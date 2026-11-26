import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openPointStore, GEOCODE_SCHEMA_VERSION } from '../../src/map/store.js';

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'store-'));
  return { dir, path: join(dir, 'geocode.db'), done: () => rmSync(dir, { recursive: true, force: true }) };
}

const rows = [
  { key: 'a', status: 'match', lat: 46.8, lon: -114 },
  { key: 'b', status: 'none', lat: null, lon: null },
];

test('save then lookup returns saved rows, omits unknown keys', () => {
  const t = tmp();
  const store = openPointStore(t.path);
  store.save(rows);
  const got = store.lookup(['a', 'b', 'c']);
  assert.deepEqual(got.get('a'), { status: 'match', lat: 46.8, lon: -114, fresh: true });
  assert.deepEqual(got.get('b'), { status: 'none', lat: null, lon: null, fresh: true });
  assert.equal(got.has('c'), false);
  store.close();
  t.done();
});

test('none rows older than 90 days are not fresh', () => {
  const t = tmp();
  const s1 = openPointStore(t.path, { now: () => new Date('2026-01-01T12:00:00Z') });
  s1.save(rows);
  s1.close();
  const s2 = openPointStore(t.path, { now: () => new Date('2026-04-02T12:00:00Z') });
  const got = s2.lookup(['a', 'b']);
  assert.equal(got.get('b').fresh, false);
  assert.equal(got.get('a').fresh, true);
  s2.close();
  t.done();
});

test('lookup handles 30,000 keys', () => {
  const t = tmp();
  const store = openPointStore(t.path);
  store.save(rows);
  const keys = Array.from({ length: 30000 }, (_, i) => `k${i}`).concat('a');
  const got = store.lookup(keys);
  assert.equal(got.size, 1);
  assert.ok(got.has('a'));
  store.close();
  t.done();
});

test('save replaces an existing row', () => {
  const t = tmp();
  const store = openPointStore(t.path);
  store.save(rows);
  store.save([{ key: 'b', status: 'match', lat: 1, lon: 2 }]);
  assert.equal(store.lookup(['b']).get('b').status, 'match');
  store.close();
  t.done();
});

test('mismatched schema version moves the file aside', () => {
  const t = tmp();
  const db = new Database(t.path);
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE points (addr_key TEXT PRIMARY KEY, status TEXT NOT NULL, lat REAL, lon REAL, checked_at TEXT NOT NULL)');
  db.prepare("INSERT INTO meta VALUES ('schema_version', '0')").run();
  db.prepare("INSERT INTO points VALUES ('a', 'match', 1, 2, '2026-01-01')").run();
  db.close();
  const store = openPointStore(t.path);
  assert.equal(store.lookup(['a']).size, 0);
  store.close();
  assert.ok(readdirSync(t.dir).some((f) => f.startsWith('geocode.db.old-')));
  const check = new Database(t.path, { readonly: true });
  assert.equal(check.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value, String(GEOCODE_SCHEMA_VERSION));
  check.close();
  t.done();
});

test('WAL and SHM files move aside with the old database', () => {
  const t = tmp();
  const db = new Database(t.path);
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare("INSERT INTO meta VALUES ('schema_version', '0')").run();
  db.close();
  writeFileSync(`${t.path}-wal`, 'stale wal');
  writeFileSync(`${t.path}-shm`, 'stale shm');
  const store = openPointStore(t.path);
  store.save(rows);
  assert.equal(store.lookup(['a']).size, 1);
  store.close();
  const old = readdirSync(t.dir).filter((f) => f.startsWith('geocode.db.old-'));
  assert.ok(old.some((f) => f.endsWith('-wal')));
  assert.ok(old.some((f) => f.endsWith('-shm')));
  t.done();
});

test('a corrupt file is moved aside and the store starts empty', () => {
  const t = tmp();
  writeFileSync(t.path, Buffer.alloc(4096, 0x41));
  const store = openPointStore(t.path);
  assert.equal(store.lookup(['a']).size, 0);
  store.save(rows);
  assert.equal(store.lookup(['a']).size, 1);
  store.close();
  assert.ok(readdirSync(t.dir).some((f) => f.startsWith('geocode.db.old-')));
  t.done();
});
