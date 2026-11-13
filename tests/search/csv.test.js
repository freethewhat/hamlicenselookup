import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { CSV_COLUMNS, csvLine, writeCsv } from '../../src/search/csv.js';

async function render(rows) {
  const out = new PassThrough();
  const chunks = [];
  out.on('data', (c) => chunks.push(c));
  await writeCsv(rows, out);
  return Buffer.concat(chunks).toString('utf8');
}

test('csv escapes and neutralizes formulas', async () => {
  assert.equal(CSV_COLUMNS.length, 23);
  const text = await render([
    { call: 'K7AAA', first: '=SUM(A1)', last: 'José', street: '1 Main St, Apt 2', zip: '598011234', op_class: 'T', status: 'A', service: 'HV' },
    { call: 'K7BBB', zip: '01003', county_name: 'Hampshire', op_class: 'G', status: 'E', prev_class: 'T', service: 'HA' },
  ]);
  assert.ok(text.startsWith('﻿'));
  const lines = text.slice(1).split('\r\n');
  assert.equal(lines[0], CSV_COLUMNS.map(([h]) => h).join(','));
  assert.equal(lines.at(-1), '');
  assert.ok(lines[1].includes(",'=SUM(A1),"));
  assert.ok(lines[1].includes('"1 Main St, Apt 2"'));
  assert.ok(lines[1].includes(',José,'));
  assert.ok(lines[1].includes(',59801-1234,Unassigned,Technician,Active,'));
  assert.ok(lines[1].includes(',Yes,'));
  assert.ok(lines[2].includes(',01003,Hampshire,General,Expired,'));
  assert.ok(lines[2].includes(',Technician,No,'));
  assert.equal(csvLine(['=SUM(A1)', 'a"b', '-1', '@x', '\tx', '']), `'=SUM(A1),"a""b",'-1,'@x,'\tx,`);
  assert.equal(csvLine(['x\ny']), '"x\ny"');
});

test('writeCsv settles and releases the iterator when the destination closes', async () => {
  let returned = false;
  let produced = 0;
  const rows = {
    [Symbol.iterator]() { return this; },
    next() { produced++; return { done: false, value: { call: 'K7AAA' } }; },
    return() { returned = true; return { done: true }; },
  };
  let out;
  out = new Writable({
    highWaterMark: 1,
    write(chunk, enc, cb) {
      setImmediate(() => { out.destroy(); });
      // never calls back: simulates a stalled client that then disconnects
      void cb;
    },
  });
  const result = await Promise.race([
    writeCsv(rows, out).then(() => 'settled'),
    new Promise((resolve) => setTimeout(() => resolve('hung'), 1000)),
  ]);
  assert.equal(result, 'settled');
  assert.equal(returned, true);
  assert.ok(produced < 5);
});

// An endless row source that records whether it was released.
function endlessRows() {
  const rows = {
    returned: false,
    [Symbol.iterator]() { return this; },
    next() { return { done: false, value: { call: 'K7AAA' } }; },
    return() { rows.returned = true; return { done: true }; },
  };
  return rows;
}

test('writeCsv destroys a destination that never drains and releases the iterator', async () => {
  const rows = endlessRows();
  // A client that never reads: write() never calls back, so 'drain' never fires.
  const out = new Writable({ highWaterMark: 1, write() {} });
  const started = Date.now();
  await writeCsv(rows, out, { drainTimeoutMs: 50 });
  assert.equal(out.destroyed, true);
  assert.equal(rows.returned, true);
  assert.ok(Date.now() - started >= 45);
});

test('writeCsv destroys the destination when the whole export passes its deadline', async () => {
  const rows = endlessRows();
  // A slow client: each chunk drains, just slowly, so only the overall deadline stops it.
  const out = new Writable({ highWaterMark: 1, write(chunk, enc, cb) { setTimeout(cb, 5); } });
  await writeCsv(rows, out, { drainTimeoutMs: 1000, deadlineMs: 80 });
  assert.equal(out.destroyed, true);
  assert.equal(rows.returned, true);
});
