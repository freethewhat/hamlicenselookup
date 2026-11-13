import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, load, save, splitSavedStates } from '../../public/js/saved-selection.js';

const EMPTY = { states: [], items: [] };

function fakeStorage(data = {}) {
  return {
    data,
    getItem(k) {
      return this.data[k] ?? null;
    },
    setItem(k, v) {
      this.data[k] = String(v);
    },
  };
}

test('load returns empty when nothing is saved', () => {
  assert.deepEqual(load(fakeStorage()), EMPTY);
});

test('save then load round-trips states and items', () => {
  const s = fakeStorage();
  const data = {
    states: ['MT', 'ID'],
    items: [
      { type: 'zip', id: '59801', label: '59801' },
      { type: 'county', id: '30063', label: 'Missoula, MT' },
    ],
  };
  save(s, data);
  assert.ok(s.data[STORAGE_KEY]);
  assert.deepEqual(load(s), data);
});

test('load returns empty for bad JSON', () => {
  assert.deepEqual(load(fakeStorage({ [STORAGE_KEY]: '{not json' })), EMPTY);
});

test('load returns empty when getItem throws or storage is missing', () => {
  const s = {
    getItem() {
      throw new Error('SecurityError');
    },
  };
  assert.deepEqual(load(s), EMPTY);
  assert.deepEqual(load(undefined), EMPTY);
  assert.deepEqual(load(null), EMPTY);
});

test('load returns empty for wrong shape', () => {
  for (const raw of ['[]', 'null', '"x"', '{"states":"MT"}', '{"items":{}}']) {
    assert.deepEqual(load(fakeStorage({ [STORAGE_KEY]: raw })), EMPTY, raw);
  }
});

test('load drops bad items and keeps good ones', () => {
  const items = [
    { type: 'zip', id: '59801', label: '59801' },
    { type: 'zip' },
    { type: 'city', id: 'x', label: 'x' },
    'junk',
    null,
    { type: 'zip', id: '59801', label: '59801' },
    { type: 'county', id: '30063' },
  ];
  const s = fakeStorage({ [STORAGE_KEY]: JSON.stringify({ states: [], items }) });
  assert.deepEqual(load(s).items, [
    { type: 'zip', id: '59801', label: '59801' },
    { type: 'county', id: '30063', label: '30063' },
  ]);
});

test('load drops non-string and duplicate states', () => {
  const s = fakeStorage({ [STORAGE_KEY]: JSON.stringify({ states: ['MT', 3, null, 'MT', 'ID'], items: [] }) });
  assert.deepEqual(load(s).states, ['MT', 'ID']);
});

test('save ignores setItem that throws', () => {
  const s = {
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  assert.doesNotThrow(() => save(s, EMPTY));
  assert.doesNotThrow(() => save(null, EMPTY));
});

test('splitSavedStates keeps known in saved order and lists unknown', () => {
  assert.deepEqual(splitSavedStates(['ID', 'XX', 'MT', 'ID'], ['MT', 'ID']), { known: ['ID', 'MT'], unknown: ['XX'] });
});
