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

const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '') && !Number.isNaN(Date.parse(s));

// With "first license only" checked, a blank or invalid date falls back to the default (12 months back).
export function filtersFromForm({ firstOnly, since, includeUpgrades, includeExpired, includeClubs }, today = new Date()) {
  return {
    firstLicenseSince: firstOnly ? (validDate(since) ? since : defaultSince(today)) : null,
    includeUpgrades: firstOnly ? Boolean(includeUpgrades) : false,
    includeExpired: Boolean(includeExpired),
    includeClubs: Boolean(includeClubs),
  };
}

const $ = (id) => document.getElementById(id);

// Returns { getFilters, getMailer }. onBack/onNext are step navigation callbacks.
// getMailer is kept apart from the filters: it changes the CSV layout, not who matches.
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
    getFilters() {
      const f = filtersFromForm({
        firstOnly: firstOnly.checked,
        since: since.value,
        includeUpgrades: upgrades.checked,
        includeExpired: $('f-expired').checked,
        includeClubs: $('f-clubs').checked,
      });
      if (f.firstLicenseSince) since.value = f.firstLicenseSince;
      return f;
    },
    getMailer() {
      return $('f-mailer').checked;
    },
  };
}
