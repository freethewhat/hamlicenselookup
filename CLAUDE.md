# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Ham License Finder: pick ZIP codes or counties, filter for recent first-time ham licensees, download a CSV mailing list. It keeps its own copy of the FCC license database. A search never calls outside servers, except the results map, which calls the Census batch geocoder from the server for addresses with no saved point. See README.md for setup and Docker.

## Rules

- No framework, bundler, or build step. Plain HTML, CSS, and JS modules in `public/`. ES modules everywhere.
- The page loads nothing from third-party servers except OpenStreetMap tiles. Leaflet and fonts are served from `node_modules` at `/vendor/...`. No CDNs, no Google Fonts.
- The site is for any ham club. Never put a specific club's name or call sign in the repo. `tests/repo-hygiene.test.js` enforces this.
- Every page change must stay WCAG 2.2 AA. The rules are in `public/CLAUDE.md`. Every UI or UX change needs the full check there (axe scan, keyboard pass, 320 px and text spacing, recorded in `docs/accessibility.md`) before a PR.
- `npm test` and `npm run lint` must pass before a PR.

## Commands

Node 22 or newer.

```bash
npm start                                   # http://127.0.0.1:3100, data in ./data
AUTO_UPDATE=0 npm start                     # skip the start-up data update
LOAD_STATES=MT npm start                    # load one state only (fast first load)
npm test                                    # node --test, all tests
node --test tests/search/query.test.js      # one file
node --test --test-name-pattern="toRequest" tests/public/selection.test.js   # one test
npm run lint
npm run update:weekly | update:daily | build:geo | setup
node scripts/check-schema.js                # exit 0 if both DBs match the code's schema
node scripts/sample-first-licenses.js --state MT --n 20   # spot-check the first-license rule
```

Tests use temp folders and fixtures from `tests/helpers/`. They never touch `./data`. CI runs lint, tests, and a Docker build. A push to `main` deploys (`deploy/README.md`).

## Architecture

Two SQLite files in `DATA_DIR` drive everything:

- `licenses.db`: FCC licenses plus a `history` table. Layout in `src/db/schema.js`.
- `geo.db`: states, counties, ZIPs. Built by `src/geo/build.js`. Map shapes go to `DATA_DIR/geo/` and are served at `/geo`.

A third file, `geocode.db`, holds results-map points. The web server builds it on demand through `src/map/`. It has its own `GEOCODE_SCHEMA_VERSION` (`src/map/store.js`); on a mismatch the old file is moved aside and a new one starts empty. The update jobs never open it, so it is outside the update lock.

Each file stores `meta.schema_version`. Bump `LICENSE_SCHEMA_VERSION` (`src/db/schema.js`) or `GEO_SCHEMA_VERSION` (`src/geo/build.js`) when a layout or derived-column rule changes. The next update then rebuilds that file. Until then the API returns 503.

**Updates (`src/update/run.js`).** `runAuto` builds geo if needed, loads the weekly FCC file if needed, then applies daily files. All jobs share one lock: `DATA_DIR/.update-lock.db`, an SQLite OS file lock, so there is no stale-lock cleanup. The `*Unlocked` variants assume the caller holds it. The weekly loader builds a new DB beside the live one and swaps it in with an atomic rename. Progress is written to `DATA_DIR/update-status.json` and read by `/api/status`.

**Reads (`src/db/handle.js`).** `openHandle` opens `licenses.db` read-only with `geo.db` attached as `geo`. It re-stats both files and reopens when an inode changes. Old connections close late, because a CSV export may still stream from them.

**Start-up (`src/server/index.js`).** The web server starts first. The update runs in a child process (`scripts/update.js auto`), so the site answers during a load. `/api/health` and `/api/status` work with no data. Other `/api` routes return 503 until data is ready.

**First-license rule (`src/fcc/classify.js`).** Fills `first_license_date` and `upgrade_date` at load time. `docs/verification.md` checks it against real data.

**Search (`src/search/`).** `resolve.js` turns picked ZIPs and counties into a ZIP list (max 5000). `query.js` counts and iterates matches. `csv.js` streams the export. `lookup.js` serves the Lookup page (`GET /api/lookup`, one field at a time; name search uses the `last_key` column). Request validation is `parseSearch` and `parseLookup` in `src/server/app.js`. The CSP there allows only self plus OSM tiles.

**Map (`src/map/`).** `address.js` keys each row by its cleaned street address (the mailer cleanup), so one point covers everyone at an address. `service.js` answers `POST /api/map/prepare` (counts, queues missing addresses) and `POST /api/map/points` (clusters and pins in a box, via `cluster.js`). `queue.js` is one shared queue that sends one batch at a time to Census (`census.js`, injected `fetch`) and saves answers in `store.js`. `optout.js` reads `DATA_DIR/map-optout.txt`: one call sign there hides its whole address and keeps it from Census. Answers never carry a street or ZIP. `MAP_CONTACT` sets the removal note. Spec: `docs/superpowers/specs/2026-11-25-results-map-design.md`.

## Design docs

Each feature has a spec in `docs/superpowers/specs/` and a plan in `docs/superpowers/plans/`. Read the matching spec before you change a feature. The original design is `docs/superpowers/specs/2026-11-13-ham-license-finder-design.md`.
