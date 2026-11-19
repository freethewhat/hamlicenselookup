# Ham Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A separate `/lookup.html` page that finds hams by call sign, name, street, city, county, or ZIP, without changing the mailing-list flow.

**Architecture:** A new `last_key` column and four indexes in `licenses.db` (schema v2). A pure query module `src/search/lookup.js` behind `GET /api/lookup`. A new page with its own module; its logic lives in a DOM-free module tested under node.

**Tech Stack:** Node 22, Express 5, better-sqlite3, plain HTML/CSS/ES modules, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-18-ham-lookup-design.md`

## Global Constraints

- No framework, bundler, or build step. ES modules everywhere.
- Nothing from third-party servers. The FCC link is a plain `<a href>`, never a fetch.
- WCAG 2.2 AA per `public/CLAUDE.md`. Every control has a visible `<label for>`. One live role per live element.
- No club name or call sign in the repo. Test fixtures use made-up `K7xxx` / `TESTER` data.
- `npm test` and `npm run lint` pass after every task.
- Work on a branch, not `main` (a push to `main` deploys). Branch name: `ham-lookup`.
- Max 100 rows per lookup. Name and Street need at least 2 characters.

## Review Focus

1. Call sign typed with spaces or lower case (`"  k7aaa "`) finds the license. Test in Task 3.
2. Names with apostrophes, hyphens, or spaces (`O'Brien`, `mc carthy`, `smith-jones`) match the stored forms. Test in Task 1 (`nameKey`) and Task 2.
3. Name input that is only punctuation (`"''"`) returns 400, not a full-table read. Test in Task 3.
4. `%` and `_` typed in Street match literally. Test in Task 2.
5. A URL with an unknown `by` or missing params opens the page on Call sign with an empty box, no error. Test in Task 4.

---

### Task 1: `last_key` column, new indexes, schema v2

**Files:**
- Create: `src/db/name-key.js`
- Modify: `src/db/schema.js`, `src/db/load-weekly.js` (`licenseInsertSql`, `loadWeekly`), `src/db/apply-daily.js`
- Test: `tests/db/name-key.test.js`, `tests/db/load-weekly.test.js`, `tests/db/apply-daily.test.js`

**Interfaces:**
- Produces: `nameKey(text: string | null | undefined) -> string` in `src/db/name-key.js`. Upper case, keeps only `A-Z` and `0-9`. `null`/`undefined` give `''`.
- Produces: `registerNameKey(db: Database) -> void` in the same file. Calls `db.function('name_key', { deterministic: true }, nameKey)`.
- Produces: column `licenses.last_key TEXT`, filled by `name_key(en.last)` in `licenseInsertSql`.

- [ ] **Step 1: Write the failing tests**

