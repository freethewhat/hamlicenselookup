import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapAddress } from '../../src/map/address.js';

test('mapAddress gives the same key for spelling variants', () => {
  const a = mapAddress({ street: '123 North Main Street', city: 'Missoula', state: 'MT', zip5: '59801' });
  const b = mapAddress({ street: '123 N Main St', city: 'MISSOULA', state: 'MT', zip5: '59801' });
  assert.equal(a.key, '59801|MISSOULA|MT|123 N MAIN ST');
  assert.equal(b.key, a.key);
});

test('mapAddress returns null for PO Box only rows', () => {
  assert.equal(mapAddress({ street: 'PO Box 486', po_box: '', city: 'Missoula', state: 'MT', zip5: '59801' }), null);
  assert.equal(mapAddress({ street: '', po_box: '486', city: 'Missoula', state: 'MT', zip5: '59801' }), null);
});

test('mapAddress sends the cleaned street', () => {
  const result = mapAddress({ street: '9 Elm Rd Missoula MT 59801', city: 'Missoula', state: 'MT', zip5: '59801' });
  assert.equal(result.street, '9 Elm Rd');
});
