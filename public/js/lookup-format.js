// DOM-free helpers for the lookup page: field list, cell text, messages, and URL state.
import { CLASS_LABELS, displayName } from './format.js';

export const BY_FIELDS = [
  ['call', 'Call sign'], ['name', 'Name'], ['street', 'Street'], ['city', 'City'], ['county', 'County'], ['zip', 'ZIP code'],
];
export const BY_STORAGE_KEY = 'hamfinder.lookupBy.v1';

const STATUS_WORDS = { A: 'Active', E: 'Expired', C: 'Cancelled', T: 'Terminated' };
export const statusWord = (code) => STATUS_WORDS[code] ?? 'Unknown';

export const lookupName = (r) => displayName(r) || 'No name';

export const sinceDate = (r) => r.earliest_event_date || r.grant_date || 'Unknown';

// Call, Name, Class, City, Status, Since.
export function lookupCells(r) {
  return [
    r.call,
    lookupName(r),
    CLASS_LABELS[r.op_class] ?? r.op_class ?? '',
    [r.city, r.state].filter(Boolean).join(', '),
    statusWord(r.status),
    sinceDate(r),
  ];
}

export const fccLicenseUrl = (usid) => `https://wireless2.fcc.gov/UlsApp/UlsSearch/license.jsp?licKey=${usid}`;

export function lookupCountMessage(count, shown) {
  if (count === 0) return 'No matches.';
  if (shown < count) return `Showing ${shown} of ${count.toLocaleString('en-US')}. Narrow your search.`;
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'match' : 'matches'}.`;
}

const KEYS = ['by', 'q', 'state', 'county'];

// Reads location.search. An unknown or missing `by` falls back to call sign.
export function paramsFromSearch(search) {
  const sp = new URLSearchParams(search);
  const p = Object.fromEntries(KEYS.map((k) => [k, sp.get(k) ?? '']));
  if (!BY_FIELDS.some(([by]) => by === p.by)) p.by = 'call';
  return p;
}

export function searchFromParams(p) {
  return `?${new URLSearchParams(KEYS.filter((k) => p[k]).map((k) => [k, p[k]]))}`;
}

export function hasQuery({ by, q, state, county }) {
  if (by === 'county') return Boolean(county);
  if (by === 'city') return Boolean(q.trim() && state);
  return Boolean(q.trim());
}
