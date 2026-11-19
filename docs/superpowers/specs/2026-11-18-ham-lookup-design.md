# Ham lookup

**Goal:** a quick way to look up one ham, or a few, by call sign, name, street, city, county, or ZIP. It replaces a trip to the FCC license search site. The owner can remember their own domain more easily than the FCC URL.

This is a secondary feature. The main job of the site stays the same: build a mailing list of new hams. The lookup must not crowd or change that flow.

## Goals

- Type a call sign, press Enter, and see the license. This is the most common use.
- Also search by name, street, city, county, or ZIP.
- See a result's full details, plus a link to the same license on the FCC site.
- Bookmark a lookup. Back and Forward work.

## Non-goals

- No search that covers all fields in one box (full-text search). Rejected for now; see Approaches.
- No CSV export from the lookup. The mailing-list flow does exports.
- No live calls to FCC servers. The lookup reads our own copy of the data, like the rest of the site.

## Anti-goals

- The home page (the 3-step mailing-list flow) must not get busier. The only change there is one header link.
- The lookup must not turn into a bulk people-finder. Results are capped (see Results).

## Approaches

1. **One box plus a "Search by" menu, with normal indexes (picked).** The user picks a field, then types. Results are easy to predict. Indexes add a little to `licenses.db`.
2. **One smart box with SQLite full-text search (FTS5).** Faster to type, but `licenses.db` gets a few hundred MB bigger, the weekly load gets slower, and matches are less predictable. Not picked. The server already runs close to its memory limit.
3. **A lookup box inside the home page** (header search or dialog). Rejected because it crowds the main flow. A separate page keeps the two jobs apart.

## The page

A separate page: `public/lookup.html`, with its own module (for example `public/js/lookup.js`). The same header style as the home page, without the step bar.

Both pages get a small header nav with two links: **Mailing list** (`/`) and **Lookup** (`/lookup.html`). The current page's link has `aria-current="page"`. On the home page the nav sits beside the step bar and must not push it out of place at 320 px.

```
Ham License Finder                         Mailing list | Lookup
-------------------------------------------------------------------
Look up a ham
Search by: [Call sign v]   [ W1AW              ]  [Search]

12 matches
Call    Name           Class  City, State     Status    Since
W1AW    ...            -      Newington, CT   Active    1993-...
...
```

- **Search by** is a `<select>`: Call sign (default), Name, Street, City, County, ZIP.
- The input changes with the field:
  - Call sign, Name, Street, ZIP: one text box.
  - City: a text box for the city plus a state `<select>`.
  - County: a state `<select>` plus the county picker from the home page (`county-combobox.js`).
- Every control has a visible label. The hint text changes with the field (for example "Last name, or first and last name").
- The page saves the last "Search by" choice in `localStorage`, in try/catch, like `saved-selection.js`.
- The search lives in the web address: `/lookup.html?by=call&q=W1AW`, plus `state=` and `county=` where needed. Each search pushes a history entry. Loading a URL with a search runs it. Back and Forward restore the form and the results.
- The data banners from the home page (stale data, error, update in progress) show here too. Reuse `update-banner.js` and the same `/api/meta` check.

## How each field matches

All text matches ignore case. The FCC data is mixed case ("SAINT LOUIS", "Lincoln").

| Field | Input | Match |
|-------|-------|-------|
| Call sign | e.g. `w1aw` | Exact match on `call`, after trim and upper case. Every stored call is already upper case and trimmed, so a plain `call = ?` with a plain index is enough. |
| Name | `smith`, `mc carthy`, or `dennis mccarthy` | Uses `last_key` (see Database). The input gets the same cleanup. One word, or the whole text: `last_key` starts with the cleaned text. Two or more words: also try the first word as the start of `first`, plus the rest of the words, cleaned and joined, as the start of `last_key`. So "mc carthy", "McCarthy", and "dennis mc carthy" all find "MC CARTHY". Club licenses only (`applicant_type` is not `I`): also match `entity_name` starting with the full text. Individuals are matched by first and last name only, so results stay predictable. |
| Street | e.g. `nuthatch` | `street` or `po_box` contains the text. This reads the whole table. Measured on the full data: about 0.3 s. |
| City | city + state | `city = ? COLLATE NOCASE AND state = ?`. The `COLLATE NOCASE` must be in the SQL, or SQLite reads every row. |
| County | state + county | ZIPs from `resolveZips`, then `zip5` in that list. |
| ZIP | 5 digits | `zip5` equals it. |

- Minimum input: 2 characters for Name and Street, so a single letter does not read everything. Anything else invalid is a 400 with a plain message.
- Any `LIKE` escapes `%`, `_`, and `\` in the user's text and uses `ESCAPE '\'`.