`tests/db/name-key.test.js`:
```js
test('nameKey upper-cases and keeps only letters and digits', () => {
  assert.equal(nameKey('MC CARTHY'), 'MCCARTHY');
  assert.equal(nameKey('McCarthy'), 'MCCARTHY');
  assert.equal(nameKey("O'Brien"), 'OBRIEN');
  assert.equal(nameKey('Smith-Jones Jr.'), 'SMITHJONESJR');
  assert.equal(nameKey(''), '');
  assert.equal(nameKey(null), '');
});
```
In `loadWeekly builds licenses ...` add:
```js
assert.equal(a.last_key, 'TESTER');
assert.equal(get('W7DDD').last_key, 'TESTERCLUB');
for (const name of ['lic_call', 'lic_last_key', 'lic_city', 'lic_entity'])
  assert.ok(db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(name), name);
```
In `applyDaily patches a changed license ...` add: `assert.equal(g.last_key, 'TESTER');`

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test tests/db/name-key.test.js tests/db/load-weekly.test.js tests/db/apply-daily.test.js`
Expected: FAIL (module not found; `last_key` undefined).

- [ ] **Step 3: Implement**

- `src/db/name-key.js`: `nameKey`, `registerNameKey` as above.
- `schema.js`: add `last_key TEXT` at the end of the `licenses` columns. Set `LICENSE_SCHEMA_VERSION = 2`. Add to `INDEX_SQL`:
  ```sql
  CREATE INDEX lic_call ON licenses(call);
  CREATE INDEX lic_last_key ON licenses(last_key);
  CREATE INDEX lic_city ON licenses(city COLLATE NOCASE);
  CREATE INDEX lic_entity ON licenses(entity_name COLLATE NOCASE);
  ```
  Plan call, differs from spec: no `first COLLATE NOCASE` index. The two-word name query is driven by the `last_key` range, so a `first` index is never used.
- `licenseInsertSql`: add `last_key` to the column list and `name_key(en.last)` to the SELECT.
- Call `registerNameKey(db)` right after `new Database(...)` in `loadWeekly` and `applyDaily`.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS. (Fixtures that build DBs from `SCHEMA_SQL + INDEX_SQL` still work; the new column is nullable.)

- [ ] **Step 5: Commit**

```bash
git checkout -b ham-lookup
git add src/db tests/db
git commit -m "Add last_key column and lookup indexes (schema v2)"
```

---

### Task 2: Lookup query module

**Files:**
- Create: `src/search/lookup.js`
- Test: `tests/search/lookup.test.js`

**Interfaces:**
- Consumes: `nameKey` (Task 1), `resolveZips(geoDb, { counties })` from `src/search/resolve.js`.
- Produces: `escapeLike(text: string) -> string`: puts `\` before `\`, `%`, `_`.
- Produces: `lookup(db, { by, q, state, county }, limit = 100) -> { count: number, rows: object[] }`. `by` is one of `'call' | 'name' | 'street' | 'city' | 'county' | 'zip'`. Inputs are already validated (Task 3). `db` has `geo` attached. Rows are `l.*` plus `county_name` (from `geo.zips` / `geo.counties`, as in `src/search/query.js`).

- [ ] **Step 1: Write the failing tests**

Fixture: the pattern of `tests/search/query.test.js`, with `last_key` filled by `nameKey(last)` and `city`, `state`, `street`, `po_box`, `entity_name` columns. Rows (all made up):
- 1 `K7AAA` A I last `MC TESTER` first `ALPHA` city `Missoula` MT zip5 59801 street `12 Pine St`
- 2 `K7AAA` C I last `OLDTESTER` first `ZED` (older holder of the same call)
- 3 `K7BBB` A I last `McTester` first `BETA` city `MISSOULA` MT street `5 100%_Rd`
- 4 `W7CCC` A B entity `TESTER RADIO CLUB`, empty first/last, zip5 59806
- 5 `K7DDD` E I last `TESTERSON` first `DELTA` city `Missoula` MT
- 6 `K7EEE` A I last `MCTESTER` first `ECHO` entity `ZULU, ECHO` city `Helena` MT

Tests (`lookup` returns calls in order):
```js
test('call: exact, every holder, active first', ...)
  // lookup(db,{by:'call',q:'K7AAA'}).rows.map(r=>r.usid) deepEqual [1, 2]
test('name: one word and whole text match last_key prefix across spellings', ...)
  // q 'mctester' and q 'mc tester' -> calls ['K7AAA','K7BBB','K7EEE'] (active, then last, first, call)
test('name: first word + rest of words', ...)
  // q 'beta mc tester' -> ['K7BBB']
test('name: clubs match entity_name prefix, individuals do not', ...)
  // q 'tester radio' -> ['W7CCC']
  // row 6 also has entity_name 'ZULU, ECHO' (an individual): q 'zulu' -> []
test('street: contains, with % and _ literal', ...)
  // q '0%' -> ['K7BBB'] (literal %); q '1_0' -> [] (would match '100' if _ were a wildcard)
test('city: case-free equality within a state', ...)
  // {by:'city', q:'missoula', state:'MT'} -> ['K7AAA','K7BBB','K7DDD'] (K7DDD expired, sorted last)
test('county and zip', ...)
  // {by:'zip', q:'59806'} -> ['W7CCC']; {by:'county', county:'30063'} -> rows in 59801 and 59806
test('count is the full count; rows stop at the limit', ...)
  // lookup(db,{by:'city',q:'missoula',state:'MT'},2) -> count 3, rows.length 2
test('every lookup but street uses an index', ...)
  // For each by except street: run EXPLAIN QUERY PLAN on the SQL lookup builds;
  // assert no detail line equals 'SCAN l'. Export a `lookupSql(params)` for this test, returning { sql, params }.
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test tests/search/lookup.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `lookup` and `lookupSql` in `src/search/lookup.js`**

