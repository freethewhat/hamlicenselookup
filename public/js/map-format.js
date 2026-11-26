// DOM-free helpers for the step 3 results map: messages, ham lines, links, and the map view sent to the server.
import { displayName, CLASS_LABELS } from './format.js';

const n = (v) => v.toLocaleString('en-US');

// The progress line. A server error (queue busy, area too big) wins over the counts.
export function prepareMessage({ total, placed, unplaceable, pending, error }) {
  if (error) return error;
  if (total === 0) return 'No hams match.';
  if (pending > 0) return `Preparing map: ${n(placed)} of ${n(total)} hams placed.`;
  const done = `${n(placed)} of ${n(total)} hams are on the map.`;
  return unplaceable > 0 ? `${done} ${n(unplaceable)} could not be placed (PO box only, or the address was not found).` : done;
}

// Count line for the "Hams in this map view" table; the server sends at most 100 hams.
export function inViewMessage(count, shown) {
  return count > shown ? `Showing ${n(shown)} of ${n(count)}. Zoom in to see the rest.` : `Hams in this map view: ${n(count)}`;
}

// One ham in a pin popup or the in-view table.
export function hamLine(h) {
  return { call: h.call, name: displayName(h), cls: CLASS_LABELS[h.op_class] ?? h.op_class ?? '', city: h.city ?? '' };
}

export const lookupHref = (call) => `/lookup.html?by=call&q=${encodeURIComponent(call)}`;

export const optOutText = (contact) => (contact ? `To be left off the map, contact ${contact}.` : '');

// Circle size in px for a cluster count: 32 px at least (target size), larger for bigger counts, 64 px at most.
export function clusterSize(count) {
  return Math.min(64, 32 + Math.round(Math.max(0, Math.log10(count) - 1) * 10));
}

// Turns Leaflet bounds and zoom into the { bbox, zoom } the server accepts:
// -90 <= south < north <= 90, -180 <= west < east <= 180, integer zoom 0-19.
// Leaflet can report longitudes past ±180 (wrapped or very wide views) and fractional zooms.
// Returns null when nothing of the box is left.
export function viewFromBounds({ south, west, north, east }, zoom) {
  if (![south, west, north, east, zoom].every(Number.isFinite)) return null;
  if (east - west >= 360) {
    west = -180;
    east = 180;
  } else {
    const shift = Math.floor((west + 180) / 360) * 360; // move west into [-180, 180)
    west -= shift;
    east = Math.min(east - shift, 180); // a box over the antimeridian keeps its part up to 180
  }
  south = Math.max(south, -90);
  north = Math.min(north, 90);
  if (!(south < north && west < east)) return null;
  return { bbox: { south, west, north, east }, zoom: Math.min(19, Math.max(0, Math.round(zoom))) };
}
