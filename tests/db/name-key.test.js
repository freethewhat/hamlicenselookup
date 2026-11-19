import test from 'node:test';
import assert from 'node:assert/strict';
import { nameKey } from '../../src/db/name-key.js';

test('nameKey upper-cases and keeps only letters and digits', () => {
  assert.equal(nameKey('MC CARTHY'), 'MCCARTHY');
  assert.equal(nameKey('McCarthy'), 'MCCARTHY');
  assert.equal(nameKey("O'Brien"), 'OBRIEN');
  assert.equal(nameKey('Smith-Jones Jr.'), 'SMITHJONESJR');
  assert.equal(nameKey(''), '');
  assert.equal(nameKey(null), '');
  assert.equal(nameKey(undefined), '');
});
