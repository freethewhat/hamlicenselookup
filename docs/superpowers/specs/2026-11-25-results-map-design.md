# Results map

**Goal:** show the hams from a search as pins on a map, at their home address. The owner wants to find hams who live near a spot and contact them one by one. (Their own use is finding hosts for radio repeaters, but the site copy stays general: it is a map of search results, nothing more.)

## Goals

- Step 3 gets a **List | Map** toggle. The map shows the same hams as the list, with the same areas and filters.
- Zoomed out, nearby hams merge into circles with a count ("152"). Zooming in splits circles into smaller ones. Close up, each address is a pin.
- A pin sits on the house. Census points are estimated along the street from the house number, so a pin is usually within a few houses of the real spot, not on the roof.
- Click a pin to see who lives there and open them on the Lookup page.
- Addresses get map points the first time someone maps them. The points are saved, so the next map of that area is instant.
- Hams can ask to be left off the map.

## Non-goals

- No map page for the whole country. The map only shows a search result.
- No overnight geocoding of every address in the data. (A "pre-map this state" command may come later. Not in this work.)
- No paid geocoding service and no API keys.
- No user accounts or passwords.

## Anti-goals

- **No map export.** No route returns a list of addresses or map points beyond what the visible map needs. The CSV export stays exactly as it is.
- The map must not slow down or break the list, the count, or the CSV export. If Census is down, everything except new map points still works.
- The site copy must not mention any project, club, or use for the map.

## Approaches

**Where map points come from:**

1. **US Census geocoder, online batch service (picked).** Free, no key, any club can run it. Some rural addresses get no match.
2. Our own geocoder built from Census TIGER street files. No outside calls, but a lot more code, several GB of data, and fewer matches. Rejected.
3. A paid service (for example Geocodio). More matches, but about $385 for a full US run and every club needs an account. Rejected.

**When to geocode:**

1. **On demand, when someone opens the map for a search (picked).** Only areas people look at get geocoded. A normal county is one batch. No long first run.
2. Geocode every address in the background after each data update. About 718,500 unique addresses, roughly 4 to 12 hours the first time. Rejected for now: it does work nobody asked for, and it leans harder on a service with no published limits.

**Where the map lives:**

1. **A toggle in step 3, beside the list (picked).** Same search, another view. Fits the current flow.
2. A separate map page. Rejected; it only makes sense with full background geocoding.

## The page

Step 3 changes:

```
1 Areas   2 Filters   3 Results
-------------------------------------------
Your results
353 hams match.

View:  [List]  [Map]

+-------------------------------------+
|        (12)                         |
|   (48)         •                    |
|            (153)      (9)           |
|   •                                 |
+-------------------------------------+
Preparing map: 120 of 353 hams placed.
312 of 353 hams are on the map. 41 could not be placed.

Hams in this map view (48)
Call    Name         Class   City
...                                    [Look up]

To be left off the map, email <contact>.

[← Back]                     [Download CSV]
```

