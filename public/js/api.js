// Thin fetch wrappers. Errors carry the server's message (e.g. the 503 "Data is being updated").
async function fail(res) {
  let msg = `Request failed (${res.status})`;
  let body = null;
  try {
    body = await res.json();
    if (body?.error) msg = body.error;
  } catch {
    // non-JSON body; keep the generic message
  }
  throw Object.assign(new Error(msg), { status: res.status, body });
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) await fail(res);
  return res.json();
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) await fail(res);
  return res;
}

export const getStatus = () => getJson('/api/status');
export const getMeta = () => getJson('/api/meta');
export const getStates = () => getJson('/api/states');
export const getCounties = (state) => getJson(`/api/counties?state=${encodeURIComponent(state)}`);
export const getZips = (state) => getJson(`/api/zips?state=${encodeURIComponent(state)}`);
export const getGeoJson = (state, mode) => getJson(`/geo/${encodeURIComponent(state)}/${mode === 'county' ? 'counties' : 'zips'}.geojson`);
// params: { by, q, state, county }; empty values are left out of the URL.
export const lookupLicenses = (params) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  return getJson(`/api/lookup?${qs}`);
};
export const search = async (body) => (await post('/api/search', body)).json();
export const exportCsv = async (body) => (await post('/api/export', body)).blob();
export const prepareMap = async (body) => (await post('/api/map/prepare', body)).json();
// body: search body plus bbox { south, west, north, east } and an integer zoom 0-19.
export const mapPoints = async (body) => (await post('/api/map/points', body)).json();