WHERE per `by` (alias `l`; every `LIKE` uses `ESCAPE '\'`):
- call: `l.call = @q` (`q` already upper case)
- name: `k = nameKey(q)`; words = `q.trim().split(/\s+/)`.
  `(l.last_key >= @k AND l.last_key < @k || '[')`
  OR, when 2+ words: `(l.first LIKE @first ESCAPE '\' AND l.last_key >= @rest AND l.last_key < @rest || '[')` with `first = escapeLike(words[0]) + '%'`, `rest = nameKey(words.slice(1).join(''))`
  OR `(l.applicant_type <> 'I' AND l.entity_name LIKE @ent ESCAPE '\')` with `ent = escapeLike(q.trim()) + '%'`.
  (`'['` is the character after `Z`, so the range is "starts with" for an A-Z/0-9 key.)
- street: `(l.street LIKE @c ESCAPE '\' OR l.po_box LIKE @c ESCAPE '\')`, `c = '%' + escapeLike(q) + '%'`
- city: `l.city = @q COLLATE NOCASE AND l.state = @state`
- zip: `l.zip5 = @q`
- county: `l.zip5 IN (SELECT value FROM json_each(@zips))`, zips from `resolveZips(db, { counties: [county] }).zips`

Order: `CASE WHEN l.status = 'A' THEN 0 ELSE 1 END, l.last, l.first, l.call`. Count with a separate `COUNT(*)` query on the same WHERE.

- [ ] **Step 4: Run it**

Run: `node --test tests/search/lookup.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/search/lookup.js tests/search/lookup.test.js
git commit -m "Add lookup query by call, name, street, city, county, ZIP"
```

---

### Task 3: `GET /api/lookup`

**Files:**
- Modify: `src/server/app.js`, `public/js/api.js`
- Test: `tests/server/app.test.js`

**Interfaces:**
- Consumes: `lookup` (Task 2).
- Produces: `parseLookup(query) -> { by, q, state, county }` (not exported; tested through the route). `GET /api/lookup` returns `{ count, rows }`.
- Produces: `lookupLicenses(params: { by, q?, state?, county? }) -> Promise<{ count, rows }>` in `public/js/api.js`, building the query string with `URLSearchParams`.

Validation (each failure is `HttpError(400, { error })` with this exact text):
- `by` not in the six fields: `Search by must be one of: call, name, street, city, county, zip`
- call: `q` trimmed, upper-cased; must match `/^[A-Z0-9]{3,10}$/`, else `Enter a call sign`
- name, street: trimmed `q` 2 to 60 characters, else `Enter at least 2 characters`. Name also needs `nameKey(q) !== ''`, else `Enter a name with letters`
- city: trimmed `q` 1 to 60 characters, else `Enter a city`; `state` upper-cased must match `/^[A-Z]{2}$/`, else `Pick a state`
- zip: `/^\d{5}$/`, else `Enter a 5-digit ZIP code`
- county: `/^\d{5}$/` and it must have ZIPs in `geo.zips`, else `Pick a county`

- [ ] **Step 1: Write the failing tests**

Extend the fixture `COLS` with `last_key`, `city`, `state`, `street` and fill `last_key` with `nameKey(last)`. Tests:
```js
test('lookup by call trims and upper-cases', ...)   // ?by=call&q=%20%20k7aaa%20 -> 200, rows[0].call 'K7AAA', count 1
test('lookup by name', ...)                          // ?by=name&q=tester -> count 3
test('lookup validation messages', ...)
  // ?by=foo -> 400 'Search by must be one of: ...'
  // ?by=name&q=a -> 400 'Enter at least 2 characters'
  // ?by=name&q='' (two apostrophes) -> 400 'Enter a name with letters'
  // ?by=city&q=Missoula -> 400 'Pick a state'
  // ?by=zip&q=5980 -> 400 'Enter a 5-digit ZIP code'
  // ?by=county&county=99999 -> 400 'Pick a county'
test('lookup returns 503 while data is missing', ...) // same pattern as the existing /api/search 503 test
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test --test-name-pattern="lookup" tests/server/app.test.js`
Expected: FAIL (404).

- [ ] **Step 3: Implement `parseLookup` and the route in `src/server/app.js`, and `lookupLicenses` in `api.js`**

