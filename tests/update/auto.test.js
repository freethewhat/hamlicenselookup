import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import { runAuto, runWeekly, download } from '../../src/update/run.js';
import { loadWeekly } from '../../src/db/load-weekly.js';
import { readStatus } from '../../src/update/status.js';
import { makeFccZip } from '../helpers/fcc-fixture.js';
import { makeGeoDb } from '../helpers/geo-fixture.js';
import { en, hd, am, hs } from '../helpers/fcc-lines.js';

const SUN = 'Sun Nov  8 09:08:58 EST 2026'; // weekly file date 2026-11-08
const day = (iso) => new Date(`${iso}T12:00:00Z`);

function weekly(n, fileDay = SUN) {
  const lines = { EN: [], HD: [], AM: [], HS: [], counts: [`File Creation Date: ${fileDay}`] };
  for (let i = 1; i <= n; i++) {
    const call = `K7A${String.fromCharCode(64 + i)}A`;
    lines.EN.push(en(i, 'Tester', `Person${i}`, { frn: String(i).padStart(10, '0') }));
    lines.HD.push(hd(i, call, '05/01/2026'));
    lines.AM.push(am(i, call, 'T'));
    lines.HS.push(hs(i, call, '05/01/2026', 'LIISS'));
  }
  return lines;
}

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'ham-auto-'));
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

function fakeFetch(routes, seen = []) {
  return async (url) => {
    seen.push(String(url));
    const key = Object.keys(routes).find((k) => String(url).endsWith(k));
    const body = routes[key];
    if (typeof body === 'number') return new Response('err', { status: body });
    if (!body) return new Response('missing', { status: 404 });
    return new Response(body, { status: 200 });
  };
}

// Stands in for the real map build: just writes a valid geo.db.
const fakeGeo = (calls) => async ({ dataDir }) => {
  calls.push('geo');
  makeGeoDb(join(dataDir, 'geo.db'), { counties: [{ geoid: '30063', name: 'Missoula', state: 'MT' }], zips: [] });
};

const meta = (path, key) => {
  const db = new Database(path, { readonly: true });
  try {
    return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value;
  } finally {
    db.close();
  }
};

test('empty data dir runs geo, weekly, then daily and ends done', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    const geoCalls = [];
    const res = await runAuto({
      dataDir: data,
      fetchImpl: fakeFetch({ 'l_amat.zip': await zipBytes(dir, 'w', weekly(3)) }),
      now: day('2026-11-10'),
      geoBuilder: fakeGeo(geoCalls),
    });
    assert.deepEqual(res.actions, ['geo', 'weekly', 'daily']);
    assert.deepEqual(geoCalls, ['geo']);
    assert.equal(meta(join(data, 'licenses.db'), 'license_count'), '3');
    const s = readStatus(data);
    assert.equal(s.state, 'done');
    assert.equal(s.job, 'auto');
  });
});

async function seed(dir, data, fileLines = weekly(2)) {
  await runWeekly({ dataDir: data, fetchImpl: fakeFetch({ 'l_amat.zip': await zipBytes(dir, 'seed', fileLines) }) });
  makeGeoDb(join(data, 'geo.db'), { counties: [{ geoid: '30063', name: 'Missoula', state: 'MT' }] });
}

test('fresh data (weekly 2 days old) only runs daily', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    await seed(dir, data);
    const geoCalls = [];
    const res = await runAuto({ dataDir: data, fetchImpl: fakeFetch({}), now: day('2026-11-10'), geoBuilder: fakeGeo(geoCalls) });
    assert.deepEqual(res.actions, ['daily']);
    assert.deepEqual(geoCalls, []);
  });
});

test('weekly file 8 days old runs weekly then daily', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    await seed(dir, data);
    const res = await runAuto({
      dataDir: data,
      fetchImpl: fakeFetch({ 'l_amat.zip': await zipBytes(dir, 'w2', weekly(4, 'Sun Nov 15 09:08:58 EST 2026')) }),
      now: day('2026-11-16'),
      geoBuilder: fakeGeo([]),
    });
    assert.deepEqual(res.actions, ['weekly', 'daily']);
    assert.equal(meta(join(data, 'licenses.db'), 'license_count'), '4');
  });
});

test('weekly file exactly 7 days old is still fresh', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    await seed(dir, data);
    const res = await runAuto({ dataDir: data, fetchImpl: fakeFetch({}), now: new Date('2026-11-15T00:00:00Z'), geoBuilder: fakeGeo([]) });
    assert.deepEqual(res.actions, ['daily']);
  });
});

