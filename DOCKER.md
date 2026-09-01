# Running PiOps in Docker

An alternative to the systemd-based install in [INSTALL.md](INSTALL.md) --
same app, packaged as a container. Useful if you'd rather manage it
alongside your other containers (Portainer, Synology Container Manager,
Unraid, plain `docker compose`, etc.) instead of as a native Node process.

## What you get

- `Dockerfile` -- builds the app image
- `docker-compose.yml` -- one-command build + run, with a persistent volume
  for the device registry, encryption key, groups, alert config, and
  custom commands

## Requirements

- Docker Engine 20.10+ and Docker Compose v2 (`docker compose`, not the
  older standalone `docker-compose`)
- Everything else is identical to the native install: the container needs
  outbound network access to every device you want to monitor (SSH, port
  22 by default), and you need somewhere to reach the dashboard's web UI
  from (port 3000 by default)

## Quick start (any Docker host)

```bash
git clone <your-repository-url> piops
cd piops
docker compose up -d --build
```

Then open `http://<host-ip>:3000`. Logs: `docker compose logs -f`.

## Synology NAS (Container Manager)

Synology's Container Manager (DSM 7.2+) can either build from this
project directly via its **Project** feature, or you can drive the same
`docker compose` commands over SSH -- both end up running the identical
container.

### Option A: Container Manager UI (Project feature)

1. Enable SSH temporarily (Control Panel &rarr; Terminal & SNMP) just long
   enough to copy the project onto the NAS -- or use File Station instead
   if you'd rather not enable SSH at all.
2. Copy this whole project folder onto the NAS, e.g. to
   `/volume1/docker/piops/` (create a shared folder named
   `docker` first in DSM if you don't already have one).
3. Open **Container Manager** &rarr; **Project** &rarr; **Create**.
4. Set the project name (e.g. `piops`) and point "Path" at
   the folder from step 2. Container Manager will detect
   `docker-compose.yml` automatically.
5. Click **Next** through the build step, then **Done**. Container
   Manager builds the image and starts the container.
6. Open `http://<synology-ip>:3000`.

### Option B: SSH + docker compose

If you're already comfortable in a terminal, this is faster:

```bash
# On the NAS, with SSH enabled (Control Panel -> Terminal & SNMP):
sudo mkdir -p /volume1/docker/piops
cd /volume1/docker/piops
# copy or git clone the project here, then:
sudo docker compose up -d --build
```

### Synology-specific notes

- **Port conflicts**: DSM itself uses a number of ports already. If 3000
  is taken, change the host side of the port mapping in
  `docker-compose.yml`, e.g. `"8088:3000"`, then re-run
  `docker compose up -d --build`.
- **Volume path**: the compose file uses `./data`, which resolves relative
  to wherever you placed the project folder -- e.g.
  `/volume1/docker/piops/data`. That folder is created
  automatically on first run and is where `devices.json`, `.key`,
  `groups.json`, `alerts.json`, and `customCommands.json` all live. Back
  this folder up the same way you'd protect an SSH key, and preferably
  also use Settings &rarr; Export backup periodically as a portable copy.
- **Architecture**: most Synology models are x86_64 (amd64); a few smaller
  models (e.g. some DS2xxj models) are ARM. Docker automatically pulls the
  right `node:20-bookworm-slim` base image for whichever architecture
  you're building on, so no manual steps are needed either way.
- **Reverse proxy**: if you're already running DSM's built-in reverse
  proxy or a `Container Manager` reverse proxy for other services, you can
  put this behind it the same way -- point it at the container's mapped
  port.

## Persistent data

Everything that needs to survive a container rebuild lives in the `data/`
folder mounted at `/app/backend/data` -- the device registry, the
encryption key, curated groups, alert configuration, custom commands,
and any API tokens you've generated (Settings &rarr; Security).
**Never delete or recreate this folder without a backup** (Settings &rarr;
Export backup) unless you intend to start fresh -- losing `.key` while
keeping `devices.json` makes every stored credential permanently
undecryptable (see the Troubleshooting section in the main README).

This same folder also holds **automatic backups** (Settings &rarr; Backup
&rarr; Automatic backups, on by default) -- they land in `data/auto-backups/`
on whatever host path you've mounted `./data` to (so if your
`docker-compose.yml` uses `./data:/app/backend/data`, that's
`auto-backups/` right next to `devices.json` and `.key`). Worth
understanding plainly: because these live in the *same* mounted folder as
everything else, they protect against an accidental bulk delete or a bad
edit, not against that folder's underlying disk failing -- for real
disaster recovery, still periodically take a manual export (Settings
&rarr; Backup &rarr; Export backup) and store it somewhere else entirely.

