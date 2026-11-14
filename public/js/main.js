// Page shell: header step bar, banners, footer, and step switching. Steps 2 and 3 mount into #step-2 / #step-3.
import { getMeta } from './api.js';
import { dataLoadingNotice } from './status-format.js';
import { createSelection } from './selection.js';
import { initAreas } from './step-areas.js';
import { initFilters } from './step-filters.js';
import { initResults } from './step-results.js';
import { initUpdateBanner } from './update-banner.js';
import { stepHeadingId } from './focus.js';

const $ = (id) => document.getElementById(id);

export const selection = createSelection();

export function showError(message) {
  // While an update runs, the progress banner replaces the "no data yet" 503 messages.
  if (message && dataLoadingNotice({ status: 503, message }, updateBanner.isRunning())) message = '';
  const el = $('banner-error');
  el.textContent = message;
  el.hidden = !message;
}

// Show step n (1-3) and update the step bar. Step modules mount into #step-2 / #step-3.
let areas = null;

export function goToStep(n) {
  const smooth = typeof document.startViewTransition === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!smooth) return showStep(n);
  // Focus the heading only after the browser has swapped the sections.
  document.startViewTransition(() => showStep(n, false)).updateCallbackDone.then(() => focusStep(n));
}

function focusStep(n) {
  // Move focus to the new step's heading so keyboard and screen-reader users know where they are.
  document.getElementById(stepHeadingId(n)).focus();
}

function showStep(n, focus = true) {
  for (const section of document.querySelectorAll('.step')) section.hidden = section.id !== `step-${n}`;
  for (const li of $('step-bar').children) {
    const s = Number(li.dataset.step);
    li.classList.toggle('active', s === n);
    li.classList.toggle('done', s < n);
    if (s === n) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  }
  if (n === 1) areas?.refresh();
  if (focus) focusStep(n);
}

async function loadMeta() {
  try {
    const meta = await getMeta();
    $('data-as-of').textContent = meta.dataAsOf ?? 'unknown';
    $('banner-stale').hidden = !meta.stale;
  } catch (err) {
    // The update banner already explains a first load in progress.
    if (!dataLoadingNotice(err, updateBanner.isRunning())) showError(err.message);
  }
}

// A running update just finished: show the new date, drop stale errors, reload the state list.
async function onDataReady() {
  showError('');
  await loadMeta();
  await areas?.reloadStates();
}

const updateBanner = initUpdateBanner({ onDataReady });
// Never let a slow status call hold up the page.
await Promise.race([updateBanner.firstPoll, new Promise((r) => setTimeout(r, 3000))]);
loadMeta();
areas = await initAreas({ selection, onNext: () => goToStep(2), onError: showError });

const filters = initFilters({ onBack: () => goToStep(1), onNext: () => { goToStep(3); results.show(); } });
const results = initResults({ selection, getFilters: filters.getFilters, getMailer: filters.getMailer, onBack: () => goToStep(2), onError: showError, isUpdating: updateBanner.isRunning });
