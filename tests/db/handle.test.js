import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, LICENSE_SCHEMA_VERSION } from '../../src/db/schema.js';
import { openHandle } from '../../src/db/handle.js';
import { makeGeoDb } from '../helpers/geo-fixture.js';

function makeLicenseDb(path, rows = 3) {
  const db = new Database(path);
  db.exec(SCHEMA_SQL);
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('schema_version', String(LICENSE_SCHEMA_VERSION));
  const ins = db.prepare('INSERT INTO licenses (usid, call) VALUES (?, ?)');
  for (let i = 1; i <= rows; i++) ins.run(i, `K7T${i}`);
  db.close();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('retiring a connection with an open iterator retries instead of throwing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handle-'));
  const uncaught = [];
  const onUncaught = (err) => uncaught.push(err);
  process.on('uncaughtException', onUncaught);
  const licenseDbPath = join(dir, 'licenses.db');
  makeLicenseDb(licenseDbPath);
  makeGeoDb(join(dir, 'geo.db'));
  const handle = openHandle({
    licenseDbPath, geoDbPath: join(dir, 'geo.db'), recheckMs: 0, closeGraceMs: 30, busyRetryMs: 30,
  });
  try {
    const old = handle.get();
    const it = old.prepare('SELECT call FROM licenses').iterate();
    assert.equal(it.next().value.call, 'K7T1');

    makeLicenseDb(join(dir, 'next.db'));
    await rename(join(dir, 'next.db'), licenseDbPath);
    assert.notEqual(handle.get(), old); // swap retires the old connection

    await sleep(120); // past the grace period and several retries
    assert.deepEqual(uncaught, []);
    assert.equal(old.open, true); // still busy, so still open

    it.return();
    await sleep(120);
    assert.equal(old.open, false);
    assert.deepEqual(uncaught, []);
  } finally {
    process.off('uncaughtException', onUncaught);
    handle.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('close() on shutdown ignores a connection that is busy', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'handle-'));
  const licenseDbPath = join(dir, 'licenses.db');
  makeLicenseDb(licenseDbPath);
  makeGeoDb(join(dir, 'geo.db'));
  const handle = openHandle({ licenseDbPath, geoDbPath: join(dir, 'geo.db'), recheckMs: 0 });
  try {
    const old = handle.get();
    const it = old.prepare('SELECT call FROM licenses').iterate();
    it.next();
    makeLicenseDb(join(dir, 'next.db'));
    await rename(join(dir, 'next.db'), licenseDbPath);
    const live = handle.get();
    const it2 = live.prepare('SELECT call FROM licenses').iterate();
    it2.next();
    assert.doesNotThrow(() => handle.close());
    it.return();
    it2.return();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
