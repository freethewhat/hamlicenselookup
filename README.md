# Ham License Finder

Find licensed amateur radio operators in an area and export them as a mailing list.

Pick many ZIP codes or counties at once, on a map or in a form. Filter to people who got their first license recently. Download a CSV with call sign, name, and mailing address. Our club uses the list to mail postcards to local hams and to invite new ones to join.

The app keeps its own copy of the public FCC license database and updates it every day. Searches never call FCC servers.

## Quick start with Docker

You need [Docker](https://docs.docker.com/get-docker/) with Docker Compose v2.

```bash
git clone https://github.com/freethewhat/hamlicenselookup.git
cd hamlicenselookup
cp .env.example .env
mkdir -p data
docker compose up
```

Open http://localhost:3100.

`docker compose up` builds the app image on your computer from the code you cloned. You don't need a prebuilt image or a GitHub account. The image in GitHub's container registry is for the production server only.

The first start downloads about 280 MB of Census map files and FCC license data, then builds the databases. Expect a few minutes. A progress bar at the top of the page shows each step, and the page is ready when the bar goes away.

On Linux the container runs as user id 1000. Check yours with `id -u`. If it isn't 1000, run `sudo chown 1000:1000 data` once.

### Getting new code

Docker keeps using the image it built the first time, so rebuild after you pull:

```bash
git pull
docker compose up --build
```

Your data in `data/` stays. Stop the app with Ctrl+C, or with `docker compose down` if you started it with `-d`.

### What `.env` controls

| Setting | Default in `.env.example` | What it does |
|---|---|---|
| `LOAD_STATES` | `MT` | Loads only these states. Use a comma list such as `MT,ID`, or leave it empty for the whole US. A short list makes the first load fast. |
| `AUTO_UPDATE` | `1` | Checks and updates the data each time the app starts. Set it to `0` to turn that off. |

The app reads `LOAD_STATES` only when it loads the weekly FCC file. After you change it, reload the data:

```bash
docker compose run --rm app npm run update:weekly
```

## How the data stays current

Each time the app starts, it checks its data in the background. `AUTO_UPDATE=0` skips this.

- If the map data is missing or from an old version, it builds the map data.
- If the license data is missing, from an old version, or built from a weekly file more than 7 days old, it loads the newest weekly FCC file.
- Then it applies the newest daily FCC files.

Everything lives in the `data/` folder. To start over, stop the app, delete `data/`, and start it again.

On the production server, timers also run the updates every day. See [deploy/README.md](deploy/README.md).

## Run without Docker

You need Node.js 22 or newer.

```bash
npm ci
npm start             # http://127.0.0.1:3100, data in ./data
```

`npm start` runs the same start-up update. Pass `LOAD_STATES` and `AUTO_UPDATE` as environment variables, for example `LOAD_STATES=MT npm start`.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Starts the web server and the start-up update. |
| `npm test` | Runs all tests. They use temporary folders and never touch `./data`. |
| `npm run lint` | Checks code style. |
| `npm run setup` | Runs the full update by hand. It builds map data if needed, loads the weekly file if needed, then applies the daily files. Same as `npm run update:auto`. |
| `npm run update:weekly` | Loads the newest weekly FCC file. |
| `npm run update:daily` | Applies the newest daily FCC files. |
| `npm run build:geo` | Rebuilds the ZIP and county map data. |

In Docker, put `docker compose run --rm app` in front, for example `docker compose run --rm app npm run update:daily`.

Only one update runs at a time. A second one stops with "Another update is running."

Environment variables:

| Variable | Default | In Docker |
|---|---|---|
| `PORT` | `3100` | `3100` |
| `HOST` | `127.0.0.1` | `0.0.0.0` |
| `DATA_DIR` | `./data` | `/data` |
| `LOAD_STATES` | all states | from `.env` |
| `AUTO_UPDATE` | `1` | from `.env` |

## Project layout

```
src/fcc/       Reads the FCC bulk files and decides who is a first-time licensee
src/db/        Builds and updates the SQLite license database
src/geo/       Builds ZIP and county tables and map shapes from Census and GeoNames files
src/update/    Downloads files, takes the update lock, swaps in new data, reports progress
src/search/    Turns picked areas into ZIP codes, runs searches, writes CSV
src/server/    Express web server and API
public/        The web page, plain JavaScript modules with no build step
scripts/       Command-line tools behind the npm scripts
tests/         Tests, run with node --test
deploy/        Server setup, systemd timers, Caddy config, deploy script
docs/          Design, build plan, and real-data test results
```

## How it works

**Data source.** The app reads the FCC Universal Licensing System bulk files. A full file of about 200 MB comes out every Sunday, and small change files come out daily. The full design is in `docs/superpowers/specs/`.

**First license.** A license counts as someone's first when its FCC history starts with a new grant, it has no earlier call sign or class, and no older license shares its FCC ID. Someone whose old license lapsed long ago, before the FCC's records start, can still show up as new. That costs us an extra postcard now and then, and we decided it was fine. `docs/verification.md` shows how we checked the rule against real data.

**ZIP to county.** Each ZIP code goes to the county that holds most of its land, using the Census ZIP-to-county relationship file. A few people near a county line land in the next county over.

**Safe updates.** The loader builds each new weekly database next to the live one and swaps it in only after it passes its checks. If an update fails, the app keeps serving the old data.

## Limits

- A search covers at most 5000 ZIP codes. That keeps each query and its memory use small, and a whole large state still fits.
- The API allows 120 requests per minute per client IP, to keep scripts from tying up a small server. Normal use stays far below it.
- Map tiles come from OpenStreetMap's free tile servers. That's fine for a club, but a busy site should switch to a hosted tile provider.

## Contributing

Read [CLAUDE.md](CLAUDE.md) first. Page changes must stay WCAG 2.2 AA compliant; the rules are in [public/CLAUDE.md](public/CLAUDE.md).

1. Make a branch, change the code, and add or update tests.
2. Run `npm test` and `npm run lint`.
3. Open a pull request into `main`. GitHub Actions runs the tests. Once the server is set up, a merge into `main` also deploys it. See [deploy/README.md](deploy/README.md).

## Credits

License data comes from the FCC Universal Licensing System. ZIP and county shapes come from the US Census Bureau. Place names come from GeoNames under CC-BY 4.0. Map tiles are © OpenStreetMap contributors. The Lato and Playfair Display fonts are under the SIL Open Font License.
