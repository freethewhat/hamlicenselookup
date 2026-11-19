import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BY_FIELDS, BY_STORAGE_KEY, statusWord, lookupName, sinceDate, lookupCells, fccLicenseUrl,
  lookupCountMessage, paramsFromSearch, searchFromParams, hasQuery, onlyUsedParams, needCountyLoad,
} from '../../public/js/lookup-format.js';

test('BY_FIELDS lists the six fields with labels, call sign first', () => {
  assert.deepEqual(BY_FIELDS, [
    ['call', 'Call sign'], ['name', 'Name'], ['street', 'Street'], ['city', 'City'], ['county', 'County'], ['zip', 'ZIP code'],
  ]);
  assert.equal(BY_STORAGE_KEY, 'hamfinder.lookupBy.v1');
});

test('statusWord maps FCC codes to words', () => {
  assert.equal(statusWord('A'), 'Active');
  assert.equal(statusWord('E'), 'Expired');
  assert.equal(statusWord('C'), 'Cancelled');
  assert.equal(statusWord('T'), 'Terminated');
  assert.equal(statusWord(''), 'Unknown');
  assert.equal(statusWord(null), 'Unknown');
});

test('lookupName falls back to entity name, then "No name"', () => {
  assert.equal(lookupName({ first: 'ALPHA', mi: 'Q', last: 'TESTER', suffix: '' }), 'ALPHA Q TESTER');
  assert.equal(lookupName({ first: '', last: '', entity_name: 'TESTER RADIO CLUB' }), 'TESTER RADIO CLUB');
  assert.equal(lookupName({ first: '', last: '', entity_name: '' }), 'No name');
});

test('sinceDate uses earliest event, then grant date, then "Unknown"', () => {
  assert.equal(sinceDate({ earliest_event_date: '2020-01-02', grant_date: '2024-01-01' }), '2020-01-02');
  assert.equal(sinceDate({ earliest_event_date: null, grant_date: '2024-01-01' }), '2024-01-01');
  assert.equal(sinceDate({ earliest_event_date: null, grant_date: '' }), 'Unknown');
});

test('lookupCells gives the six table cells', () => {
  const r = { call: 'K7AAA', first: 'ALPHA', last: 'TESTER', op_class: 'T', city: 'Missoula', state: 'MT', status: 'A', earliest_event_date: '2026-05-01' };
  assert.deepEqual(lookupCells(r), ['K7AAA', 'ALPHA TESTER', 'Technician', 'Missoula, MT', 'Active', '2026-05-01']);
  assert.equal(lookupCells({ ...r, city: '', state: 'MT' })[3], 'MT');
  assert.equal(lookupCells({ ...r, city: '', state: '' })[3], '');
  assert.equal(lookupCells({ ...r, op_class: '' })[2], '');
});

test('fccLicenseUrl', () => {
  assert.equal(fccLicenseUrl(123), 'https://wireless2.fcc.gov/UlsApp/UlsSearch/license.jsp?licKey=123');
});

test('lookupCountMessage', () => {
  assert.equal(lookupCountMessage(0, 0), 'No matches.');
  assert.equal(lookupCountMessage(1, 1), '1 match.');
  assert.equal(lookupCountMessage(12, 12), '12 matches.');
  assert.equal(lookupCountMessage(1234, 100), 'Showing 100 of 1,234. Narrow your search.');
});

test('paramsFromSearch defaults to call with empty values', () => {
  assert.deepEqual(paramsFromSearch('?by=nope&q=x&state=MT'), { by: 'call', q: '', state: '', county: '' });
  assert.deepEqual(paramsFromSearch(''), { by: 'call', q: '', state: '', county: '' });
  assert.deepEqual(paramsFromSearch('?by=county&state=MT&county=30063'), { by: 'county', q: '', state: 'MT', county: '30063' });
});

test('searchFromParams round-trips and leaves out empty values', () => {
  const p = { by: 'city', q: 'Saint Louis', state: 'MO', county: '' };
  assert.equal(searchFromParams(p), '?by=city&q=Saint+Louis&state=MO');
  assert.deepEqual(paramsFromSearch(searchFromParams(p)), p);
});

test('hasQuery says when a search can run', () => {
  assert.equal(hasQuery({ by: 'call', q: 'K7AAA', state: '', county: '' }), true);
  assert.equal(hasQuery({ by: 'call', q: ' ', state: '', county: '' }), false);
  assert.equal(hasQuery({ by: 'city', q: 'Missoula', state: '', county: '' }), false);
  assert.equal(hasQuery({ by: 'city', q: 'Missoula', state: 'MT', county: '' }), true);
  assert.equal(hasQuery({ by: 'county', q: '', state: 'MT', county: '' }), false);
  assert.equal(hasQuery({ by: 'county', q: '', state: 'MT', county: '30063' }), true);
});

test('onlyUsedParams blanks the values the field does not use', () => {
  const all = { by: 'county', q: 'K7AAA', state: 'MT', county: '30063' };
  assert.deepEqual(onlyUsedParams(all), { by: 'county', q: '', state: 'MT', county: '30063' });
  assert.deepEqual(onlyUsedParams({ ...all, by: 'city' }), { by: 'city', q: 'K7AAA', state: 'MT', county: '' });
  assert.deepEqual(onlyUsedParams({ ...all, by: 'call' }), { by: 'call', q: 'K7AAA', state: '', county: '' });
});

test('needCountyLoad reloads counties when the state they belong to differs', () => {
  assert.equal(needCountyLoad({ by: 'county', state: 'ID', loadedFor: 'MT' }), true);
  assert.equal(needCountyLoad({ by: 'county', state: 'MT', loadedFor: 'MT' }), false);
  assert.equal(needCountyLoad({ by: 'county', state: 'MT', loadedFor: null }), true);
  assert.equal(needCountyLoad({ by: 'county', state: '', loadedFor: 'MT' }), true);
  assert.equal(needCountyLoad({ by: 'city', state: 'ID', loadedFor: 'MT' }), false);
});
