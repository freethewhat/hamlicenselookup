// Step 3: count, preview table, and CSV download.
import { search, exportCsv } from './api.js';
import { countMessage, rowCells } from './format.js';
import { dataLoadingNotice } from './status-format.js';

const $ = (id) => document.getElementById(id);

function row(r) {
  const tr = document.createElement('tr');
  for (const text of rowCells(r)) {
    const td = document.createElement('td');
    td.textContent = text ?? '';
    tr.append(td);
  }
  return tr;
}

// Returns { show } which runs the search for the current selection and filters.
export function initResults({ selection, getFilters, getMailer = () => false, onBack, onError, isUpdating = () => false }) {
  const download = $('download-csv');
  let body = null;
  let count = 0; // hits for the current search
  let token = 0; // ignores a slow search that was overtaken by a newer one

  $('back-3').addEventListener('click', onBack);

  download.addEventListener('click', async () => {
    if (!body) return;
    const clicked = token;
    const request = body;
    download.disabled = true;
    let url = null;
    try {
      onError('');
      const blob = await exportCsv(request);
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      a.download = `hams-${request.mailer ? 'mailer-' : ''}${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
    } catch (err) {
      onError(err.message);
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (clicked === token && count > 0) download.disabled = false;
    }
  });

  async function show() {
    const mine = ++token;
    count = 0;
    body = { ...selection.toRequest(), filters: getFilters(), mailer: getMailer() };
    $('result-count').textContent = 'Searching…';
    $('result-note').textContent = '';
    $('result-table').hidden = true;
    $('result-table').parentElement.hidden = true;
    $('result-rows').replaceChildren();
    download.disabled = true;
    try {
      onError('');
      const res = await search(body);
      if (mine !== token) return;
      count = res.count;
      const { preview } = res;
      if (count === 0) {
        $('result-count').textContent = 'No hams match. Try more areas or fewer filters.';
        return;
      }
      $('result-count').textContent = countMessage(count, res.addressCount);
      $('result-rows').replaceChildren(...preview.map(row));
      $('result-table').hidden = false;
      $('result-table').parentElement.hidden = false;
      if (count > preview.length) {
        $('result-note').textContent = `Showing ${preview.length.toLocaleString('en-US')} of ${count.toLocaleString('en-US')}. The CSV has all of them.`;
      }
      download.disabled = false;
    } catch (err) {
      if (mine !== token) return;
      const notice = dataLoadingNotice(err, isUpdating());
      $('result-count').textContent = notice ?? '';
      if (!notice) onError(err.message);
    }
  }

  return { show };
}
