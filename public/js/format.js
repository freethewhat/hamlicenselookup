// DOM-free display helpers for result rows.
export const CLASS_LABELS = { T: 'Technician', G: 'General', E: 'Extra', A: 'Advanced', N: 'Novice' };

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

// The eight preview cells, in column order.
export function rowCells(r) {
  return [
    r.call,
    displayName(r),
    displayAddress(r),
    r.city,
    displayZip(r),
    r.county_name || 'Unassigned',
    CLASS_LABELS[r.op_class] ?? r.op_class ?? '',
    r.new_label ?? '',
  ];
}
