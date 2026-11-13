import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, rename, writeFile, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, INDEX_SQL, LICENSE_SCHEMA_VERSION } from '../../src/db/schema.js';
import { checkSchemas } from '../../src/db/handle.js';
import { createApp } from '../../src/server/app.js';
import { makeGeoDb } from '../helpers/geo-fixture.js';

const COLS = ['usid', 'call', 'status', 'applicant_type', 'last', 'first', 'zip', 'zip5', 'trustee_call',
  'first_license_date', 'op_class'];
const ROWS = [
  [1, 'K7AAA', 'A', 'I', 'TESTER', 'ALPHA', '59801', '59801', '', '2026-05-01', 'T'],
  [2, 'K7BBB', 'A', 'I', 'TESTER', 'BETA', '59801', '59801', '', '2016-03-02', 'G'],
  [3, 'K7CCC', 'A', 'I', 'TESTER', 'GAMMA', '59806', '59806', '', '2016-03-02', 'G'],
];

function makeLicenseDb(path, { version = LICENSE_SCHEMA_VERSION, asOf = '2026-11-10', count = ROWS.length } = {}) {
  const db = new Database(path);
  db.exec(SCHEMA_SQL + INDEX_SQL);
  const meta = db.prepare('INSERT INTO meta VALUES (?, ?)');
  meta.run('schema_version', String(version));
  meta.run('data_as_of', asOf);
  meta.run('license_count', String(count));
  const ins = db.prepare(`INSERT INTO licenses (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`);
  for (const r of ROWS) ins.run(r);
  db.close();
}

const COUNTIES = [{ geoid: '30063', name: 'Missoula', state: 'MT' }];
const GEO_ZIPS = [
  { zip: '59801', state: 'MT', county_geoid: '30063' },
  { zip: '59806', state: 'MT', county_geoid: '30063' },
];

