# Results Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** add a List | Map toggle to step 3 that shows the search's hams as clustered pins at their home address, geocoded on demand with the US Census batch geocoder and saved in `DATA_DIR/geocode.db`.

**Architecture:** a new `src/map/` folder holds five small units: address key, opt-out list, point store (`geocode.db`), Census client, one shared geocode queue, and grid clustering. `src/map/service.js` ties them to a search and backs two routes, `POST /api/map/prepare` and `POST /api/map/points`. The page gets `public/js/results-map.js` (Leaflet) and a DOM-free `public/js/map-format.js`.

**Tech Stack:** Node 22 (global `fetch`, `FormData`, `Blob`, `AbortSignal.timeout`), Express 5, better-sqlite3, Leaflet 1.9.4 from `/vendor/leaflet`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-25-results-map-design.md`

## Global Constraints

- No framework, bundler, or build step. Plain HTML, CSS, ES modules. No new npm dependency.
- The browser loads nothing new from other servers. The CSP in `src/server/app.js` does not change.
- Tests never call Census. The Census client takes an injected `fetchImpl`, like `download` in `src/update/run.js`.
- `licenses.db` and `geo.db` do not change. No schema bump.
- No club name or call sign in the repo. Fixtures use made-up calls (`K7AAA` style) and made-up addresses.
- No route returns a list of addresses. Pins carry no street, no ZIP.
- Site copy never names a project, club, or use for the map.
- WCAG 2.2 AA and the full check in `public/CLAUDE.md`, recorded in `docs/accessibility.md`.
- `npm test` and `npm run lint` pass after every task.
- Census endpoint: `https://geocoding.geo.census.gov/geocoder/locations/addressbatch`, form fields `addressFile` and `benchmark=Public_AR_Current`. `User-Agent: ham-license-finder`.
- Values: batch size 1000; per-request cap 20,000 new addresses; global queue cap 40,000; idle drop 60 s; cool-down 10 min; `'none'` retry after 90 days; cluster cell 60 px; every address a pin from zoom 16; max 2000 items per answer; in-view list max 100; page polls every 3 s; keyed-rows cache about 60 s.

## Review Focus

1. **Addresses with commas, quotes, or `#`** ("123 Main St, Apt #4", `O"Neil Rd`) must round-trip through the Census CSV both ways. Test in Task 3.
2. **Census answers out of order, with missing rows, or with a malformed "lon,lat"** must save only good matches and leave the rest missing. Test in Task 3.
3. **Two visitors mapping overlapping areas at once** must not queue an address twice, and each sees only their own `pending`. Test in Task 4.
4. **A data update swaps `licenses.db` while someone is on the map** must not serve rows from the old file after the handle reopens. Cache is keyed by the db connection object. Test in Task 6.
5. **Bad `bbox` / `zoom` in a points request** (strings, south > north, lat beyond ±90, zoom 25, missing) must be a 400, never a crash or a huge answer. Test in Task 6.

---

### Task 1: Address key and opt-out list

**Files:**
- Modify: `src/search/mailer.js` (export `squash`)
- Create: `src/map/address.js`, `src/map/optout.js`
- Test: `tests/map/address.test.js`, `tests/map/optout.test.js`

**Interfaces:**
- Produces: `mapAddress(row) -> { key: string, street: string } | null` where `row` has `street, po_box, city, state, zip5`. `key = \`${zip5}|${squash(city)}|${state}|${standardStreet(street)}\``, `street` is the cleaned street (from `mailingAddress`) to send to Census. Returns `null` when the cleaned street is empty.
- Produces: `parseOptOut(text: string) -> Set<string>` (upper-case calls; `#` starts a comment; blank lines skipped). `createOptOut(path: string) -> { calls(): Set<string> }` re-reads the file only when its mtime changes; a missing file is an empty set.

- [ ] **Step 1: Write the failing tests**

`tests/map/address.test.js`:
- `mapAddress({ street: '123 North Main Street', city: 'Missoula', state: 'MT', zip5: '59801' })` and `{ street: '123 N Main St', city: 'MISSOULA', ... }` give the same `key`, equal to `'59801|MISSOULA|MT|123 N MAIN ST'`.
- `mapAddress({ street: 'PO Box 486', po_box: '', city: 'Missoula', state: 'MT', zip5: '59801' })` is `null`.
- `mapAddress({ street: '', po_box: '486', ... })` is `null`.
- `mapAddress({ street: '9 Elm Rd Missoula MT 59801', city: 'Missoula', state: 'MT', zip5: '59801' }).street` is `'9 Elm Rd'`.

