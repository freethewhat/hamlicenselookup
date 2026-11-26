// Map answers for a search: counts for the progress line, and clusters and pins for a map view.
// Privacy: nothing returned here carries a street or ZIP, and opted-out addresses are never queued.
import { iterateLicenses } from '../search/query.js';
import { mapAddress } from './address.js';
import { clusterPoints } from './cluster.js';

const TOO_MANY = 'This area has too many new addresses to map at once. Pick a smaller area.';
const IN_VIEW_MAX = 100;

// The only ham fields a pin or the in-view table may show.
const hamView = (r) => ({
  call: r.call, first: r.first, mi: r.mi, last: r.last, suffix: r.suffix,
  entity_name: r.entity_name, op_class: r.op_class, city: r.city,
});

export function createMapService({ store, queue, optOut, now = Date.now, cacheMs = 60_000, maxPerRequest = 20_000 }) {
  // Keyed by connection, so a reopened handle (new data) never sees another one's rows.
  const cache = new WeakMap();

  // groups: key -> { item, hams }; noStreet: hams with no street address.
  function keyed(db, zips, filters) {
    let perDb = cache.get(db);
    if (!perDb) cache.set(db, (perDb = new Map()));
    const cacheKey = JSON.stringify({ zips, filters });
    const t = now();
    for (const [k, e] of perDb) if (t - e.at > cacheMs) perDb.delete(k);
    const hit = perDb.get(cacheKey);
    if (hit) return hit;

    const groups = new Map();
    let noStreet = 0;
    for (const row of iterateLicenses(db, zips, filters)) {
      const addr = mapAddress(row);
      if (!addr) { noStreet++; continue; }
      let g = groups.get(addr.key);
      if (!g) {
        g = {
          item: { key: addr.key, street: addr.street, city: row.city, state: row.state, zip: row.zip5 },
          hams: [],
        };
        groups.set(addr.key, g);
      }
      g.hams.push(hamView(row));
    }
    const entry = { at: t, groups, noStreet };
    perDb.set(cacheKey, entry);
    return entry;
  }

  // Address keys of every license held by an opted-out call, from all rows (any status, any
  // filter), so a filtered-out ham still hides their whole address. Cached per connection until
  // the opt-out list changes (createOptOut returns the same Set until the file changes).
  const optedKeysCache = new WeakMap();
  function optedOutKeys(db) {
    const calls = optOut.calls();
    const hit = optedKeysCache.get(db);
    if (hit?.calls === calls) return hit.keys;
    const keys = new Set();
    if (calls.size) {
      const rows = db
        .prepare('SELECT call, street, po_box, city, state, zip5 FROM licenses WHERE call IN (SELECT value FROM json_each(?))')
        .all(JSON.stringify([...calls]));
      for (const row of rows) {
        const addr = mapAddress(row);
        if (addr) keys.add(addr.key);
      }
    }
    optedKeysCache.set(db, { calls, keys });
    return keys;
  }

  // Addresses with no opted-out ham, plus the hams hidden by the opt-out list.
  function visible(db, groups) {
    const optedOut = optedOutKeys(db);
    const shown = [];
    let hidden = 0;
    for (const [key, g] of groups) {
      if (optedOut.has(key)) hidden += g.hams.length;
      else shown.push(g);
    }
    return { shown, hidden };
  }

  function prepare(db, zips, filters) {
    const { groups, noStreet } = keyed(db, zips, filters);
    const { shown, hidden } = visible(db, groups);
    const points = store.lookup(shown.map((g) => g.item.key));
    let total = noStreet + hidden;
    let placed = 0;
    let unplaceable = noStreet + hidden;
    const missing = [];
    for (const g of shown) {
      total += g.hams.length;
      const p = points.get(g.item.key);
      if (p?.fresh && p.status === 'match') placed += g.hams.length;
      else if (p?.fresh && p.status === 'none') unplaceable += g.hams.length;
      else missing.push(g);
    }

    let error = queue.error();
    if (!error) {
      const fresh = missing.filter((g) => !queue.isPending(g.item.key));
      if (fresh.length > maxPerRequest) error = TOO_MANY;
      else if (missing.length) error = queue.want(missing.map((g) => g.item)).error;
    }
    let pending = 0;
    if (error !== TOO_MANY) {
      for (const g of missing) if (queue.isPending(g.item.key)) pending += g.hams.length;
    }
    return { total, placed, unplaceable, pending, error: error ?? null };
  }

  function points(db, zips, filters, bbox, zoom) {
    const { groups } = keyed(db, zips, filters);
    const { shown } = visible(db, groups);
    const found = store.lookup(shown.map((g) => g.item.key));
    const inBox = [];
    for (const g of shown) {
      const p = found.get(g.item.key);
      if (p?.status !== 'match') continue;
      if (p.lat < bbox.south || p.lat > bbox.north || p.lon < bbox.west || p.lon > bbox.east) continue;
      inBox.push({ lat: p.lat, lon: p.lon, hams: g.hams });
    }
    const all = inBox.flatMap((p) => p.hams).sort((a, b) => (a.call < b.call ? -1 : a.call > b.call ? 1 : 0));
    return {
      ...clusterPoints(inBox, { zoom }),
      inView: { count: all.length, hams: all.slice(0, IN_VIEW_MAX) },
    };
  }

  return { prepare, points };
}
