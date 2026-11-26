import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CENSUS_BATCH_URL, buildBatchCsv, parseBatchCsv, geocodeBatch } from '../../src/map/census.js';

test('buildBatchCsv quotes every field and doubles inner quotes', () => {
  const csv = buildBatchCsv([{ id: '1', street: '12 Main St, Apt "B"', city: 'Missoula', state: 'MT', zip: '59801' }]);
  assert.equal(csv, '"1","12 Main St, Apt ""B""","Missoula","MT","59801"\r\n');
});

test('parseBatchCsv maps matches, none, and leaves out missing or bad rows', () => {
  const text = [
    '"3","1 A St, X, MT, 59801","No_Match"',
    '"1","12 Main St, Missoula, MT, 59801","Match","Exact","12 MAIN ST, MISSOULA, MT, 59801","-113.994,46.872","123","L"',
    '"2","9 Elm, Missoula, MT, 59801","Tie"',
    '"5","8 Oak, Missoula, MT, 59801","Match","Non_Exact","8 OAK","garbage","1","R"',
    '"6","x","Weird"',
    '"7","x","Match","Exact","x","-213.9,46.8","1","R"',
  ].join('\r\n') + '\r\n';
  const m = parseBatchCsv(text);
  assert.deepEqual(m.get('1'), { status: 'match', lat: 46.872, lon: -113.994 });
  assert.deepEqual(m.get('2'), { status: 'none', lat: null, lon: null });
  assert.deepEqual(m.get('3'), { status: 'none', lat: null, lon: null });
  for (const id of ['4', '5', '6', '7']) assert.equal(m.has(id), false);
});

const items = [{ id: '1', street: '12 Main St', city: 'Missoula', state: 'MT', zip: '59801' }];

test('geocodeBatch posts a multipart form with the app User-Agent', async () => {
  let seen;
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return new Response('"1","a","Match","Exact","a","-113.9,46.8","1","L"\n', { status: 200 });
  };
  const m = await geocodeBatch(fetchImpl, items);
  assert.equal(seen.url, CENSUS_BATCH_URL);
  assert.equal(seen.opts.method, 'POST');
  assert.equal(seen.opts.headers['User-Agent'], 'ham-license-finder');
  assert.ok(seen.opts.body instanceof FormData);
  assert.equal(seen.opts.body.get('benchmark'), 'Public_AR_Current');
  assert.equal(await seen.opts.body.get('addressFile').text(), buildBatchCsv(items));
  assert.equal(m.get('1').status, 'match');
});

test('geocodeBatch rejects on a non-OK status', async () => {
  const fetchImpl = async () => new Response('bad', { status: 502 });
  await assert.rejects(geocodeBatch(fetchImpl, items), /502/);
});

test('geocodeBatch rejects on timeout', async () => {
  const fetchImpl = (url, { signal }) => new Promise((_, rej) => {
    signal.addEventListener('abort', () => rej(signal.reason));
  });
  const keepAlive = setTimeout(() => {}, 2000); // AbortSignal.timeout's timer is unref'd
  await assert.rejects(geocodeBatch(fetchImpl, items, { timeoutMs: 20 }));
  clearTimeout(keepAlive);
});
