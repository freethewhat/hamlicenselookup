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

// Chip text for a picked county. label is "Name, ST" (map data has no county-type word).
// Louisiana has parishes; Alaska boroughs and Puerto Rico municipios keep the plain name;
// county codes 500 and up are independent cities (Richmond city, VA vs Richmond County, VA).
export function countyChipLabel(label, geoid) {
  const m = /^(.*), ([A-Z]{2})$/.exec(label ?? '');
  if (!m) return label ?? '';
  const [, name, st] = m;
  if (st === 'LA') return `${name} Parish, ${st}`;
  if (st === 'AK' || st === 'PR') return `${name}, ${st}`;
  if (Number(String(geoid).slice(2)) >= 500) return `${name} city, ${st}`;
  return `${name} County, ${st}`;
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

// Result count line. addressCount is only sent when "Prepare for mailer" is on.
export function countMessage(count, addressCount) {
  const hams = `${count.toLocaleString('en-US')} ${count === 1 ? 'ham' : 'hams'} found`;
  if (addressCount == null) return hams;
  return `${hams} at ${addressCount.toLocaleString('en-US')} ${addressCount === 1 ? 'address' : 'addresses'}`;
}
