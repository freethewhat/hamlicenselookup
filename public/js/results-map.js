/* global L */
// Step 3 results map: circles with counts, pins with a popup, a progress line, and the
// "Hams in this map view" table. Uses the global `L` from /vendor/leaflet/leaflet.js.
// Everything from the data goes in with textContent, never as HTML.
import { prepareMap, mapPoints } from './api.js';
import {
  prepareMessage, inViewMessage, hamLine, lookupHref, viewFromBounds, clusterSize, needsPoints, isActivateKey, clusterLabel, setLiveText, popupMaxWidth, POPUP_LEFT_ROOM, mapFailure,
} from './map-format.js';

const POLL_MS = 3000;
const MAX_ZOOM = 18;
const WORLD = { south: -90, west: -180, north: 90, east: 180 };

// "Look up" link; the call sign is added for screen readers so each link has a unique name.
function lookupLink(call) {
  const a = document.createElement('a');
  a.href = lookupHref(call);
  a.append('Look up');
  const hidden = document.createElement('span');
  hidden.className = 'visually-hidden';
  hidden.textContent = ` ${call}`;
  a.append(hidden);
  return a;
}

function popupFor(hams) {
  const ul = document.createElement('ul');
  ul.className = 'ham-popup';
  for (const h of hams) {
    const { call, name, cls, city } = hamLine(h);
    const li = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = call;
    li.append(strong, document.createElement('br'));
    li.append([name, cls, city].filter(Boolean).join(', '), document.createElement('br'));
    li.append(lookupLink(call));
    ul.append(li);
  }
  return ul;
}

function tableRow(h) {
  const tr = document.createElement('tr');
  const { call, name, cls, city } = hamLine(h);
  for (const text of [call, name, cls, city]) {
    const td = document.createElement('td');
    td.textContent = text;
    tr.append(td);
  }
  const td = document.createElement('td');
  td.append(lookupLink(call));
  tr.append(td);
  return tr;
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function createResultsMap({ el, statusEl, tableBody, tableCountEl, onError, isUpdating = () => false }) {
  const tableWrap = tableBody.closest('.table-wrap');
  let map = null;
  let marks = null;
  let body = null;
  let active = false;
  let token = 0; // a new show() or hide() drops answers for the old search
  let pointsToken = 0; // a newer map view drops answers for an older one
  let timer = null;
  let shownPlaced = -1; // placed count of the last progress answer whose points were rendered
  let fitted = false;
  let popupOpen = false; // a redraw removes the pin and closes its popup, so moves wait until it closes
  let viewStale = false; // the map moved while a popup was open

  function fail(err) {
    const { status, banner } = mapFailure(err, isUpdating());
    if (status) setLiveText(statusEl, status);
    else onError(banner);
  }

  function ensureMap() {
    if (map) return;
    map = L.map(el, { keyboard: true }).setView([39.5, -98.35], 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: MAX_ZOOM,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    marks = L.layerGroup().addTo(map);
    map.on('moveend', () => {
      if (!active || !fitted) return;
      if (popupOpen) viewStale = true; // e.g. the popup panned the map to fit itself
      else loadPoints();
    });
    map.on('popupopen', () => {
      popupOpen = true;
    });
    map.on('popupclose', () => {
      popupOpen = false;
      if (viewStale && active && fitted) loadPoints();
      viewStale = false;
    });
  }

  function clusterMarker({ lat, lon, count }) {
    const size = clusterSize(count);
    const div = document.createElement('div');
    div.className = 'cluster-icon';
    div.style.width = `${size}px`;
    div.style.height = `${size}px`;
    div.textContent = count.toLocaleString('en-US');
    const label = clusterLabel(count);
    const marker = L.marker([lat, lon], {
      icon: L.divIcon({ html: div, className: '', iconSize: [size, size] }),
      title: label,
      alt: label,
      keyboard: true, // Leaflet makes the icon a role=button Tab stop
    });
    const zoomIn = () => map.setView(marker.getLatLng(), Math.min(map.getZoom() + 2, MAX_ZOOM));
    marker.on('click', zoomIn);
    // Leaflet does not click a marker from the keyboard, so Enter and Space are handled here.
    marker.on('keypress', (e) => {
      if (!isActivateKey(e.originalEvent)) return;
      e.originalEvent.preventDefault(); // Space would scroll the page
      zoomIn();
      el.focus(); // the circle is redrawn after the zoom, so focus would fall to the page
    });
    marker.on('add', () => marker.getElement()?.setAttribute('aria-label', label));
    return marker;
  }

  function pinMarker({ lat, lon, hams }) {
    const pin = L.circleMarker([lat, lon], {
      radius: 8,
      color: cssVar('--pin-line'),
      weight: 2,
      fillColor: cssVar('--pin-fill'),
      fillOpacity: 1,
    });
    pin.bindPopup(() => popupFor(hams), {
      maxWidth: popupMaxWidth(map.getSize().x),
      autoPanPaddingTopLeft: [POPUP_LEFT_ROOM, 8],
    });
    return pin;
  }

  function render({ clusters, pins, inView }) {
    marks.clearLayers();
    for (const c of clusters) marks.addLayer(clusterMarker(c));
    for (const p of pins) marks.addLayer(pinMarker(p));
    tableBody.replaceChildren(...inView.hams.map(tableRow));
    tableWrap.hidden = inView.hams.length === 0;
    setLiveText(tableCountEl, inViewMessage(inView.count, inView.hams.length));
  }

  // Points for the current view. Before the first fit the whole world is asked for, so the map can fit to it.
  // placed: the progress count that asked for this load; recorded only once the answer is rendered.
  async function loadPoints(placed) {
    const mine = token;
    const pmine = ++pointsToken;
    const b = map.getBounds();
    const view = fitted
      ? viewFromBounds({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, map.getZoom())
      : viewFromBounds(WORLD, map.getZoom());
    if (!view) return;
    try {
      const res = await mapPoints({ ...body, ...view });
      if (mine !== token || pmine !== pointsToken) return;
      render(res);
      if (placed !== undefined) shownPlaced = placed;
      if (!fitted) {
        const all = [...res.clusters, ...res.pins].map((p) => [p.lat, p.lon]);
        if (all.length) {
          fitted = true;
          map.fitBounds(L.latLngBounds(all), { padding: [24, 24], maxZoom: 15 }); // moveend loads the real view
        }
      }
    } catch (err) {
      if (mine === token && pmine === pointsToken) fail(err);
    }
  }

  async function poll() {
    const mine = token;
    timer = null;
    try {
      const res = await prepareMap(body);
      if (mine !== token) return;
      setLiveText(statusEl, prepareMessage(res));
      if (needsPoints({ placed: res.placed, shownPlaced, fitted })) {
        await loadPoints(res.placed);
        if (mine !== token) return;
      }
      if (res.pending > 0) timer = setTimeout(poll, POLL_MS);
    } catch (err) {
      if (mine === token) fail(err);
    }
  }

  function stop() {
    token++;
    active = false;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return {
    // Call after the map panel is visible, so Leaflet can measure it.
    show(next) {
      stop();
      ensureMap();
      map.invalidateSize();
      active = true;
      if (next !== body) {
        body = next;
        shownPlaced = -1;
        fitted = false;
        marks.clearLayers();
        tableBody.replaceChildren();
        tableWrap.hidden = true;
        tableCountEl.textContent = '';
        statusEl.textContent = 'Preparing map…';
      }
      poll();
    },
    hide: stop,
  };
}