- The heading changes from "Your mailing list" to "Your results". The step bar label changes from "List + export" to "Results".
- **View** is a pair of toggle buttons with `aria-pressed`, the same pattern as Map/Form in step 1. List is the default. The choice is not remembered between visits.
- Map tiles are OpenStreetMap, like step 1. Leaflet is already served at `/vendor`.
- **Circles** show a count as text and get bigger with the count. Clicking a circle zooms in on it.
- **Pins** are one per address. Several hams at one address share a pin.
- **Pin popup:** for each ham at that address: call sign, name, class, city, and a link to `/lookup.html?by=call&q=<call>`. Built with `textContent`, never HTML from the data. The street address is not in the popup; the Lookup page has it.
- **Progress line** (one live region): "Preparing map: X of Y hams placed." (Counts are hams, not addresses, to match the totals.) Pins appear as batches finish. When done: "X of Y hams are on the map. Z could not be placed." with a short hint why (PO box only, or the address was not found).
- **Removal note** under the map, with the contact address from config. If no contact is set, the note is not shown.
- Download CSV and Back work the same in both views.
- **"Hams in this map view" table (owner's choice)** under the map. It lists the hams at the pins and circles inside the visible map area, up to 100, with the same columns as the pin popup plus a Lookup link. Over 100: "Showing 100 of N. Zoom in to see the rest." It refreshes when the map stops moving. Its count message is the one live region for it. This is the accessible way to answer "who lives near here?"
- The map container can take keyboard focus, and Leaflet's keyboard support is on: arrow keys pan, + and − zoom. A short visible hint says so. The focus ring shows on the map.
- The map fits the page width and works at 320 px. It does not trap the keyboard.

## How geocoding works

**Address key (builder-check call).** Each map point is saved under its address, not under a license. The key reuses the mailer cleanup in `src/search/mailer.js`: `mailingAddress()` first (it moves a PO box typed into the street field out of the street, and strips city, state, and ZIP stuck on the street line), then `standardStreet()` ("Street" and "St" match). Key: cleaned street | city | state | zip5. So the map and the mailer export agree on what counts as one address, and Census never gets a PO box.

This is how only new or changed addresses get sent: when a ham moves, their new address has no saved point, so it gets geocoded. A weekly rebuild of `licenses.db` changes nothing, because points live in another file. If the cleanup rules change later, some saved points stop matching. They are just geocoded again on demand. That is acceptable.

The key exists only in JS, so the server reads every matching row for the search and keys it in JS. A search is limited to its ZIPs, so this is small (Los Angeles County: about 17,000 rows). The server caches the keyed rows per search body for a short time (about a minute), so panning and zooming do not redo it.

**Who gets a pin.** Hams with a street after cleanup. A PO-box-only ham never gets a pin and counts as "could not be placed." Hams on the removal list never get a pin either.

**Storage: `DATA_DIR/geocode.db`.** A new SQLite file, separate from `licenses.db`, so the weekly swap never touches it.

```sql
CREATE TABLE points (
  addr_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,      -- 'match' or 'none'
  lat REAL, lon REAL,        -- null when status = 'none'
  checked_at TEXT NOT NULL   -- ISO date of the Census answer
);
CREATE INDEX points_latlon ON points(lat, lon);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);  -- schema_version
```

- Opened read-write by the web server, WAL mode, `busy_timeout` set.
- It has its own `schema_version`. If it does not match, the server moves the old file aside and starts empty. The points can always be rebuilt.
- The update job never opens it, so it needs no part in the update lock.
- `'none'` rows older than 90 days count as missing again and get retried, because Census updates its street data.

**The Census call.** `POST https://geocoding.geo.census.gov/geocoder/locations/addressbatch`, multipart form, field `addressFile` (CSV: id, street, city, state, zip), field `benchmark=Public_AR_Current`. The answer is CSV, one row per input: id, input address, `Match` / `No_Match` / `Tie`, `Exact` / `Non_Exact`, matched address, "lon,lat", and more.

- `Match` (Exact or Non_Exact): save the point.
- `No_Match` or `Tie`: save as `'none'`.
- A row missing from the answer: not saved, so it is tried again next time.
- The CSV must be built with proper quoting. Addresses have commas.
- The id column is the row's index in its batch (0, 1, 2, ...), mapped back to the address key on our side, so an id echoed or quoted oddly by Census can never look like a missing row.

**The queue.** One queue in the web server process, shared by all visitors.

- It sends **one batch at a time** to Census, never two at once, with a short pause between batches.
- Batch size: up to 1,000 addresses, so the first pins show within a minute or so. (Census accepts up to 10,000 and 5 MB.)
- Timeout per batch: a few minutes. On a timeout, an HTTP error, or an answer with no recognized rows for the batch (an outage page sent with HTTP 200, say): wait and retry, splitting the batch in half each time. Nothing is saved as `'none'` because of a failure.
- **Failures are global (builder-check call).** After a set number of failed tries in a row, the whole queue stops for a cool-down (about 10 minutes) and drops what it holds. During the cool-down, `/api/map/prepare` queues nothing and returns `error: "The map service is not answering. Try again later."` So polling never turns into a retry loop against Census.
- An address already queued is not queued twice, even if two visitors ask for it.
- Requests send a plain `User-Agent` with the app name only, like the FCC downloads.
- **Per-request cap (builder-check call):** if a search has more than 20,000 addresses with no point yet, nothing is queued. The answer has `pending: 0` and `error: "This area has too many new addresses to map at once. Pick a smaller area."` Points already saved still show. All or nothing, so reopening the map cannot creep through a whole state.
- **Global cap (builder-check call):** the queue holds at most 40,000 addresses in total. A request that would go over gets `error: "The map is busy. Try again in a few minutes."` and nothing is queued.
- **Work nobody is waiting for is dropped (builder-check call).** Each queued address remembers the last time a request that needs it called `prepare`. Addresses no request has polled for 60 seconds are dropped before their batch is sent. So closing the page or switching back to List stops the work soon.
- `pending` counts only this request's addresses that are still waiting, not other visitors' work.
- If the server restarts, the queue is lost. That is fine: the next map request finds the same missing addresses and queues them again.

## API

Both routes sit behind the existing `/api` rate limit and 503 rule, and take the same request body as `/api/search` (areas plus filters), validated by `parseSearch`. `mailer` is ignored.

**`POST /api/map/prepare`** — finds the matching hams with a street address, finds which address keys have no point (or an old `'none'`), queues them, and returns:

```json
{ "total": 353, "placed": 120, "unplaceable": 30, "pending": 203, "error": null }
```

- `total`: hams in the search. `placed`: hams whose address has a point. `unplaceable`: PO box only, removal list, or `'none'`. `pending`: waiting for Census.
- The page calls it when the map opens, then every 3 seconds while `pending > 0`, and refreshes the map each time `placed` grows. The call is cheap when nothing is new.

**`POST /api/map/points`** — body adds `bbox` (south, west, north, east) and `zoom`. Returns circles and pins inside the box only:

```json
{ "clusters": [{ "lat": 46.87, "lon": -114.0, "count": 152 }],
  "pins": [{ "lat": 46.86, "lon": -113.99, "hams": [{ "call": "...", "name": "...", "class": "...", "city": "..." }] }] }
```

- **Clustering is done on the server** in plain JS. No new library. Points in the box are grouped into a grid of cells about 60 screen pixels wide at the given zoom. A cell with one address is a pin. A cell with more is a circle at the average position.
- From zoom 16 up, every address is a pin.
- Hard limit: at most 2,000 items per answer. Grid clustering keeps it far below that.
- A pin carries only what the popup shows. No street, no ZIP, no lat/lon beyond the pin's own spot.
- The answer also has `inView: { count, hams: [...] }`: every ham at an address inside the box, sorted by call sign, at most 100. It feeds the "Hams in this map view" table.

## Removal list

- File: `DATA_DIR/map-optout.txt`, one call sign per line, `#` starts a comment. Read when it changes (check mtime on each map request).
- **One opt-out hides the whole address (owner's choice).** When any ham at an address is on the list, that address gets no pin, for anyone at it. That address is also never sent to Census. The opt-out check runs before queueing, and again when drawing.
- Removal is by call sign. The ham (and anyone at the same address) is left off the map only. They still appear in the list and the CSV, because that is the FCC's public data and the main job of the site.
- Config: env var `MAP_CONTACT` (an email address or URL). Shown in the removal note. Document it in the README and the Docker setup.

## Effect on the rest of the site

- `CLAUDE.md` and the README say the site never calls outside servers during a search. That changes: opening the map can call the Census geocoder from the server. Update both to say so, and add Census to the data credits.
- The browser still loads nothing new from other servers. The CSP does not change.
- `licenses.db` and `geo.db` do not change. No schema bump, no downtime.
- `geocode.db` grows by about 60 bytes per address. A full US worth would be under 100 MB.
- Memory: the queue holds at most 40,000 short addresses (a few MB). The keyed-rows cache holds a few searches for about a minute each.

## Rules this must keep

- No framework or build step. Plain HTML, CSS, ES modules.
- WCAG 2.2 AA and the full check in `public/CLAUDE.md`, recorded in `docs/accessibility.md`. Scan step 3 in list view, map view while preparing, map view done, an error, and no results, at full width and 320 px.
- Extend `tests/public/markup.test.js` for the new markup and `tests/public/theme.test.js` for any new color pair (circle fill and text, pin).
- No club name or call sign in the repo. Fixtures use made-up calls and addresses.
- Tests never call Census. The geocoder takes an injected `fetch`, like `download` in `src/update/run.js`.

## Left to the builder

- Exact circle sizes, colors, and pin style, within the contrast rules.
- Exact pause, timeout, and retry counts for the queue.
- Whether the address-key function lives in `src/search/` or a new `src/map/` folder (a new folder is the likely fit: `src/map/geocode.js`, `src/map/queue.js`, `src/map/cluster.js`).
- Whether the List/Map toggle state and map logic go in a new `public/js/results-map.js` (preferred) with clustering math kept server side.
- Wording of messages, in plain English.
