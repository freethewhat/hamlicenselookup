import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareMessage, inViewMessage, hamLine, lookupHref, optOutText, viewFromBounds, clusterSize, needsPoints, isActivateKey, clusterLabel,
} from '../../public/js/map-format.js';

test('prepareMessage while pending counts placed hams', () => {
  assert.equal(prepareMessage({ total: 353, placed: 120, unplaceable: 0, pending: 233, error: null }), 'Preparing map: 120 of 353 hams placed.');
});

test('prepareMessage when done adds the could-not-place hint', () => {
  assert.equal(
    prepareMessage({ total: 353, placed: 312, unplaceable: 41, pending: 0, error: null }),
    '312 of 353 hams are on the map. 41 could not be placed (PO box only, or the address was not found).',
  );
  assert.equal(prepareMessage({ total: 5, placed: 5, unplaceable: 0, pending: 0, error: null }), '5 of 5 hams are on the map.');
});

test('prepareMessage uses en-US digit groups', () => {
  assert.equal(prepareMessage({ total: 12345, placed: 1000, unplaceable: 0, pending: 11345, error: null }), 'Preparing map: 1,000 of 12,345 hams placed.');
});

test('prepareMessage returns an error as is, whatever the counts', () => {
  assert.equal(prepareMessage({ total: 353, placed: 1, unplaceable: 2, pending: 3, error: 'Too many.' }), 'Too many.');
  assert.equal(prepareMessage({ total: 0, placed: 0, unplaceable: 0, pending: 0, error: 'Busy.' }), 'Busy.');
});

test('prepareMessage with no matches', () => {
  assert.equal(prepareMessage({ total: 0, placed: 0, unplaceable: 0, pending: 0, error: null }), 'No hams match.');
});

test('inViewMessage', () => {
  assert.equal(inViewMessage(250, 100), 'Showing 100 of 250. Zoom in to see the rest.');
  assert.equal(inViewMessage(48, 48), 'Hams in this map view: 48');
  assert.equal(inViewMessage(1500, 100), 'Showing 100 of 1,500. Zoom in to see the rest.');
});

test('hamLine uses display name and class label', () => {
  assert.deepEqual(
    hamLine({ call: 'K7AAA', first: 'ALPHA', mi: 'Q', last: 'TESTER', suffix: '', entity_name: 'TESTER, ALPHA Q', op_class: 'E', city: 'Testville' }),
    { call: 'K7AAA', name: 'ALPHA Q TESTER', cls: 'Extra', city: 'Testville' },
  );
  assert.deepEqual(hamLine({ call: 'K7AAB', first: '', last: '', entity_name: 'TEST CLUB', op_class: null, city: null }), { call: 'K7AAB', name: 'TEST CLUB', cls: '', city: '' });
});

test('lookupHref encodes the call', () => {
  assert.equal(lookupHref('K7AAA'), '/lookup.html?by=call&q=K7AAA');
  assert.equal(lookupHref('A&B'), '/lookup.html?by=call&q=A%26B');
});

test('optOutText', () => {
  assert.equal(optOutText(''), '');
  assert.equal(optOutText(undefined), '');
  assert.equal(optOutText('test@example.org'), 'To be left off the map, contact test@example.org.');
});

test('viewFromBounds passes a normal box and integer zoom through', () => {
  assert.deepEqual(
    viewFromBounds({ south: 46.8, west: -114.1, north: 47, east: -113.9 }, 12),
    { bbox: { south: 46.8, west: -114.1, north: 47, east: -113.9 }, zoom: 12 },
  );
});

test('viewFromBounds clamps a box wider than the world', () => {
  assert.deepEqual(
    viewFromBounds({ south: -95, west: -400, north: 95, east: 300 }, 1),
    { bbox: { south: -90, west: -180, north: 90, east: 180 }, zoom: 1 },
  );
});

test('viewFromBounds shifts a wrapped box back into range', () => {
  const { bbox } = viewFromBounds({ south: 40, west: 245.9, north: 50, east: 246.1 }, 10);
  assert.ok(Math.abs(bbox.west - -114.1) < 1e-9 && Math.abs(bbox.east - -113.9) < 1e-9, JSON.stringify(bbox));
  assert.deepEqual([bbox.south, bbox.north], [40, 50]);
  // Crosses the antimeridian: keep the part up to 180.
  assert.deepEqual(viewFromBounds({ south: 10, west: 170, north: 20, east: 190 }, 5).bbox, { south: 10, west: 170, north: 20, east: 180 });
});

test('viewFromBounds rounds and clamps the zoom', () => {
  assert.equal(viewFromBounds({ south: 1, west: 1, north: 2, east: 2 }, 4.6).zoom, 5);
  assert.equal(viewFromBounds({ south: 1, west: 1, north: 2, east: 2 }, 4.4).zoom, 4);
  assert.equal(viewFromBounds({ south: 1, west: 1, north: 2, east: 2 }, -1).zoom, 0);
  assert.equal(viewFromBounds({ south: 1, west: 1, north: 2, east: 2 }, 22).zoom, 19);
});

test('viewFromBounds returns null for an empty box', () => {
  assert.equal(viewFromBounds({ south: 95, west: 1, north: 99, east: 2 }, 3), null);
  assert.equal(viewFromBounds({ south: 1, west: 5, north: 2, east: 5 }, 3), null);
  assert.equal(viewFromBounds({ south: NaN, west: 1, north: 2, east: 2 }, 3), null);
});

test('clusterSize is at least 32 px and grows with the count', () => {
  assert.equal(clusterSize(2), 32);
  assert.ok(clusterSize(100) > clusterSize(10));
  assert.ok(clusterSize(10000) > clusterSize(100));
  assert.ok(clusterSize(1e6) <= 64);
});

test('needsPoints loads when more hams are placed than the map last showed', () => {
  assert.equal(needsPoints({ placed: 10, shownPlaced: -1, fitted: false }), true); // first answer
  assert.equal(needsPoints({ placed: 10, shownPlaced: 10, fitted: true }), false); // nothing new
  assert.equal(needsPoints({ placed: 20, shownPlaced: 10, fitted: true }), true); // a batch finished
  assert.equal(needsPoints({ placed: 0, shownPlaced: -1, fitted: false }), true); // shows the empty answer once
});

test('needsPoints retries while the map has not been fitted', () => {
  // An answer dropped or failed before the first fit must not leave the map empty for good.
  assert.equal(needsPoints({ placed: 10, shownPlaced: 10, fitted: false }), true);
  assert.equal(needsPoints({ placed: 0, shownPlaced: 0, fitted: false }), false); // nothing to fit to
});

test('isActivateKey is Enter or Space, like a button', () => {
  assert.equal(isActivateKey({ key: 'Enter' }), true);
  assert.equal(isActivateKey({ key: ' ' }), true);
  assert.equal(isActivateKey({ key: 'Spacebar' }), true);
  assert.equal(isActivateKey({ key: 'a' }), false);
  assert.equal(isActivateKey({ key: '+' }), false);
});

test('clusterLabel names the count and the action', () => {
  assert.equal(clusterLabel(254), '254 hams. Zoom in.');
  assert.equal(clusterLabel(1500), '1,500 hams. Zoom in.');
});
