// Page shell: header step bar, banners, footer, and step switching. Steps 2 and 3 mount into #step-2 / #step-3.
import { getMeta } from './api.js';
import { createSelection } from './selection.js';
import { initAreas } from './step-areas.js';
import { initFilters } from './step-filters.js';
import { initResults } from './step-results.js';

const $ = (id) => document.getElementById(id);

export const selection = createSelection();

export function showError(message) {
  const el = $('banner-error');
  el.textContent = message;
  el.hidden = !message;
}

// Show step n (1-3) and update the step bar. Step modules mount into #step-2 / #step-3.
let areas = null;

export function goToStep(n) {
  for (const section of document.querySelectorAll('.step')) section.hidden = section.id !== `step-${n}`;
  for (const li of $('step-bar').children) {
    const s = Number(li.dataset.step);
    li.classList.toggle('active', s === n);
    li.classList.toggle('done', s < n);
    if (s === n) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  }
  if (n === 1) areas?.refresh();
  window.scrollTo(0, 0);
}

async function loadMeta() {
  try {
    const meta = await getMeta();
    $('data-as-of').textContent = meta.dataAsOf ?? 'unknown';
    $('banner-stale').hidden = !meta.stale;
  } catch (err) {
    showError(err.message);
  }
}

loadMeta();
areas = await initAreas({ selection, onNext: () => goToStep(2), onError: showError });

const filters = initFilters({ onBack: () => goToStep(1), onNext: () => { goToStep(3); results.show(); } });
const results = initResults({ selection, getFilters: filters.getFilters, onBack: () => goToStep(2), onError: showError });
