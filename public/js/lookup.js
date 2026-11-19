// Lookup page: one field at a time (call, name, street, city, county, ZIP). The search lives in the URL,
// so a lookup can be bookmarked and Back/Forward replay it.
import { getCounties, getMeta, getStates, lookupLicenses } from './api.js';
import { createCountyCombobox } from './county-combobox.js';
import { countyChipLabel, displayAddress, displayZip } from './format.js';
import {
  BY_FIELDS, BY_STORAGE_KEY, fccLicenseUrl, hasQuery, lookupCells, lookupCountMessage, lookupName,
  needCountyLoad, onlyUsedParams, paramsFromSearch, searchFromParams, statusWord,
} from './lookup-format.js';
import { dataLoadingNotice } from './status-format.js';
import { initUpdateBanner } from './update-banner.js';

const $ = (id) => document.getElementById(id);

const TEXT_FIELDS = {
  call: ['Call sign', 'For example K7ABC.'],
  name: ['Name', 'Last name, or first and last name. The start of a name is enough.'],
  street: ['Street', 'Any part of the street, for example Pine or 12 Pine.'],
  city: ['City', 'The full city name.'],
  zip: ['ZIP code', '5 digits.'],
};

let county = null; // { geoid, name, state } picked in the county field
let counties = [];
let countiesFor = null; // the state `counties` belongs to

function showError(message) {
  const el = $('banner-error');
  el.textContent = message;
  el.hidden = !message;
}

function errorText(err) {
  return dataLoadingNotice(err, updateBanner.isRunning()) ?? err.message;
}

// Show only the inputs the chosen field needs.
function showFields(by) {
  $('lookup-q-field').hidden = by === 'county';
  $('lookup-state-field').hidden = by !== 'city' && by !== 'county';
  $('lookup-county-field').hidden = by !== 'county';
  if (TEXT_FIELDS[by]) {
    const [label, hint] = TEXT_FIELDS[by];
    $('lookup-q-label').textContent = label;
    $('lookup-hint').textContent = hint;
  }
}

function showPickedCounty() {
  $('lookup-county-picked').textContent = county ? `Picked: ${countyChipLabel(`${county.name}, ${county.state}`, county.geoid)}` : '';
}

async function loadCounties(state) {
  counties = [];
  countiesFor = state;
  combo.setCounties([]);
  if (!state) return;
  try {
    counties = await getCounties(state);
    combo.setCounties(counties);
  } catch (err) {
    showError(errorText(err));
  }
}

function readForm() {
  return onlyUsedParams({
    by: $('lookup-by').value,
    q: $('lookup-q').value.trim(),
    state: $('lookup-state').value,
    county: county?.geoid ?? '',
  });
}

// Put URL params into the form. Loads the state's counties when the county field needs them.
async function fillForm(p) {
  $('lookup-by').value = p.by;
  $('lookup-q').value = p.by === 'county' ? '' : p.q;
  const state = p.by === 'city' || p.by === 'county' ? p.state : '';
  $('lookup-state').value = state;
  if (needCountyLoad({ by: p.by, state, loadedFor: countiesFor })) await loadCounties(state);
  county = p.by === 'county' ? counties.find((c) => c.geoid === p.county) ?? null : null;
  showPickedCounty();
  showFields(p.by);
}