The route sits after `/api/zips`, inside the existing `/api` middleware (rate limit and 503 rule apply).

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/app.js public/js/api.js tests/server/app.test.js
git commit -m "Add GET /api/lookup with input checks"
```

---

### Task 4: DOM-free lookup page logic

**Files:**
- Create: `public/js/lookup-format.js`
- Test: `tests/public/lookup-format.test.js`

**Interfaces:**
- Consumes: `displayName`, `CLASS_LABELS` from `public/js/format.js`.
- Produces (all exported from `lookup-format.js`):
  - `BY_FIELDS`: `[['call','Call sign'],['name','Name'],['street','Street'],['city','City'],['county','County'],['zip','ZIP code']]`
  - `statusWord(code: string) -> string`: A Active, E Expired, C Cancelled, T Terminated, anything else Unknown.
  - `lookupName(r) -> string`: `displayName(r)` or `'No name'` when that is empty.
  - `sinceDate(r) -> string`: `earliest_event_date ?? grant_date`, or `'Unknown'` when both are empty.
  - `lookupCells(r) -> string[6]`: Call, `lookupName`, Class label, `"City, ST"` (just the parts that exist), `statusWord`, `sinceDate`.
  - `fccLicenseUrl(usid: number) -> string`: `https://wireless2.fcc.gov/UlsApp/UlsSearch/license.jsp?licKey=${usid}`
  - `lookupCountMessage(count: number, shown: number) -> string`: `'No matches.'`, `'1 match.'`, `'12 matches.'`, or `'Showing 100 of 1,234. Narrow your search.'`
  - `paramsFromSearch(search: string) -> { by, q, state, county }`: reads a `location.search` string. Unknown or missing `by` gives `'call'`. Missing values give `''`.
  - `searchFromParams(p) -> string`: `?by=...&q=...` plus `state`/`county` only when not empty. Round-trips with `paramsFromSearch`.
  - `hasQuery(p) -> boolean`: true when the params are complete enough to run (`q` for call/name/street/zip; `q` and `state` for city; `county` for county).
  - `BY_STORAGE_KEY = 'hamfinder.lookupBy.v1'`

- [ ] **Step 1: Write the failing tests**

