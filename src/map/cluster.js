// Grid clustering for map points. Pure, no I/O.

function project(lat, lon, scale) {
  const phi = (lat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * scale;
  const y = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * scale;
  return [x, y];
}

// Groups points by grid cell. Each group keeps sums so groups can be merged later.
function grid(points, scale, cellPx) {
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
  return [...cells.values()];
}

// Groups in neighboring cells can sit a pixel apart, so their circles would cover each other.
// Merge any two groups closer than minPx until none are left. Biggest groups absorb first.
function mergeClose(groups, scale, minPx) {
  for (;;) {
    groups.sort((a, b) => b.count - a.count);
    const at = new Map();
    const pos = groups.map((g) => project(g.latSum / g.n, g.lonSum / g.n, scale));
    groups.forEach((g, i) => {
      const key = `${Math.floor(pos[i][0] / minPx)},${Math.floor(pos[i][1] / minPx)}`;
      if (!at.has(key)) at.set(key, []);
      at.get(key).push(i);
    });
    const gone = new Set();
    for (let i = 0; i < groups.length; i++) {
      if (gone.has(i)) continue;
      const [x, y] = pos[i];
      const cx = Math.floor(x / minPx);
      const cy = Math.floor(y / minPx);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const j of at.get(`${cx + dx},${cy + dy}`) ?? []) {
            if (j === i || gone.has(j)) continue;
            if (Math.hypot(pos[j][0] - x, pos[j][1] - y) >= minPx) continue;
            const a = groups[i];
            const b = groups[j];
            a.n += b.n;
            a.latSum += b.latSum;
            a.lonSum += b.lonSum;
            a.count += b.count;
            gone.add(j);
          }
        }
      }
    }
    if (gone.size === 0) return groups;
    groups = groups.filter((_, i) => !gone.has(i));
  }
}

function pass(points, scale, cellPx) {
  const clusters = [];
  const pins = [];
  for (const g of mergeClose(grid(points, scale, cellPx), scale, cellPx)) {
    if (g.n === 1) {
      pins.push({ lat: g.point.lat, lon: g.point.lon, hams: g.point.hams });
    } else {
      clusters.push({ lat: g.latSum / g.n, lon: g.lonSum / g.n, count: g.count });
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