`tests/map/optout.test.js`:
- `parseOptOut('k7aaa\n# note\n\n  K7BBB  # trailing\n')` equals `new Set(['K7AAA', 'K7BBB'])`.
- `createOptOut(missingPath).calls().size === 0`.
- Write a file, read it, rewrite it with a later mtime (`utimes`), and `calls()` shows the new content.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/map/`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `mapAddress` in `src/map/address.js` and `parseOptOut` / `createOptOut` in `src/map/optout.js`**

Export `squash` from `src/search/mailer.js` (no behavior change). `createOptOut` uses `statSync` on each `calls()` call and caches by `mtimeMs`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/map/ tests/search/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/search/mailer.js src/map/address.js src/map/optout.js tests/map/
git commit -m "Add map address key and opt-out list"
```

---

### Task 2: Point store (`geocode.db`)

**Files:**
- Create: `src/map/store.js`
- Test: `tests/map/store.test.js`

**Interfaces:**
- Produces: `GEOCODE_SCHEMA_VERSION = 1`.
- Produces: `openPointStore(path: string, { now = () => new Date() } = {}) -> { lookup(keys: string[]) -> Map<string, { status: 'match'|'none', lat: number|null, lon: number|null, fresh: boolean }>, save(results: Array<{ key, status, lat, lon }>) -> void, close() -> void }`.
  - `fresh` is false only for a `'none'` row whose `checked_at` is more than 90 days before `now()`.
  - `save` writes all rows in one transaction with `INSERT OR REPLACE`, `checked_at = now().toISOString().slice(0, 10)`.
- Table layout exactly as in the spec ("Storage: `DATA_DIR/geocode.db`"). WAL mode, `busy_timeout = 10000`.
- On open, if `meta.schema_version` exists and is not `GEOCODE_SCHEMA_VERSION`, rename the file to `geocode.db.old-<timestamp>` and start empty.

- [ ] **Step 1: Write the failing tests**

- Save `{ key: 'a', status: 'match', lat: 46.8, lon: -114 }` and `{ key: 'b', status: 'none', lat: null, lon: null }`; `lookup(['a', 'b', 'c'])` has `a` (match, fresh), `b` (none, fresh), and no `c`.
- With `now` 91 days later, `b.fresh === false`; `a.fresh === true`.
- `lookup` with 30,000 keys works (uses `json_each`, not a giant `IN (?, ?, ...)`).
- A file with `schema_version = '0'` is moved aside: after open, `lookup(['a'])` is empty and a `geocode.db.old-*` file exists.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/map/store.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `openPointStore` in `src/map/store.js`**

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/map/store.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/map/store.js tests/map/store.test.js
git commit -m "Add geocode point store"
```

---

### Task 3: Census batch client

**Files:**
- Create: `src/map/census.js`
- Test: `tests/map/census.test.js`

**Interfaces:**
- Produces: `CENSUS_BATCH_URL` (the endpoint above).
- Produces: `buildBatchCsv(items: Array<{ id: string, street, city, state, zip }>) -> string`. One row per item, every field double-quoted, inner `"` doubled, `\r\n` line ends, no header.
- Produces: `parseBatchCsv(text: string) -> Map<string, { status: 'match'|'none', lat: number|null, lon: number|null }>`. RFC 4180 parse (quoted fields with commas). Column 3 `Match` with a valid `"lon,lat"` in column 6 → match. `No_Match` or `Tie` → none. `Match` with a lon/lat that does not parse to two finite numbers in range → left out (treated as missing). Unknown status → left out.
- Produces: `geocodeBatch(fetchImpl, items, { timeoutMs = 300_000 } = {}) -> Promise<Map>` (same map as `parseBatchCsv`). POSTs a `FormData` with `addressFile` (a `Blob` of `buildBatchCsv(items)`, filename `addresses.csv`) and `benchmark`. Uses `AbortSignal.timeout(timeoutMs)`. Throws on a non-OK status or a timeout.

