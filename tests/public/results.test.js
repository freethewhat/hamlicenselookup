import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName, displayAddress, displayZip, rowCells, countyChipLabel } from '../../public/js/format.js';

test('individual name is First MI Last Suffix, not entity_name', () => {
  assert.equal(displayName({ first: 'ALPHA', mi: 'Q', last: 'TESTER', suffix: 'JR', entity_name: 'TESTER, ALPHA Q' }), 'ALPHA Q TESTER JR');
  assert.equal(displayName({ first: 'ALPHA', mi: '', last: 'TESTER', suffix: '' }), 'ALPHA TESTER');
});

test('club name is entity_name', () => {
  assert.equal(displayName({ first: '', last: '', entity_name: 'TEST RADIO CLUB' }), 'TEST RADIO CLUB');
});

test('address falls back to PO Box when street is empty', () => {
  assert.equal(displayAddress({ street: '1 Test St', po_box: '9' }), '1 Test St');
  assert.equal(displayAddress({ street: '', po_box: '123' }), 'PO Box 123');
  assert.equal(displayAddress({ street: '', po_box: '' }), '');
});

test('9-digit ZIP is formatted, 5-digit left alone', () => {
  assert.equal(displayZip({ zip: '598011234' }), '59801-1234');
  assert.equal(displayZip({ zip: '59801' }), '59801');
});

test('row cells map class label and Unassigned county', () => {
  const cells = rowCells({ call: 'K7AAA', first: 'A', last: 'T', street: 's', city: 'Missoula', zip: '59801', county_name: null, op_class: 'E', new_label: 'First license' });
  assert.deepEqual(cells, ['K7AAA', 'A T', 's', 'Missoula', '59801', 'Unassigned', 'Extra', 'First license']);
  assert.equal(rowCells({ op_class: 'T', county_name: 'Missoula' })[5], 'Missoula');
  assert.equal(rowCells({ op_class: 'T' })[6], 'Technician');
});

test('county chip label names the county once, with the right word', () => {
  assert.equal(countyChipLabel('Missoula, MT', '30063'), 'Missoula County, MT');
  assert.equal(countyChipLabel('Acadia, LA', '22001'), 'Acadia Parish, LA');
  assert.equal(countyChipLabel('Juneau, AK', '02110'), 'Juneau, AK');
  assert.equal(countyChipLabel('Richmond, VA', '51760'), 'Richmond city, VA'); // independent city
  assert.equal(countyChipLabel('Richmond, VA', '51159'), 'Richmond County, VA');
  assert.equal(countyChipLabel('Ponce, PR', '72113'), 'Ponce, PR');
});