test('an outdated licenses schema forces a weekly load', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    await seed(dir, data);
    const db = new Database(join(data, 'licenses.db'));
    db.prepare("UPDATE meta SET value = '0' WHERE key = 'schema_version'").run();
    db.close();
    const res = await runAuto({
      dataDir: data,
      fetchImpl: fakeFetch({ 'l_amat.zip': await zipBytes(dir, 'w3', weekly(2)) }),
      now: day('2026-11-10'),
      geoBuilder: fakeGeo([]),
    });
    assert.deepEqual(res.actions, ['weekly', 'daily']);
  });
});

test('a failing weekly download records failed and keeps the old licenses.db', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    await seed(dir, data);
    const before = await readFile(join(data, 'licenses.db'));
    await assert.rejects(
      runAuto({ dataDir: data, fetchImpl: fakeFetch({ 'l_amat.zip': 500 }), now: day('2026-11-20'), geoBuilder: fakeGeo([]) }),
      /HTTP 500/,
    );
    const s = readStatus(data);
    assert.equal(s.state, 'failed');
    assert.match(s.error, /HTTP 500/);
    assert.deepEqual(await readFile(join(data, 'licenses.db')), before);
  });
});

test('a lock held by another process makes auto skip without touching anything', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    await mkdir(data, { recursive: true });
    const lockUrl = new URL('../../src/update/run.js', import.meta.url).href;
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      const { acquireUpdateLock } = await import(${JSON.stringify(lockUrl)});
      await acquireUpdateLock(${JSON.stringify(data)});
      console.log('ready');
      setInterval(() => {}, 1000);
    `], { stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      await once(child.stdout, 'data');
      const seen = [];
      const res = await runAuto({ dataDir: data, fetchImpl: fakeFetch({}, seen), now: day('2026-11-10'), geoBuilder: fakeGeo([]) });
      assert.deepEqual(res, { actions: [] });
      assert.deepEqual(seen, []);
      assert.deepEqual((await readdir(data)).filter((n) => !n.startsWith('.update-lock.db')), []);
      assert.equal(existsSync(join(data, 'update-status.json')), false);
    } finally {
      const closed = once(child, 'close');
      child.kill('SIGKILL');
      await closed;
    }
  });
});

test('runAuto leaves the lock released', async () => {
  await withDir(async (dir) => {
    const data = join(dir, 'data');
    await seed(dir, data);
    await runAuto({ dataDir: data, fetchImpl: fakeFetch({}), now: day('2026-11-10'), geoBuilder: fakeGeo([]) });
    const again = await runAuto({ dataDir: data, fetchImpl: fakeFetch({}), now: day('2026-11-10'), geoBuilder: fakeGeo([]) });
    assert.deepEqual(again.actions, ['daily']);
  });
});

test('download reports bytes against Content-Length, and null total without it', async () => {
  await withDir(async (dir) => {
    const body = Buffer.alloc(5000, 1);
    const withLength = async () => new Response(body, { headers: { 'content-length': '5000' } });
    const calls = [];
    await download(withLength, 'http://x/a.zip', join(dir, 'a.zip'), { onProgress: (d, t) => calls.push([d, t]) });
    assert.deepEqual(calls[0], [0, 5000]);
    assert.deepEqual(calls.at(-1), [5000, 5000]);
    const noLength = async () => new Response(body);
    const calls2 = [];
    await download(noLength, 'http://x/b.zip', join(dir, 'b.zip'), { onProgress: (d, t) => calls2.push([d, t]) });
    assert.equal(calls2.at(-1)[1], null);
  });
});

test('loadWeekly reports import bytes up to the total, then index and classify', async () => {
  await withDir(async (dir) => {
    const zip = await makeFccZip(dir, weekly(3));
    const calls = [];
    await loadWeekly(zip, join(dir, 'out.db'), { onProgress: (...a) => calls.push(a) });
    const imports = calls.filter((c) => c[0] === 'import');
    assert.ok(imports.length > 1);
    const total = imports[0][2];
    assert.ok(total > 0);
    assert.deepEqual(imports.at(-1).slice(1), [total, total]);
    assert.ok(imports.every((c, i) => i === 0 || c[1] >= imports[i - 1][1]));
    assert.ok(calls.some((c) => c[0] === 'index'));
    assert.deepEqual(calls.find((c) => c[0] === 'classify'), ['classify', 0, 3]);
  });
});
