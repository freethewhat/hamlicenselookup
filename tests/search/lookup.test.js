import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, INDEX_SQL } from '../../src/db/schema.js';
import { nameKey } from '../../src/db/name-key.js';
import { escapeLike, lookup, lookupSql } from '../../src/search/lookup.js';
import { makeGeoDb } from '../helpers/geo-fixture.js';

const COLS = ['usid', 'call', 'status', 'applicant_type', 'last', 'first', 'entity_name', 'city', 'state', 'zip5', 'street'];
const ROWS = [
  [1, 'K7AAA', 'A', 'I', 'MC TESTER', 'ALPHA', '', 'Missoula', 'MT', '59801', '12 Pine St'],
  [2, 'K7AAA', 'C', 'I', 'OLDTESTER', 'ZED', '', '', '', '59801', ''],
  [3, 'K7BBB', 'A', 'I', 'McTester', 'BETA', '', 'MISSOULA', 'MT', '59801', '5 100%_Rd'],
  [4, 'W7CCC', 'A', 'B', '', '', 'TESTER RADIO CLUB', '', 'MT', '59806', ''],
  [5, 'K7DDD', 'E', 'I', 'TESTERSON', 'DELTA', '', 'Missoula', 'MT', '59801', ''],
  [6, 'K7EEE', 'A', 'I', 'MCTESTER', 'ECHO', 'ZULU, ECHO', 'Helena', 'MT', '59601', ''],
];

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'lookup-'));
  const db = new Database(join(dir, 'licenses.db'));
  db.exec(SCHEMA_SQL + INDEX_SQL);
  const ins = db.prepare(`INSERT INTO licenses (${COLS.join(',')}, last_key) VALUES (${COLS.map(() => '?').join(',')}, ?)`);
  for (const r of ROWS) ins.run(...r, nameKey(r[4]));
  const geo = join(dir, 'geo.db');
  makeGeoDb(geo, {
    counties: [{ geoid: '30063', name: 'Missoula', state: 'MT' }],
    zips: [
      { zip: '59801', state: 'MT', county_geoid: '30063' },
      { zip: '59806', state: 'MT', county_geoid: '30063' },
    ],
  });
  db.prepare('ATTACH DATABASE ? AS geo').run(geo);
  return { dir, db };
}

async function withDb(fn) {
  const { dir, db } = await fixture();
  try {
    await fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const calls = (db, p, limit) => lookup(db, p, limit).rows.map((r) => r.call);

test('escapeLike escapes backslash, percent, and underscore', () => {
  assert.equal(escapeLike('a\\b%c_d'), 'a\\\\b\\%c\\_d');
});

test('call: exact, every holder, active first', () => withDb((db) => {
  assert.deepEqual(lookup(db, { by: 'call', q: 'K7AAA' }).rows.map((r) => r.usid), [1, 2]);
  assert.equal(lookup(db, { by: 'call', q: 'K7AAA' }).rows[0].county_name, 'Missoula');
}));

test('name: one word and whole text match last_key prefix across spellings', () => withDb((db) => {
  assert.deepEqual(calls(db, { by: 'name', q: 'mctester' }), ['K7AAA', 'K7BBB', 'K7EEE']);
  assert.deepEqual(calls(db, { by: 'name', q: 'mc tester' }), ['K7AAA', 'K7BBB', 'K7EEE']);
  assert.deepEqual(calls(db, { by: 'name', q: 'TESTERS' }), ['K7DDD']);
}));

test('name: first word + rest of words', () => withDb((db) => {
  assert.deepEqual(calls(db, { by: 'name', q: 'beta mc tester' }), ['K7BBB']);
}));

test('name: clubs match entity_name prefix, individuals do not', () => withDb((db) => {
  assert.deepEqual(calls(db, { by: 'name', q: 'tester radio' }), ['W7CCC']);
  assert.deepEqual(calls(db, { by: 'name', q: 'zulu' }), []);
}));

test('street: contains, with % and _ literal', () => withDb((db) => {
  assert.deepEqual(calls(db, { by: 'street', q: 'pine' }), ['K7AAA']);
  assert.deepEqual(calls(db, { by: 'street', q: '0%' }), ['K7BBB']);
  assert.deepEqual(calls(db, { by: 'street', q: '1_0' }), []);
}));

test('city: case-free equality within a state', () => withDb((db) => {
  assert.deepEqual(calls(db, { by: 'city', q: 'missoula', state: 'MT' }), ['K7AAA', 'K7BBB', 'K7DDD']);
  assert.deepEqual(calls(db, { by: 'city', q: 'missoula', state: 'OR' }), []);
}));

test('county and zip', () => withDb((db) => {
  assert.deepEqual(calls(db, { by: 'zip', q: '59806' }), ['W7CCC']);
  // Active first (sorted by name, clubs by entity name), then the rest.
  assert.deepEqual(calls(db, { by: 'county', county: '30063' }), ['K7AAA', 'K7BBB', 'W7CCC', 'K7AAA', 'K7DDD']);
}));

test('count is the full count; rows stop at the limit', () => withDb((db) => {
  const res = lookup(db, { by: 'city', q: 'missoula', state: 'MT' }, 2);
  assert.equal(res.count, 3);
  assert.equal(res.rows.length, 2);
}));

test('every lookup but street uses an index', () => withDb((db) => {
  for (const p of [
    { by: 'call', q: 'K7AAA' },
    { by: 'name', q: 'mctester' },
    { by: 'name', q: 'beta mc tester' },
    { by: 'city', q: 'missoula', state: 'MT' },
    { by: 'zip', q: '59801' },
    { by: 'county', county: '30063' },
  ]) {
    const { sql, params } = lookupSql(db, p);
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(params).map((r) => r.detail);
    assert.ok(!plan.includes('SCAN l'), `${p.by} ${p.q}: ${plan.join(' | ')}`);
  }
}));

test('older licenses of the same holder show newest first', () => withDb((db) => {
  const ins = db.prepare("INSERT INTO licenses (usid, call, status, applicant_type, last, first, last_key, grant_date) VALUES (?, 'K7ZZZ', 'C', 'I', 'ZZTESTER', 'ZULU', 'ZZTESTER', ?)");
  ins.run(10, '2001-01-01');
  ins.run(11, '2011-01-01');
  ins.run(12, '2006-01-01');
  assert.deepEqual(lookup(db, { by: 'call', q: 'K7ZZZ' }).rows.map((r) => r.usid), [11, 12, 10]);
}));
