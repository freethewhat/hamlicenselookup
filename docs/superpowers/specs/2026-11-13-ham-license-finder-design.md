# Ham License Finder — Design

Date: 2026-11-13
Status: Approved 2026-11-13

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
- Target server: a DigitalOcean Droplet, 2 GB RAM, 50 GB disk,
  Ubuntu LTS. Parse the FCC files as a stream, not all in memory.
- **Docker everywhere (decided 2026-11-13):** the app ships as one
  Docker image. The same image runs on developers' computers and on the
  server, started with Docker Compose. Details in sections 11b and 11c.

## 11a. Data updates

**Decided:** the update schedule runs **on the same VPS** as the app,
using host systemd timers that run the update command inside the app's
container (`docker compose run --rm app npm run update:weekly` /
`update:daily`). No extra hosting.

- **Weekly (Sunday night, after the FCC posts the file):** download
  `l_amat.zip`, build a **new** database file beside the live one, run
  checks, then switch the app to the new file. Checks include: the load
  finished without errors, and the license count is not much lower than
  last week's (builder picks the threshold). If any step fails, the app
  keeps the old file. Delete scratch files after each load.
- **Daily (Monday–Saturday mornings):** download that day's
  `l_am_*.zip` and apply the changes to the live database.
- The app shows **"Data as of: <date>"**.
- Failures go to the server log (journald). The page shows a warning
  when the data is more than 10 days old.
- A way to run the weekly load by hand (for the first setup and for
  recovery).

## 11b. CI/CD and hosting

**Decided:** code on GitHub, with **automatic deploy**.

- **CI:** GitHub Actions runs lint and tests on every pull request and
  push.
- **CI:** also builds the Docker image, so a broken image fails the
  check.
- **CD:** when a change is merged to `main` and the tests pass, GitHub
  Actions builds the image, pushes it to the GitHub Container Registry
  (`ghcr.io`), then connects to the VPS over SSH and runs a deploy
  script there that pulls the new image and restarts the container.
  The SSH key and server address live in GitHub repository secrets. The
  deploy key may only run that one script (SSH forced command).
- The database is **not** part of the deploy. Data lives in a folder on
  the host mounted into the container. A deploy must not wipe or
  rebuild the data.
- First-time server setup is a written, repeatable script or checklist
  (install Docker, firewall, swap, Caddy container, app folder, systemd
  timers, HTTPS via Caddy).

**Deploy safety (decided 2026-11-13):**

1. **Rollback.** Each image is tagged with its git commit. The server
   runs a specific tag, not "latest". If the health check fails after a
   deploy, the deploy script starts the last good tag again and the
   deploy job fails.
2. **Database versions.** The license and geo databases store a schema
   version. If new code needs a different version, the app answers
   "Data is being updated, try again soon" instead of breaking, and the
   deploy starts a data rebuild in the background. Daily updates refuse
   to run on an old schema.
3. **Disk cleanup.** After a good deploy, old images of this app are
   deleted, keeping the current and the previous one (for rollback).
4. **Protected `main`.** GitHub branch protection: changes reach `main`
   only through a pull request that passes the tests.
5. **One build.** The image is built once per change; the test and
   deploy steps share a build cache.

A deploy causes about 5 seconds of downtime while the container
restarts. That is acceptable for this tool.

**Hosting provider (decided):** a **DigitalOcean** Basic Droplet with
**2 GB RAM** (about $12/month, 50 GB disk, Ubuntu LTS), in a US region
(builder picks; a West Coast region such as SFO is closest to Montana).
Resize later if needed. (SiteGround was ruled out: its normal plans are
shared hosting, and its cloud plans start near $100/month. Hetzner was
ruled out: its US servers cost more after 2026 price rises, and its
reviews are weaker.)

**Many apps on one server (decided):** the owner wants to host more apps
on this Droplet later. So:

- **Caddy** runs in its own container in front of all apps as the
  reverse proxy (it sends each web address to the right app) and gets
  HTTPS certificates automatically. It is the only container that
  publishes ports (80 and 443).
- All app containers join one shared Docker network (`web`). Caddy
  reaches each app by container name; apps publish no ports on the
  server.
- Each app has its **own folder with its own Compose file and data**
  (for example `/srv/apps/ham-finder/`), plus one Caddy site file
  (`/srv/apps/caddy/sites/<app>.caddy`). This app must not assume it
  owns the whole server.
- Each app gets its own subdomain (for example `hams.<club-domain>`).
  The club's domain and DNS are set up by the owner.
- The setup script installs Docker and the Caddy container once, and
  this app's pieces separately, so a second app can be added the same
  way: new folder, new Compose file, new Caddy site file.

## 11c. Running locally

**Decided:** developers run the app with Docker.

- `docker compose up` starts the app at `http://localhost:3100`.
- A one-time setup command builds the map data and loads the FCC data
  into a local `data/` folder.
- A `LOAD_STATES` setting (for example `LOAD_STATES=MT`) loads only
  some states, so a first local load is quick. The server leaves it
  empty and loads the whole US.
- Tests can also run without Docker (`npm test`) for speed.

## 11d. Automatic updates on start, with visible progress (decided 2026-11-13)

**Why:** a new developer should only need `docker compose up`, and a
server or container that was down for weeks should catch up by itself.
People must always see what the data update is doing.

**On every app start** (local and server), unless `AUTO_UPDATE=0`, the
app starts the update in a separate background process (the website
keeps working while it runs). It decides:

- map data missing or from an old version → build the map data;
- license data missing, from an old version, or its Sunday file older
  than 7 days → full weekly load;
- then always apply the newest daily files.

If another update holds the update lock (for example the server timer),
the start-up run exits quietly; the running one keeps reporting. The
one-time setup command does the same steps, so it now also applies the
daily files.

**Progress:** every update run (start-up, timer, or by hand) writes its
progress to a status file in the data folder: which job, which step
(downloading, importing, building indexes, finding first licenses,
switching to the new data, building map data), how far (megabytes for
downloads, share of the file for imports), when it started, and any
error. A run that stopped reporting for 2 minutes counts as
interrupted.

**On the page:** a banner with a progress bar and plain text, for
example "Updating license data: Downloading FCC file, 45% (90 of
198 MB)". It is announced to screen readers. While no data exists yet,
the page shows this progress instead of "Data not loaded yet". When an
update finishes, the banner says "Data updated to <date>" for a moment
and the page uses the new data. A failed update shows its error; the
old data stays in use.

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
- Test details, and the exact deploy and setup scripts (within section
  11b).
