// Step 1: pick states, then areas by map or form. Owns the picked-states list and the selected-areas panel.
import { getStates, getCounties, getZips, getGeoJson } from './api.js';
import { createMapView } from './map-view.js';
import { createFormView } from './form-view.js';
import { countyChipLabel } from './format.js';
import { focusIndexAfterRemove } from './focus.js';
import { load, save, splitSavedStates } from './saved-selection.js';

const $ = (id) => document.getElementById(id);

export async function initAreas({ selection, onNext, onError }) {
  let states = [];
  const picked = []; // state abbrs in pick order
  const countiesByState = new Map(); // ST -> counties[]
  const countyZips = new Map(); // geoid -> zip[] (grows as states load)
  let view = 'map';
  let mode = 'zip';

  const map = createMapView({ el: $('map'), selection, loadGeo: getGeoJson, onError });
  const form = createFormView({ selection });

  // ---- saved picks (kept in this browser between visits)
  let storage = null;
  try {
    storage = window.localStorage;
  } catch {
    // blocked storage: picks are just not remembered
  }
  // Saved states wait here until the state list loads (it can fail on a first visit while data loads).
  let pendingStates = [];
  const persist = () => save(storage, { states: [...picked, ...pendingStates], items: selection.items() });

  function addPendingStates() {
    if (!states.length || !pendingStates.length) return;
    const { known } = splitSavedStates(pendingStates, states.map((s) => s.abbr));
    pendingStates = [];
    const added = known.filter((abbr) => !picked.includes(abbr));
    picked.push(...added);
    // Always save: this also drops saved states the server no longer lists.
    if (added.length) statesChanged();
    else persist();
  }

  // ---- state picker
  const select = $('state-add');
  // Also called again when a data update finishes after the page opened with no data.
  async function loadStates() {
    try {
      states = await getStates();
    } catch (err) {
      onError(err.message);
      return;
    }
    select.replaceChildren(select.options[0]);
    for (const s of states) select.append(new Option(`${s.name} (${s.abbr})`, s.abbr));
    addPendingStates();
  }
  await loadStates();

  const stateName = (abbr) => states.find((s) => s.abbr === abbr)?.name ?? abbr;

  function renderChips() {
    $('state-chips').replaceChildren(
      ...picked.map((abbr, n) =>
        chip(stateName(abbr), `Remove state ${stateName(abbr)}`, () => removeAndRefocus($('state-chips'), n, () => removeState(abbr), select)),
      ),
    );
    for (const o of select.options) o.disabled = picked.includes(o.value) && o.value !== '';
  }

  async function loadStateData(abbr) {
    if (countiesByState.has(abbr)) return;
    const [counties, zips] = await Promise.all([getCounties(abbr), getZips(abbr)]);
    countiesByState.set(abbr, counties);
    const byCounty = new Map();
    for (const z of zips) {
      if (!z.countyGeoid) continue;
      if (!byCounty.has(z.countyGeoid)) byCounty.set(z.countyGeoid, []);
      byCounty.get(z.countyGeoid).push(z.zip);
    }
    for (const [g, list] of byCounty) countyZips.set(g, list);
    // Counties with no ZIPs still resolve to an empty list.
    for (const c of counties) if (!countyZips.has(c.geoid)) countyZips.set(c.geoid, []);
  }

  async function statesChanged() {
    renderChips();
    persist();
    $('map-hint').textContent = picked.length
      ? 'Click a shape to add or remove it.'
      : 'Pick a state to start. Then click a shape to add or remove it.';
    map.setStates(picked);
    try {
      await Promise.all(picked.map(loadStateData));
    } catch (err) {
      onError(`Could not load area data: ${err.message}`);
    }
    form.setCounties(picked.flatMap((st) => countiesByState.get(st) ?? []));
    renderSelected();
  }

  function removeState(abbr) {
    picked.splice(picked.indexOf(abbr), 1);
    return statesChanged();
  }

  select.addEventListener('change', () => {
    const abbr = select.value;
    select.value = '';
    if (abbr && !picked.includes(abbr)) {
      picked.push(abbr);
      statesChanged();
    }
  });

  // ---- selected list
  // Removing a chip destroys its button. Keep keyboard focus nearby instead of letting it fall to <body>:
  // the chip now in its place, else the one before, else `fallback`.
  async function removeAndRefocus(list, index, remove, fallback) {
    await remove();
    const buttons = list.querySelectorAll('button');
    const i = focusIndexAfterRemove(index, buttons.length);
    (i >= 0 ? buttons[i] : fallback).focus();
  }

  function chip(text, removeLabel, onRemove) {
    const li = document.createElement('li');
    li.append(text);
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = '✕';
    b.setAttribute('aria-label', removeLabel);
    b.addEventListener('click', onRemove);
    li.append(b);
    return li;
  }

  function renderSelected() {
    const items = selection.items();
    $('selected-count').textContent = items.length ? `(${items.length})` : '';
    $('selected-list').replaceChildren(
      ...items.map((i, n) => {
        const text = i.type === 'county' ? countyChipLabel(i.label, i.id) : i.label;
        return chip(text, `Remove ${text}`, () => removeAndRefocus($('selected-list'), n, () => selection.remove(i.type, i.id), $('selected-title')));
      }),
    );
    const n = selection.coveredZips(countyZips).size;
    $('zip-covered').textContent = items.length ? `${n} ZIP code${n === 1 ? '' : 's'} covered` : 'Nothing picked yet.';
    $('clear-all').hidden = items.length === 0;
    $('next-1').disabled = items.length === 0;
    $('next-1-hint').hidden = items.length > 0;
    // A hidden hint is still read out if referenced, so only point at it while it applies.
    if (items.length) $('next-1').removeAttribute('aria-describedby');
    else $('next-1').setAttribute('aria-describedby', 'next-1-hint');
  }
  selection.onChange(renderSelected);
  $('clear-all').addEventListener('click', () => {
    selection.clear();
    $('selected-title').focus(); // the button hides itself, so move focus somewhere sensible
  });
  $('next-1').addEventListener('click', () => onNext());

  // ---- toggles
  function setPressed(a, b, firstOn) {
    $(a).setAttribute('aria-pressed', String(firstOn));
    $(b).setAttribute('aria-pressed', String(!firstOn));
  }
  function setView(next) {
    view = next;
    setPressed('view-map', 'view-form', view === 'map');
    $('map-panel').hidden = view !== 'map';
    $('form-panel').hidden = view !== 'form';
    $('mode-zip').disabled = $('mode-county').disabled = view !== 'map';
    if (view === 'map') map.refresh();
  }
  function setMode(next) {
    mode = next;
    setPressed('mode-zip', 'mode-county', mode === 'zip');
    return map.setMode(mode);
  }
  $('view-map').addEventListener('click', () => setView('map'));
  $('view-form').addEventListener('click', () => setView('form'));
  $('mode-zip').addEventListener('click', () => setMode('zip'));
  $('mode-county').addEventListener('click', () => setMode('county'));

  // Put back the last visit's picks, then start saving. Saving earlier would overwrite them.
  const saved = load(storage);
  selection.restore(saved.items);
  pendingStates = saved.states;
  addPendingStates();
  selection.onChange(persist);

  renderChips();
  renderSelected();
  form.setCounties([]);
  // Leaflet needs a size recalculation after its container was hidden.
  return { refresh: () => map.refresh(), reloadStates: loadStates };
}
