import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeocodeQueue } from '../../src/map/queue.js';

const NOT_ANSWERING = 'The map service is not answering. Try again later.';
const BUSY = 'The map is busy. Try again in a few minutes.';

const item = (key) => ({ key, street: '1 Main', city: 'X', state: 'MT', zip: '59801' });
const items = (...keys) => keys.map(item);

function setup(opts = {}) {
  const calls = [];
  const saved = [];
  const clock = { t: 1_000_000 };
  let open = 0;
  let overlapped = false;
  const geocode = opts.geocode ?? (async (batch) => {
    calls.push(batch.map((b) => b.id));
    open++;
    if (open > 1) overlapped = true;
    await new Promise((r) => setImmediate(r));
    open--;
    return new Map(batch.map((b) => [b.id, { status: 'match', lat: 1, lon: 2 }]));
  });
  const store = opts.store ?? { save(rows) { saved.push(...rows); } };
  const q = createGeocodeQueue({
    geocode, store, now: () => clock.t, sleep: opts.sleep ?? (async () => {}),
    ...opts.queue,
  });
  return { q, calls, saved, clock, overlapped: () => overlapped };
}

test('dedupe: a key wanted twice is sent once', async () => {
  const { q, calls } = setup();
  q.want(items('a', 'b'));
  q.want(items('b', 'c'));
  await q.whenIdle();
  assert.deepEqual(calls.flat().sort(), ['a', 'b', 'c']);
});

test('batches: sizes 1000, 1000, 500, one at a time', async () => {
  const { q, calls, overlapped } = setup();
  q.want(items(...Array.from({ length: 2500 }, (_, i) => `k${i}`)));
  await q.whenIdle();
  assert.deepEqual(calls.map((c) => c.length), [1000, 1000, 500]);
  assert.equal(overlapped(), false);
});

test('idle drop: keys not wanted for over idleMs are never sent', async () => {
  const clock = { t: 1_000_000 };
  const calls = [];
  const geocode = async (batch) => {
    calls.push(batch.map((b) => b.id));
    return new Map(batch.map((b) => [b.id, { status: 'match', lat: 1, lon: 2 }]));
  };
  const { q } = setup({
    geocode,
    queue: { batchSize: 1, now: () => clock.t },
    sleep: async () => { clock.t += 61_000; },
  });
  q.want(items('a', 'b'));
  await q.whenIdle();
  assert.deepEqual(calls, [['a']]);
  assert.equal(q.isPending('b'), false);
});

test('retry split: a failed batch is halved and all items get saved', async () => {
  const calls = [];
  const saved = [];
  let n = 0;
  const geocode = async (batch) => {
    calls.push(batch.map((b) => b.id));
    if (n++ === 0) throw new Error('boom');
    return new Map(batch.map((b) => [b.id, { status: 'match', lat: 1, lon: 2 }]));
  };
  const { q } = setup({ geocode, store: { save(r) { saved.push(...r); } } });
  q.want(items('a', 'b', 'c', 'd'));
  await q.whenIdle();
  assert.deepEqual(calls.map((c) => c.length), [4, 2, 2]);
  assert.deepEqual(saved.map((r) => r.key).sort(), ['a', 'b', 'c', 'd']);
});

test('cool-down: repeated failures clear the queue and block want until it ends', async () => {
  const geocode = async () => { throw new Error('down'); };
  const { q, clock } = setup({ geocode, queue: { maxFailures: 4 } });
  q.want(items('a', 'b', 'c'));
  await q.whenIdle();
  assert.equal(q.error(), NOT_ANSWERING);
  for (const k of ['a', 'b', 'c']) assert.equal(q.isPending(k), false);
  assert.deepEqual(q.want(items('x')), { error: NOT_ANSWERING });
  assert.equal(q.isPending('x'), false);
  clock.t += 600_001;
  assert.equal(q.error(), null);
  assert.deepEqual(q.want(items('x')), { error: null });
  assert.equal(q.isPending('x'), true);
  await q.whenIdle();
});

test('global cap: over maxTotal adds nothing', async () => {
  const { q } = setup({ queue: { maxTotal: 3 } });
  assert.deepEqual(q.want(items('a', 'b')), { error: null });
  assert.deepEqual(q.want(items('c', 'd')), { error: BUSY });
  assert.equal(q.isPending('c'), false);
  await q.whenIdle();
});

test('a throwing store.save counts as a failed batch and the worker survives', async () => {
  const saved = [];
  let n = 0;
  const store = { save(rows) { if (n++ === 0) throw new Error('disk'); saved.push(...rows); } };
  const { q } = setup({ store });
  q.want(items('a', 'b'));
  await q.whenIdle();
  assert.deepEqual(saved.map((r) => r.key).sort(), ['a', 'b']);
  assert.equal(q.error(), null);
});

test('keys missing from the answer are dropped unsaved', async () => {
  const saved = [];
  const geocode = async () => new Map([['a', { status: 'match', lat: 1, lon: 2 }]]);
  const { q } = setup({ geocode, store: { save(r) { saved.push(...r); } } });
  q.want(items('a', 'b'));
  await q.whenIdle();
  assert.deepEqual(saved.map((r) => r.key), ['a']);
  assert.equal(q.isPending('b'), false);
});

test('a want() landing as the worker finishes restarts it and whenIdle waits for it', async () => {
  const calls = [];
  const geocode = async (batch) => {
    calls.push(batch.map((b) => b.id));
    return new Map(batch.map((b) => [b.id, { status: 'match', lat: 1, lon: 2 }]));
  };
  let q;
  let n = 0;
  const store = { save() { if (n++ === 0) queueMicrotask(() => q.want(items('b'))); } };
  ({ q } = setup({ geocode, store }));
  q.want(items('a'));
  await q.whenIdle();
  assert.deepEqual(calls, [['a'], ['b']]);
  assert.equal(q.isPending('b'), false);
});

test('want() of 20,000 new keys is fast even with a failed batch in front', async () => {
  let n = 0;
  const geocode = async (batch) => {
    if (n++ === 0) throw new Error('boom');
    return new Map(batch.map((b) => [b.id, { status: 'match', lat: 1, lon: 2 }]));
  };
  let release;
  const gate = new Promise((r) => { release = r; });
  const { q } = setup({ geocode, sleep: () => gate });
  q.want(items(...Array.from({ length: 1000 }, (_, i) => `f${i}`)));
  await new Promise((r) => setImmediate(r)); // first batch fails, halves go to the front
  const many = items(...Array.from({ length: 20_000 }, (_, i) => `k${i}`));
  const t0 = performance.now();
  assert.deepEqual(q.want(many), { error: null });
  const ms = performance.now() - t0;
  assert.ok(ms < 200, `want took ${ms} ms`);
  assert.equal(q.isPending('k19999'), true);
  release();
  await q.whenIdle();
});
