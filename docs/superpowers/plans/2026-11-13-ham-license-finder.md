# Ham License Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public web app that searches FCC amateur licenses across many ZIP codes or counties at once (by map or form), filters to first-time licensees, and exports a CSV.

**Architecture:** One Node.js (Express) service serves a no-build static front end and a JSON/CSV API. License data lives in a local SQLite file (`licenses.db`) rebuilt weekly from the FCC bulk file and patched daily; geography (ZIP→county, per-state boundary GeoJSON) lives in `geo.db` plus static files, built once from Census and GeoNames data. The app ships as one Docker image, run with Docker Compose both locally and on the Droplet. On the server, a shared Caddy container fronts all apps with HTTPS over a shared `web` network; host systemd timers run the updates inside the app container; GitHub Actions tests, builds and pushes the image to GHCR, then triggers a pull-and-restart over SSH.

**Tech Stack:** Node.js 24 LTS (`node:24-bookworm-slim` image; local non-Docker dev ≥ 22), Express 5, better-sqlite3, yauzl (unzip), mapshaper (geo build), express-rate-limit, Leaflet 1.9.4 + OpenStreetMap tiles, `node:test`, ESLint 9, yazl (test fixtures only), Docker + Docker Compose v2, GitHub Actions + GHCR, Caddy 2 (container), systemd timers, Ubuntu LTS on DigitalOcean.

**Spec:** `docs/superpowers/specs/2026-11-13-ham-license-finder-design.md`

## Global Constraints

- No user accounts, logins, or passwords.
- Never call FCC servers during a user search; searches read only our own SQLite files.
- FCC sources: `https://data.fcc.gov/download/pub/uls/complete/l_amat.zip` (weekly) and `https://data.fcc.gov/download/pub/uls/daily/l_am_{sun,mon,tue,wed,thu,fri,sat}.zip` (daily).
- County search = all ZIPs whose largest land share is in that county.
- Default filters: active licenses only; individuals only (no clubs); first-license date range default = last 12 months.
- "Data as of: <date>" always shown; warning when data is more than 10 days old.
- Parse FCC files as streams; never hold a whole `.dat` file in memory. Target box: 2 GB RAM.
- A failed weekly load must leave the previous `licenses.db` live. A deploy must never touch `DATA_DIR`.
- Docker everywhere: one image, run by Docker Compose locally and on the server. On the server the app lives in `/srv/apps/ham-finder/`, joins the shared `web` network, publishes no host ports, and is reached by Caddy as `ham-finder:3100`. Only the Caddy container publishes 80/443. The app must not assume it owns the server.
- Config by env: `PORT` (default `3100`), `HOST` (default `127.0.0.1`; `0.0.0.0` in the image), `DATA_DIR` (default `./data`; `/data` in the image), `LOAD_STATES` (comma list of state abbrs, empty = all; for quick local loads).
- Container runs as the non-root `node` user (uid 1000); the host data folder is owned by uid 1000.
- Test fixtures use made-up people only (e.g. `TESTER, ALPHA`); never commit real FCC records.
- Call sign stays a clean, uppercase column (future membership cross-check, spec §13).

## Review Focus

1. **Messy FCC lines** (CRLF endings, a record split across two lines by an embedded newline, non-ASCII bytes in names) — expected: the record is joined and parsed, names decode without crashing. Test: Task 1, `readDatLines joins split records and decodes latin1`.
2. **Odd ZIPs in EN records** (`59801-1234`, `598011234`, `5980`, empty, foreign) — expected: first 5 digits when there are ≥ 5 digits, else `zip5` is empty and the row is never matched by a ZIP search. Test: Task 1, `normalizeZip5`.
3. **CSV opened in Excel** (ZIP with leading zero, a name starting with `=`, accented names, commas/quotes in addresses) — expected: opens cleanly, UTF-8 intact, no formula runs. Test: Task 6, `csv escapes and neutralizes formulas`.
4. **Search while data is missing or mid-swap** (first boot before any load; weekly swap replacing the file) — expected: `503 {"error":"Data not loaded yet"}` before first load; after a swap, the next request sees the new data without restart. Test: Task 7, `returns 503 when no license db` and `reopens db after file swap`.
5. **PO-box ZIPs and overlaps** (user types a ZIP with no ZCTA shape; picks a county plus a ZIP already inside it) — expected: the PO-box ZIP is searched; overlapping picks are counted once. Test: Task 6, `resolveZips includes geonames-only zips and dedupes`.

---

## File Structure

```
package.json, eslint.config.js, .gitignore, README.md
src/
  fcc/fields.js        FCC field indices + code→label maps
  fcc/parse.js         line reader + per-record parsers + normalizeZip5
  fcc/classify.js      first-license / upgrade rule (pure)
  fcc/unzip.js         stream named entries out of a zip (yauzl)
  db/schema.js         licenses.db DDL + indexes
  db/load-weekly.js    full rebuild from l_amat.zip
  db/apply-daily.js    patch from l_am_*.zip
  db/handle.js         open DBs, reopen on file swap
  update/run.js        download, check, swap; weekly + daily entry points
  geo/fips.js          state FIPS ↔ abbr ↔ name table
  geo/build.js         build geo.db + per-state GeoJSON
  search/resolve.js    {zips, counties} → zip list
  search/query.js      count + rows from licenses.db
  search/csv.js        CSV columns + streaming writer
  server/app.js        Express app factory
  server/index.js      starts the server
scripts/update.js      CLI: `weekly` | `daily`
scripts/build-geo.js   CLI for geo/build.js
scripts/sample-first-licenses.js   verification helper
scripts/check-schema.js            schema check used by deploy.sh
public/index.html, public/css/app.css
public/js/main.js, api.js, selection.js, step-areas.js, map-view.js,
          form-view.js, step-filters.js, step-results.js
tests/  (mirrors src/; tests/helpers/fcc-fixture.js, tests/helpers/geo-fixture.js)
Dockerfile, .dockerignore, docker-compose.yml (local dev), .env.example
deploy/ setup-server.sh, setup-app.sh, caddy/docker-compose.yml, caddy/Caddyfile,
        ham-finder/docker-compose.yml, ham-finder/deploy.sh, ham-finder.caddy,
        ham-finder-weekly.{service,timer}, ham-finder-daily.{service,timer},
        ham-finder-setup.service, README.md
.github/workflows/ci-deploy.yml
docs/verification.md
```

Runtime data (gitignored) under `DATA_DIR`: `licenses.db`, `geo.db`, `geo/<ST>/zips.geojson`, `geo/<ST>/counties.geojson`, `tmp/`.

---

### Task 1: Project scaffold and FCC record parsing

**Files:**
- Create: `package.json`, `eslint.config.js`, `README.md`, `src/fcc/fields.js`, `src/fcc/parse.js`, `src/fcc/unzip.js`
- Modify: `.gitignore` (add `data/`)
- Test: `tests/fcc/parse.test.js`, `tests/fcc/unzip.test.js`, `tests/helpers/fcc-fixture.js`

