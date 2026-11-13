// Turns user-picked ZIPs and counties into one sorted, de-duplicated ZIP list.
export function resolveZips(geoDb, { zips = [], counties = [] } = {}) {
  const out = new Set();
  const invalid = [];
  for (const z of zips) {
    if (/^\d{5}$/.test(z)) out.add(z);
    else invalid.push(z);
  }
  const byCounty = geoDb.prepare('SELECT zip FROM zips WHERE county_geoid = ?');
  for (const geoid of counties) {
    for (const { zip } of byCounty.all(geoid)) out.add(zip);
  }
  return { zips: [...out].sort(), invalid };
}
