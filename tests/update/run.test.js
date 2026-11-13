import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { runWeekly, runDaily, DAILY_DAYS } from '../../src/update/run.js';
import { makeFccZip } from '../helpers/fcc-fixture.js';
import { en, hd, am, hs } from '../helpers/fcc-lines.js';

const counts = (day) => [`File Creation Date: ${day}`];
const SUN = 'Sun Nov  8 09:08:58 EST 2026';

function weekly(n) {
  const lines = { EN: [], HD: [], AM: [], HS: [], counts: counts(SUN) };
  for (let i = 1; i <= n; i++) {
    const call = `K7A${String.fromCharCode(64 + i)}A`;
    lines.EN.push(en(i, 'Tester', `Person${i}`, { frn: String(i).padStart(10, '0') }));
    lines.HD.push(hd(i, call, '05/01/2026'));
    lines.AM.push(am(i, call, 'T'));
    lines.HS.push(hs(i, call, '05/01/2026', 'LIISS'));
  }
  return lines;
}

function daily(usid, call, dateText) {
  return {
    EN: [en(usid, 'Tester', `Daily${usid}`, { frn: String(usid).padStart(10, '0') })],
    HD: [hd(usid, call, '11/09/2026')],
    AM: [am(usid, call, 'T')],
    HS: [hs(usid, call, '11/09/2026', 'LIISS')],
    counts: counts(dateText),
  };
}

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'ham-run-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function zipBytes(dir, name, lines) {
  const sub = join(dir, `fx-${name}`);
  await mkdir(sub, { recursive: true });
  return readFile(await makeFccZip(sub, lines));
}

// Serves { urlSuffix: Buffer | status number }; anything else is a 404.
function fakeFetch(routes, seen = []) {
  return async (url, init) => {
    seen.push({ url: String(url), init });
    const key = Object.keys(routes).find((k) => String(url).endsWith(k));
    const body = routes[key];
    if (typeof body === 'number') return new Response('err', { status: body });
    if (!body) return new Response('missing', { status: 404 });
    return new Response(body, { status: 200 });
  };
}

const meta = (path) => {
  const db = new Database(path, { readonly: true });
  try {
    return Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
  } finally {
    db.close();
  }
};

test('first weekly creates licenses.db, sends a User-Agent and leaves tmp empty', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    const seen = [];
    const res = await runWeekly({
      dataDir: data,
      fetchImpl: fakeFetch({ 'l_amat.zip': await zipBytes(dir, 'w', weekly(3)) }, seen),
    });
    assert.deepEqual(res, { licenseCount: 3, fileDate: '2026-11-08' });
    assert.equal(meta(join(data, 'licenses.db')).license_count, '3');
    assert.equal(seen[0].init.headers['User-Agent'], 'ham-license-finder');
    assert.deepEqual(await readdir(join(data, 'tmp')), []);
    assert.deepEqual((await readdir(data)).sort(), ['licenses.db', 'tmp']);
  });
});

test('after the swap licenses.db is in delete journal mode with no -wal/-shm files', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    const fetchImpl = fakeFetch({ 'l_amat.zip': await zipBytes(dir, 'w', weekly(3)) });
    await runWeekly({ dataDir: data, fetchImpl });
    await runWeekly({ dataDir: data, fetchImpl });
    const db = new Database(join(data, 'licenses.db'), { readonly: true });
    try {
      assert.equal(db.pragma('journal_mode', { simple: true }), 'delete');
    } finally {
      db.close();
    }
    const files = await readdir(data);
    assert.deepEqual(files.filter((f) => /-(wal|shm|journal)$/.test(f)), []);
  });
});

test('a stale licenses.db-wal/-shm from an older WAL-mode file is removed after the swap', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    await mkdir(data, { recursive: true });
    await writeStale(join(data, 'licenses.db-wal'));
    await writeStale(join(data, 'licenses.db-shm'));
    await runWeekly({ dataDir: data, fetchImpl: fakeFetch({ 'l_amat.zip': await zipBytes(dir, 'w', weekly(3)) }) });
    assert.deepEqual((await readdir(data)).sort(), ['licenses.db', 'tmp']);
  });
});

async function writeStale(path) {

  await writeFile(path, 'stale');
}