**Interfaces:**
- Produces:
  - `readDatLines(stream: Readable, prefix: 'EN'|'HD'|'AM'|'HS'): AsyncIterable<string[]>` — decodes latin1, strips `\r`, skips blank lines, joins a line that does not start with `<prefix>|` onto the previous record, yields split fields.
  - `parseEN(f) -> {usid:number, entityName, first, mi, last, suffix, street, city, state, zip, zip5, poBox, frn, applicantType} | null` (null unless `f[5] === 'L'`)
  - `parseHD(f) -> {usid, call, status, service, grantDate, expiredDate, cancelDate, lastActionDate}` (dates ISO `YYYY-MM-DD` or `null`)
  - `parseAM(f) -> {usid, opClass, trusteeCall, prevCall, prevClass}`
  - `parseHS(f) -> {usid, date, code}`
  - `normalizeZip5(zip: string): string` (`''` if fewer than 5 digits)
  - `fccDate('09/26/2026') -> '2026-09-26'`, `'' -> null`
  - `readZipEntries(zipPath, names: string[]): Promise<Map<string, () => Promise<Readable>>>` — case-insensitive entry names (`EN.dat`, `counts`, …).
  - `fields.js`: `CLASS_LABELS = {T:'Technician', G:'General', E:'Extra', A:'Advanced', N:'Novice'}`, `STATUS_LABELS = {A:'Active', E:'Expired', C:'Canceled', T:'Terminated'}`, `CLASS_RANK = {N:1, T:2, G:3, A:4, E:5}`.
  - `tests/helpers/fcc-fixture.js`: `makeFccZip(dir, {EN?, HD?, AM?, HS?, counts?}: Record<string,string[]>) -> Promise<string>` (writes lines joined with `\r\n` via yazl, returns zip path).

Field indices (0-based, verified against `l_am_tue.zip` on 2026-11-13):

| Record | Indices |
|---|---|
| EN | 1 usid, 4 call, 5 entity type (`L`), 7 entity name, 8 first, 9 MI, 10 last, 11 suffix, 15 street, 16 city, 17 state, 18 zip, 19 PO box, 22 FRN, 23 applicant type (`I` individual, `B` club, …) |
| HD | 1 usid, 4 call, 5 status, 6 radio service (`HA`/`HV`), 7 grant, 8 expiration, 9 cancellation, 43 last action (59 fields total) |
| AM | 1 usid, 4 call, 5 class, 8 trustee call, 15 previous call, 16 previous class |
| HS | 1 usid, 3 call, 4 date, 5 code |

- [ ] **Step 1: Scaffold.** `git branch -m master main`. Create `package.json` (`"type":"module"`, `"engines":{"node":">=22"}`, scripts: `test: node --test`, `lint: eslint .`, `start: node src/server/index.js`, `update:weekly: node scripts/update.js weekly`, `update:daily: node scripts/update.js daily`, `build:geo: node --max-old-space-size=3072 scripts/build-geo.js`, `setup: npm run build:geo && npm run update:weekly`). Install deps: `express better-sqlite3 yauzl express-rate-limit leaflet@1.9.4`; dev: `eslint @eslint/js globals yazl mapshaper`. ESLint flat config: recommended rules, node globals for `src/ scripts/ tests/`, browser globals for `public/`. README: one paragraph + `npm test`, `npm start`.

- [ ] **Step 2: Write failing tests** in `tests/fcc/parse.test.js`:

```js
test('readDatLines joins split records and decodes latin1', async () => {
  const buf = Buffer.concat([
    Buffer.from('EN|1|||K7AAA|L|L1|TESTER, ALPHA|Alpha||Tester|||||1 Main St|Missoula|MT|59801|||000|0000000001|I||||||\r\n'),
    Buffer.from('EN|2|||K7BBB|L|L2|TESTER, BETA|Beta||Te'), Buffer.from('\r\n'),
    Buffer.from('ster|||||2 Oak|Hamilton|MT|59840|||000|0000000002|I||||||\r\n'),
    Buffer.from([0x45,0x4e,0x7c,0x33,0x7c,0x7c,0x7c,0x4b,0x7c,0x4c,0x7c,0x7c,0x4a,0x6f,0x73,0xe9,0x0a]), // "EN|3|||K|L||Jos\xe9\n"
  ]);
  const rows = [];
  for await (const f of readDatLines(Readable.from([buf]), 'EN')) rows.push(f);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][10], 'Tester');
  assert.equal(rows[2][7], 'José');
});
test('parseEN maps fields and skips non-licensee entities', ...)   // zip5 '59801', applicantType 'I', frn '0000000001'; f[5]='CL' -> null
test('parseHD converts dates', ...)        // grantDate '2026-09-26', cancelDate null, lastActionDate from f[43]
test('parseAM reads previous call and class', ...)  // fields from 'AM|5385194|||KJ5SJL|G|D|5||||||||KJ5SIE|T|' -> prevCall 'KJ5SIE', prevClass 'T', opClass 'G'
test('normalizeZip5', () => {
  assert.equal(normalizeZip5('59801-1234'), '59801');
  assert.equal(normalizeZip5('598011234'), '59801');
  assert.equal(normalizeZip5('01003'), '01003');
  assert.equal(normalizeZip5('5980'), '');
  assert.equal(normalizeZip5(''), '');
});
```

`tests/fcc/unzip.test.js`: `readZipEntries` on a `makeFccZip` zip returns streams for `EN.dat` and `counts`, and a missing name is absent from the map.

- [ ] **Step 3: Run** `npm test` — Expected: FAIL (modules not found).
- [ ] **Step 4: Implement** `fields.js`, `parse.js`, `unzip.js`, `tests/helpers/fcc-fixture.js`. `readDatLines`: `stream.pipe(new TextDecoder('latin1'))` equivalent via `readline` on a latin1-decoded stream.
- [ ] **Step 5: Run** `npm test && npm run lint` — Expected: PASS, no lint errors.
- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: scaffold project and FCC record parsers"`

---

### Task 2: First-license and upgrade rule

**Files:**
- Create: `src/fcc/classify.js`
- Test: `tests/fcc/classify.test.js`

**Interfaces:**
- Consumes: `CLASS_RANK` (Task 1)
- Produces: `classifyLicense({opClass, prevCall, prevClass, grantDate, history: {date, code}[]}) -> {firstLicenseDate: string|null, upgradeDate: string|null, earliestEventDate: string|null}`

The rule (write it as a doc comment at the top of `classify.js`):

```
earliestEventDate = min(history.date)
firstLicenseDate  = date of the earliest LIISS event, only if
                      prevCall === '' and prevClass === '' and
                      no history event is dated before that LIISS date;
                    else null.
upgradeDate       = if prevClass !== '' and CLASS_RANK[opClass] > CLASS_RANK[prevClass]:
                      latest LIMOD date, or grantDate if there is no LIMOD;
                    else null.
```