- [ ] **Step 1: Write the failing tests**

- `buildBatchCsv([{ id: '1', street: '12 Main St, Apt "B"', city: 'Missoula', state: 'MT', zip: '59801' }])` is `'"1","12 Main St, Apt ""B""","Missoula","MT","59801"\r\n'`.
- `parseBatchCsv` on this answer (out of order, one missing id `4`):
  ```
  "3","1 A St, X, MT, 59801","No_Match"
  "1","12 Main St, Missoula, MT, 59801","Match","Exact","12 MAIN ST, MISSOULA, MT, 59801","-113.994,46.872","123","L"
  "2","9 Elm, Missoula, MT, 59801","Tie"
  "5","8 Oak, Missoula, MT, 59801","Match","Non_Exact","8 OAK","garbage","1","R"
  ```
  gives `1` → match with `lat 46.872, lon -113.994`; `2` and `3` → none; no `4`, no `5`.
- `geocodeBatch` with a fake `fetchImpl` that captures the request: URL is `CENSUS_BATCH_URL`, method POST, body is `FormData` with `benchmark === 'Public_AR_Current'` and an `addressFile` blob whose text equals `buildBatchCsv(items)`; header `User-Agent` is `ham-license-finder`.
- `geocodeBatch` with a fake returning status 502 rejects.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/map/census.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the three functions in `src/map/census.js`**

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/map/census.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/map/census.js tests/map/census.test.js
git commit -m "Add Census batch geocoder client"
```

---

### Task 4: Shared geocode queue

**Files:**
- Create: `src/map/queue.js`
- Test: `tests/map/queue.test.js`

**Interfaces:**
- Consumes: `geocodeBatch` shape from Task 3 (passed in as `geocode`), `store.save` from Task 2.
- Produces: `createGeocodeQueue({ geocode: (items) => Promise<Map>, store, now = Date.now, sleep = (ms) => new Promise(r => setTimeout(r, ms)), batchSize = 1000, pauseMs = 2000, maxFailures = 4, cooldownMs = 600_000, idleMs = 60_000, maxTotal = 40_000 }) -> queue` with:
  - `want(items: Array<{ key, street, city, state, zip }>) -> { error: string|null }`. Marks every item's key as wanted now (`lastWanted = now()`). Adds keys not already queued. If in cool-down: adds nothing, returns the cool-down error. If adding the new keys would take the queue over `maxTotal`: adds nothing, returns `'The map is busy. Try again in a few minutes.'`. Starts the worker if idle.
  - `isPending(key) -> boolean`.
  - `error() -> string|null`: `'The map service is not answering. Try again later.'` while in cool-down, else null.
  - `whenIdle() -> Promise<void>` (tests only): resolves when the worker has nothing left.
- Worker rules (one batch at a time):
  - Before each batch, drop keys whose `lastWanted` is older than `idleMs`.
  - Take up to `batchSize` keys, using each key as the Census `id`. Send. Save every result with `store.save`, mapping id back to key. Keys missing from the answer are removed from the queue unsaved.
  - On a throw: split the batch in half, put both halves back at the front, `sleep(pauseMs * 2 ** failures)`, count one failure. A success resets the count. At `maxFailures` failures in a row: clear the whole queue and enter cool-down for `cooldownMs`.
  - `sleep(pauseMs)` between batches.

- [ ] **Step 1: Write the failing tests**

Use a fake `geocode` that records calls and returns a match for every id, a fake `now`, and `sleep = async () => {}`.
- **dedupe** (Review Focus 3): `want([a, b])` then `want([b, c])` before the worker runs → after `whenIdle()`, the fake saw `a`, `b`, `c` exactly once in total.
- **batches**: 2,500 items with `batchSize = 1000` → 3 calls of sizes 1000, 1000, 500, sent one after another (the fake asserts no call starts while another is open).
- **idle drop**: `want([a])`, advance `now` by 61 s before the worker takes a batch (make the first `sleep` advance time) → `a` is never sent.
- **retry split**: fake throws on the first call only → the next two calls have half the items each, and all items end up saved.
- **cool-down**: fake always throws, `maxFailures = 4` → after `whenIdle()`, `error()` is the not-answering message, `isPending` is false for all, and `want([x])` returns that error and queues nothing. Advance `now` past `cooldownMs` → `error()` is null and `want` works.
- **global cap**: `maxTotal = 3`, `want([a, b])` ok, `want([c, d])` returns the busy error and `isPending(c) === false`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/map/queue.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `createGeocodeQueue` in `src/map/queue.js`**

Keep queued keys in a `Map<key, { item, lastWanted }>` (insertion order is the send order) plus a "front" list for retried halves.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/map/queue.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/map/queue.js tests/map/queue.test.js
git commit -m "Add shared geocode queue"
```

