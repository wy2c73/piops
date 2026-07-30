# Running Pi Fleet Dashboard in Docker

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
git clone <your-repository-url> pi-fleet-dashboard
cd pi-fleet-dashboard
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
   `/volume1/docker/pi-fleet-dashboard/` (create a shared folder named
   `docker` first in DSM if you don't already have one).
3. Open **Container Manager** &rarr; **Project** &rarr; **Create**.
4. Set the project name (e.g. `pi-fleet-dashboard`) and point "Path" at
   the folder from step 2. Container Manager will detect
   `docker-compose.yml` automatically.
5. Click **Next** through the build step, then **Done**. Container
   Manager builds the image and starts the container.
6. Open `http://<synology-ip>:3000`.

### Option B: SSH + docker compose

If you're already comfortable in a terminal, this is faster:

```bash
# On the NAS, with SSH enabled (Control Panel -> Terminal & SNMP):
sudo mkdir -p /volume1/docker/pi-fleet-dashboard
cd /volume1/docker/pi-fleet-dashboard
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
  `/volume1/docker/pi-fleet-dashboard/data`. That folder is created
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
encryption key, curated groups, alert configuration, and custom commands.
**Never delete or recreate this folder without a backup** (Settings &rarr;
Export backup) unless you intend to start fresh -- losing `.key` while
keeping `devices.json` makes every stored credential permanently
undecryptable (see the Troubleshooting section in the main README).

## Updating

```bash
cd pi-fleet-dashboard
git pull   # or copy in the new files
docker compose up -d --build
```

The `data/` volume is untouched by this -- your devices, groups, alerts,
and custom commands all carry over.

## Environment variables

Set these under `environment:` in `docker-compose.yml` (a couple of
examples are already commented out there):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port the dashboard listens on inside the container |
| `HOST` | `0.0.0.0` | Bind address (leave as-is; this is what makes it reachable from outside the container) |
| `POLL_INTERVAL_MS` | `15000` | How often each device is polled for stats |
| `POLL_CONCURRENCY` | `5` | Max simultaneous SSH connections during a poll cycle |

## A note on quick actions (reboot/shutdown/service restart/custom commands)

These require passwordless `sudo` configured **on each monitored Pi**, not
on the Docker host or inside the container itself -- the container is just
where the SSH client runs from. See "Setting up quick actions" in the main
README for the exact sudoers rule.

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