A later cross-license pass (Task 3) clears `firstLicenseDate` when another license with the same FRN has an earlier `earliestEventDate`.

- [ ] **Step 1: Write failing tests:**

```js
test('brand new license', () => {
  const r = classifyLicense({opClass:'T', prevCall:'', prevClass:'', grantDate:'2026-05-01',
    history:[{date:'2026-05-01',code:'SYSGRT'},{date:'2026-05-01',code:'LIISS'}]});
  assert.deepEqual(r, {firstLicenseDate:'2026-05-01', upgradeDate:null, earliestEventDate:'2026-05-01'});
});
test('renewal is not new', ...)        // history LIISS 2016-03-02, LIREN 2026-03-01 -> firstLicenseDate '2016-03-02' (old, filtered by date range later)
test('vanity change is not new', ...)  // prevCall 'KJ7XYZ', LIISS 2026-04-01, VANGRT 2026-04-01 -> firstLicenseDate null
test('upgrade T->G', ...)              // prevClass 'T', opClass 'G', LIMOD 2026-06-01 -> upgradeDate '2026-06-01', firstLicenseDate null
test('upgrade without LIMOD falls back to grantDate', ...)
test('event before LIISS blocks first license', ...)  // LIEXP 2015-01-01 then LIISS 2026-02-02 -> null
test('empty history', ...)             // all three null
```

- [ ] **Step 2: Run** `node --test tests/fcc/classify.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `classifyLicense` in `src/fcc/classify.js`. History may arrive unsorted; compare ISO strings.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat: first-license and upgrade classification"` (add new files first).

---

### Task 3: Weekly load into licenses.db

**Files:**
- Create: `src/db/schema.js`, `src/db/load-weekly.js`
- Test: `tests/db/load-weekly.test.js`

**Interfaces:**
- Consumes: Task 1 parsers, `readZipEntries`, `classifyLicense`
- Produces:
  - `SCHEMA_SQL: string`, `INDEX_SQL: string`, `LICENSE_SCHEMA_VERSION = 1` (bump on any change to licenses.db layout or derived-column rules; written to meta `schema_version`)
  - `loadWeekly(zipPath: string, outDbPath: string, opts?: {states?: string[]}): Promise<{licenseCount: number, fileDate: string}>` — when `states` is non-empty, only EN rows whose `state` is in the list are kept (licenses without an EN row are dropped by the join). Meta key `load_states` stores the list (comma-joined, `''` = all).
  - `parseCountsDate(text: string): string` — `'File Creation Date: Sun Nov  8 09:08:58 EST 2026'` → `'2026-11-08'`
  - `reclassify(db, usids?: number[]): void` — recompute classify columns for the given usids (all when omitted), then the FRN pass for affected FRNs. Exported for Task 4.

Schema (`licenses.db`, WAL mode):

```sql
CREATE TABLE licenses (
  usid INTEGER PRIMARY KEY, call TEXT NOT NULL, status TEXT, service TEXT,
  grant_date TEXT, expired_date TEXT, cancel_date TEXT, last_action_date TEXT,
  applicant_type TEXT, entity_name TEXT, first TEXT, mi TEXT, last TEXT, suffix TEXT,
  street TEXT, po_box TEXT, city TEXT, state TEXT, zip TEXT, zip5 TEXT, frn TEXT,
  op_class TEXT, prev_call TEXT, prev_class TEXT, trustee_call TEXT,
  first_license_date TEXT, upgrade_date TEXT, earliest_event_date TEXT);
CREATE TABLE history (usid INTEGER NOT NULL, date TEXT, code TEXT);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
-- INDEX_SQL (created after bulk insert):
CREATE INDEX lic_zip5 ON licenses(zip5); CREATE INDEX lic_frn ON licenses(frn);
CREATE INDEX lic_first ON licenses(first_license_date); CREATE INDEX lic_upg ON licenses(upgrade_date);
CREATE INDEX hist_usid ON history(usid);
```

Meta keys written: `schema_version` (= `LICENSE_SCHEMA_VERSION`), `data_as_of` (= fileDate), `weekly_file_date`, `daily_applied_through` (= fileDate), `license_count`.

Approach: insert EN/HD/AM into staging tables in batched transactions (10k rows), insert HS into `history`; build `licenses` with one `INSERT … SELECT` joining on usid (HD is the driver; licenses without HD are skipped); drop staging; create indexes; `reclassify(db)` walking `licenses` and `history` both ordered by usid (merge walk, no per-row queries); FRN pass:

```sql
UPDATE licenses SET first_license_date = NULL
WHERE first_license_date IS NOT NULL AND frn <> '' AND EXISTS (
  SELECT 1 FROM licenses o WHERE o.frn = licenses.frn AND o.usid <> licenses.usid
    AND o.earliest_event_date < licenses.first_license_date);
```

- [ ] **Step 1: Write failing test** building a fixture zip with 4 made-up licenses: A first license (LIISS 2026-05-01), B renewal (LIISS 2016-03-02, LIREN 2026-03-01), C upgrade (prevClass T, class G, LIMOD 2026-06-01), D club (applicant `B`, trustee `K7AAA`), plus E sharing A's FRN with LIISS 2019-01-01 and `counts` text above. Assert: `licenseCount === 5`; `fileDate === '2026-11-08'`; A `first_license_date` is `null` because of E (then a second fixture without E gives `'2026-05-01'`); C `upgrade_date === '2026-06-01'`; D `applicant_type === 'B'`; `zip5` set; meta `data_as_of === '2026-11-08'`. Plus: `loadWeekly(zip, db, {states:['MT']})` with one fixture row in `OR` keeps only the MT rows.
- [ ] **Step 2: Run** `node --test tests/db/load-weekly.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `schema.js`, `loadWeekly`, `parseCountsDate`, `reclassify`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: weekly FCC load into SQLite"` (after `git add`).

---

### Task 4: Daily patch

**Files:**
- Create: `src/db/apply-daily.js`
- Test: `tests/db/apply-daily.test.js`

**Interfaces:**
- Consumes: Task 1 parsers, `parseCountsDate`, `reclassify` (Task 3)
- Produces: `applyDaily(zipPath: string, dbPath: string): Promise<{changed: number, fileDate: string, skipped: boolean}>`

Behavior: a daily file holds the full record set for each changed usid. Respect meta `load_states`: when set, drop incoming EN rows outside those states (and delete any existing row for that usid, since the license moved out). In one transaction: for every usid seen in the daily HD/EN/AM/HS, delete its `licenses` and `history` rows, insert the new ones (same join rule as Task 3), then `reclassify(db, usids)`. Skip (return `skipped: true`, change nothing) when `fileDate <= meta.daily_applied_through`. On success set `daily_applied_through` and `data_as_of` to `fileDate`.

