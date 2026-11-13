// Step 2: filters. The pure helpers touch no DOM so tests can import them; initFilters wires the form.

const iso = (d) => d.toISOString().slice(0, 10);

// Same calendar date 12 months earlier (Feb 29 becomes Feb 28), as YYYY-MM-DD.
export function defaultSince(today) {
  const y = today.getUTCFullYear() - 1;
  const m = today.getUTCMonth();
  const day = Math.min(today.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
  return iso(new Date(Date.UTC(y, m, day)));
}

export function defaultFilters() {
  return { firstLicenseSince: null, includeUpgrades: false, includeExpired: false, includeClubs: false };
}

export function filtersFromForm({ firstOnly, since, includeUpgrades, includeExpired, includeClubs }) {
  const dated = Boolean(firstOnly && since);
  return {
    firstLicenseSince: dated ? since : null,
    includeUpgrades: dated ? Boolean(includeUpgrades) : false,
    includeExpired: Boolean(includeExpired),
    includeClubs: Boolean(includeClubs),
  };
}

const $ = (id) => document.getElementById(id);

// Returns { getFilters }. onBack/onNext are step navigation callbacks.
export function initFilters({ onBack, onNext }) {
  const firstOnly = $('f-first-only');
  const since = $('f-since');
  const upgrades = $('f-upgrades');
  since.value = defaultSince(new Date());

  function sync() {
    since.disabled = !firstOnly.checked;
    upgrades.disabled = !firstOnly.checked;
  }
  firstOnly.addEventListener('change', sync);
  sync();

  $('back-2').addEventListener('click', onBack);
  $('next-2').addEventListener('click', onNext);

  return {
    getFilters: () =>
      filtersFromForm({
        firstOnly: firstOnly.checked,
        since: since.value,
        includeUpgrades: upgrades.checked,
        includeExpired: $('f-expired').checked,
        includeClubs: $('f-clubs').checked,
      }),
  };
}
