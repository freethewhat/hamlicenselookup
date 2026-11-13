// Step 3: count, preview table, and CSV download.
import { search, exportCsv } from './api.js';

const $ = (id) => document.getElementById(id);

const CLASS_LABELS = { T: 'Technician', G: 'General', E: 'Extra', A: 'Advanced', N: 'Novice' };

export function displayName(r) {
  // Individuals also carry entity_name ("Last, First MI"); use it only when there is no personal name (clubs).
  const person = [r.first, r.mi, r.last, r.suffix].filter(Boolean).join(' ');
  return r.first || r.last ? person : (r.entity_name ?? '');
}

export function displayAddress(r) {
  return r.street || (r.po_box ? `PO Box ${r.po_box}` : '');
}

export function displayZip(r) {
  const z = r.zip ?? '';
  return /^\d{9}$/.test(z) ? `${z.slice(0, 5)}-${z.slice(5)}` : z;
}

function row(r) {
  const tr = document.createElement('tr');
  const cells = [
    r.call,
    displayName(r),
    displayAddress(r),
    r.city,
    displayZip(r),
    r.county_name || 'Unassigned',
    CLASS_LABELS[r.op_class] ?? r.op_class ?? '',
    r.new_label ?? '',
  ];
  for (const text of cells) {
    const td = document.createElement('td');
    td.textContent = text ?? '';
    tr.append(td);
  }
  return tr;
}

// Returns { show } which runs the search for the current selection and filters.
export function initResults({ selection, getFilters, onBack, onError }) {
  const download = $('download-csv');
  let body = null;
  let token = 0; // ignores a slow search that was overtaken by a newer one

  $('back-3').addEventListener('click', onBack);

  download.addEventListener('click', async () => {
    if (!body) return;
    download.disabled = true;
    let url = null;
    try {
      onError('');
      const blob = await exportCsv(body);
      url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hams-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
    } catch (err) {
      onError(err.message);
    } finally {
      if (url) URL.revokeObjectURL(url);
      download.disabled = false;
    }
  });

  async function show() {
    const mine = ++token;
    body = { ...selection.toRequest(), filters: getFilters() };
    $('result-count').textContent = 'Searching…';
    $('result-note').textContent = '';
    $('result-table').hidden = true;
    $('result-rows').replaceChildren();
    download.disabled = true;
    try {
      onError('');
      const res = await search(body);
      if (mine !== token) return;
      const { count, preview } = res;
      if (count === 0) {
        $('result-count').textContent = 'No hams match. Try more areas or fewer filters.';
        return;
      }
      $('result-count').textContent = `${count.toLocaleString('en-US')} ${count === 1 ? 'ham' : 'hams'} found`;
      $('result-rows').replaceChildren(...preview.map(row));
      $('result-table').hidden = false;
      if (count > preview.length) {
        $('result-note').textContent = `Showing ${preview.length.toLocaleString('en-US')} of ${count.toLocaleString('en-US')}. The CSV has all of them.`;
      }
      download.disabled = false;
    } catch (err) {
      if (mine !== token) return;
      $('result-count').textContent = '';
      onError(err.message);
    }
  }

  return { show };
}