## Updating

### Manual (always available, no setup required)

```bash
cd piops
git pull   # or copy in the new files
docker compose up -d --build
```

The `data/` volume is untouched by this -- your devices, groups, alerts,
and custom commands all carry over.

### Getting notified when an update exists

The dashboard can check your GitHub repo's `main` branch and show a small
"vX.Y.Z available" badge next to the version number in the top bar --
purely informational, it never applies anything on its own. Set the
`GITHUB_REPO` environment variable (in `docker-compose.yml`, or
`PORT`/`HOST` alongside it) to `wy2c73/piops`. Leave it
unset and this feature just stays off -- no error, no behavior change.

### Fully automatic updates (opt-in, Docker only)

This is a bigger decision than the other options above, worth being
deliberate about: it means anything pushed to your repo's `main` branch
gets built and deployed with no manual review step in between. For a tool
that holds SSH credentials to your whole fleet and can reboot/shutdown
devices, that's a real trade-off against convenience -- reasonable for a
personal home-lab setup where you're the only one pushing commits, less
so if you'd want a chance to review changes first.

If you want it anyway, two pieces:

1. **Publish images automatically.** This repo includes
   `.github/workflows/docker-publish.yml`, which builds and pushes an
   image to GitHub Container Registry (`ghcr.io`) on every push to `main`.
   It needs no secrets beyond what GitHub Actions provides automatically --
   just push this repo to your own GitHub and make sure Actions is enabled
   (Settings &rarr; Actions &rarr; General). By default GHCR packages are
   private; make yours public (package Settings &rarr; Change visibility)
   or Watchtower won't be able to pull it without additional auth setup.

2. **Auto-pull with Watchtower.** Point `docker-compose.yml` at the
   published image instead of building locally, and add
   [Watchtower](https://containrrr.dev/watchtower/) as a second service
   to poll for and apply new images:

   ```yaml
   services:
     piops:
       image: ghcr.io/wy2c73/piops:latest
       # remove the "build: ." line if it's still there
       container_name: piops
       restart: unless-stopped
       ports:
         - "3000:3000"
       volumes:
         - ./data:/app/backend/data
       environment:
         - PORT=3000
         - HOST=0.0.0.0
         - GITHUB_REPO=wy2c73/piops

     watchtower:
       image: containrrr/watchtower
       container_name: watchtower
       restart: unless-stopped
       volumes:
         - /var/run/docker.sock:/var/run/docker.sock
       command: --interval 3600 piops
       # checks hourly and only touches the piops container,
       # not anything else you're running
   ```

   Run `docker compose up -d` after this change. Watchtower will now pull
   and swap in a new image whenever one appears on GHCR, restarting the
   container in the process (a few seconds of downtime, and any
   in-progress SSH terminal sessions or custom commands would be
   interrupted -- something to keep in mind if you schedule this for
   times you're likely to be using it).

## Environment variables

Set these under `environment:` in `docker-compose.yml` (a couple of
examples are already commented out there):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port the dashboard listens on inside the container |
| `HOST` | `0.0.0.0` | Bind address (leave as-is; this is what makes it reachable from outside the container) |
| `POLL_INTERVAL_MS` | `15000` | How often each device is polled for stats |
| `POLL_CONCURRENCY` | `5` | Max simultaneous SSH connections during a poll cycle |
| `GITHUB_REPO` | *(unset, disabled)* | `owner/repo` -- enables the "update available" badge in the UI by checking that repo's `main` branch |

## A note on quick actions (reboot/shutdown/service restart/custom commands)

These require passwordless `sudo` configured **on each monitored Pi**, not
on the Docker host or inside the container itself -- the container is just
where the SSH client runs from. See "Setting up quick actions" in the main
README for the exact sudoers rule.

## Uninstalling

See [UNINSTALL.md](UNINSTALL.md) for the full removal steps (container,
image, and the project folder holding your data).

## Troubleshooting

- **Container exits immediately**: `docker compose logs` will show the
  Node error. Most likely cause is a `data/` permissions issue -- try
  `sudo chown -R 1000:1000 data` if the container can't write to it (the
  image runs as root by default, so this is uncommon, but worth checking
  first).
- **Can't reach the dashboard from another device**: confirm the port
  mapping in `docker-compose.yml` and that DSM's firewall (Control Panel
  &rarr; Security &rarr; Firewall) isn't blocking the port.
- Everything else is identical to a native install -- see the
  Troubleshooting section in the main [README.md](README.md).
