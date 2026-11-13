import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCounties, parseZips } from '../../public/js/form-view.js';

const counties = [
  { geoid: '30063', name: 'Missoula', state: 'MT' },
  { geoid: '30081', name: 'Ravalli', state: 'MT' },
  { geoid: '16001', name: 'Ravalli', state: 'ID' },
  { geoid: '22001', name: 'Acadia Parish', state: 'LA' },
];
const ids = (t) => matchCounties(t, counties).map((c) => c.geoid);

test('exact label match', () => assert.deepEqual(ids('Missoula, MT'), ['30063']));
test('lowercase, no state', () => assert.deepEqual(ids('missoula'), ['30063']));
test('with County word', () => {
  assert.deepEqual(ids('Missoula County, MT'), ['30063']);
  assert.deepEqual(ids('Missoula County'), ['30063']);
});
test('parish names match with or without the word', () => {
  assert.deepEqual(ids('Acadia'), ['22001']);
  assert.deepEqual(ids('acadia parish, la'), ['22001']);
});
test('ambiguous without state, resolved with state', () => {
  assert.deepEqual(ids('Ravalli'), ['30081', '16001']);
  assert.deepEqual(ids('Ravalli, ID'), ['16001']);
});
test('no match', () => {
  assert.deepEqual(ids('Nowhere'), []);
  assert.deepEqual(ids(''), []);
  assert.deepEqual(ids('Missoula, ID'), []);
});
test('parseZips splits on mixed separators and reports rejects', () => {
  assert.deepEqual(parseZips('59801, 59802\n59801 abc 1234'), { valid: ['59801', '59802'], rejected: ['abc', '1234'] });
});