test('weekly with a big drop in rows throws, keeps the old db and empties tmp', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    await runWeekly({ dataDir: data, fetchImpl: fakeFetch({ 'l_amat.zip': await zipBytes(dir, 'a', weekly(5)) }) });
    await assert.rejects(
      runWeekly({ dataDir: data, fetchImpl: fakeFetch({ 'l_amat.zip': await zipBytes(dir, 'b', weekly(2)) }) }),
      /License count dropped from 5 to 2; keeping old data/,
    );
    assert.equal(meta(join(data, 'licenses.db')).license_count, '5');
    assert.deepEqual(await readdir(join(data, 'tmp')), []);
  });
});

test('weekly swaps in a new db of similar size and skips the check when load_states differ', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    await runWeekly({ dataDir: data, fetchImpl: fakeFetch({ 'l_amat.zip': await zipBytes(dir, 'a', weekly(5)) }) });
    // Same states, 5 -> 5: swaps.
    await runWeekly({ dataDir: data, fetchImpl: fakeFetch({ 'l_amat.zip': await zipBytes(dir, 'b', weekly(5)) }) });
    // Different states: a count of 0 would fail the ratio check, but it is skipped.
    const res = await runWeekly({
      dataDir: data, states: ['OR'],
      fetchImpl: fakeFetch({ 'l_amat.zip': await zipBytes(dir, 'c', weekly(5)) }),
    });
    assert.equal(res.licenseCount, 0);
    assert.equal(meta(join(data, 'licenses.db')).load_states, 'OR');
  });
});

test('weekly failure on HTTP error leaves no licenses.db and keeps tmp empty', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    await assert.rejects(runWeekly({ dataDir: data, fetchImpl: fakeFetch({ 'l_amat.zip': 500 }) }), /500/);
    assert.deepEqual(await readdir(join(data, 'tmp')), []);
    assert.equal((await readdir(data)).includes('licenses.db'), false);
  });
});

test('runDaily applies newer dailies in date order and skips one older than the weekly', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    await runWeekly({ dataDir: data, fetchImpl: fakeFetch({ 'l_amat.zip': await zipBytes(dir, 'w', weekly(2)) }) });
    const seen = [];
    const res = await runDaily({
      dataDir: data,
      baseUrl: 'https://example.test/daily',
      fetchImpl: fakeFetch({
        // wed is dated after tue, so file order differs from date order.
        'l_am_wed.zip': await zipBytes(dir, 'wed', daily(11, 'K7WED', 'Wed Nov 11 09:00:00 EST 2026')),
        'l_am_tue.zip': await zipBytes(dir, 'tue', daily(10, 'K7TUE', 'Tue Nov 10 09:00:00 EST 2026')),
        'l_am_fri.zip': await zipBytes(dir, 'fri', daily(9, 'K7OLD', 'Fri Nov  6 09:00:00 EST 2026')),
      }, seen),
    });
    assert.deepEqual(res, { applied: ['2026-11-10', '2026-11-11'] });
    assert.equal(seen.length, DAILY_DAYS.length);
    assert.ok(seen[0].url.startsWith('https://example.test/daily/l_am_'));
    const m = meta(join(data, 'licenses.db'));
    assert.equal(m.daily_applied_through, '2026-11-11');
    assert.equal(m.license_count, '4');
    assert.deepEqual(await readdir(join(data, 'tmp')), []);
  });
});

test('runDaily throws on a non-404 HTTP error', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    await runWeekly({ dataDir: data, fetchImpl: fakeFetch({ 'l_amat.zip': await zipBytes(dir, 'w', weekly(2)) }) });
    await assert.rejects(runDaily({ dataDir: data, fetchImpl: fakeFetch({ 'l_am_mon.zip': 503 }) }), /503/);
    assert.deepEqual(await readdir(join(data, 'tmp')), []);
  });
});

test('runDaily refuses a db with an out-of-date schema version', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    await runWeekly({ dataDir: data, fetchImpl: fakeFetch({ 'l_amat.zip': await zipBytes(dir, 'w', weekly(2)) }) });
    const db = new Database(join(data, 'licenses.db'));
    db.prepare("UPDATE meta SET value = '0' WHERE key = 'schema_version'").run();
    db.close();
    await assert.rejects(
      runDaily({ dataDir: data, fetchImpl: fakeFetch({}) }),
      /licenses\.db schema is out of date; run the weekly load/,
    );
  });
});
