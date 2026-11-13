/* global L */
// Leaflet map of ZIP or county shapes. Uses the global `L` from /vendor/leaflet/leaflet.js.
const BASE = { color: '#35506b', weight: 1, fillColor: '#35506b', fillOpacity: 0.05 };
const PICKED = { color: '#0b3d7a', weight: 2, fillColor: '#1f5fa8', fillOpacity: 0.55 };

export function createMapView({ el, selection, loadGeo, onError }) {
  const map = L.map(el, { preferCanvas: true }).setView([39.5, -98.35], 4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const cache = new Map(); // "ST:mode" -> Promise<L.GeoJSON>
  let states = [];
  let mode = 'zip';
  let token = 0; // invalidates stale async loads
  let centeredOn = null;
  const shown = new Set(); // layers currently on the map

  function itemFor(feature, st) {
    const p = feature.properties;
    return mode === 'county'
      ? { type: 'county', id: p.geoid, label: `${p.name}, ${st}`, tip: p.name }
      : { type: 'zip', id: p.zip, label: p.zip, tip: p.zip };
  }

  function style(feature, st, layerMode) {
    const p = feature.properties;
    const picked = layerMode === 'county' ? selection.has('county', p.geoid) : selection.has('zip', p.zip);
    return picked ? PICKED : BASE;
  }

  function buildLayer(st, layerMode) {
    return loadGeo(st, layerMode).then((data) =>
      L.geoJSON(data, {
        style: (f) => style(f, st, layerMode),
        onEachFeature(feature, layer) {
          const item = itemFor(feature, st);
          layer.bindTooltip(item.tip, { sticky: true });
          layer.on('click', () => selection.toggle(item.type, item.id, item.label));
        },
      }),
    );
  }

  function layerFor(st) {
    const k = `${st}:${mode}`;
    if (!cache.has(k)) {
      const p = buildLayer(st, mode);
      p.catch(() => cache.delete(k));
      cache.set(k, p);
    }
    return cache.get(k);
  }

  async function sync() {
    const mine = ++token;
    for (const l of shown) map.removeLayer(l);
    shown.clear();
    if (states.length === 0) {
      centeredOn = null;
      return;
    }
    const first = states[0];
    await Promise.all(
      states.map(async (st) => {
        try {
          const layer = await layerFor(st);
          if (mine !== token) return;
          layer.setStyle((f) => style(f, st, mode)); // selection may have changed while hidden
          layer.addTo(map);
          shown.add(layer);
          if (st === first && centeredOn !== `${first}:${mode}`) {
            centeredOn = `${first}:${mode}`;
            const b = layer.getBounds();
            if (b.isValid()) map.fitBounds(b);
          }
        } catch (err) {
          if (mine === token) onError(`Could not load the ${mode === 'county' ? 'county' : 'ZIP'} map for ${st}: ${err.message}`);
        }
      }),
    );
  }

  selection.onChange(() => {
    for (const l of shown) l.setStyle((f) => style(f, '', mode));
  });

  return {
    setStates(next) {
      states = next;
      return sync();
    },
    setMode(next) {
      mode = next;
      return sync();
    },
    // Call after the map container becomes visible again.
    refresh() {
      map.invalidateSize();
    },
  };
}
