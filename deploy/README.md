# Deploying Ham License Finder

Owner's checklist, in order. Nothing here has been run against a real server yet.

1. Create a GitHub repo and push `main`. Then turn on branch protection for `main` (Settings, Branches, or a ruleset): require a pull request, require the `test` status check to pass, and block force pushes. Developers work on branches and merge by pull request.
2. Create a DigitalOcean Basic Droplet: 2 GB RAM, Ubuntu LTS, region SFO3, with your SSH key.
3. Point `hams.<club-domain>` (A record) at the Droplet's IP.
4. Make a deploy key pair locally: `ssh-keygen -t ed25519 -f ham-finder-deploy -N ''`.
5. Copy `deploy/` to the Droplet (for example `scp -r deploy root@<IP>:`). As root on the Droplet: `bash setup-server.sh "$(cat ham-finder-deploy.pub)"`. The script finds its sibling files by its own location, so keep the folder intact.
6. Add GitHub secrets (Settings, Secrets and variables, Actions): `DEPLOY_HOST` (the IP), `DEPLOY_SSH_KEY` (contents of the private key `ham-finder-deploy`), `DEPLOY_KNOWN_HOSTS` (output of `ssh-keyscan <IP>`).
7. Push to `main`. The first deploy job builds and pushes the image. Its SSH step fails until step 9; that is expected. In GitHub, Packages, set the image to public. (The code holds no secrets. To keep it private instead, run `docker login ghcr.io` on the server once with a read-only `read:packages` token.)
8. As root on the Droplet: `bash setup-app.sh hams.<club-domain> ghcr.io/<owner>/<repo>` (lowercase owner and repo).
9. Re-run the workflow, or run `ssh deploy@<IP> deploy ham-finder <full-commit-sha>`. Expected: the health check passes and the first full data load starts on its own (the app runs its start-up update when the container starts; a post-deploy schema check may also start the setup service, which skips if the update is already running).
10. Watch the first load: open the site, which shows a progress banner (whole US; takes a while), or run `docker compose logs -f app` in `/srv/apps/ham-finder`.
11. Check: open `https://hams.<club-domain>`; `systemctl list-timers 'ham-finder*'`; logs with `journalctl -u ham-finder-weekly` and `docker compose logs app` (from `/srv/apps/ham-finder`).
12. Adding another app later: create `/srv/apps/<app>/` with its own Compose file on the `web` network, a `deploy.sh`, and `/srv/apps/caddy/sites/<app>.caddy`; then reload Caddy:
    `docker compose -f /srv/apps/caddy/docker-compose.yml exec caddy caddy reload --config /etc/caddy/Caddyfile`

## How it works

- Only Caddy publishes ports 80 and 443. The app joins the shared `web` Docker network and is reached as `ham-finder:3100`.
- Each deploy pulls the image tagged with the commit SHA (never `latest`), health-checks it, and rolls back to `last-good-tag` if it fails. `./data` is never touched by a deploy.
- The `deploy` user can only run `deploy <app> <tag>` over SSH. A forced command validates the app name and tag, then runs `/srv/apps/<app>/deploy.sh` through sudo.
- The app container also runs an update when it starts (map data if missing, the weekly file if the data is missing or older than 7 days, then the daily files), so a server that was down catches up by itself. It shares the container's 1800 MB memory limit. To turn it off, add the line `AUTO_UPDATE=0` to `/srv/apps/ham-finder/.env` and run `docker compose up -d` in `/srv/apps/ham-finder`. Deploys only rewrite the `IMAGE_TAG=` line, so the setting survives them. Progress is written to `update-status.json` in the data folder and shown as a banner on the page.
- Weekly (Sunday 20:00) and daily (Mon to Sat 08:00) updates run from systemd timers, Mountain time. Every load (timer jobs and the app's start-up update) takes an SQLite lock on `DATA_DIR/.update-lock.db`, so only one runs at a time; a second one fails or, for the start-up update, skips. The `flock` on `/srv/apps/ham-finder/.update.lock` in the timer units only keeps timer runs from overlapping each other.
