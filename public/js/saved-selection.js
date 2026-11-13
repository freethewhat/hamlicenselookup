// Saves the step 1 picks (states, ZIPs, counties) in browser storage between visits.
// The storage object is passed in, so node tests can use a fake. No browser globals here.
export const STORAGE_KEY = 'hamfinder.selection.v1';

const TYPES = new Set(['zip', 'county']);
const isText = (v) => typeof v === 'string' && v !== '';
const empty = () => ({ states: [], items: [] });

// Returns {states, items}. Missing, broken, or blocked storage gives empty lists.
export function load(storage) {
  let data;
  try {
    data = JSON.parse(storage.getItem(STORAGE_KEY));
  } catch {
    return empty();
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.states) || !Array.isArray(data.items)) return empty();

  const states = [...new Set(data.states.filter(isText))];
  const seen = new Set();
  const items = [];
  for (const i of data.items) {
    if (!i || !TYPES.has(i.type) || !isText(i.id)) continue;
    const key = `${i.type}:${i.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ type: i.type, id: i.id, label: isText(i.label) ? i.label : i.id });
  }
  return { states, items };
}

// Never throws. Private windows, blocked storage, and a full quota all just skip the save.
export function save(storage, { states, items }) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ states, items }));
  } catch {
    // nothing to do: the picks simply are not remembered
  }
}

// Split saved state abbrs into ones the server still lists and ones it does not. Keeps saved order.
export function splitSavedStates(saved, known) {
  const knownSet = new Set(known);
  const out = { known: [], unknown: [] };
  for (const abbr of new Set(saved)) (knownSet.has(abbr) ? out.known : out.unknown).push(abbr);
  return out;
}
