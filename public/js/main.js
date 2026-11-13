// Page shell: header step bar, banners, footer, and step switching. Task 9 fills steps 2 and 3.
import { getMeta } from './api.js';
import { createSelection } from './selection.js';
import { initAreas } from './step-areas.js';

const $ = (id) => document.getElementById(id);

export const selection = createSelection();

export function showError(message) {
  const el = $('banner-error');
  el.textContent = message;
  el.hidden = !message;
}

// Show step n (1-3) and update the step bar. Step modules mount into #step-2 / #step-3.
export function goToStep(n) {
  for (const section of document.querySelectorAll('.step')) section.hidden = section.id !== `step-${n}`;
  for (const li of $('step-bar').children) {
    const s = Number(li.dataset.step);
    li.classList.toggle('active', s === n);
    li.classList.toggle('done', s < n);
    if (s === n) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  }
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
initAreas({ selection, onNext: () => goToStep(2), onError: showError });
