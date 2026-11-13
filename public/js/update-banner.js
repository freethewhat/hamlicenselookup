// Banner at the top of <main> showing the data update's progress. Polls /api/status.
import { getStatus, getMeta } from './api.js';
import { statusView } from './status-format.js';

const FAST_MS = 2000;
const SLOW_MS = 60_000;
// The server re-checks its data files every 5 s, so wait that long before reading the new data.
const HANDLE_RECHECK_MS = 5500;

// onDataReady() runs when a running update finishes, so the page can load the new data.
// Returns { isRunning(), firstPoll } where firstPoll resolves after the first status answer.
export function initUpdateBanner({ onDataReady }) {
  const root = document.createElement('div');
  root.className = 'banner update-banner';
  root.hidden = true;
  const bar = document.createElement('progress');
  bar.max = 100;
  const text = document.createElement('span');
  text.setAttribute('aria-live', 'polite');
  text.setAttribute('role', 'status');
  root.append(text, bar);
  document.querySelector('main').prepend(root);

  let state = 'idle';
  let dataAsOf = null;
  let timer = null;

  async function render(status) {
    // On the running -> done edge the new data is live: tell the page, and read the date for the text.
    const finished = state === 'running' && status.state === 'done';
    if (finished) await new Promise((r) => setTimeout(r, HANDLE_RECHECK_MS));
    let view = statusView(status, new Date(), dataAsOf);
    if (status.state === 'done' && view.visible && (finished || dataAsOf === null)) {
      try {
        dataAsOf = (await getMeta()).dataAsOf;
        view = statusView(status, new Date(), dataAsOf);
      } catch {
        // meta not available; the text falls back to "Data updated"
      }
    }
    root.hidden = !view.visible;
    root.className = `banner update-banner ${view.tone}`;
    text.textContent = view.text;
    bar.hidden = !(status.state === 'running' || status.state === 'done');
    if (view.percent === null) bar.removeAttribute('value');
    else bar.value = view.percent;
    state = status.state;
    if (finished) onDataReady();
  }

  async function poll() {
    try {
      await render(await getStatus());
    } catch {
      // status unavailable (server restarting); keep the last banner and try again
    }
    // Stay fast while running and while the "Data updated" message is on screen, so it clears on time.
    const fast = state === 'running' || (state === 'done' && !root.hidden);
    timer = setTimeout(poll, fast ? FAST_MS : SLOW_MS);
  }

  const firstPoll = poll();
  return {
    isRunning: () => state === 'running',
    firstPoll,
    stop: () => clearTimeout(timer),
  };
}