One `test(...)` per export, using the values above. Include:
```js
assert.deepEqual(paramsFromSearch('?by=nope&q=x'), { by: 'call', q: 'x', state: '', county: '' });
assert.deepEqual(paramsFromSearch(''), { by: 'call', q: '', state: '', county: '' });
const p = { by: 'city', q: 'Saint Louis', state: 'MO', county: '' };
assert.deepEqual(paramsFromSearch(searchFromParams(p)), p);
assert.equal(lookupName({ first: '', last: '', entity_name: '' }), 'No name');
assert.equal(sinceDate({ earliest_event_date: null, grant_date: '' }), 'Unknown');
assert.equal(lookupCountMessage(1234, 100), 'Showing 100 of 1,234. Narrow your search.');
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test tests/public/lookup-format.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `public/js/lookup-format.js`**

- [ ] **Step 4: Run it**

Run: `node --test tests/public/lookup-format.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/js/lookup-format.js tests/public/lookup-format.test.js
git commit -m "Add lookup page helpers: status words, URL state, messages"
```

---

### Task 5: The lookup page and header nav

**Files:**
- Create: `public/lookup.html`, `public/js/lookup.js`
- Modify: `public/index.html` (header nav), `public/css/app.css`
- Test: `tests/public/markup.test.js`, `tests/public/theme.test.js` (only if a new color pair is added)

**Interfaces:**
- Consumes: Task 3 `lookupLicenses`, `getStates`, `getCounties`, `getMeta` (`api.js`); Task 4 exports; `initUpdateBanner` (`update-banner.js`); `createCountyCombobox` (`county-combobox.js`); `dataLoadingNotice` (`status-format.js`).

Markup on `lookup.html` (ids are fixed so the tests can check them):
- Same `<head>` shape, skip link, `<main id="main" tabindex="-1">`, `banner-stale`, `banner-error` (`role="alert"`), and footer as `index.html`. No Leaflet CSS.
- Header: brand plus `<nav aria-label="Site">` with links `Mailing list` (`/`) and `Lookup` (`/lookup.html`, `aria-current="page"`). The same nav goes in `index.html`, with `aria-current="page"` on `Mailing list`, placed after `.brand` and before the step bar.
- `<section aria-labelledby="lookup-title">` with `<h2 id="lookup-title" tabindex="-1">Look up a ham</h2>`.
- `<form id="lookup-form">`: `<select id="lookup-by">` (from `BY_FIELDS`), `<input id="lookup-q">` with hint `<p id="lookup-hint">` (`aria-describedby`; text changes per field), `<select id="lookup-state">` (city and county only), the county combobox (`lookup-county`, `lookup-county-listbox`, `lookup-county-count` with `role="status"`, same pattern as `county-search` on `index.html`), and a `Search` submit button. Fields not used by the current `by` are `hidden`.
- `<p id="lookup-count" role="status">` for `lookupCountMessage` and "no matches".
- Results table with `<caption id="lookup-caption">`, six `<th scope="col">` (Call, Name, Class, City, Status, Since), inside `.table-wrap` with `tabindex="0"`, `role="region"`, `aria-labelledby="lookup-caption"`.
- Details: each Call cell is a `<button aria-expanded>` that shows a details row under it (full name, address, county, grant/expire/cancel dates, first license and upgrade dates, previous call, FCC link). Focus stays on the button.

Behavior (`lookup.js`):
- On load: read `paramsFromSearch(location.search)`. With no `by` in the URL, use the saved `BY_STORAGE_KEY` (try/catch). Fill the form. If `hasQuery`, run the search.
- On submit: `history.pushState(null, '', searchFromParams(p))`, save `by`, run the search. On `popstate`: fill the form from the URL and run it again (or clear results when `!hasQuery`).
- Server 400 text goes in `banner-error`. 503 uses `dataLoadingNotice` the way `main.js` does.
- Stale banner: `getMeta().stale`, same as `main.js` `loadMeta`.

- [ ] **Step 1: Write the failing markup tests**

In `tests/public/markup.test.js`, read `public/lookup.html` too and add:
```js
test('lookup page: skip link, main, labelled h2', ...)       // same checks as index.html
test('lookup page: every control has a label and hints are tied', ...)  // lookup-q -> lookup-hint
test('lookup page: live elements have one live role', ...)   // banner-error, lookup-count, lookup-county-count
test('lookup page: table has caption, 6 column scopes, labelled scroll box', ...)
test('both pages have the site nav with aria-current on their own link', ...)
test('lookup page loads nothing from other hosts', ...)      // no src/href starting with http except the footer GitHub links
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test tests/public/markup.test.js`
Expected: FAIL (file not found).

- [ ] **Step 3: Build `lookup.html`, `lookup.js`, the nav, and the CSS**

Use only existing color tokens. The nav must not push the step bar out of line at 320 px.

- [ ] **Step 4: Run tests and lint**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 5: Check it in a browser**

Run: `AUTO_UPDATE=0 DATA_DIR=<folder with a v2 licenses.db> npm start`. Build that DB first with `LOAD_STATES=MT npm run update:weekly`. Check at 320 px and full width: call sign lookup by Enter, each `by` field, Back/Forward, details by keyboard, no sideways scroll, the home page step bar unchanged. Stop the server after.

- [ ] **Step 6: Commit**

```bash
git add public tests/public
git commit -m "Add lookup page and site nav"
```

---

### Task 6: Docs and final check

**Files:**
- Modify: `docs/accessibility.md` (new "Change check: lookup page, 2026-11-18" entry, same table format as the others), `README.md` (one short section on `/lookup.html`), `CLAUDE.md` (one line under Search: `lookup.js` and `/api/lookup`)

- [ ] **Step 1: Write the docs**

- [ ] **Step 2: Run everything**

Run: `npm test && npm run lint && node scripts/check-schema.js`
Expected: tests and lint PASS. `check-schema` exits non-zero against an old v1 `./data` (expected until the rebuild).

- [ ] **Step 3: Commit**

```bash
git add docs README.md CLAUDE.md
git commit -m "Document the lookup page"
```

- [ ] **Step 4: Hand-check before release (owner)**

Open one result's FCC link and check it shows the right license. Deploy at a quiet time: the whole `/api` returns 503 until the v2 rebuild finishes.
