import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLicense } from '../../src/fcc/classify.js';

test('brand new license', () => {
  const r = classifyLicense({
    opClass: 'T', prevCall: '', prevClass: '', grantDate: '2026-05-01',
    history: [{ date: '2026-05-01', code: 'SYSGRT' }, { date: '2026-05-01', code: 'LIISS' }],
  });
  assert.deepEqual(r, { firstLicenseDate: '2026-05-01', upgradeDate: null, earliestEventDate: '2026-05-01' });
});

test('renewal is not new', () => {
  const r = classifyLicense({
    opClass: 'T', prevCall: '', prevClass: '', grantDate: '2026-03-01',
    history: [{ date: '2026-03-01', code: 'LIREN' }, { date: '2016-03-02', code: 'LIISS' }],
  });
  assert.equal(r.firstLicenseDate, '2016-03-02');
  assert.equal(r.earliestEventDate, '2016-03-02');
  assert.equal(r.upgradeDate, null);
});

test('vanity change is not new', () => {
  const r = classifyLicense({
    opClass: 'T', prevCall: 'KJ7XYZ', prevClass: 'T', grantDate: '2026-04-01',
    history: [{ date: '2026-04-01', code: 'VANGRT' }, { date: '2026-04-01', code: 'LIISS' }],
  });
  assert.equal(r.firstLicenseDate, null);
  assert.equal(r.upgradeDate, null);
  assert.equal(r.earliestEventDate, '2026-04-01');
});

test('upgrade T->G uses latest LIMOD date', () => {
  const r = classifyLicense({
    opClass: 'G', prevCall: 'KJ7XYZ', prevClass: 'T', grantDate: '2026-06-15',
    history: [
      { date: '2026-06-01', code: 'LIMOD' },
      { date: '2026-06-10', code: 'LIMOD' },
      { date: '2026-06-02', code: 'LIREN' },
      { date: '2020-01-01', code: 'LIISS' },
    ],
  });
  assert.equal(r.upgradeDate, '2026-06-10');
  assert.equal(r.firstLicenseDate, null);
  assert.equal(r.earliestEventDate, '2020-01-01');
});

test('upgrade without LIMOD falls back to grantDate', () => {
  const r = classifyLicense({
    opClass: 'G', prevCall: 'KJ7XYZ', prevClass: 'T', grantDate: '2026-06-15',
    history: [{ date: '2020-01-01', code: 'LIISS' }],
  });
  assert.equal(r.upgradeDate, '2026-06-15');
  assert.equal(r.firstLicenseDate, null);
});

test('event before LIISS blocks first license', () => {
  const r = classifyLicense({
    opClass: 'T', prevCall: '', prevClass: '', grantDate: '2026-02-02',
    history: [{ date: '2015-01-01', code: 'LIEXP' }, { date: '2026-02-02', code: 'LIISS' }],
  });
  assert.equal(r.firstLicenseDate, null);
  assert.equal(r.earliestEventDate, '2015-01-01');
});

test('empty history', () => {
  const r = classifyLicense({
    opClass: 'T', prevCall: '', prevClass: '', grantDate: '2026-01-01', history: [],
  });
  assert.deepEqual(r, { firstLicenseDate: null, upgradeDate: null, earliestEventDate: null });
});

test('downgrade or same class is not an upgrade', () => {
  const r = classifyLicense({
    opClass: 'T', prevCall: 'KJ7XYZ', prevClass: 'G', grantDate: '2026-06-15',
    history: [{ date: '2026-06-01', code: 'LIMOD' }],
  });
  assert.equal(r.upgradeDate, null);
});