- [ ] **Step 1: Write failing tests:** (a) weekly fixture, then a daily fixture that changes B's address and adds new license F (LIISS on the daily date) → B's street changed, F present with `first_license_date` set, `license_count` meta updated; (b) applying the same daily file twice → second call `skipped: true`, row counts unchanged; (c) a daily file dated before `weekly_file_date` → skipped.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `applyDaily`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: apply FCC daily files"` (after `git add`).

---

### Task 5: Update runner (download, check, swap) and CLI

**Files:**
- Create: `src/update/run.js`, `scripts/update.js`
- Test: `tests/update/run.test.js`

**Interfaces:**
- Consumes: `loadWeekly`, `applyDaily`
- Produces:
  - `runWeekly({dataDir: string, url?: string, fetchImpl?: typeof fetch, minRatio?: number}) -> Promise<{licenseCount, fileDate}>` — `minRatio` default `0.95`.
  - `runDaily({dataDir: string, baseUrl?: string, fetchImpl?: typeof fetch}) -> Promise<{applied: string[]}>`
  - `DAILY_DAYS = ['sun','mon','tue','wed','thu','fri','sat']`

Weekly: download to `dataDir/tmp/l_amat.zip` (stream to disk; send `User-Agent: ham-license-finder`); `loadWeekly` into `dataDir/tmp/licenses-new.db`; if `dataDir/licenses.db` exists and new count `< minRatio × old license_count`, throw `Error('License count dropped from X to Y; keeping old data')`; else `fs.renameSync` new → `dataDir/licenses.db` (remove stale `-wal`/`-shm` of the new file first by checkpointing and closing it). Always delete `dataDir/tmp` contents in `finally`.
Daily: download all 7 daily zips to `tmp/`; read each `counts` date; apply in ascending date order via `applyDaily` (which skips old ones). A 404 for a day is skipped, other HTTP errors throw.
`runDaily` throws `Error('licenses.db schema is out of date; run the weekly load')` when meta `schema_version` ≠ `LICENSE_SCHEMA_VERSION` (test it).
`runWeekly` also accepts `states?: string[]` and passes it to `loadWeekly`; the count check is skipped when the old db's `load_states` differs from the new one.
CLI `scripts/update.js weekly|daily`: `DATA_DIR` from env (default `./data`), `LOAD_STATES` from env (split on `,`, trimmed, uppercased, empty = all), logs one line per outcome to stdout, `process.exit(1)` with the error message on stderr on failure (systemd → journald).

- [ ] **Step 1: Write failing tests** with a fake `fetchImpl` serving fixture zips: (a) first weekly creates `licenses.db`; (b) second weekly with fewer than 95% of the rows throws and the old db (old `license_count`) stays; (c) `tmp/` is empty after both success and failure; (d) `runDaily` applies two newer daily files in date order and skips one older than the weekly.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `run.js` and the CLI.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: weekly/daily update runner with safe swap"` (after `git add`).

---

### Task 6: Geography build, search, and CSV

**Files:**
- Create: `src/geo/fips.js`, `src/geo/build.js`, `scripts/build-geo.js`, `src/search/resolve.js`, `src/search/query.js`, `src/search/csv.js`
- Test: `tests/geo/build.test.js`, `tests/search/resolve.test.js`, `tests/search/query.test.js`, `tests/search/csv.test.js`, `tests/helpers/geo-fixture.js`

**Interfaces:**
- Consumes: licenses.db schema (Task 3)
- Produces:
  - `STATES: {fips:string, abbr:string, name:string}[]` (50 states + DC + PR, VI, GU, AS, MP)
  - `buildGeoDb({relPath, geonamesPath, countyNames: Map<geoid,{name,state}>, outDbPath}): {zipCount, unassigned}` — the testable table-building part.
  - `buildGeo({dataDir}): Promise<void>` — downloads sources to `dataDir/tmp`, calls `buildGeoDb`, writes GeoJSON with mapshaper.
  - `GEO_SCHEMA_VERSION = 1`, stored in geo.db table `meta(key, value)` as `schema_version`.
  - geo.db tables:
    `states(abbr TEXT PRIMARY KEY, name TEXT, fips TEXT)`,
    `counties(geoid TEXT PRIMARY KEY, name TEXT, state TEXT)`,
    `zips(zip TEXT PRIMARY KEY, state TEXT, county_geoid TEXT, has_shape INTEGER, source TEXT)` (`source` = `'zcta'` | `'geonames'`; `county_geoid` NULL = unassigned)
  - `resolveZips(geoDb, {zips?: string[], counties?: string[]}) -> {zips: string[], invalid: string[]}` — validates `/^\d{5}$/`, unions county ZIPs, dedupes, sorts. Unknown-but-well-formed ZIPs are kept (a licensee may still have them).
  - `Filters = {firstLicenseSince: string|null, includeUpgrades: boolean, includeExpired: boolean, includeClubs: boolean}`
  - `countLicenses(db, zips: string[], filters: Filters) -> number`
  - `iterateLicenses(db, zips: string[], filters: Filters, limit?: number) -> Iterable<Row>` — `db` is licenses.db with geo.db attached as `geo`; Row has all licenses columns plus `county_name` and `new_label` (`'First license'` | `'Upgrade'` | `''`). Order: `zip5, last, first, call`.
  - `CSV_COLUMNS: [header: string, toValue: (row) => string][]`, `csvLine(values: string[]): string`, `writeCsv(rows: Iterable<Row>, out: Writable): Promise<void>`

Sources (checked 2026-11-13):
- ZCTA shapes: `https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip` (field `ZCTA5CE20`)
- County shapes: `https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip` (fields `GEOID`, `NAME`, `STUSPS`)
- ZCTA→county: `https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt` (pipe-delimited, BOM, header; use `GEOID_ZCTA5_20`, `GEOID_COUNTY_20`, `AREALAND_PART`; skip rows with empty ZCTA)
- PO-box / no-shape ZIPs: GeoNames `https://download.geonames.org/export/zip/US.zip` (`US.txt`, tab-delimited: [1] ZIP, [4] state abbr, [5] county name, [6] county FIPS 3-digit). License CC-BY 4.0 — credit in the page footer.

Rules: each ZCTA → county with the largest `AREALAND_PART`; state = county GEOID's first 2 digits via `STATES`. GeoNames ZIPs not already in `zips` are added with `source='geonames'`, `has_shape=0`, `county_geoid = stateFips + countyFips3` if that geoid exists in `counties`, else NULL.
GeoJSON: per state, `DATA_DIR/geo/<ST>/zips.geojson` (properties `{zip}`) and `counties.geojson` (`{geoid, name}`), simplified with mapshaper (`-simplify 10% keep-shapes`, `precision=0.0001`); target ≤ 4 MB for the largest state's zips file — adjust the percentage until met and note the value in a code comment.

