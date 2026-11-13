# Ham License Finder — Design

Date: 2026-11-13
Status: Draft for review

## 1. Why this exists

A Missoula-area amateur radio club passed a motion (2026-11-12) to mail
postcards to licensed hams in its area. The cards do two jobs:

1. Tell current hams the club exists, or remind members that renewal is
   coming up (sent near the end of the club's fiscal year).
2. Help the membership committee reach **newly licensed** hams and invite
   them to join.

The club has never done this before. The cards are personalized by hand,
so the tool only needs to produce a good list. A CSV export is enough.

No existing tool does what the club needs. The ARRL FCC search
(arrl.org/fcc/search) searches one ZIP, city, or state at a time, with no
county search, no multi-area search, no "new license" filter, and no CSV
export. Other public tools (DXZone ZIP lookup, RadioQTH, N4MC's locator)
are single-ZIP lookups.

The first users are this club (Missoula County, Flathead Valley,
Bitterroot Valley). Other clubs anywhere in the US should be able to use
it too.

## 2. Goals

- Search for licensed hams across **many ZIP codes or many counties at
  once**.
- Two ways to pick the same areas: a **map** (click shapes) and a **plain
  form** (type or pick from lists). Some people prefer one, some the other.
- On the map, the user picks "by ZIP" or "by county", and the map shows
  those boundaries.
- Filter to **first-time licensees** in a chosen date range.
- Export the results as a **CSV**.
- Work for any US area. Typical search: several counties in one state.
  Sometimes two neighboring states. Rarely more.
- Fast and stable for a full-state search.

## 3. Non-goals

- User accounts, logins, or passwords.
- Mailing labels, mail merge, or printing postcards.
- Email or phone contact (the FCC does not publish these).
- Exact address-in-county matching (see section 6).

## 4. Anti-goals (would make it a failure even if it works)

- Calling FCC servers once per user search. This invites rate limits and
  breaks under load. All searches run against our own copy of the data.
- Making the user search one ZIP at a time.

## 5. Data source

**Decided:** the FCC Universal Licensing System (ULS) public bulk files.
There is no FCC search API for area searches.

- Full weekly file: `https://data.fcc.gov/download/pub/uls/complete/l_amat.zip`
  (about 198 MB zipped, checked 2026-11-13; posted Sundays).
- Daily change files: `https://data.fcc.gov/download/pub/uls/daily/l_am_{sun,mon,tue,wed,thu,fri,sat}.zip`
  (about 30 KB each).
- Format: pipe-delimited `.dat` files, one record type per file. Each
  record is keyed by a unique system identifier (field 2). The FCC
  publishes the field definitions ("ULS public access file
  definitions"); use them.

Record types we use (confirmed present in the daily file):

| File | Holds |
|------|-------|
| `EN.dat` | Name (first, MI, last, suffix), entity name, street / PO box, city, state, ZIP, FRN, entity type |
| `HD.dat` | Call sign, license status (A/E/C…), radio service (HA, HV = vanity), grant / expiration / cancellation / last-action dates |
| `AM.dat` | Operator class (T, G, E, A, N), trustee call sign (clubs), **previous call sign**, **previous operator class** |
| `HS.dat` | Dated history events per license. Codes seen: `LIISS` (issued), `LIREN` (renewed), `LIMOD` (modified), `VANGRT` (vanity granted), `LIEXP` (expired), `LICAN` (canceled), `SYSGRT`, `LIAUA`, `LITIN`, and others |

**Update process:** load the full file weekly after it posts, and apply
daily files in between. A failed download must leave the previous good
copy in place. Show the "data as of" date in the app.

**My call:** the weekly + daily schedule. Weekly only would also be
acceptable if daily files prove fiddly; the builder may drop daily
updates if they cause trouble, and should say so.

## 6. Geography

**Decided:** a county search means "all ZIP codes that are mostly inside
that county". Some people near a county line will be included or left
out by mistake. The club accepted this.

- ZIP boundaries: US Census TIGER/Line ZCTA shapes (ZIP Code Tabulation
  Areas — the Census's map version of ZIP codes).
- County boundaries: US Census TIGER/Line county shapes.
- ZIP-to-county: Census ZCTA-to-county relationship file. Assign each
  ZIP to the county holding the largest share of its land area.
- The licensee's ZIP comes from `EN.dat` (first 5 digits; ZIP+4 is
  common).
- Shapes are served from our own server, simplified enough to load
  quickly for a full state at a time.

**Known gap:** PO-box-only and some rural ZIPs have no ZCTA shape. Those
licensees must still show up when the user types the ZIP in the form.
For county searches, the builder should find a free ZIP-to-county source
that covers these ZIPs (for example, a public USPS/Census-derived
crosswalk) and record the choice. If no free source covers them, list
them as "unassigned" rather than drop them silently.

## 7. "First license" filter

**Decided:** the **"First license only"** checkbox (step 2 of the UI)
shows people whose **first ever ham license** was granted inside a date range the user picks (default: last 12
months). It must exclude renewals, upgrades, and vanity call sign
changes.

**Left to the builder:** the exact rule. Signals available: `LIISS`
history events and their dates, the `AM.dat` previous-call-sign and
previous-class fields (empty for a first license), and the FRN. Verify
the rule against real data — for example, spot-check a sample of
results against the FCC's ULS license search — and write the rule down
in the code.

**Mix-ups are OK (decided):** the FCC file keeps old expired licenses
for only a limited time, so a returning ham with a lapsed old license
can look like a first-timer. The club accepts these false positives (an
extra postcard costs little). Do not load extra historical data or build
person matching to catch them. Use only the weekly and daily files.

**Extra option (decided):** a checkbox to also include **upgrades** in
the same date range (for example, Technician to General). Each row is
labeled "first license" or "upgrade".

## 8. Default filters

- **Expired / canceled licenses:** excluded by default. Checkbox to
  include.
- **Club licenses** (entity type = club, or has a trustee): excluded by
  default. Checkbox to include.

## 9. User interface

**Decided:** three steps, one thing at a time (option B from the mockups):

1. **Areas.** Toggle between **Map** and **Form**. Toggle between
   **by ZIP** and **by county**.
   - Map: a real street map (Leaflet with OpenStreetMap tiles — my call)
     with ZIP or county boundaries drawn on top. Click a shape to add or
     remove it. Selected shapes are highlighted.
   - Form: pick one or more states; type-to-search counties (multi-pick);
     type or paste a list of ZIP codes.
   - Map and form share one selection. A list of chosen areas with
     remove buttons is always shown, plus a count of ZIPs covered.
2. **Filters.** First license only (with date range), include upgrades,
   include expired, include clubs.
3. **List and export.** Result count, a preview table, and a
   **Download CSV** button.

Mockups: `.superpowers/brainstorm/915526-1794587304/content/layout.html`.

**Builder's call:** visual style, exact controls, and how the map handles
loading many shapes (for example, load shapes per state when the user
picks a state).

## 10. CSV export

**Decided:** include all useful fields. The club said "the more
information the better".

- Call sign
- First name, middle initial, last name, suffix
- Entity name (for clubs)
- Street address / PO box, city, state, ZIP
- County (from ZIP)
- License class
- License status
- Grant date, expiration date, last action date
- First license date (when known)
- New-license label (first license / upgrade / blank)
- Previous call sign, previous class
- Vanity call (yes/no)
- FRN

Builder's call: column order and header names. The file must open
cleanly in Excel and Google Sheets.

## 11. Hosting and stack

**Decided by the club:** a Node.js app on a small VPS. No logins.

**My calls (builder may change with reason):**
- A single Node.js service serving the API and the web page.
- A local SQLite database for the license data. About 1–2 million
  records is well within SQLite's range. Index ZIP, state, status, and
  dates.
- A scheduled job (cron or in-process) for the weekly and daily loads.
- Target server: a small Linux VPS (assume 1 GB RAM, 25 GB disk,
  Ubuntu LTS), run as a systemd service. Parse the FCC files as a
  stream, not all in memory. Build the new weekly database as a new
  file and swap it in when done, so the old copy stays live until then.
  Delete scratch files after each load. No specific server exists yet.

## 12. Load and limits

- Searches hit our own database only. No FCC rate limits apply at
  search time.
- One weekly download of about 200 MB, plus tiny daily files.
- Target: a full-state search and CSV export of a large state finish in
  a few seconds. The builder should measure with a large state (for
  example, California or Texas) and record the numbers.
- No hard cap on areas per search. The builder may add a cap on result
  size or basic request limits if needed to protect the server, and
  should say why.
- OpenStreetMap's public tiles are fine for club-size use. If traffic
  grows, switch to a hosted tile provider (most have a free tier).

## 13. Future feature (may or may not be needed)

**Membership cross-check.** The club has no public member list today.
Several members are software developers who may build this later. Idea:
keep a list of current members (call signs), and remove them from
"new ham" invite lists. Do not build now. Keep call sign as a clean key
so a later filter can be added easily.

## 14. Left to the builder

- Exact first-license rule (section 7), verified against real data.
- Free source for ZIPs with no ZCTA shape (section 6).
- Shape simplification and map loading strategy.
- Visual design.
- CSV column order and names.
- Tests and deployment scripts.
