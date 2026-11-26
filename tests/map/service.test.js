import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createMapService } from '../../src/map/service.js';
import { openPointStore } from '../../src/map/store.js';
import { mapAddress } from '../../src/map/address.js';
import { makeGeoDb } from '../helpers/geo-fixture.js';
import { makeLicenseDb } from '../helpers/license-fixture.js';

const ham = (usid, call, address) => ({
  usid, call, last: 'TESTER', first: `HAM${usid}`, city: 'Missoula', state: 'MT',
  zip: '59801', zip5: '59801', first_license_date: '2026-05-01', op_class: 'T', ...address,
});
const ROWS = [
  ham(1, 'K7AAA', { street: '12 Main St' }),
  ham(2, 'K7BBB', { street: '12 Main Street' }),
  ham(3, 'K7CCC', { street: '', po_box: '486' }),
  ham(4, 'K7DDD', { street: '99 Unknown Rd' }),
];
const MAIN = mapAddress(ROWS[0]).key;
const UNKNOWN = mapAddress(ROWS[3]);
const ZIPS = ['59801'];
const FILTERS = { firstLicenseSince: null, includeUpgrades: false, includeExpired: false, includeClubs: false };
const BOX = { south: 46.8, west: -114.1, north: 46.9, east: -113.9 };

// A licenses.db with geo.db attached, the way openHandle serves it.
function openDb(dir, name, rows) {
  const path = join(dir, name);
  makeLicenseDb(path, { rows });
  const db = new Database(path);
  db.prepare('ATTACH DATABASE ? AS geo').run(join(dir, 'geo.db'));
  return db;
}