Query rules: `zip5 IN (SELECT value FROM json_each(?))`; `includeExpired=false` → `status='A'`; `includeClubs=false` → `applicant_type='I' AND COALESCE(trustee_call,'')=''`; when `firstLicenseSince` is set → `(first_license_date >= :since OR (:includeUpgrades AND upgrade_date >= :since))`; when it is null, `includeUpgrades` is ignored and `new_label` is `''`.

CSV columns, in this order: Call Sign, First Name, Middle Initial, Last Name, Suffix, Entity Name, Street Address, PO Box, City, State, ZIP, County, License Class, License Status, Grant Date, Expiration Date, Last Action Date, First License Date, New License, Previous Call Sign, Previous Class, Vanity Call, FRN. Class/status use `CLASS_LABELS`/`STATUS_LABELS`; ZIP is the full stored ZIP formatted `12345-6789` when 9 digits; Vanity Call = `service === 'HV' ? 'Yes' : 'No'`; County = `county_name`, or `Unassigned` when the ZIP has no county (spec §6). File starts with a UTF-8 BOM, lines end `\r\n`, fields quoted when they contain `,` `"` `\r` `\n`, and a cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'`.

- [ ] **Step 1: Write failing tests:**
  - `build.test.js`: tiny relationship text (ZCTA 59801 split across two counties, larger land in 30063) + tiny GeoNames text with PO-box ZIP 59806 (county FIPS 063) and 59999 (unknown county) → `zips` has 59801→30063 `zcta`, 59806→30063 `geonames`, 59999 county NULL; returns `unassigned: 1`.
  - `resolve.test.js` — `resolveZips includes geonames-only zips and dedupes`: counties `['30063']` + zips `['59801','59806','abc']` → zips contain 59801 and 59806 once each; `invalid: ['abc']`.
  - `query.test.js`: on a fixture licenses.db + geo.db, default filters exclude expired and club rows; `includeClubs` adds the club; `firstLicenseSince:'2025-11-13'` returns only A with `new_label 'First license'`; adding `includeUpgrades` adds C with `'Upgrade'`; `countLicenses` equals the row count; `county_name` filled.
  - `csv.test.js` — `csv escapes and neutralizes formulas`: header line equals the 23 headers joined by `,`; output starts with `﻿`; `'=SUM(A1)'` → `"'=SUM(A1)"`; `'1 Main St, Apt 2'` quoted; `'José'` survives a round-trip; ZIP `'598011234'` → `59801-1234`; ZIP `'01003'` stays `01003`.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** `fips.js`, `buildGeoDb`, `buildGeo` (mapshaper Node API `mapshaper.runCommands`; unzip with `readZipEntries` first), `scripts/build-geo.js`, `resolve.js`, `query.js`, `csv.js`, `tests/helpers/geo-fixture.js` (`makeGeoDb(path, {counties, zips})`).
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Run the real geo build once:** `DATA_DIR=./data npm run build:geo` — Expected: `data/geo.db` exists; `ls data/geo/MT` shows `zips.geojson counties.geojson`; `sqlite3 data/geo.db "select count(*) from zips where state='MT'"` > 300; largest `zips.geojson` ≤ 4 MB (`du -h data/geo/*/zips.geojson | sort -h | tail -1`).
- [ ] **Step 6: Commit** `git commit -m "feat: geography build, search, and CSV export"` (after `git add`).

---

### Task 7: HTTP API

**Files:**
- Create: `src/db/handle.js`, `src/server/app.js`, `src/server/index.js`, `scripts/check-schema.js`
- Test: `tests/server/app.test.js`

**Interfaces:**
- Consumes: `resolveZips`, `countLicenses`, `iterateLicenses`, `writeCsv`, `STATES`
- Produces:
  - `openHandle({licenseDbPath, geoDbPath, recheckMs = 5000}) -> {get(): Database|null, status(): 'ok'|'missing'|'outdated', close()}` — read-only; attaches geo.db as `geo`; `'missing'` when either file is absent; `'outdated'` when either `schema_version` differs from `LICENSE_SCHEMA_VERSION` / `GEO_SCHEMA_VERSION`; `get()` returns `null` unless `'ok'`; re-stats the files at most every `recheckMs` and reopens when an inode changes.
  - `checkSchemas(dataDir) -> {licenses: 'ok'|'missing'|'outdated', geo: 'ok'|'missing'|'outdated'}` (in `handle.js`), plus CLI `scripts/check-schema.js`: prints `licenses=<state> geo=<state>`, exits `0` when both are `ok`, `3` otherwise.
  - `createApp({dataDir: string, now?: () => Date}) -> express.Application`
  - Routes:
    - `GET /api/health` → `200 {ok:true}`
    - `GET /api/meta` → `{dataAsOf, licenseCount, stale}`; `stale` = `dataAsOf` more than 10 days before `now()`
    - `GET /api/states` → `[{abbr, name}]` (only states present in geo.db)
    - `GET /api/counties?state=MT` → `[{geoid, name, state, zipCount}]`
    - `GET /api/zips?state=MT` → `[{zip, countyGeoid, countyName, hasShape}]`
    - `POST /api/search` body `{zips?, counties?, filters}` → `{count, preview: Row[≤100], zipCount}`
    - `POST /api/export` same body → `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="hams-<YYYY-MM-DD>.csv"`, streamed
    - static: `/` → `public/`, `/vendor/leaflet/` → `node_modules/leaflet/dist/`, `/geo/` → `DATA_DIR/geo/` (`maxAge: '1d'`)
  - Errors: status `'missing'` → `503 {"error":"Data not loaded yet"}`; status `'outdated'` → `503 {"error":"Data is being updated. Try again soon."}` (both for every `/api/*` route except `/api/health`; the front end shows the message); invalid entries or zero ZIPs → `400 {"error": "...", "invalid": [...]}`; more than 5,000 resolved ZIPs → `400 {"error":"Too many ZIP codes (max 5000)"}`. `express-rate-limit` on `/api`: 120 requests / minute / IP; `app.set('trust proxy', 1)`; JSON body limit `1mb`.
  - `index.js`: `createApp({dataDir: process.env.DATA_DIR ?? './data'}).listen(Number(process.env.PORT ?? 3100), process.env.HOST ?? '127.0.0.1')`; on `SIGTERM` close the server and the db handle, then exit 0 (so `docker stop` is quick and clean).

