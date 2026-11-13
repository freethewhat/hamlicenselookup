import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSelection } from '../../public/js/selection.js';

test('toggling twice removes the item', () => {
  const s = createSelection();
  s.toggle('zip', '59801', '59801');
  assert.equal(s.has('zip', '59801'), true);
  s.toggle('zip', '59801', '59801');
  assert.equal(s.has('zip', '59801'), false);
  assert.deepEqual(s.items(), []);
});

test('same id as zip and county are separate items', () => {
  const s = createSelection();
  s.toggle('zip', '30001', '30001');
  s.toggle('county', '30001', 'Test County');
  assert.equal(s.items().length, 2);
});

test('toRequest splits zips and counties', () => {
  const s = createSelection();
  s.toggle('zip', '59801', '59801');
  s.toggle('county', '30063', 'Missoula, MT');
  s.toggle('zip', '59802', '59802');
  assert.deepEqual(s.toRequest(), { zips: ['59801', '59802'], counties: ['30063'] });
});

test('coveredZips unions county zips with direct zips, counting overlaps once', () => {
  const s = createSelection();
  s.toggle('county', 'A', 'A');
  s.toggle('county', 'B', 'B');
  s.toggle('zip', '2', '2');
  s.toggle('zip', '9', '9');
  const map = new Map([
    ['A', ['1', '2']],
    ['B', ['2', '3']],
  ]);
  assert.deepEqual([...s.coveredZips(map)].sort(), ['1', '2', '3', '9']);
});

test('coveredZips tolerates a county missing from the map', () => {
  const s = createSelection();
  s.toggle('county', 'X', 'X');
  assert.equal(s.coveredZips(new Map()).size, 0);
});

test('onChange fires on toggle, remove, clear; unsubscribe stops it', () => {
  const s = createSelection();
  let n = 0;
  const off = s.onChange(() => n++);
  s.toggle('zip', '1', '1');
  s.remove('zip', '1');
  s.toggle('zip', '2', '2');
  s.clear();
  assert.equal(n, 4);
  off();
  s.toggle('zip', '3', '3');
  assert.equal(n, 4);
});

test('remove of an absent item does not fire onChange', () => {
  const s = createSelection();
  let n = 0;
  s.onChange(() => n++);
  s.remove('zip', 'nope');
  assert.equal(n, 0);
});
