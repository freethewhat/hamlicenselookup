// The only code that talks to the Census batch geocoder.
const USER_AGENT = 'ham-license-finder';
export const CENSUS_BATCH_URL = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch';
const BENCHMARK = 'Public_AR_Current';

const q = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;

export function buildBatchCsv(items) {
  return items
    .map((i) => [i.id, i.street, i.city, i.state, i.zip].map(q).join(',') + '\r\n')
    .join('');
}

// RFC 4180: quoted fields may hold commas, doubled quotes, and line breaks.
function parseRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let touched = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') { inQuotes = true; touched = true; }
    else if (c === ',') { row.push(field); field = ''; touched = true; }
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (touched || field) { row.push(field); rows.push(row); }
      row = []; field = ''; touched = false;
    } else { field += c; touched = true; }
  }
  if (touched || field) { row.push(field); rows.push(row); }
  return rows;
}

function parsePoint(s) {
  const parts = String(s ?? '').split(',');
  if (parts.length !== 2 || parts.some((p) => p.trim() === '')) return null;
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return { lat, lon };
}

export function parseBatchCsv(text) {
  const out = new Map();
  for (const r of parseRows(text)) {
    const id = r[0];
    if (!id) continue;
    if (r[2] === 'No_Match' || r[2] === 'Tie') {
      out.set(id, { status: 'none', lat: null, lon: null });
    } else if (r[2] === 'Match') {
      const p = parsePoint(r[5]);
      if (p) out.set(id, { status: 'match', lat: p.lat, lon: p.lon });
    }
  }
  return out;
}

export async function geocodeBatch(fetchImpl, items, { timeoutMs = 300_000 } = {}) {
  const body = new FormData();
  body.append('addressFile', new Blob([buildBatchCsv(items)], { type: 'text/csv' }), 'addresses.csv');
  body.append('benchmark', BENCHMARK);
  const res = await fetchImpl(CENSUS_BATCH_URL, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Census geocoder returned HTTP ${res.status}`);
  return parseBatchCsv(await res.text());
}