- [ ] **Step 1: Write failing tests** (start the app on port 0, use `fetch`):
  - `returns 503 when no license db`: empty data dir → `/api/search` 503 with that exact error; `/api/health` 200.
  - `search and export`: fixture dbs → `/api/search` with `counties:['30063']` returns `count` and `preview` rows; `/api/export` returns CSV whose first line (after BOM) is the header and has `count + 1` lines.
  - `rejects bad input`: `zips:['12']` → 400 with `invalid:['12']`; 5,001 ZIPs → 400.
  - `returns 503 updating when schema is outdated`: fixture licenses.db with meta `schema_version` `0` → `/api/search` 503 `"Data is being updated. Try again soon."`; `checkSchemas` returns `licenses:'outdated'`; `scripts/check-schema.js` exits 3.
  - `meta stale flag`: `now` 11 days after `data_as_of` → `stale:true`; 3 days → `false`.
  - `reopens db after file swap`: rename a second fixture db (different `license_count`) over `licenses.db`, wait > 5 s (inject a shorter recheck interval via an `openHandle` option `recheckMs` to keep the test fast) → `/api/meta` shows the new count.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `handle.js`, `app.js`, `index.js`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: HTTP API for search and CSV export"` (after `git add`).

---

### Task 8: Front end — step 1 (areas: map and form)

**Files:**
- Create: `public/index.html`, `public/css/app.css`, `public/js/main.js`, `public/js/api.js`, `public/js/selection.js`, `public/js/step-areas.js`, `public/js/map-view.js`, `public/js/form-view.js`
- Test: `tests/public/selection.test.js`

**Interfaces:**
- Consumes: API routes (Task 7)
- Produces:
  - `createSelection() -> {toggle(type:'zip'|'county', id, label), remove(type, id), clear(), has(type, id): boolean, items(): {type, id, label}[], toRequest(): {zips: string[], counties: string[]}, coveredZips(countyZips: Map<string,string[]>): Set<string>, onChange(cb): () => void}`
  - `api.js`: `getMeta()`, `getStates()`, `getCounties(state)`, `getZips(state)`, `search(body)`, `exportCsv(body): Promise<Blob>`
  - Page shell: header "Ham License Finder", a three-step bar (`1 Areas`, `2 Filters`, `3 List + export`), footer with "Data as of: <date>", a stale warning banner when `stale`, and credits: FCC ULS, US Census Bureau, GeoNames (CC-BY 4.0), © OpenStreetMap contributors.

Step 1 layout (match mockup B): state picker (multi, default none; map centers on the first picked state), `Map | Form` toggle, `By ZIP | By county` toggle, the shared selected-areas list with ✕ buttons and "N ZIP codes covered", and a disabled **Next →** until something is picked.
- Map view: Leaflet with `https://tile.openstreetmap.org/{z}/{x}/{y}.png` and OSM attribution; loads `/geo/<ST>/zips.geojson` or `counties.geojson` for each picked state on demand (cache per state+mode); click toggles; selected style highlighted; hover shows the ZIP or county name.
- Form view: counties — type-to-search input over `getCounties` results for picked states, multi-pick; ZIPs — textarea accepting any mix of commas, spaces, newlines; "Add" parses and toggles each valid 5-digit ZIP and lists rejected entries.

- [ ] **Step 1: Write failing tests** for `selection.js` (it must import nothing browser-only): toggling twice removes; `toRequest` splits zips/counties; `coveredZips` unions county ZIPs with direct ZIPs and counts overlaps once; `onChange` fires on toggle/remove/clear and its return value unsubscribes.
- [ ] **Step 2: Run** `node --test tests/public/selection.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the files above. ES modules, no build step, no framework.
- [ ] **Step 4: Run** `npm test && npm run lint` — Expected: PASS.
- [ ] **Step 5: Manual check** (use the `run` skill or a browser): with real `geo.db` and a loaded `licenses.db` (`LOAD_STATES=MT npm run setup`, or a fixture), `npm start`, open `http://127.0.0.1:3100`, pick MT, click three ZIPs on the map, switch to Form and see the same three; switch to By county, pick Missoula + Ravalli, see the ZIP count update. Expected: all as described, no console errors.
- [ ] **Step 6: Commit** `git commit -m "feat: step 1 area picker with map and form"` (after `git add`).

---

### Task 9: Front end — steps 2 and 3 (filters, list, export)

**Files:**
- Create: `public/js/step-filters.js`, `public/js/step-results.js`
- Modify: `public/js/main.js`, `public/index.html`, `public/css/app.css`
- Test: `tests/public/filters.test.js`

**Interfaces:**
- Consumes: `createSelection` (Task 8), `api.search`, `api.exportCsv`
- Produces: `defaultFilters(today: Date) -> Filters` (`firstLicenseSince: null`, all booleans `false`), `filtersFromForm(form: {firstOnly, since, includeUpgrades, includeExpired, includeClubs}) -> Filters`, `defaultSince(today: Date): string` (same date 12 months earlier, ISO).

Step 2: checkbox "First license only" with a date input "since" (default `defaultSince(today)`, disabled unless checked); "Also include upgrades" (disabled unless first-only checked); "Include expired or canceled licenses"; "Include club licenses". Back / Next.
Step 3: "N hams found" (from `search`), preview table of the first 100 rows (Call, Name, Address, City, ZIP, County, Class, New License), a note when `count > 100` ("Showing 100 of N. The CSV has all of them."), **Download CSV** (`exportCsv` → object URL → `<a download="hams-YYYY-MM-DD.csv">`), and Back. Zero results shows "No hams match. Try more areas or fewer filters."

- [ ] **Step 1: Write failing tests:** `defaultSince(new Date('2026-11-13'))` → `'2025-11-13'`; `filtersFromForm({firstOnly:false, since:'2025-11-13', includeUpgrades:true, ...})` → `firstLicenseSince:null, includeUpgrades:false`; with `firstOnly:true` → since and upgrades carried.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run lint` — Expected: PASS.
- [ ] **Step 5: Manual check:** pick Missoula County → Next → defaults → Next shows a count and table; Download CSV opens in LibreOffice/Excel with 23 columns and correct names; tick First license only → count drops and New License column says "First license".
- [ ] **Step 6: Commit** `git commit -m "feat: filters, results preview, and CSV download"` (after `git add`).

---

### Task 10: Real-data verification and performance

**Files:**
- Create: `scripts/sample-first-licenses.js`, `docs/verification.md`

**Interfaces:**
- Consumes: licenses.db (Task 3), `iterateLicenses`, `writeCsv`
- Produces: `node scripts/sample-first-licenses.js --state MT --n 20` prints `call, first_license_date, grant_date, prev_call, prev_class` for a random sample of rows with `first_license_date` in the last 12 months, plus 10 rows flagged `upgrade`.

- [ ] **Step 1: Full load:** `DATA_DIR=./data npm run update:weekly`. Expected: exits 0; prints license count (expect roughly 1–2 million rows total, ~750k active). Record load time and peak memory (`/usr/bin/time -v`) — peak RSS must stay under 1.5 GB for the 2 GB Droplet; if not, reduce batch sizes in Task 3 and re-run.
- [ ] **Step 2: Confirm the weekly zip contains `HS.dat`** (`unzip -l data/tmp/l_amat.zip` during a run, or log entry names in `loadWeekly`). If it does not, stop and report: the first-license rule needs the application file and the plan must change.
- [ ] **Step 3: Spot-check the rule:** run the sample script; look up each call sign in the FCC ULS license search (`https://wireless2.fcc.gov/UlsApp/UlsSearch/searchLicense.jsp`) and confirm it is a new license (no earlier call sign/history) or an upgrade. Record matches/mismatches in `docs/verification.md`. If more than 2 of 20 first-license rows are clearly renewals, upgrades, or vanity changes, fix `classifyLicense` (add a failing test for the case first) and re-run.
- [ ] **Step 4: Daily:** `npm run update:daily`. Expected: applies the daily files newer than the weekly; `/api/meta` `dataAsOf` advances.
- [ ] **Step 5: Performance:** time `/api/search` and `/api/export` for all Texas counties and all California counties (`curl -w '%{time_total}'`). Target: each under 5 s. Record the numbers in `docs/verification.md`. If over, add the missing index or batch the `json_each` lookup and re-measure.
- [ ] **Step 6: Commit** `git add scripts/sample-first-licenses.js docs/verification.md && git commit -m "docs: real-data verification and performance numbers"`

