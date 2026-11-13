# Ham License Finder

Search FCC amateur radio licenses by location and first-license date. It loads the FCC bulk license files into local SQLite databases, so searches never call FCC servers.

- `npm ci` installs dependencies; then `npm test` runs the test suite.
- `npm start` starts the web server.

## Local quick start (Docker)

```bash
cp .env.example .env
mkdir -p data                                # Linux: also `sudo chown 1000:1000 data` if your uid is not 1000
docker compose up                            # http://localhost:3100
```

The first start downloads about 280 MB (Census map sources and the FCC weekly file) and builds the data; the page shows a progress banner while it runs. `.env` limits the load to Montana for speed. Every later start catches up on its own: it rebuilds out-of-date data, reloads the weekly file when it is more than 7 days old, and applies the daily files. Set `AUTO_UPDATE=0` in `.env` to turn this off. `npm run update:auto` runs the same update by hand, and `npm run setup` is the same command.

The container runs as uid 1000, so on Linux the `data/` folder must belong to uid 1000.

`LOAD_STATES` is read only when the weekly file is loaded. After changing it, run `docker compose run --rm app npm run update:weekly` (or delete `data/licenses.db` and restart) to reload with the new states.

To deploy to a server, see [deploy/README.md](deploy/README.md).

## Limits

- A search covers at most 5000 ZIP codes. This bounds the size of the SQL query and the memory a single request can use; a whole large state fits.
- The API allows 120 requests per minute per client IP. The site runs on a small server, and the limit keeps a script from tying it up; normal use stays far below it.