---

### Task 5: Grid clustering

**Files:**
- Create: `src/map/cluster.js`
- Test: `tests/map/cluster.test.js`

**Interfaces:**
- Produces: `clusterPoints(points: Array<{ lat, lon, hams: object[] }>, { zoom: number, cellPx = 60, pinZoom = 16, maxItems = 2000 }) -> { clusters: Array<{ lat, lon, count }>, pins: Array<{ lat, lon, hams }> }`.
  - `count` is the number of hams (not addresses) in the cell.
  - Project with Web Mercator to world pixels at `zoom`: `x = (lon + 180) / 360 * 256 * 2 ** zoom`, `y = (1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2 * 256 * 2 ** zoom` with `φ` in radians. Cell = `floor(x / cellPx), floor(y / cellPx)`.
  - A cell with one point becomes a pin. A cell with more becomes a cluster at the mean lat/lon.
  - At `zoom >= pinZoom`, every point is a pin.
  - If the result has more than `maxItems` items, double `cellPx` and try again (only below `pinZoom`; at or above it, truncate pins to `maxItems`).

- [ ] **Step 1: Write the failing tests**

- Two points 10 m apart at zoom 10 → one cluster with `count` = total hams of both.
- The same two points at zoom 16 → two pins.
- Two points 50 km apart at zoom 10 → two pins.
- 10,000 random points in a box at zoom 4 → `clusters.length + pins.length <= 2000`, and the sum of all counts plus pin ham counts equals the total hams.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/map/cluster.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `clusterPoints` in `src/map/cluster.js`**

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/map/cluster.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/map/cluster.js tests/map/cluster.test.js
git commit -m "Add grid clustering for map points"
```

---

### Task 6: Map service, API routes, and docs

**Files:**
- Create: `src/map/service.js`
- Modify: `src/server/app.js` (routes, `parseMapView`, `createApp` options, `/api/meta` field), `src/server/index.js` (pass `MAP_CONTACT`)
- Modify: `README.md`, `CLAUDE.md`
- Test: `tests/map/service.test.js`, `tests/server/app.test.js`

**Interfaces:**
- Consumes: Tasks 1 to 5. `iterateLicenses(db, zips, filters)` from `src/search/query.js` (returns `l.*` rows).
- Produces: `createMapService({ store, queue, optOut, now = Date.now, cacheMs = 60_000, maxPerRequest = 20_000 }) -> { prepare(db, zips, filters), points(db, zips, filters, bbox, zoom) }`.
  - **Keyed rows:** for a search, read every row with `iterateLicenses`, group by `mapAddress(row).key`. Rows with a `null` address are "no street". An address where any ham's `call` is in `optOut.calls()` is "opted out" for every ham there. Cache per search in a `WeakMap<db, Map<JSON.stringify({ zips, filters }), { at, groups, noStreet }>>`, entries older than `cacheMs` rebuilt. (Keying by `db` covers Review Focus 4: a reopened handle is a new object.)
  - **`prepare` → `{ total, placed, unplaceable, pending, error }`**, all counts in hams. Look up every non-opted-out key in the store. `placed`: hams at a `match`. `unplaceable`: no street + opted out + hams at a fresh `none`. Missing = no record or `fresh: false`. If `queue.error()`: return it, queue nothing. If the missing keys not already pending exceed `maxPerRequest`: queue nothing, `error: 'This area has too many new addresses to map at once. Pick a smaller area.'`. Else `queue.want(missingItems)` and pass on its error. `pending`: hams whose key `queue.isPending`.
  - **`points` → `{ clusters, pins, inView: { count, hams } }`.** Matched, non-opted-out addresses inside `bbox` (`south <= lat <= north`, `west <= lon <= east`), passed to `clusterPoints` with `zoom`. Each ham in a pin is `{ call, first, mi, last, suffix, entity_name, op_class, city }`, nothing else. `inView.hams`: every ham in the box, sorted by `call`, first 100. `inView.count`: all hams in the box.
- Produces in `app.js`:
  - `createApp({ ..., fetchImpl = fetch, mapContact = '', mapQueueOptions = {} })`. Opens `openPointStore(join(dataDir, 'geocode.db'))`, `createOptOut(join(dataDir, 'map-optout.txt'))`, `createGeocodeQueue({ geocode: (items) => geocodeBatch(fetchImpl, items), store, ...mapQueueOptions })`. Expose `app.locals.mapStore` so tests close it.
  - `parseMapView(body) -> { bbox: { south, west, north, east }, zoom }`. 400 `'Invalid map view'` unless all four are finite numbers, `-90 <= south < north <= 90`, `-180 <= west < east <= 180`, and `zoom` is an integer 0 to 19.
  - `POST /api/map/prepare`: `parseSearch` (ignore `mailer`), then `service.prepare`.
  - `POST /api/map/points`: `parseSearch` + `parseMapView`, then `service.points`.
  - `/api/meta` gains `mapContact` (string, may be empty).
- `src/server/index.js` passes `mapContact: process.env.MAP_CONTACT ?? ''`.

- [ ] **Step 1: Write the failing service tests (`tests/map/service.test.js`)**

Build a small `licenses.db` + `geo.db` with the helpers used in `tests/server/app.test.js`, a temp store, a fake queue (`want`, `isPending`, `error` recorded), and a fake opt-out.
- Two hams at `12 Main St` and `12 Main Street` (same ZIP) + one PO-box-only ham + one ham at an unknown address. Store has a match for Main St. `prepare` → `{ total: 4, placed: 2, unplaceable: 1, pending: 1 }` with the fake queue reporting the unknown key pending; `want` was called with exactly that one item, with the cleaned street.
- Opt-out holds one of the two Main St calls → `placed: 0`, `unplaceable: 3`, and `want` never got the Main St key.
- `maxPerRequest: 1` with two missing addresses → `error` is the too-many message and `want` was not called.
- `queue.error()` returns the not-answering message → `prepare` returns it and `want` was not called.
- `points` with a box around Main St at zoom 16 → one pin, two hams, each ham object has exactly the keys listed above (no `street`, no `zip5`). A box elsewhere → empty, `inView.count === 0`.
- Review Focus 4: call `prepare` with db object A, then with a fresh `Database` object B on a file that has one more ham → B's `total` is one higher (cache did not leak across connections).

- [ ] **Step 2: Write the failing route tests (append to `tests/server/app.test.js`)**

Use `withApp` with `fetchImpl` faked to answer `Match` for every id and `mapQueueOptions: { pauseMs: 0 }`.
- `POST /api/map/prepare` with `{ zips: ['59801'] }` returns 200 with numeric `total`, `placed`, `unplaceable`, `pending`, and `error: null`.
- Poll `prepare` until `pending === 0` (max 20 tries), then `POST /api/map/points` with a US-wide box and zoom 16 returns pins.
- Review Focus 5: `/api/map/points` returns 400 `{ error: 'Invalid map view' }` for each of: no `bbox`; `bbox.south: '1'`; `south > north`; `north: 91`; `zoom: 25`; `zoom: 3.5`.
- `/api/meta` includes `mapContact` equal to the option passed.
- No route answers with a `street` field anywhere in the JSON (stringify and `doesNotMatch /"street"/`).

- [ ] **Step 3: Run to verify they fail**

Run: `node --test tests/map/service.test.js tests/server/app.test.js`
Expected: FAIL (service module missing, routes 404).

- [ ] **Step 4: Implement `src/map/service.js`, the routes, `parseMapView`, the meta field, and the `index.js` option**

Close `app.locals.mapStore` in the existing `withApp` cleanup.

- [ ] **Step 5: Run the whole suite and lint**

Run: `npm test && npm run lint`
Expected: PASS, no lint errors.

- [ ] **Step 6: Update the docs**

- `README.md`: in "What `.env` controls" and the env table under "Commands", add `MAP_CONTACT` (default empty): "Email or web address shown on the results map for hams who want to be left off it. Without it, the note is hidden." In "About the data and your privacy", add that opening the map sends the matching street addresses (public FCC data) to the US Census geocoder from the server, and that the map points are saved in `geocode.db`. Describe `map-optout.txt` (one call sign per line; hides that whole address from the map). Add the Census geocoder to "Credits". Add `src/map/` to "Project layout".
- `CLAUDE.md`: change "never calls FCC servers during a search" to say search never calls outside servers, except the results map, which calls the Census batch geocoder from the server for addresses with no saved point. Add `geocode.db` (built on demand by `src/map/`, own `GEOCODE_SCHEMA_VERSION`, outside the update lock) to Architecture, plus a **Map (`src/map/`)** paragraph.

- [ ] **Step 7: Commit**

```bash
git add src/map/service.js src/server/app.js src/server/index.js tests/map/service.test.js tests/server/app.test.js README.md CLAUDE.md
git commit -m "Add map prepare and points API"
```

---

### Task 7: Results map on the page

**Files:**
- Create: `public/js/map-format.js`, `public/js/results-map.js`
- Modify: `public/index.html` (step 3, step bar label), `public/js/step-results.js`, `public/js/api.js`, `public/js/main.js` (pass `mapContact` from `/api/meta`), `public/css/app.css`
- Test: `tests/public/map-format.test.js`, `tests/public/markup.test.js`, `tests/public/theme.test.js`

**Interfaces:**
- Consumes: the two routes and `mapContact` from Task 6. `displayName`, `CLASS_LABELS` from `public/js/format.js`.
- Produces in `api.js`: `prepareMap(body) -> Promise<{ total, placed, unplaceable, pending, error }>`, `mapPoints(body) -> Promise<{ clusters, pins, inView }>`.
- Produces in `map-format.js` (DOM-free):
  - `prepareMessage({ total, placed, unplaceable, pending, error })`: `error` wins. `pending > 0` → `'Preparing map: X of Y hams placed.'`. Done → `'X of Y hams are on the map.'`, plus `' Z could not be placed (PO box only, or the address was not found).'` when `unplaceable > 0`. Numbers with `toLocaleString('en-US')`. `total === 0` → `'No hams match.'`.
  - `inViewMessage(count, shown)`: `'Hams in this map view: N'`; when `count > shown`: `'Showing 100 of N. Zoom in to see the rest.'`.
  - `hamLine(h) -> { call, name, cls, city }` using `displayName` and `CLASS_LABELS`.
  - `lookupHref(call)` → `/lookup.html?by=call&q=${encodeURIComponent(call)}`.
  - `optOutText(contact)` → `''` for empty, else `'To be left off the map, contact ' + contact + '.'`.
- Produces in `results-map.js`: `createResultsMap({ el, statusEl, tableBody, tableCountEl, onError }) -> { show(body), hide() }`.
  - `show(body)`: creates the Leaflet map once (`keyboard: true`, OSM tiles exactly as in `map-view.js`), calls `prepareMap`, writes `prepareMessage` to `statusEl`, polls every 3000 ms while `pending > 0`, and calls `mapPoints` with the map's bounds and zoom after each poll where `placed` grew and on `moveend`. The first time, fit the map to the returned points.
  - Clusters: `L.marker` with an `L.divIcon` whose text is the count, at least 32 px, sized up by count. Click → `map.setView(latlng, zoom + 2)`.
  - Pins: `L.circleMarker` radius 8 (24 px target) with a popup built from DOM nodes and `textContent` only: one line per ham (call, name, class, city) and a "Look up" link to `lookupHref`.
  - In-view table: rows from `inView.hams` via `hamLine`, last cell a "Look up" link; count text via `inViewMessage`.
  - A token drops stale answers (same pattern as `step-results.js`). `hide()` stops polling.
- `index.html` step 3, per the spec sketch:
  - `<h2 id="step-3-title">Your results</h2>`; step bar `<span>3</span> Results`.
  - View toggle: `<button id="view-list" aria-pressed="true">List</button>` and `<button id="view-map-results" aria-pressed="false">Map</button>` in a group labelled "View".
  - `<div id="results-map-panel" hidden>` holding: `<p id="map-keys-hint" class="hint">` ("Use the arrow keys to move the map and + or − to zoom."), `<div id="results-map" tabindex="0" aria-label="Map of matching hams" aria-describedby="map-keys-hint">`, `<p id="map-status" role="status">`, the in-view table (`<caption>Hams in this map view</caption>`, columns Call, Name, Class, City, Look up) with `<p id="in-view-count" role="status">`, and `<p id="map-optout" class="hint">`.
  - The list table, result note, Back and Download CSV stay where they are and work in both views.

- [ ] **Step 1: Write the failing tests**

`tests/public/map-format.test.js`:
- `prepareMessage({ total: 353, placed: 120, unplaceable: 0, pending: 233, error: null })` → `'Preparing map: 120 of 353 hams placed.'`
- `prepareMessage({ total: 353, placed: 312, unplaceable: 41, pending: 0, error: null })` → `'312 of 353 hams are on the map. 41 could not be placed (PO box only, or the address was not found).'`
- An `error` string is returned as is, whatever the counts.
- `inViewMessage(250, 100)` → `'Showing 100 of 250. Zoom in to see the rest.'`; `inViewMessage(48, 48)` → `'Hams in this map view: 48'`.
- `lookupHref('K7AAA')` → `'/lookup.html?by=call&q=K7AAA'`.
- `optOutText('')` → `''`.

`tests/public/markup.test.js`:
- Step 3 heading text is "Your results".
- `view-list` and `view-map-results` are `<button type="button">` with `aria-pressed`.
- `map-status` and `in-view-count` each have exactly one live role.
- `results-map` has `tabindex="0"` and `aria-describedby="map-keys-hint"`.
- The in-view table has a `<caption>` and `scope="col"` headers.

`tests/public/theme.test.js`: add each new color pair used for cluster text on cluster fill (4.5:1) and pin outline on map tiles (`--line-strong`-level, 3:1 against `--surface`).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/public/`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement `map-format.js`, the `api.js` wrappers, the markup, the CSS tokens and rules, `results-map.js`, and the toggle in `step-results.js`**