---

### Task 11: Docker image, local Compose, server setup, and CI/CD

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`, `deploy/setup-server.sh`, `deploy/setup-app.sh`, `deploy/caddy/docker-compose.yml`, `deploy/caddy/Caddyfile`, `deploy/ham-finder/docker-compose.yml`, `deploy/ham-finder/deploy.sh`, `deploy/ham-finder.caddy`, `deploy/ham-finder-weekly.service`, `deploy/ham-finder-weekly.timer`, `deploy/ham-finder-daily.service`, `deploy/ham-finder-daily.timer`, `deploy/ham-finder-setup.service`, `deploy/README.md`, `.github/workflows/ci-deploy.yml`
- Modify: `README.md` (local quick start + link to `deploy/README.md`)

**Interfaces:**
- Consumes: npm scripts `start`, `setup`, `build:geo`, `update:weekly`, `update:daily`; env `PORT`, `HOST`, `DATA_DIR`, `LOAD_STATES`; `GET /api/health`
- Produces: image `ghcr.io/<owner>/<repo>:latest` and `:<git-sha>`; the server layout below.

**Image (`Dockerfile`):** multi-stage. Build stage `node:24-bookworm-slim` + `python3 make g++` (for better-sqlite3 if no prebuild), `npm ci --omit=dev`. Runtime stage `node:24-bookworm-slim`: copy `node_modules`, `src/`, `scripts/`, `public/`, `package*.json`; `ENV NODE_ENV=production PORT=3100 HOST=0.0.0.0 DATA_DIR=/data`; `USER node`; `EXPOSE 3100`; `HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`; `CMD ["node","src/server/index.js"]`. mapshaper is needed by `build:geo` at runtime, so move it from devDependencies to dependencies. `.dockerignore`: `.git node_modules data .superpowers docs tests .github`.

**Local (`docker-compose.yml`):** service `app`, `build: .`, `ports: ["127.0.0.1:3100:3100"]`, `volumes: ["./data:/data"]`, `env_file: .env` (optional: `required: false`), `restart: unless-stopped`. `.env.example`: `LOAD_STATES=MT`. README quick start:

```bash
cp .env.example .env
docker compose build
docker compose run --rm app npm run setup   # map data + FCC load (MT only per .env)
docker compose up                            # http://localhost:3100
```

Note in README: on Linux, create `data/` first and `chown 1000:1000 data` if your uid is not 1000.

**Server layout:**
- `/srv/apps/caddy/` — `docker-compose.yml` (image `caddy:2`, ports `80:80`, `443:443`, `443:443/udp`, volumes `./Caddyfile:/etc/caddy/Caddyfile:ro`, `./sites:/etc/caddy/sites:ro`, `caddy_data:/data`, `caddy_config:/config`, network `web` external, `restart: unless-stopped`), `Caddyfile` = `import /etc/caddy/sites/*.caddy`, `sites/`.
- `/srv/apps/ham-finder/` — `docker-compose.yml` (service `app`, `container_name: ham-finder`, `image: ghcr.io/<owner>/<repo>:${IMAGE_TAG}`, volume `./data:/data`, network `web` external, `restart: unless-stopped`, `mem_limit: 1g`, no `ports`), `.env` (`IMAGE_TAG=<sha>`, written only by `deploy.sh`), `last-good-tag`, `deploy.sh`, `data/` (owner 1000:1000).
- `/srv/apps/caddy/sites/ham-finder.caddy` = `<domain> { encode gzip; reverse_proxy ham-finder:3100 }`.

**`setup-server.sh <deploy-public-key>`** (shared, once per Droplet, idempotent, run as root): apt update/upgrade; install `ufw unattended-upgrades`; Docker Engine + Compose plugin from Docker's official apt repo; `docker network create web` if missing; 2 GB swap file; ufw allow OpenSSH, 80/tcp, 443/tcp, 443/udp, enable (note: Docker-published ports bypass ufw, which is fine because only Caddy publishes); create `/srv/apps/caddy` from `deploy/caddy/`, `docker compose up -d`; create user `deploy` (no password, no sudo, not in the `docker` group) whose `authorized_keys` line is `command="/srv/apps/bin/deploy-dispatch",no-port-forwarding,no-agent-forwarding,no-pty <key>`; `/srv/apps/bin/deploy-dispatch` (root-owned) reads `$SSH_ORIGINAL_COMMAND`, accepts only `deploy <app>` where `<app>` matches `^[a-z0-9-]+$` and `/srv/apps/<app>/deploy.sh` exists, then runs it via `sudo` (sudoers: `deploy ALL=(root) NOPASSWD: /srv/apps/*/deploy.sh`, validated with `visudo -cf`). The command format is `deploy <app> <tag>`; `<tag>` must match `^[0-9a-f]{7,40}$` and is passed to `deploy.sh` as `$1`.
**`setup-app.sh <domain> <image>`** (per app, idempotent, run as root): create `/srv/apps/ham-finder/{data}` (`chown 1000:1000 data`); write its `docker-compose.yml` with `<image>`; install `deploy.sh` (root-owned, 755); write `sites/ham-finder.caddy` with `<domain>`; `docker compose -f /srv/apps/caddy/docker-compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile`; install the four systemd units to `/etc/systemd/system/`, `systemctl daemon-reload`, `systemctl enable --now ham-finder-weekly.timer ham-finder-daily.timer`.
**`deploy.sh <tag>`** (`set -euo pipefail`, `cd /srv/apps/ham-finder`):
1. `PREV=$(cat last-good-tag 2>/dev/null || true)`; write `IMAGE_TAG=<tag>` to `.env`; `docker compose pull`; `docker compose up -d`.
2. Health check: up to 10 tries, 3 s apart, `docker compose exec -T app node -e "<same health fetch as HEALTHCHECK>"`.
3. **Fail →** if `PREV` is set, write `IMAGE_TAG=$PREV` to `.env`, `docker compose up -d`, print `Rolled back to $PREV`; exit 1 either way (the GitHub job fails).
4. **Pass →** write `<tag>` to `last-good-tag`. Schema check: `docker compose exec -T app node scripts/check-schema.js`; if it exits 3 and prints `geo=outdated` or `geo=missing`, `systemctl start --no-block ham-finder-setup.service`; else if it exits 3, `systemctl start --no-block ham-finder-weekly.service`. (On the very first deploy both are `missing`; that starts the full first load automatically.)
5. Cleanup: remove every local `ghcr.io/<owner>/<repo>` image whose tag is not `<tag>` or `$PREV` (`docker image ls --format '{{.Repository}}:{{.Tag}}'` filtered, `docker image rm`), then `docker image prune -f`.
**Timers:** `ham-finder-weekly.service` / `-daily.service`: `Type=oneshot`, `WorkingDirectory=/srv/apps/ham-finder`, `ExecStart=/usr/bin/docker compose run --rm app npm run update:weekly` (resp. `update:daily`). Timers: weekly `OnCalendar=Sun *-*-* 20:00:00 America/Denver`; daily `OnCalendar=Mon..Sat *-*-* 08:00:00 America/Denver`; both `Persistent=true`. Output lands in journald. Plus `ham-finder-setup.service` (`Type=oneshot`, same folder, `ExecStart=/usr/bin/docker compose run --rm app npm run setup`, no timer; started by `deploy.sh` or by hand). All three update services share `Conflicts=` with each other so two loads never run at once.

**`.github/workflows/ci-deploy.yml`:** on `push` (all branches) and `pull_request`. `permissions: contents: read, packages: write`.
- Job `test`: ubuntu-latest, Node 24, `npm ci`, `npm run lint`, `npm test`, then `docker/setup-buildx-action` + `docker/build-push-action` with `push: false`, `cache-to: type=gha,mode=max` so a broken image fails CI and the layers are cached.
- Job `deploy`: `needs: test`, `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`, `concurrency: {group: deploy, cancel-in-progress: false}`; `docker/login-action` to `ghcr.io` with `GITHUB_TOKEN`; `docker/build-push-action` with `push: true`, `cache-from: type=gha` (reuses the test job's layers, so this is fast), tags `ghcr.io/<repo-lowercased>:${{ github.sha }}` and `:latest` (`latest` is for humans only; the server never deploys it); write `secrets.DEPLOY_SSH_KEY` and `secrets.DEPLOY_KNOWN_HOSTS` to `~/.ssh`; `ssh deploy@${{ secrets.DEPLOY_HOST }} deploy ham-finder ${{ github.sha }}`.
- Secrets: `DEPLOY_HOST`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`.
- GHCR access from the server: make the package **public** after the first push (the code holds no secrets; my call). If the club wants it private, run `docker login ghcr.io` on the server once with a read-only (`read:packages`) token instead.

