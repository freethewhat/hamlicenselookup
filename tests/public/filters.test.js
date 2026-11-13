import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultFilters, filtersFromForm, defaultSince } from '../../public/js/step-filters.js';

test('defaultSince is the same date 12 months earlier', () => {
  assert.equal(defaultSince(new Date('2026-11-13')), '2025-11-13');
});

test('defaultSince clamps Feb 29 to Feb 28', () => {
  assert.equal(defaultSince(new Date('2028-02-29')), '2027-02-28');
});

test('defaultFilters has no date and all booleans false', () => {
  assert.deepEqual(defaultFilters(new Date('2026-11-13')), {
    firstLicenseSince: null,
    includeUpgrades: false,
    includeExpired: false,
    includeClubs: false,
  });
});

test('first-only off drops since and upgrades', () => {
  const f = filtersFromForm({ firstOnly: false, since: '2025-11-13', includeUpgrades: true, includeExpired: true, includeClubs: false });
  assert.deepEqual(f, { firstLicenseSince: null, includeUpgrades: false, includeExpired: true, includeClubs: false });
});

test('first-only on carries since and upgrades', () => {
  const f = filtersFromForm({ firstOnly: true, since: '2025-11-13', includeUpgrades: true, includeExpired: false, includeClubs: true });
  assert.deepEqual(f, { firstLicenseSince: '2025-11-13', includeUpgrades: true, includeExpired: false, includeClubs: true });
});

test('first-only with an empty or invalid date falls back to the default since', () => {
  for (const since of ['', 'garbage', undefined]) {
    const f = filtersFromForm({ firstOnly: true, since, includeUpgrades: true, includeExpired: false, includeClubs: false }, new Date('2026-11-13'));
    assert.equal(f.firstLicenseSince, '2025-11-13');
    assert.equal(f.includeUpgrades, true);
  }
});
