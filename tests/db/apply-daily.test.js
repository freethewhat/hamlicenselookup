import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { loadWeekly, reclassify } from '../../src/db/load-weekly.js';
import { applyDaily } from '../../src/db/apply-daily.js';
import { makeFccZip } from '../helpers/fcc-fixture.js';
import { en, hd, am, hs } from '../helpers/fcc-lines.js';

const WEEKLY_COUNTS = ['File Creation Date: Sun Nov  8 09:08:58 EST 2026'];
const DAILY_COUNTS = ['File Creation Date: Tue Nov 10 09:08:58 EST 2026'];

function weekly() {
  const lines = { EN: [], HD: [], AM: [], HS: [], counts: WEEKLY_COUNTS };
  const add = (e, h, a, hist) => {
    lines.EN.push(e); lines.HD.push(h); lines.AM.push(a); lines.HS.push(...hist);
  };
  add(en(1, 'Tester', 'Alpha', { frn: '0000000001' }), hd(1, 'K7AAA', '05/01/2026'), am(1, 'K7AAA', 'T'),
    [hs(1, 'K7AAA', '05/01/2026', 'LIISS')]);
  add(en(2, 'Tester', 'Beta', { frn: '0000000002' }), hd(2, 'K7BBB', '03/01/2026'), am(2, 'K7BBB', 'G'),
    [hs(2, 'K7BBB', '03/02/2016', 'LIISS'), hs(2, 'K7BBB', '03/01/2026', 'LIREN')]);
  add(en(5, 'Tester', 'Echo', { frn: '0000000001' }), hd(5, 'K7EEE', '01/01/2019'), am(5, 'K7EEE', 'E'),
    [hs(5, 'K7EEE', '01/01/2019', 'LIISS')]);
  add(en(6, 'Tester', 'Foxtrot', { frn: '0000000006', state: 'OR', zip: '97201' }),
    hd(6, 'K7FFF', '04/01/2026'), am(6, 'K7FFF', 'T'), [hs(6, 'K7FFF', '04/01/2026', 'LIISS')]);
  return lines;
}

// Daily: B gets a new street, new license 7 (Golf) appears.
function daily(counts = DAILY_COUNTS) {
  const b = en(2, 'Tester', 'Beta', { frn: '0000000002' }).split('|');
  b[15] = '99 New Rd';
  return {
    EN: [b.join('|'), en(7, 'Tester', 'Golf', { frn: '0000000007' })],
    HD: [hd(2, 'K7BBB', '03/01/2026'), hd(7, 'K7GGG', '11/09/2026')],
    AM: [am(2, 'K7BBB', 'G'), am(7, 'K7GGG', 'T')],
    HS: [hs(2, 'K7BBB', '03/02/2016', 'LIISS'), hs(2, 'K7BBB', '03/01/2026', 'LIREN'),
      hs(7, 'K7GGG', '11/09/2026', 'LIISS')],
    counts,
  };
}

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'ham-daily-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function zipTo(dir, name, lines) {
  const sub = join(dir, name);
  await mkdir(sub);
  return makeFccZip(sub, lines);
}

const meta = (db) => Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
const lic = (db, call) => db.prepare('SELECT * FROM licenses WHERE call = ?').get(call);

