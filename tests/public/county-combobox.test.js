import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countCounties, matchMessage, suggestCounties } from '../../public/js/county-combobox.js';

const counties = [
  { geoid: '30063', name: 'Missoula', state: 'MT' },
  { geoid: '30081', name: 'Ravalli', state: 'MT' },
  { geoid: '16001', name: 'Ravalli', state: 'ID' },
  { geoid: '22001', name: 'Acadia Parish', state: 'LA' },
  { geoid: '30029', name: 'Flathead', state: 'MT' },
];
const labels = (t, limit) => suggestCounties(t, counties, limit).map((c) => `${c.name}, ${c.state}`);

test('prefix matches come before substring matches', () => {
  assert.deepEqual(labels('ra'), ['Ravalli, ID', 'Ravalli, MT']);
  assert.deepEqual(labels('a'), ['Acadia Parish, LA', 'Flathead, MT', 'Missoula, MT', 'Ravalli, ID', 'Ravalli, MT']);
});
test('substring match anywhere in the name', () => assert.deepEqual(labels('head'), ['Flathead, MT']));
test('same name in two states lists both', () => assert.deepEqual(labels('Ravalli'), ['Ravalli, ID', 'Ravalli, MT']));
test('", ST" narrows to that state', () => assert.deepEqual(labels('ravalli, mt'), ['Ravalli, MT']));
test('a trailing County/Parish word is ignored', () => {
  assert.deepEqual(labels('Missoula County'), ['Missoula, MT']);
  assert.deepEqual(labels('acadia parish'), ['Acadia Parish, LA']);
});
test('case and extra spaces do not matter', () => assert.deepEqual(labels('  MISSOULA  '), ['Missoula, MT']));
test('blank text gives no suggestions', () => assert.deepEqual(labels('   '), []));
test('limit caps the list', () => assert.equal(labels('a', 2).length, 2));

test('countCounties counts every match, not just the shown ones', () => {
  assert.equal(countCounties('a', counties), 5);
  assert.equal(countCounties('ravalli, mt', counties), 1);
  assert.equal(countCounties('', counties), 0);
});
test('matchMessage says when the list is cut short', () => {
  assert.equal(matchMessage(0, 0), 'No counties match.');
  assert.equal(matchMessage(1, 1), '1 county matches.');
  assert.equal(matchMessage(5, 5), '5 counties match.');
  assert.equal(matchMessage(20, 143), 'Showing 20 of 143 counties. Keep typing to narrow the list.');
});
