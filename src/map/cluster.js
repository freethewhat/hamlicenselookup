// Grid clustering for map points. Pure, no I/O.

function project(lat, lon, scale) {
  const phi = (lat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * scale;
  const y = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * scale;
  return [x, y];
}

function pass(points, scale, cellPx) {
  const cells = new Map();
  for (const p of points) {
    const [x, y] = project(p.lat, p.lon, scale);
    const key = `${Math.floor(x / cellPx)},${Math.floor(y / cellPx)}`;
    const cell = cells.get(key);
    if (cell) {
      cell.n += 1;
      cell.latSum += p.lat;
      cell.lonSum += p.lon;
      cell.count += p.hams.length;
    } else {
      cells.set(key, { n: 1, latSum: p.lat, lonSum: p.lon, count: p.hams.length, point: p });
    }
  }
  const clusters = [];
  const pins = [];
  for (const c of cells.values()) {
    if (c.n === 1) {
      pins.push({ lat: c.point.lat, lon: c.point.lon, hams: c.point.hams });
    } else {
      clusters.push({ lat: c.latSum / c.n, lon: c.lonSum / c.n, count: c.count });
    }
  }
  return { clusters, pins };
}

export function clusterPoints(
  points,
  { zoom, cellPx = 60, pinZoom = 16, maxItems = 2000 } = {},
) {
  if (zoom >= pinZoom) {
    return {
      clusters: [],
      pins: points.slice(0, maxItems).map((p) => ({ lat: p.lat, lon: p.lon, hams: p.hams })),
    };
  }
  const scale = 256 * 2 ** zoom;
  let size = cellPx;
  for (;;) {
    const out = pass(points, scale, size);
    // A cell larger than the whole world always yields at most one item.
    if (out.clusters.length + out.pins.length <= maxItems || size > scale) return out;
    size *= 2;
  }
}