function detailRow(r, id) {
  const tr = document.createElement('tr');
  tr.id = id;
  tr.className = 'lookup-detail';
  tr.hidden = true;
  const td = document.createElement('td');
  td.colSpan = 6;
  const dl = document.createElement('dl');
  const items = [
    ['Name', lookupName(r)],
    ['Address', [displayAddress(r), r.street && r.po_box ? `PO Box ${r.po_box}` : ''].filter(Boolean).join(', ')],
    ['City, state, ZIP', [r.city, r.state, displayZip(r)].filter(Boolean).join(' ')],
    ['County', r.county_name ?? ''],
    ['Status', statusWord(r.status)],
    ['Granted', r.grant_date],
    ['Expires', r.expired_date],
    ['Cancelled', r.cancel_date],
    ['First license', r.first_license_date],
    ['Upgraded', r.upgrade_date],
    ['Previous call', r.prev_call],
  ];
  for (const [term, value] of items) {
    if (!value) continue;
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
  const link = document.createElement('a');
  link.href = fccLicenseUrl(r.usid);
  link.textContent = `See ${r.call} on the FCC license search`;
  td.append(dl, link);
  tr.append(td);
  return tr;
}

function render({ count, rows }) {
  $('lookup-count').textContent = lookupCountMessage(count, rows.length);
  const body = $('lookup-rows');
  body.replaceChildren();
  rows.forEach((r, n) => {
    const id = `lookup-detail-${n}`;
    const tr = document.createElement('tr');
    lookupCells(r).forEach((text, i) => {
      const td = document.createElement('td');
      if (i === 0) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'link';
        btn.textContent = text;
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-controls', id);
        btn.addEventListener('click', () => {
          const open = btn.getAttribute('aria-expanded') !== 'true';
          btn.setAttribute('aria-expanded', String(open));
          $(id).hidden = !open;
        });
        td.append(btn);
      } else {
        td.textContent = text;
      }
      tr.append(td);
    });
    body.append(tr, detailRow(r, id));
  });
  document.querySelector('.table-wrap').hidden = rows.length === 0;
}

function clearResults() {
  $('lookup-count').textContent = '';
  $('lookup-rows').replaceChildren();
  document.querySelector('.table-wrap').hidden = true;
}

async function run(p) {
  if (!hasQuery(p)) return clearResults();
  showError('');
  try {
    render(await lookupLicenses(p));
  } catch (err) {
    clearResults();
    showError(errorText(err));
  }
}

function saveBy(by) {
  try {
    localStorage.setItem(BY_STORAGE_KEY, by);
  } catch {
    // storage blocked; the choice is just not remembered
  }
}

function savedBy() {
  try {
    const by = localStorage.getItem(BY_STORAGE_KEY);
    return BY_FIELDS.some(([b]) => b === by) ? by : null;
  } catch {
    return null;
  }
}

const updateBanner = initUpdateBanner({ onDataReady: () => { showError(''); loadMeta(); loadStates(); } });

const combo = createCountyCombobox({
  input: $('lookup-county'),
  listbox: $('lookup-county-listbox'),
  status: $('lookup-county-count'),
  onPick: (c) => {
    county = c;
    showPickedCounty();
    $('lookup-form').requestSubmit();
  },
  onEnterText: () => {
    if (county) $('lookup-form').requestSubmit();
  },
});

async function loadMeta() {
  try {
    const meta = await getMeta();
    $('data-as-of').textContent = meta.dataAsOf ?? 'unknown';
    $('banner-stale').hidden = !meta.stale;
  } catch (err) {
    if (!dataLoadingNotice(err, updateBanner.isRunning())) showError(err.message);
  }
}

async function loadStates() {
  try {
    const states = await getStates();
    const select = $('lookup-state');
    const keep = select.value;
    select.replaceChildren(new Option('Pick a state…', ''), ...states.map((s) => new Option(s.name, s.abbr)));
    select.value = keep;
  } catch (err) {
    showError(errorText(err));
  }
}

$('lookup-by').replaceChildren(...BY_FIELDS.map(([value, label]) => new Option(label, value)));
$('lookup-by').addEventListener('change', () => {
  const by = $('lookup-by').value;
  showFields(by);
  const state = $('lookup-state').value;
  if (needCountyLoad({ by, state, loadedFor: countiesFor })) loadCounties(state);
});
$('lookup-state').addEventListener('change', () => {
  county = null;
  showPickedCounty();
  const state = $('lookup-state').value;
  if (needCountyLoad({ by: $('lookup-by').value, state, loadedFor: countiesFor })) loadCounties(state);
});

$('lookup-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const p = readForm();
  saveBy(p.by);
  const url = searchFromParams(p);
  if (url !== location.search) history.pushState(null, '', url);
  run(p);
});

addEventListener('popstate', async () => {
  const p = paramsFromSearch(location.search);
  await fillForm(p);
  run(p);
});

await Promise.race([updateBanner.firstPoll, new Promise((r) => setTimeout(r, 3000))]);
loadMeta();
await loadStates();
const start = paramsFromSearch(location.search);
if (!new URLSearchParams(location.search).has('by')) start.by = savedBy() ?? 'call';
await fillForm(start);
run(start);
