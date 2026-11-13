import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, INDEX_SQL, LICENSE_SCHEMA_VERSION } from '../../src/db/schema.js';
import { countLicenses, iterateLicenses } from '../../src/search/query.js';
import { makeGeoDb } from '../helpers/geo-fixture.js';

const COLS = ['usid', 'call', 'status', 'applicant_type', 'last', 'first', 'zip', 'zip5', 'trustee_call',
  'first_license_date', 'upgrade_date', 'op_class'];
const rows = [
  [1, 'K7AAA', 'A', 'I', 'TESTER', 'ALPHA', '59801', '59801', '', '2026-05-01', null, 'T'],
  [2, 'K7BBB', 'A', 'I', 'TESTER', 'BETA', '59801', '59801', '', '2016-03-02', '2026-03-01', 'G'],
  [3, 'K7CCC', 'A', 'I', 'TESTER', 'GAMMA', '59806', '59806', '', '2016-03-02', '2015-01-01', 'G'],
  [4, 'W7DDD', 'A', 'B', 'TESTER CLUB', 'DELTA', '59801', '59801', 'K7AAA', '2025-12-01', null, ''],
  [5, 'K7EEE', 'E', 'I', 'TESTER', 'ECHO', '59801', '59801', '', '2019-01-01', null, 'E'],
  [6, 'K7FFF', 'A', 'I', 'TESTER', 'FOXTROT', '99999', '99999', '', '2026-06-01', null, 'T'],
];
const ZIPS = ['59801', '59806'];

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'query-'));
  const db = new Database(join(dir, 'licenses.db'));
  db.exec(SCHEMA_SQL + INDEX_SQL);
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('schema_version', String(LICENSE_SCHEMA_VERSION));
  const ins = db.prepare(`INSERT INTO licenses (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`);
  for (const r of rows) ins.run(r);
  const geo = join(dir, 'geo.db');
  makeGeoDb(geo, {
    counties: [{ geoid: '30063', name: 'Missoula', state: 'MT' }],
    zips: [{ zip: '59801', state: 'MT', county_geoid: '30063' }],
  });
  db.prepare('ATTACH DATABASE ? AS geo').run(geo);
  return { dir, db };
}

const base = { firstLicenseSince: null, includeUpgrades: false, includeExpired: false, includeClubs: false };
const run = (db, f, zips = ZIPS, limit) => [...iterateLicenses(db, zips, f, limit)];

test('query filters, labels, ordering, and county names', async () => {
  const { dir, db } = await fixture();
  try {
    const calls = (f, zips) => run(db, f, zips).map((r) => r.call);
    // order is zip5, last, first, call
    assert.deepEqual(calls(base), ['K7AAA', 'K7BBB', 'K7CCC']);
    assert.deepEqual(calls({ ...base, includeClubs: true }), ['K7AAA', 'K7BBB', 'W7DDD', 'K7CCC']);
    assert.deepEqual(calls({ ...base, includeExpired: true }), ['K7AAA', 'K7BBB', 'K7EEE', 'K7CCC']);

    const since = '2025-11-13';
    const fresh = run(db, { ...base, firstLicenseSince: since });
    assert.deepEqual(fresh.map((r) => [r.call, r.new_label]), [['K7AAA', 'First license']]);
    const upg = run(db, { ...base, firstLicenseSince: since, includeUpgrades: true });
    assert.deepEqual(upg.map((r) => [r.call, r.new_label]), [['K7AAA', 'First license'], ['K7BBB', 'Upgrade']]);

    // includeUpgrades is ignored without a date, and labels are empty
    const all = run(db, { ...base, includeUpgrades: true }, ['59801']);
    assert.equal(all.length, 2);
    assert.ok(all.every((r) => r.new_label === ''));

    assert.equal(all[0].county_name, 'Missoula');
    assert.equal(run(db, base, ['99999'])[0].county_name, null);
    assert.equal(countLicenses(db, ZIPS, base), run(db, base).length);
    assert.equal(countLicenses(db, ZIPS, { ...base, includeClubs: true, includeExpired: true }), 5);
    assert.equal(run(db, base, ZIPS, 2).length, 2);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
