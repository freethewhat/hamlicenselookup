import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createStatusWriter, createProgressSink, readStatus } from '../../src/update/status.js';

async function withDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'ham-status-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const clock = (start = Date.parse('2026-11-13T12:00:00Z')) => {
  let t = start;
  const now = () => new Date(t);
  now.advance = (ms) => { t += ms; };
  return now;
};

test('every step write leaves a parseable file and no tmp file behind', async () => {
  await withDir(async (dir) => {
    const w = createStatusWriter(dir, 'weekly', { now: clock() });
    w.step('download', 'Downloading FCC file', { total: 200, unit: 'bytes' });
    const s = JSON.parse(await readFile(join(dir, 'update-status.json'), 'utf8'));
    assert.equal(s.state, 'running');
    assert.equal(s.job, 'weekly');
    assert.equal(s.step, 'download');
    assert.equal(s.stepLabel, 'Downloading FCC file');
    assert.equal(s.total, 200);
    assert.equal(s.done, 0);
    assert.equal(s.unit, 'bytes');
    assert.equal(s.percent, 0);
    assert.deepEqual(await readdir(dir), ['update-status.json']);
  });
});

test('progress throttles writes and computes percent', async () => {
  await withDir(async (dir) => {
    const now = clock();
    const w = createStatusWriter(dir, 'weekly', { now, throttleMs: 500 });
    w.step('import', 'Importing', { total: 1000, unit: 'bytes' });
    const file = join(dir, 'update-status.json');
    const stamps = new Set();
    for (let i = 1; i <= 10; i++) {
      now.advance(10);
      w.progress(i * 10);
      stamps.add(JSON.parse(readFileSync(file, 'utf8')).updatedAt);
    }
    // the step write plus at most one throttled progress write
    assert.ok(stamps.size <= 2, `wrote ${stamps.size} times`);
    now.advance(600);
    w.progress(250);
    const s = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(s.done, 250);
    assert.equal(s.percent, 25);
  });
});

test('percent is null when the total is unknown', async () => {
  await withDir(async (dir) => {
    const now = clock();
    const w = createStatusWriter(dir, 'weekly', { now });
    w.step('download', 'Downloading', { unit: 'bytes' });
    now.advance(1000);
    w.progress(500);
    const s = readStatus(dir, now());
    assert.equal(s.percent, null);
    assert.equal(s.total, null);
  });
});

test('finish and fail set the state', async () => {
  await withDir(async (dir) => {
    const w = createStatusWriter(dir, 'auto', { now: clock() });
    w.step('swap', 'Switching');
    w.finish('all good');
    let s = readStatus(dir);
    assert.equal(s.state, 'done');
    assert.equal(s.message, 'all good');
    assert.equal(s.error, null);
    w.fail('boom');
    s = readStatus(dir);
    assert.equal(s.state, 'failed');
    assert.equal(s.error, 'boom');
  });
});

test('readStatus is idle without a file and interrupted after 120 s without updates', async () => {
  await withDir(async (dir) => {
    assert.deepEqual(readStatus(dir), { state: 'idle' });
    const now = clock();
    const w = createStatusWriter(dir, 'weekly', { now });
    w.step('import', 'Importing');
    const written = now();
    assert.equal(readStatus(dir, new Date(+written + 120_000)).state, 'running');
    assert.equal(readStatus(dir, new Date(+written + 121_000)).state, 'interrupted');
  });
});

test('a failed finished run stays failed however old', async () => {
  await withDir(async (dir) => {
    await writeFile(join(dir, 'update-status.json'), JSON.stringify({
      state: 'failed', error: 'x', updatedAt: '2020-01-01T00:00:00Z',
    }));
    assert.equal(readStatus(dir).state, 'failed');
  });
});

test('an unwritable data dir does not throw and logs once', async () => {
  await withDir(async (dir) => {
    const blocker = join(dir, 'file');
    await writeFile(blocker, 'x');
    const logs = [];
    const orig = console.error;
    console.error = (m) => logs.push(m);
    try {
      const w = createStatusWriter(join(blocker, 'sub'), 'weekly', { now: clock() });
      w.step('import', 'a', { total: 1, unit: 'bytes' });
      w.step('import', 'b');
      w.fail('x');
    } finally {
      console.error = orig;
    }
    assert.equal(logs.length, 1);
  });
});

test('progress sink starts a step on change and only moves progress otherwise', () => {
  const calls = [];
  const sink = createProgressSink({
    step: (...a) => calls.push(['step', ...a]),
    progress: (d) => calls.push(['progress', d]),
  });
  sink('import', 0, 100);
  sink('import', 40, 100);
  sink('index', null, null);
  sink('download', 5, 10, 'Downloading daily file (2 of 7)');
  assert.deepEqual(calls, [
    ['step', 'import', 'Importing FCC records', { total: 100, unit: 'bytes' }],
    ['progress', 0],
    ['progress', 40],
    ['step', 'index', 'Building indexes', { total: null, unit: null }],
    ['step', 'download', 'Downloading daily file (2 of 7)', { total: 10, unit: 'bytes' }],
    ['progress', 5],
  ]);
});

async function staleRunning(dir) {
  await writeFile(join(dir, 'update-status.json'), JSON.stringify({
    state: 'running', updatedAt: '2026-11-13T12:00:00.000Z',
  }));
}
const LATER = new Date('2026-11-13T12:10:00Z');

test('a stale running status with the lock free is interrupted, and the lock is left free', async () => {
  await withDir(async (dir) => {
    const { acquireUpdateLock } = await import('../../src/update/run.js');
    (await acquireUpdateLock(dir)).release();
    await staleRunning(dir);
    assert.equal(readStatus(dir, LATER).state, 'interrupted');
    (await acquireUpdateLock(dir)).release(); // would throw if readStatus kept the lock
  });
});

test('a stale running status is still running while another process holds the lock', async () => {
  await withDir(async (dir) => {
    const lockUrl = new URL('../../src/update/run.js', import.meta.url).href;
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      const { acquireUpdateLock } = await import(${JSON.stringify(lockUrl)});
      await acquireUpdateLock(${JSON.stringify(dir)});
      console.log('ready');
      setInterval(() => {}, 1000);
    `], { stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      await once(child.stdout, 'data');
      await staleRunning(dir);
      assert.equal(readStatus(dir, LATER).state, 'running');
    } finally {
      const closed = once(child, 'close');
      child.kill('SIGKILL');
      await closed;
    }
  });
});
