import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { loadWeekly, parseCountsDate, reclassify } from '../../src/db/load-weekly.js';
import { LICENSE_SCHEMA_VERSION } from '../../src/db/schema.js';
import { makeFccZip } from '../helpers/fcc-fixture.js';

const COUNTS = ['File Creation Date: Sun Nov  8 09:08:58 EST 2026'];

function line(len, prefix, fields) {
  const f = new Array(len).fill('');
  f[0] = prefix;
  for (const [i, v] of Object.entries(fields)) f[i] = String(v);
  return f.join('|');
}
const en = (usid, last, first, { state = 'MT', zip = '59801-1234', frn, type = 'I', cls = 'L' }) => line(24, 'EN', {
  1: usid, 5: cls, 7: `${last.toUpperCase()}, ${first.toUpperCase()}`, 8: first, 10: last,
  15: '1 Main St', 16: 'Town', 17: state, 18: zip, 22: frn, 23: type,
});
const hd = (usid, call, grant) => line(59, 'HD', {
  1: usid, 4: call, 5: 'A', 6: 'HA', 7: grant, 8: '01/01/2036', 43: grant,
});
const am = (usid, call, cls, prevCall = '', prevClass = '', trustee = '') => line(17, 'AM', {
  1: usid, 4: call, 5: cls, 8: trustee, 15: prevCall, 16: prevClass,
});
const hs = (usid, call, date, code) => line(6, 'HS', { 1: usid, 3: call, 4: date, 5: code });

function fixture({ withE = true, extra = false } = {}) {
  const lines = { EN: [], HD: [], AM: [], HS: [], counts: COUNTS };
  const add = (e, h, a, hist) => {
    lines.EN.push(e); lines.HD.push(h); lines.AM.push(a); lines.HS.push(...hist);
  };
  add(en(1, 'Tester', 'Alpha', { frn: '0000000001' }), hd(1, 'k7aaa', '05/01/2026'), am(1, 'K7AAA', 'T'),
    [hs(1, 'K7AAA', '05/01/2026', 'LIISS')]);
  add(en(2, 'Tester', 'Beta', { frn: '0000000002' }), hd(2, 'K7BBB', '03/01/2026'), am(2, 'K7BBB', 'G'),
    [hs(2, 'K7BBB', '03/02/2016', 'LIISS'), hs(2, 'K7BBB', '03/01/2026', 'LIREN')]);
  add(en(3, 'Tester', 'Gamma', { frn: '0000000003' }), hd(3, 'K7CCC', '06/01/2026'), am(3, 'K7CCC', 'G', '', 'T'),
    [hs(3, 'K7CCC', '06/01/2026', 'LIMOD')]);
  add(en(4, 'Tester Club', 'Delta', { frn: '0000000004', type: 'B' }), hd(4, 'W7DDD', '02/02/2025'),
    am(4, 'W7DDD', '', '', '', 'K7AAA'), [hs(4, 'W7DDD', '02/02/2025', 'LIISS')]);
  if (withE) {
    add(en(5, 'Tester', 'Echo', { frn: '0000000001' }), hd(5, 'K7EEE', '01/01/2019'), am(5, 'K7EEE', 'E'),
      [hs(5, 'K7EEE', '01/01/2019', 'LIISS')]);
  }
  if (extra) {
    add(en(6, 'Tester', 'Foxtrot', { frn: '0000000006', state: 'OR', zip: '97201' }),
      hd(6, 'K7FFF', '04/01/2026'), am(6, 'K7FFF', 'T'), [hs(6, 'K7FFF', '04/01/2026', 'LIISS')]);
  }
  return lines;
}

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'ham-load-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const read = (path) => new Database(path, { readonly: true });

test('parseCountsDate', () => {
  assert.equal(parseCountsDate(COUNTS[0]), '2026-11-08');
  assert.equal(parseCountsDate('File Creation Date: Wed Dec 23 01:02:03 EST 2026\r\n'), '2026-12-23');
  assert.throws(() => parseCountsDate('nope'));
});

