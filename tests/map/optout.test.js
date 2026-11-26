import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOptOut, createOptOut } from '../../src/map/optout.js';

test('parseOptOut upper-cases and skips comments and blanks', () => {
  assert.deepEqual(parseOptOut('k7aaa\n# note\n\n  K7BBB  # trailing\n'), new Set(['K7AAA', 'K7BBB']));
});

test('createOptOut treats a missing file as empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'optout-'));
  assert.equal(createOptOut(join(dir, 'none.txt')).calls().size, 0);
});

test('createOptOut re-reads when the mtime changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'optout-'));
  const path = join(dir, 'optout.txt');
  writeFileSync(path, 'K7AAA\n');
  utimesSync(path, 1000, 1000);
  const list = createOptOut(path);
  assert.deepEqual(list.calls(), new Set(['K7AAA']));
  writeFileSync(path, 'K7BBB\n');
  utimesSync(path, 2000, 2000);
  assert.deepEqual(list.calls(), new Set(['K7BBB']));
});
