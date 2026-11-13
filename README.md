# Ham License Finder

Find licensed amateur radio operators in an area and export them as a mailing list.

Pick many ZIP codes or counties at once, on a map or in a form. Filter to people who got their first license recently. Download the result as a CSV file with call sign, name, and mailing address. A ham radio club can use the list to send postcards to local hams and to invite new ones.

The app keeps its own copy of the public FCC license database and updates it every day. Searches never call FCC servers.

## Quick start (Docker)

You need [Docker](https://docs.docker.com/get-docker/) with Docker Compose v2.

```bash
git clone https://github.com/freethewhat/hamlicenselookup.git
cd hamlicenselookup
cp .env.example .env
mkdir -p data
docker compose up
```

Open http://localhost:3100.

On the first start, the app downloads about 280 MB (Census map files and the FCC license file) and builds its data. This takes a few minutes. A progress bar at the top of the page shows each step. You can use the page when the bar finishes.

On Linux, the container runs as user id 1000. If your user id is not 1000 (check with `id -u`), run `sudo chown 1000:1000 data` once.

### What `.env` controls

| Setting | Default in `.env.example` | What it does |
|---|---|---|
| `LOAD_STATES` | `MT` | Load only these states (comma list, for example `MT,ID`). Empty means the whole US. A small list makes the first load fast. |
| `AUTO_UPDATE` | `1` | Check and update the data each time the app starts. Set to `0` to turn it off. |

`LOAD_STATES` is used only when the weekly FCC file loads. After you change it, reload the data:

```bash
docker compose run --rm app npm run update:weekly
```

## How the data stays current

Each time the app starts (unless `AUTO_UPDATE=0`), it checks its data in the background:

- No map data, or map data from an old version: build the map data.
- No license data, data from an old version, or a weekly file older than 7 days: load the newest weekly FCC file.
- Then apply the newest daily FCC files.

Everything lives in the `data/` folder. To start over, stop the app, delete `data/`, and start it again.

On the server, timers also run the updates every day. See [deploy/README.md](deploy/README.md).

## Run without Docker

You need Node.js 22 or newer.

```bash
npm ci
npm start             # http://127.0.0.1:3100, data in ./data
```

`npm start` runs the same start-up update. Set `LOAD_STATES` and `AUTO_UPDATE` as environment variables, for example `LOAD_STATES=MT npm start`.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Start the web server, and the start-up update. |
| `npm test` | Run all tests. They use temporary folders and never touch `./data`. |
| `npm run lint` | Check the code style. |
| `npm run setup` | Run the full update by hand: map data if needed, weekly file if needed, then daily files. Same as `npm run update:auto`. |
| `npm run update:weekly` | Load the newest weekly FCC file. |
| `npm run update:daily` | Apply the newest daily FCC files. |
| `npm run build:geo` | Rebuild the ZIP and county map data. |

In Docker, put `docker compose run --rm app` in front, for example `docker compose run --rm app npm run update:daily`.

Only one update runs at a time. If you start a second one, it stops with "Another update is running."

Environment variables: `PORT` (default `3100`), `HOST` (default `127.0.0.1`, `0.0.0.0` in Docker), `DATA_DIR` (default `./data`, `/data` in Docker), `LOAD_STATES`, `AUTO_UPDATE`.

## Project layout

```
src/fcc/       Read the FCC bulk files and decide who is a first-time licensee
src/db/        Build and update the license database (SQLite)
src/geo/       Build ZIP and county data and map shapes from Census and GeoNames files
src/update/    Download files, lock, swap in new data, report progress
src/search/    Turn picked areas into ZIP codes, run searches, write CSV
src/server/    Express web server and API
public/        The web page (plain JavaScript modules, no build step)
scripts/       Command-line tools behind the npm scripts
tests/         Tests (node --test)
deploy/        Server setup, systemd timers, Caddy, deploy script
docs/          Design, build plan, and real-data test results
```

## How it works

- **Data source:** the FCC Universal Licensing System bulk files: a full weekly file (about 200 MB) and small daily change files. See `docs/superpowers/specs/` for the full design.
- **First license:** a license counts as a first license when the FCC history shows a new license with no earlier call sign, class, or history, and no older license with the same FCC ID. Someone who let an old license expire long ago can still show up as new. The club accepted this. See `docs/verification.md` for how the rule was checked against real data.
- **ZIP to county:** each ZIP code belongs to the county that holds most of its land (from the Census relationship file). People near a county line can land in the next county.
- **Safe updates:** a new weekly database is built beside the live one and swapped in only when it passes its checks. If an update fails, the old data stays in use.

## Limits

- A search covers at most 5000 ZIP codes. This keeps each query and its memory use small. A whole large state fits.
- The API allows 120 requests per minute per client IP. This protects a small server from scripts. Normal use stays far below it.
- Map tiles come from OpenStreetMap's free tile servers, which is fine for club-size use. A busy site should switch to a hosted tile provider.

## Contributing

1. Make a branch, change the code, and add or update tests.
2. Run `npm test` and `npm run lint`.
3. Open a pull request into `main`. GitHub Actions runs the tests. A merge into `main` deploys to the server once it is set up (see [deploy/README.md](deploy/README.md)).

## Credits

License data: FCC Universal Licensing System. ZIP and county shapes: US Census Bureau. Place names: GeoNames (CC-BY 4.0). Map: © OpenStreetMap contributors.
