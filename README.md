# Ham License Finder

Search FCC amateur radio licenses by location and first-license date. It loads the FCC bulk license files into local SQLite databases, so searches never call FCC servers.

- `npm test` runs the test suite.
- `npm start` starts the web server.

## Local quick start (Docker)

```bash
cp .env.example .env
docker compose build
docker compose run --rm app npm run setup   # map data + FCC load (MT only per .env)
docker compose up                            # http://localhost:3100
```

On Linux, create `data/` first and run `chown 1000:1000 data` if your uid is not 1000 (the container runs as uid 1000).

To deploy to a server, see [deploy/README.md](deploy/README.md).
