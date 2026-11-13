import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readZipEntries } from '../../src/fcc/unzip.js';
import { makeFccZip } from '../helpers/fcc-fixture.js';

async function readAll(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks).toString('latin1');
}

test('readZipEntries returns streams for requested names and omits missing ones', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ham-unzip-'));
  try {
    const zipPath = await makeFccZip(dir, { EN: ['EN|1|x'], counts: ['EN 1'] });
    const map = await readZipEntries(zipPath, ['en.dat', 'COUNTS', 'HD.dat']);
    assert.deepEqual([...map.keys()].sort(), ['COUNTS', 'en.dat']);
    assert.equal(await readAll(await map.get('en.dat')()), 'EN|1|x\r\n');
    assert.equal(await readAll(await map.get('COUNTS')()), 'EN 1\r\n');
    assert.equal(map.has('HD.dat'), false);
    assert.equal(typeof map.close, 'function');
    map.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