## Results

- Shows every license status. Status words: A = Active, E = Expired, C = Cancelled, T = Terminated, anything else = Unknown. Status is shown as a word, never by color alone.
- Order: active first, then by last name, first name, call. SQLite sorts the matches before the 100-row cap. That is fine at this size.
- Max 100 rows. When there are more: "Showing 100 of N. Narrow your search."
- One call sign can match many rows (up to 16 in the data): the current holder plus older licenses. At most one is active. Show them all, active first. This is expected.
- Columns: Call, Name (or entity name for clubs), Class, City and State, Status, Since.
- **Name** shows "No name" when first, last, and entity name are all empty (about 6,000 rows, found only by call sign).
- **Since** is `earliest_event_date`, falling back to `grant_date`: the date this license first appears. It is not `first_license_date`, which is null for upgrades, call changes, older licenses, and clubs. When both dates are empty (about 21,500 rows), show "Unknown".
- Each row can open its details: full name, full address (street, PO box, city, state, ZIP), county, license dates (grant, expire, cancel), first license and upgrade dates, previous call, and a link to the license on the FCC site: `https://wireless2.fcc.gov/UlsApp/UlsSearch/license.jsp?licKey=<usid>`. The link opens in the same tab (normal link). It is an outbound link only; the server never calls the FCC. **Check this URL format by hand before release.** It has not been checked against the FCC site.
- Results count and "no matches" use one live region.

## API

`GET /api/lookup?by=<field>&q=<text>&state=<XX>&county=<geoid>`

- Sits behind the same `/api` rate limit and the same 503 rule as the other data routes.
- Returns `{ count, rows }`. `count` is the full match count; `rows` holds at most 100.
- Validation lives beside `parseSearch` in `src/server/app.js`. The query code lives in a new `src/search/lookup.js`.

## Database

New column on `licenses`:

- `last_key`: `last` in upper case with everything that is not A to Z or 0 to 9 removed ("MC CARTHY", "McCarthy", "O'Brien" become "MCCARTHY", "OBRIEN"). One shared JS function makes it, used by the weekly load, the daily apply, and the lookup query, so all three clean text the same way. The loaders write license rows with SQL `INSERT ... SELECT` (`src/db/load-weekly.js`), so the function is registered as an SQLite function (`db.function` in better-sqlite3) and called in that SQL. The daily apply must fill it for new and changed rows.

New indexes in `src/db/schema.js`:

- `call`: plain index. Calls are stored upper case.
- `last_key`: plain index. It is already upper case.
- `first COLLATE NOCASE`
- `city COLLATE NOCASE`
- `entity_name COLLATE NOCASE` (for club name search)

Bump `LICENSE_SCHEMA_VERSION` from 1 to 2. The next update rebuilds `licenses.db`.

Index rules, checked on the real data with `EXPLAIN QUERY PLAN`:

- A NOCASE index is used only when the comparison is NOCASE. `col = ?` on a plain column does not use it; `col = ? COLLATE NOCASE` does.
- `LIKE 'abc%'` (literal or bound parameter, with `ESCAPE`) uses a NOCASE index. A range check (`col >= ? AND col < ?`) needs `COLLATE NOCASE` on both bounds.
- The builder checks each lookup query with `EXPLAIN QUERY PLAN` in a test. Only Street may read the whole table.

## Effect on the mailing list

- Search and export queries do not change. The CSV export uses a fixed column list, so `last_key` never appears in it.
- **One-time downtime.** After this is deployed, the live `licenses.db` is still version 1. The whole `/api` (the mailing list included) returns 503 until the rebuild finishes, about as long as a full weekly load. Deploy when nobody needs the site.
- `licenses.db` gets bigger (new column and five indexes), and each weekly load takes a bit longer. The server's memory is already tight; check the first full load after deploy.
- The home page header gets one link.

## Rules this must keep

- No framework or build step. Plain HTML, CSS, ES modules.
- Nothing from third-party servers. The FCC link is a link, not a fetch.
- WCAG 2.2 AA, per `public/CLAUDE.md`. Extend `tests/public/markup.test.js` to cover `lookup.html`. Add any new color pairs to `tests/public/theme.test.js`.
- No club name or call sign in the repo. Test fixtures use made-up calls.

## Left to the builder

- How the details open: an expanding row, or a panel under the table. It must work by keyboard and keep focus sensible.
- Exact wording of hints and messages, in plain English.
- Whether to put the URL-to-form logic in a node-testable module (preferred, as `public/CLAUDE.md` asks).