**`deploy/README.md`** — the owner's checklist, in order:
1. Create a GitHub repo and push `main`. Then turn on branch protection for `main` (Settings → Branches, or a ruleset): require a pull request, require the `test` status check to pass, block force pushes. Developers work on branches and merge by pull request.
2. Create a DigitalOcean Basic Droplet, 2 GB RAM, Ubuntu LTS, region SFO3, with your SSH key.
3. Point `hams.<club-domain>` (A record) at the Droplet's IP.
4. Make a deploy key pair locally: `ssh-keygen -t ed25519 -f ham-finder-deploy -N ''`.
5. Copy `deploy/` to the Droplet. As root: `bash setup-server.sh "$(cat ham-finder-deploy.pub)"`.
6. Add GitHub secrets: `DEPLOY_HOST` (IP), `DEPLOY_SSH_KEY` (private key), `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan <IP>`).
7. Push to `main`. The first deploy job builds and pushes the image (the SSH step fails until step 9; that is expected). In GitHub → Packages, set the image to public.
8. As root: `bash setup-app.sh hams.<club-domain> ghcr.io/<owner>/<repo>`.
9. Re-run the workflow, or `ssh deploy@<IP> deploy ham-finder <full-commit-sha>`. Expected: health check passes, and the first full data load starts on its own (the schema check finds no data).
10. Watch the first load: `journalctl -fu ham-finder-setup` (whole US; takes a while). The site shows "Data not loaded yet" until it finishes.
11. Check: open `https://hams.<club-domain>`; `systemctl list-timers 'ham-finder*'`; logs with `journalctl -u ham-finder-weekly` and `docker compose logs app`.
12. Adding another app later: new folder `/srv/apps/<app>/` with its own Compose file on the `web` network, a `deploy.sh`, and `/srv/apps/caddy/sites/<app>.caddy`; reload Caddy.

- [ ] **Step 1: Write the image and local Compose files.** Move `mapshaper` to dependencies.
- [ ] **Step 2: Verify locally:** `docker compose build` succeeds; `cp .env.example .env && docker compose run --rm app npm run setup` loads MT; `docker compose up -d` then `curl -fsS http://127.0.0.1:3100/api/health` → `{"ok":true}`; `docker compose ps` shows `healthy`; `docker compose down`. Expected: all succeed.
- [ ] **Step 3: Write the `deploy/` files and the workflow.**
- [ ] **Step 4: Validate:** `bash -n deploy/*.sh deploy/ham-finder/deploy.sh` (no output); `systemd-analyze verify deploy/*.service deploy/*.timer` (no errors besides missing-path warnings); `docker compose -f deploy/caddy/docker-compose.yml config -q` and the same for `deploy/ham-finder/docker-compose.yml` (after `docker network create web`); `docker run --rm -v $PWD/deploy/ham-finder.caddy:/c caddy:2 caddy adapt --config /c --adapter caddyfile` with a sample domain substituted. Push to a branch and confirm the `test` job passes and `deploy` is skipped.
- [ ] **Step 4b: Test the deploy script locally** against the local Docker daemon (temporarily point `deploy.sh`'s folder at a scratch copy and use locally built tags `aaaaaaa` / `bbbbbbb`): (a) deploy `aaaaaaa` → healthy, `last-good-tag` = `aaaaaaa`; (b) deploy `bbbbbbb` built with a `CMD` that exits 1 → script exits 1, prints `Rolled back to aaaaaaa`, container healthy on `aaaaaaa`; (c) after a third good deploy, only the current and previous tags remain in `docker image ls`. Record the results in the commit message.
- [ ] **Step 5: Commit** `git add Dockerfile .dockerignore docker-compose.yml .env.example deploy .github README.md package*.json && git commit -m "ci: Docker image, local compose, server setup, and GHCR deploy"`
- [ ] **Step 6: Hand off** to the owner with `deploy/README.md` steps 1–11 (they create the GitHub repo, Droplet, DNS, and secrets).