// Opens the db, runs fn, always closes it.
function inDb(path, fn, opts = { readonly: true }) {
  const db = new Database(path, opts);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

test('applyDaily patches a changed license, adds a new one and updates meta', async () => {
  await withDir(async (dir) => {
    const out = join(dir, 'licenses.db');
    await loadWeekly(await zipTo(dir, 'w', weekly()), out);
    const res = await applyDaily(await zipTo(dir, 'd', daily()), out);
    assert.deepEqual(res, { changed: 2, fileDate: '2026-11-10', skipped: false });
    inDb(out, (db) => {
      assert.equal(lic(db, 'K7BBB').street, '99 New Rd');
      assert.equal(lic(db, 'K7BBB').first_license_date, '2016-03-02');
      assert.equal(db.prepare('SELECT count(*) n FROM history WHERE usid = 2').get().n, 2);
      const g = lic(db, 'K7GGG');
      assert.equal(g.first_license_date, '2026-11-09');
      assert.equal(g.entity_name, 'TESTER, GOLF');
      const m = meta(db);
      assert.equal(m.license_count, '5');
      assert.equal(m.data_as_of, '2026-11-10');
      assert.equal(m.daily_applied_through, '2026-11-10');
      assert.equal(m.weekly_file_date, '2026-11-08');
    });
  });
});

test('applyDaily twice skips the second time and changes nothing', async () => {
  await withDir(async (dir) => {
    const out = join(dir, 'licenses.db');
    await loadWeekly(await zipTo(dir, 'w', weekly()), out);
    const zip = await zipTo(dir, 'd', daily());
    await applyDaily(zip, out);
    const count = () => inDb(out, (db) => [
      db.prepare('SELECT count(*) n FROM licenses').get().n,
      db.prepare('SELECT count(*) n FROM history').get().n,
    ]);
    const before = count();
    assert.deepEqual(await applyDaily(zip, out), { changed: 0, fileDate: '2026-11-10', skipped: true });
    assert.deepEqual(count(), before);
  });
});

test('applyDaily skips a daily dated before the weekly', async () => {
  await withDir(async (dir) => {
    const out = join(dir, 'licenses.db');
    await loadWeekly(await zipTo(dir, 'w', weekly()), out);
    const old = daily(['File Creation Date: Fri Nov  6 09:08:58 EST 2026']);
    const res = await applyDaily(await zipTo(dir, 'd', old), out);
    assert.equal(res.skipped, true);
    inDb(out, (db) => {
      assert.equal(lic(db, 'K7BBB').street, '1 Main St');
      assert.equal(lic(db, 'K7GGG'), undefined);
    });
  });
});

test('applyDaily with load_states drops incoming rows outside the states and removes movers', async () => {
  await withDir(async (dir) => {
    const out = join(dir, 'licenses.db');
    await loadWeekly(await zipTo(dir, 'w', weekly()), out, { states: ['MT'] });
    const d = daily();
    // Golf is in OR (dropped); Beta moves to OR (existing row removed).
    d.EN = [en(2, 'Tester', 'Beta', { frn: '0000000002', state: 'OR', zip: '97201' }),
      en(7, 'Tester', 'Golf', { frn: '0000000007', state: 'OR', zip: '97201' })];
    await applyDaily(await zipTo(dir, 'd', d), out);
    inDb(out, (db) => {
      assert.equal(lic(db, 'K7BBB'), undefined);
      assert.equal(lic(db, 'K7GGG'), undefined);
      assert.equal(db.prepare('SELECT count(*) n FROM history WHERE usid IN (2, 7)').get().n, 0);
      assert.equal(meta(db).license_count, '2');
    });
  });
});

test('applyDaily restores first_license_date when the older same-FRN license changes FRN', async () => {
  await withDir(async (dir) => {
    const out = join(dir, 'licenses.db');
    await loadWeekly(await zipTo(dir, 'w', weekly()), out);
    assert.equal(inDb(out, (db) => lic(db, 'K7AAA').first_license_date), null);
    // Echo (usid 5, the older license on FRN 1) is replaced and moves to another FRN.
    const d = {
      EN: [en(5, 'Tester', 'Echo', { frn: '0000000005' })],
      HD: [hd(5, 'K7EEE', '01/01/2019')],
      AM: [am(5, 'K7EEE', 'E')],
      HS: [hs(5, 'K7EEE', '01/01/2019', 'LIISS')],
      counts: DAILY_COUNTS,
    };
    await applyDaily(await zipTo(dir, 'd', d), out);
    inDb(out, (db) => {
      assert.equal(lic(db, 'K7AAA').first_license_date, '2026-05-01');
      assert.equal(lic(db, 'K7EEE').first_license_date, '2019-01-01');
    });
  });
});

test('reclassify restores first_license_date of same-FRN licenses when the older one no longer predates them', async () => {
  await withDir(async (dir) => {
    const out = join(dir, 'licenses.db');
    await loadWeekly(await zipTo(dir, 'w', weekly()), out);
    inDb(out, (db) => {
      // Echo's history now post-dates Alpha's, so it no longer shadows Alpha.
      db.prepare("UPDATE history SET date = '2027-01-01' WHERE usid = 5").run();
      reclassify(db, [5]);
      assert.equal(lic(db, 'K7AAA').first_license_date, '2026-05-01');
      assert.equal(lic(db, 'K7EEE').first_license_date, null); // now shadowed by Alpha
    }, {});
  });
});

test('reclassify on the older license re-nulls a same-FRN license that it shadows', async () => {
  await withDir(async (dir) => {
    const out = join(dir, 'licenses.db');
    await loadWeekly(await zipTo(dir, 'w', weekly()), out);
    inDb(out, (db) => {
      db.prepare("UPDATE licenses SET first_license_date = '2026-05-01' WHERE usid = 1").run();
      reclassify(db, [5]);
      assert.equal(lic(db, 'K7AAA').first_license_date, null);
      assert.equal(lic(db, 'K7EEE').first_license_date, '2019-01-01');
    }, {});
  });
});