// Runs fn(base, dir, app) against an app on an ephemeral port, then cleans up.
async function withApp(setup, opts, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'app-'));
  await setup?.(dir);
  const app = createApp({ dataDir: dir, ...opts });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`, dir, app);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    app.locals.handle.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const fixture = (dir) => {
  makeLicenseDb(join(dir, 'licenses.db'));
  makeGeoDb(join(dir, 'geo.db'), { counties: COUNTIES, zips: GEO_ZIPS });
};
const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const filters = { firstLicenseSince: null, includeUpgrades: false, includeExpired: false, includeClubs: false };

test('returns 503 when no license db', async () => {
  await withApp(null, {}, async (base) => {
    const res = await post(`${base}/api/search`, { counties: ['30063'], filters });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'Data not loaded yet' });
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  });
});

test('search, export, and lookup routes', async () => {
  await withApp(fixture, {}, async (base) => {
    const res = await post(`${base}/api/search`, { counties: ['30063'], filters });
    const body = await res.json();
    assert.equal(body.count, 3);
    assert.equal(body.zipCount, 2);
    assert.equal(body.preview.length, 3);
    assert.equal(body.preview[0].county_name, 'Missoula');

    const csv = await post(`${base}/api/export`, { counties: ['30063'], filters });
    assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.match(csv.headers.get('content-disposition'), /^attachment; filename="hams-\d{4}-\d{2}-\d{2}\.csv"$/);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await csv.arrayBuffer());
    const lines = text.split('\r\n').filter(Boolean);
    assert.ok(lines[0].startsWith('﻿Call Sign,'));
    assert.equal(lines.length, body.count + 1);

    assert.deepEqual(await (await fetch(`${base}/api/states`)).json(), [{ abbr: 'MT', name: 'Montana' }]);
    assert.deepEqual(await (await fetch(`${base}/api/counties?state=MT`)).json(), [
      { geoid: '30063', name: 'Missoula', state: 'MT', zipCount: 2 },
    ]);
    const zips = await (await fetch(`${base}/api/zips?state=MT`)).json();
    assert.deepEqual(zips[0], { zip: '59801', countyGeoid: '30063', countyName: 'Missoula', hasShape: true });
    assert.equal((await fetch(`${base}/api/counties`)).status, 400);
  });
});

test('rejects bad input', async () => {
  await withApp(fixture, {}, async (base) => {
    let res = await post(`${base}/api/search`, { zips: ['12'], filters });
    assert.equal(res.status, 400);
    assert.deepEqual((await res.json()).invalid, ['12']);

    const many = Array.from({ length: 5001 }, (_, i) => String(10000 + i));
    res = await post(`${base}/api/search`, { zips: many, filters });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Too many ZIP codes (max 5000)' });

    res = await post(`${base}/api/export`, { filters });
    assert.equal(res.status, 400);
    for (const bad of [null, [], 'x']) {
      res = await post(`${base}/api/search`, { zips: ['59801'], filters: bad });
      assert.equal(res.status, 400);
    }
    res = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(res.status, 400);
  });
});

test('returns 503 updating when schema is outdated', async () => {
  const setup = (dir) => {
    makeLicenseDb(join(dir, 'licenses.db'), { version: 0 });
    makeGeoDb(join(dir, 'geo.db'), { counties: COUNTIES, zips: GEO_ZIPS });
  };
  await withApp(setup, {}, async (base, dir) => {
    const res = await post(`${base}/api/search`, { counties: ['30063'], filters });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'Data is being updated. Try again soon.' });
    assert.deepEqual(checkSchemas(dir), { licenses: 'outdated', geo: 'ok' });
    const cli = spawnSync(process.execPath, ['scripts/check-schema.js'], { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' });
    assert.equal(cli.status, 3);
    assert.equal(cli.stdout.trim(), 'licenses=outdated geo=ok');
  });
});

test('meta stale flag', async () => {
  const get = async (nowIso) => {
    let out;
    await withApp(fixture, { now: () => new Date(nowIso) }, async (base) => {
      out = await (await fetch(`${base}/api/meta`)).json();
    });
    return out;
  };
  const old = await get('2026-11-21T12:00:00Z');
  assert.deepEqual(old, { dataAsOf: '2026-11-10', licenseCount: 3, stale: true });
  assert.equal((await get('2026-11-13T12:00:00Z')).stale, false);
});

test('reopens db after license or geo file swap', async () => {
  await withApp(fixture, { recheckMs: 20 }, async (base, dir) => {
    assert.equal((await (await fetch(`${base}/api/meta`)).json()).licenseCount, 3);
    makeLicenseDb(join(dir, 'next.db'), { count: 99 });
    await rename(join(dir, 'next.db'), join(dir, 'licenses.db'));
    await new Promise((r) => setTimeout(r, 60));
    assert.equal((await (await fetch(`${base}/api/meta`)).json()).licenseCount, 99);

    makeGeoDb(join(dir, 'next-geo.db'), { counties: [{ geoid: '16001', name: 'Ada', state: 'ID' }], zips: [] });
    await rename(join(dir, 'next-geo.db'), join(dir, 'geo.db'));
    await new Promise((r) => setTimeout(r, 60));
    assert.deepEqual(await (await fetch(`${base}/api/states`)).json(), [{ abbr: 'ID', name: 'Idaho' }]);
  });
});

test('rate limit applies to the api', async () => {
  await withApp(fixture, { rateLimitPerMinute: 2 }, async (base) => {
    assert.equal((await fetch(`${base}/api/states`)).status, 200);
    assert.equal((await fetch(`${base}/api/states`)).status, 200);
    assert.equal((await fetch(`${base}/api/states`)).status, 429);
  });
});

test('retries a failed open even when the file inode is unchanged', async () => {
  const setup = async (dir) => {
    await writeFile(join(dir, 'licenses.db'), 'not a database, just garbage '.repeat(50));
    makeGeoDb(join(dir, 'geo.db'), { counties: COUNTIES, zips: GEO_ZIPS });
  };
  await withApp(setup, { recheckMs: 20 }, async (base, dir) => {
    assert.equal((await fetch(`${base}/api/meta`)).status, 503);
    makeLicenseDb(join(dir, 'good.db'));
    await copyFile(join(dir, 'good.db'), join(dir, 'licenses.db')); // same inode, new contents
    await new Promise((r) => setTimeout(r, 60));
    assert.equal((await fetch(`${base}/api/meta`)).status, 200);
  });
});

test('public files revalidate; vendor files cache', async () => {
  await withApp(fixture, {}, async (base) => {
    for (const path of ['/', '/js/main.js']) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('cache-control'), /no-cache/);
    }
    const leaflet = await fetch(`${base}/vendor/leaflet/leaflet.js`);
    assert.match(leaflet.headers.get('cache-control'), /max-age=86400/);
  });
});