function setup({ saved = [{ key: MAIN, status: 'match', lat: 46.87, lon: -114.0 }], optOut = [], queueError = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'map-service-'));
  makeGeoDb(join(dir, 'geo.db'), { counties: [{ geoid: '30063', name: 'Missoula', state: 'MT' }],
    zips: [{ zip: '59801', state: 'MT', county_geoid: '30063' }] });
  const db = openDb(dir, 'licenses.db', ROWS);
  const store = openPointStore(join(dir, 'geocode.db'));
  store.save(saved);
  const wanted = [];
  const pending = new Set();
  const queue = {
    want(items) {
      wanted.push(items);
      for (const i of items) pending.add(i.key);
      return { error: null };
    },
    isPending: (key) => pending.has(key),
    error: () => queueError,
  };
  const calls = new Set(optOut);
  const t = {
    dir, db, store, queue, wanted,
    optOut: { calls: () => calls },
    done() {
      t.db.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return t;
}

test('prepare counts placed, unplaceable, and pending hams and queues only missing addresses', () => {
  const t = setup();
  const service = createMapService({ store: t.store, queue: t.queue, optOut: t.optOut });
  const out = service.prepare(t.db, ZIPS, FILTERS);
  assert.deepEqual(out, { total: 4, placed: 2, unplaceable: 1, pending: 1, error: null });
  assert.deepEqual(t.wanted, [[
    { key: UNKNOWN.key, street: '99 Unknown Rd', city: 'Missoula', state: 'MT', zip: '59801' },
  ]]);
  t.done();
});

test('one opted-out ham hides the whole address and it is never queued', () => {
  const t = setup({ optOut: ['K7AAA'], saved: [] });
  const service = createMapService({ store: t.store, queue: t.queue, optOut: t.optOut });
  const out = service.prepare(t.db, ZIPS, FILTERS);
  assert.deepEqual(out, { total: 4, placed: 0, unplaceable: 3, pending: 1, error: null });
  assert.ok(t.wanted.flat().every((i) => i.key !== MAIN));
  const pts = service.points(t.db, ZIPS, FILTERS, BOX, 16);
  assert.deepEqual(pts.pins, []);
  t.done();
});

test('an opted-out ham filtered out of the search still hides their whole address', () => {
  const t = setup({ optOut: ['K7OLD'], saved: [] });
  t.db.close();
  const rows = [...ROWS, ham(9, 'K7OLD', { street: '12 Main Street', first_license_date: '2001-01-01' })];
  t.db = openDb(t.dir, 'with-old.db', rows);
  const service = createMapService({ store: t.store, queue: t.queue, optOut: t.optOut });
  const since = { ...FILTERS, firstLicenseSince: '2026-01-01' };
  const out = service.prepare(t.db, ZIPS, since);
  assert.deepEqual(out, { total: 4, placed: 0, unplaceable: 3, pending: 1, error: null });
  assert.deepEqual(t.wanted.flat().map((i) => i.key), [UNKNOWN.key]);
  t.store.save([{ key: MAIN, status: 'match', lat: 46.87, lon: -114.0 }]);
  assert.deepEqual(service.points(t.db, ZIPS, since, BOX, 16).pins, []);
  t.done();
});

test('a fresh none counts as unplaceable and is not queued', () => {
  const t = setup({ saved: [{ key: UNKNOWN.key, status: 'none', lat: null, lon: null }] });
  const service = createMapService({ store: t.store, queue: t.queue, optOut: t.optOut });
  const out = service.prepare(t.db, ZIPS, FILTERS);
  assert.equal(out.unplaceable, 2);
  assert.deepEqual(t.wanted.flat().map((i) => i.key), [MAIN]);
  t.done();
});

test('too many new addresses queues nothing', () => {
  const t = setup({ saved: [] });
  const service = createMapService({ store: t.store, queue: t.queue, optOut: t.optOut, maxPerRequest: 1 });
  const out = service.prepare(t.db, ZIPS, FILTERS);
  assert.equal(out.error, 'This area has too many new addresses to map at once. Pick a smaller area.');
  assert.equal(out.pending, 0);
  assert.deepEqual(t.wanted, []);
  t.done();
});

test('a queue in cool-down returns its error and queues nothing', () => {
  const msg = 'The map service is not answering. Try again later.';
  const t = setup({ queueError: msg });
  const service = createMapService({ store: t.store, queue: t.queue, optOut: t.optOut });
  const out = service.prepare(t.db, ZIPS, FILTERS);
  assert.equal(out.error, msg);
  assert.equal(out.placed, 2);
  assert.deepEqual(t.wanted, []);
  t.done();
});

test('points returns pins with only the popup fields, inside the box', () => {
  const t = setup();
  const service = createMapService({ store: t.store, queue: t.queue, optOut: t.optOut });
  const out = service.points(t.db, ZIPS, FILTERS, BOX, 16);
  assert.equal(out.clusters.length, 0);
  assert.equal(out.pins.length, 1);
  assert.deepEqual(out.pins[0].hams.map((h) => h.call), ['K7AAA', 'K7BBB']);
  for (const h of out.pins[0].hams) {
    assert.deepEqual(Object.keys(h).sort(), ['call', 'city', 'entity_name', 'first', 'last', 'mi', 'op_class', 'suffix']);
  }
  assert.equal(out.inView.count, 2);
  assert.deepEqual(out.inView.hams.map((h) => h.call), ['K7AAA', 'K7BBB']);
  assert.doesNotMatch(JSON.stringify(out), /"street"|"zip5"|Main/);

  const away = service.points(t.db, ZIPS, FILTERS, { south: 40, west: -100, north: 41, east: -99 }, 16);
  assert.deepEqual(away, { clusters: [], pins: [], inView: { count: 0, hams: [] } });
  t.done();
});

test('the keyed-rows cache is per connection and expires', () => {
  const t = setup();
  let clock = 1_000;
  const service = createMapService({ store: t.store, queue: t.queue, optOut: t.optOut, now: () => clock });
  assert.equal(service.prepare(t.db, ZIPS, FILTERS).total, 4);

  const other = openDb(t.dir, 'other.db', [...ROWS, ham(5, 'K7EEE', { street: '5 Oak Ave' })]);
  assert.equal(service.prepare(other, ZIPS, FILTERS).total, 5);
  other.close();

  t.db.prepare('DELETE FROM licenses WHERE call = ?').run('K7DDD');
  assert.equal(service.prepare(t.db, ZIPS, FILTERS).total, 4); // still cached
  clock += 60_001;
  assert.equal(service.prepare(t.db, ZIPS, FILTERS).total, 3);
  t.done();
});

// A write from another connection, the way the daily update writes into the live licenses.db.
function writeFromOtherConnection(t, sql, ...args) {
  const other = new Database(t.db.name);
  other.prepare(sql).run(...args);
  other.close();
}
function insertFromOtherConnection(t, r) {
  const row = { status: 'A', applicant_type: 'I', trustee_call: '', last_key: 'TESTER', ...r };
  const cols = Object.keys(row);
  const other = new Database(t.db.name);
  other.prepare(`INSERT INTO licenses (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`).run(row);
  other.close();
}

test('a daily update that adds an opted-out call hides its address at once and never queues it', () => {
  const t = setup({ optOut: ['K7NEW'] });
  const service = createMapService({ store: t.store, queue: t.queue, optOut: t.optOut });
  assert.equal(service.prepare(t.db, ZIPS, FILTERS).total, 4);
  const pine = ham(7, 'K7NEW', { street: '7 Pine St' });
  insertFromOtherConnection(t, pine);
  const pineKey = mapAddress(pine).key;
  t.wanted.length = 0;
  const out = service.prepare(t.db, ZIPS, FILTERS);
  assert.equal(out.total, 5);
  assert.equal(out.unplaceable, 2);
  assert.ok(t.wanted.flat().every((i) => i.key !== pineKey));
  t.store.save([{ key: pineKey, status: 'match', lat: 46.86, lon: -114.0 }]);
  assert.equal(service.points(t.db, ZIPS, FILTERS, BOX, 16).inView.hams.some((h) => h.call === 'K7NEW'), false);
  t.done();
});

test('an opted-out ham who moves in a daily update hides the new address', () => {
  const t = setup({ optOut: ['K7DDD'], saved: [] });
  const service = createMapService({ store: t.store, queue: t.queue, optOut: t.optOut });
  service.prepare(t.db, ZIPS, FILTERS);
  writeFromOtherConnection(t, "UPDATE licenses SET street = '12 Main St' WHERE call = 'K7DDD'");
  t.wanted.length = 0;
  service.prepare(t.db, ZIPS, FILTERS);
  assert.ok(t.wanted.flat().every((i) => i.key !== MAIN));
  t.done();
});

test('the keyed-rows cache never serves rows from before another connection wrote', () => {
  const t = setup();
  const service = createMapService({ store: t.store, queue: t.queue, optOut: t.optOut });
  assert.equal(service.prepare(t.db, ZIPS, FILTERS).total, 4);
  writeFromOtherConnection(t, 'DELETE FROM licenses WHERE call = ?', 'K7DDD');
  assert.equal(service.prepare(t.db, ZIPS, FILTERS).total, 3);
  t.done();
});

test('the keyed-rows cache holds at most 6 searches per connection, least recently used out first', () => {
  const t = setup();
  const service = createMapService({ store: t.store, queue: t.queue, optOut: t.optOut });
  const search = (i) => ({ ...FILTERS, firstLicenseSince: `2000-01-0${i}` });
  for (let i = 1; i <= 6; i++) assert.equal(service.prepare(t.db, ZIPS, search(i)).total, 4);
  t.db.prepare('DELETE FROM licenses WHERE call = ?').run('K7DDD'); // same connection: caches stay
  assert.equal(service.prepare(t.db, ZIPS, search(1)).total, 4); // cached, now most recent
  assert.equal(service.prepare(t.db, ZIPS, search(7)).total, 3); // evicts search 2
  assert.equal(service.prepare(t.db, ZIPS, search(2)).total, 3); // read again; evicts search 3
  assert.equal(service.prepare(t.db, ZIPS, search(1)).total, 4); // still cached
  t.done();
});

test('a search with too many hams is refused by prepare and points, with nothing queued', () => {
  const msg = 'This area has too many hams to map at once. Pick a smaller area.';
  const t = setup({ saved: [] });
  const service = createMapService({ store: t.store, queue: t.queue, optOut: t.optOut, maxHams: 3 });
  const out = service.prepare(t.db, ZIPS, FILTERS);
  assert.equal(out.error, msg);
  assert.equal(out.pending, 0);
  assert.equal(out.placed, 0);
  assert.deepEqual(t.wanted, []);
  const pts = service.points(t.db, ZIPS, FILTERS, BOX, 16);
  assert.deepEqual(pts, { clusters: [], pins: [], inView: { count: 0, hams: [] }, error: msg });
  const ok = createMapService({ store: t.store, queue: t.queue, optOut: t.optOut, maxHams: 4 });
  assert.equal(ok.prepare(t.db, ZIPS, FILTERS).error, null);
  t.done();
});