test('loadWeekly builds licenses with classification, FRN pass and meta', async () => {
  await withDir(async (dir) => {
    const zip = await makeFccZip(dir, fixture());
    const out = join(dir, 'licenses.db');
    const res = await loadWeekly(zip, out);
    assert.deepEqual(res, { licenseCount: 5, fileDate: '2026-11-08' });
    const db = read(out);
    try {
      const get = (call) => db.prepare('SELECT * FROM licenses WHERE call = ?').get(call);
      const a = get('K7AAA');
      assert.equal(a.first_license_date, null); // E on the same FRN is older
      assert.equal(a.earliest_event_date, '2026-05-01');
      assert.equal(a.zip5, '59801');
      assert.equal(a.entity_name, 'TESTER, ALPHA');
      assert.equal(get('K7BBB').first_license_date, '2016-03-02'); // renewal: first issued long ago
      assert.equal(get('K7CCC').upgrade_date, '2026-06-01');
      const d = get('W7DDD');
      assert.equal(d.applicant_type, 'B');
      assert.equal(d.trustee_call, 'K7AAA');
      assert.equal(get('K7EEE').first_license_date, '2019-01-01');
      const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
      assert.equal(meta.data_as_of, '2026-11-08');
      assert.equal(meta.weekly_file_date, '2026-11-08');
      assert.equal(meta.daily_applied_through, '2026-11-08');
      assert.equal(meta.license_count, '5');
      assert.equal(meta.schema_version, String(LICENSE_SCHEMA_VERSION));
      assert.equal(meta.load_states, '');
      assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'lic_zip5'").get());
    } finally {
      db.close();
    }
  });
});

test('first license date survives without a same-FRN older license', async () => {
  await withDir(async (dir) => {
    const zip = await makeFccZip(dir, fixture({ withE: false }));
    const out = join(dir, 'licenses.db');
    assert.equal((await loadWeekly(zip, out)).licenseCount, 4);
    const db = read(out);
    try {
      assert.equal(db.prepare("SELECT first_license_date f FROM licenses WHERE call = 'K7AAA'").get().f, '2026-05-01');
    } finally {
      db.close();
    }
  });
});

test('loadWeekly with states keeps only matching rows and their history', async () => {
  await withDir(async (dir) => {
    const zip = await makeFccZip(dir, fixture({ withE: false, extra: true }));
    const out = join(dir, 'licenses.db');
    const res = await loadWeekly(zip, out, { states: ['MT'] });
    assert.equal(res.licenseCount, 4);
    const db = read(out);
    try {
      assert.equal(db.prepare("SELECT count(*) n FROM licenses WHERE state <> 'MT'").get().n, 0);
      assert.equal(db.prepare('SELECT count(*) n FROM history WHERE usid = 6').get().n, 0);
      assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'load_states'").get().value, 'MT');
    } finally {
      db.close();
    }
  });
});

test('loadWeekly replaces an existing db and leaves no stage file', async () => {
  await withDir(async (dir) => {
    const zip = await makeFccZip(dir, fixture());
    const out = join(dir, 'licenses.db');
    await loadWeekly(zip, out);
    assert.equal((await loadWeekly(zip, out)).licenseCount, 5);
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual((await readdir(dir)).filter((n) => n.includes('stage')), []);
  });
});

test('loadWeekly rejects a zip without required entries', async () => {
  await withDir(async (dir) => {
    const zip = await makeFccZip(dir, { EN: ['EN|1'], counts: COUNTS });
    await assert.rejects(loadWeekly(zip, join(dir, 'licenses.db')), /missing HD\.dat/);
  });
});

test('reclassify with usids recomputes just those licenses', async () => {
  await withDir(async (dir) => {
    const zip = await makeFccZip(dir, fixture({ withE: false }));
    const out = join(dir, 'licenses.db');
    await loadWeekly(zip, out);
    const db = new Database(out);
    try {
      db.prepare("UPDATE licenses SET first_license_date = 'x', upgrade_date = 'x'").run();
      reclassify(db, [1]);
      const row = (u) => db.prepare('SELECT first_license_date f, upgrade_date g FROM licenses WHERE usid = ?').get(u);
      assert.deepEqual(row(1), { f: '2026-05-01', g: null });
      assert.deepEqual(row(2), { f: 'x', g: 'x' });
      reclassify(db);
      assert.deepEqual(row(2), { f: '2016-03-02', g: null });
      assert.deepEqual(row(3), { f: null, g: '2026-06-01' });
    } finally {
      db.close();
    }
  });
});
