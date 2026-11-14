import { CLASS_LABELS, STATUS_LABELS } from '../fcc/fields.js';

export const csvZip = (z) => (/^\d{9}$/.test(z ?? '') ? `${z.slice(0, 5)}-${z.slice(5)}` : (z ?? ''));
const label = (map, v) => (v ? (map[v] ?? v) : '');

export const CSV_COLUMNS = [
  ['Call Sign', (r) => r.call],
  ['First Name', (r) => r.first],
  ['Middle Initial', (r) => r.mi],
  ['Last Name', (r) => r.last],
  ['Suffix', (r) => r.suffix],
  ['Entity Name', (r) => r.entity_name],
  ['Street Address', (r) => r.street],
  ['PO Box', (r) => r.po_box],
  ['City', (r) => r.city],
  ['State', (r) => r.state],
  ['ZIP', (r) => csvZip(r.zip)],
  ['County', (r) => r.county_name || 'Unassigned'],
  ['License Class', (r) => label(CLASS_LABELS, r.op_class)],
  ['License Status', (r) => label(STATUS_LABELS, r.status)],
  ['Grant Date', (r) => r.grant_date],
  ['Expiration Date', (r) => r.expired_date],
  ['Last Action Date', (r) => r.last_action_date],
  ['First License Date', (r) => r.first_license_date],
  ['New License', (r) => r.new_label],
  ['Previous Call Sign', (r) => r.prev_call],
  ['Previous Class', (r) => label(CLASS_LABELS, r.prev_class)],
  ['Vanity Call', (r) => (r.service === 'HV' ? 'Yes' : 'No')],
  ['FRN', (r) => r.frn],
];

function cell(value) {
  let s = value == null ? '' : String(value);
  // Stop spreadsheet apps from running a cell as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One CSV record, without the line terminator.
export const csvLine = (values) => values.map(cell).join(',');

// Writes rows to `out` with backpressure. Resolves early (without throwing) if the
// destination closes mid-export, and releases the row iterator so SQLite can finish.
// An open iterator holds a read lock that blocks the daily update, so a client that stops
// reading for `drainTimeoutMs`, or an export that runs past `deadlineMs`, is cut off.
// `columns` is a list of [header, (row) => value]; the mailer export passes MAILER_COLUMNS.
export async function writeCsv(rows, out, { columns = CSV_COLUMNS, drainTimeoutMs = Infinity, deadlineMs = Infinity } = {}) {
  const deadline = Number.isFinite(deadlineMs) ? setTimeout(() => out.destroy(), deadlineMs) : null;
  // Returns false when the destination is gone.
  const write = async (chunk) => {
    if (out.destroyed) return false;
    if (out.write(chunk)) return true;
    await new Promise((resolve) => {
      const stall = Number.isFinite(drainTimeoutMs) ? setTimeout(() => out.destroy(), drainTimeoutMs) : null;
      const done = () => {
        clearTimeout(stall);
        out.off('drain', done);
        out.off('close', done);
        out.off('error', done);
        resolve();
      };
      out.on('drain', done);
      out.on('close', done);
      out.on('error', done);
    });
    return !out.destroyed;
  };
  // Swallow stream errors here; a broken client must not crash the process.
  const ignore = () => {};
  out.on('error', ignore);
  try {
    let ok = await write(`\uFEFF${csvLine(columns.map(([h]) => h))}\r\n`);
    if (ok) {
      for (const row of rows) {
        ok = await write(`${csvLine(columns.map(([, f]) => f(row)))}\r\n`);
        if (!ok) break;
      }
    }
    if (!ok) rows.return?.();
    else out.end();
  } finally {
    clearTimeout(deadline);
    out.off('error', ignore);
  }
}