`step-results.js`: the toggle shows one panel and hides the other, sets `aria-pressed`, and calls `resultsMap.show(body)` / `hide()`. A new search (`show()` in step 3) resets to List view. `main.js` reads `mapContact` from the `/api/meta` it already fetches and fills `#map-optout` with `optOutText`. Cluster and pin colors are `:root` tokens. The map focus ring uses the existing `:focus-visible` rule.

- [ ] **Step 4: Run tests and lint**

Run: `npm test && npm run lint`
Expected: PASS

- [ ] **Step 5: Try it by hand**

Run: `AUTO_UPDATE=0 MAP_CONTACT=test@example.org npm start`, open http://127.0.0.1:3100, pick Missoula County, MT, turn off "First license only", go to step 3, select **Map**. Expected: the progress line counts up, pins and circles appear, zooming splits circles, a pin popup has a working Look up link, the in-view table follows the map, Back and Download CSV still work. This calls the real Census service, which is fine for a hand check.

- [ ] **Step 6: Commit**

```bash
git add public/ tests/public/
git commit -m "Add results map to step 3"
```

---

### Task 8: Accessibility check and record

**Files:**
- Modify: `docs/accessibility.md`

- [ ] **Step 1: Run the full check from `public/CLAUDE.md`**

axe (tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice`, method in "How to repeat the audit") on step 3 in these states, at full width and 320 px: list view, map view while preparing, map view done, map error (stop the server's network or fake a Census failure), no results. Expected: 0 violations; each "needs review" item checked by hand.

- [ ] **Step 2: Keyboard pass**

Tab through step 3 in both views: toggle, map (arrow keys pan, + and − zoom, focus ring visible), in-view table links, Back, Download CSV. Nothing traps focus.

- [ ] **Step 3: Zoom and spacing**

At 320 px: no sideways page scroll. With the text spacing override: nothing cut off.

- [ ] **Step 4: Record it**

Add a "Change check: results map, <date>" entry at the top of `docs/accessibility.md` with tools, the axe table, the other checks, and what was not checked.

- [ ] **Step 5: Commit**

```bash
git add docs/accessibility.md
git commit -m "Record the results map accessibility check"
```
