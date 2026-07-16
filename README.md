# Pi Fleet Dashboard

A self-hosted, agentless monitoring dashboard for a fleet of Raspberry Pis (or any
SSH-reachable Linux boxes). No software to install on the monitored devices — the
dashboard reaches out over SSH to collect stats and to open interactive terminals.

## Features

- **Add / edit / remove devices** at any time from the UI (name, host, port, user, group, password or private-key auth)
- **CSV import** — bulk-add devices from a spreadsheet, with a downloadable template
- **Card or detail-table view** — toggle between visual cards and a dense, sortable-by-drag table
- **Drag to reorder** — rearrange devices in either view; order is remembered per browser
- **Live stats** — CPU, memory, disk, temperature, uptime, load average, running service count, OS version, and hardware model — polled over SSH every 15s and pushed to the browser over a websocket
- **Services tab** per device — full `systemctl` unit list with status, filterable
- **Ports tab** per device — open TCP ports via `ss`/`netstat`; recognized web ports (Grafana, Home Assistant, Node-RED, Plex, Jellyfin, and similar) are clickable links
- **Groups** — manage a curated list of group names in Settings; the Add/Edit device form uses a dropdown fed from that list
- **Alerts** — webhook notifications (Discord, Slack, ntfy.sh, or generic JSON) when a device goes offline/recovers, a Pi reports under-voltage or throttling, or CPU/memory/disk/temperature crosses a threshold you set
- **Under-voltage / throttling indicator** — reads `vcgencmd get_throttled` on Raspberry Pi devices and flags active or historical power/thermal issues right on the card
- **In-browser SSH terminal** — click "Terminal" on any card for a real xterm.js session proxied over SSH
- **"Open in local terminal"** — hands off to your system's default `ssh://` handler, or launch PuTTY / WinSCP directly (pick one in Settings; see "Windows integration" below)
- **Settings** — Metric/Imperial and °C/°F display preference, view mode, local terminal app, saved per-browser
- **Encrypted backup export/import** — bundle every device (with credentials) and your preferences into one passphrase-protected file, portable across installs
- Credentials are **encrypted at rest** (AES-256-GCM) in the dashboard's own data file

## Requirements

- Node.js 18+ on whichever machine will run the dashboard (a dedicated always-on Pi, per your plan)
- SSH access (password or key) from that machine to each Pi you want to monitor
- The monitored Pis just need a normal SSH server — nothing else to install

## Setup

See [INSTALL.md](INSTALL.md) for detailed, step-by-step Linux install instructions including system and software requirements. Short version:

```bash
cd backend
npm install
npm start
```

On startup it prints every LAN IP it's reachable on, e.g.:

```
Pi Fleet Dashboard listening on 0.0.0.0:3000
  -> http://localhost:3000
  -> http://192.168.1.50:3000
```

Open that `192.168.1.x` address from any device on your network — laptop, phone, etc.
It binds to all interfaces by default, so no extra config is needed for LAN access.

If you don't see it from another machine, it's almost always the Pi's firewall.
If you're running `ufw`:

```bash
sudo ufw allow 3000/tcp
```

By default it listens on port 3000 and polls every 15 seconds. Override with env vars:

```bash
PORT=8080 POLL_INTERVAL_MS=30000 POLL_CONCURRENCY=5 npm start
```

To restrict it to localhost only (e.g. if you're putting a reverse proxy in front of it), set `HOST=127.0.0.1`.

## Running it as a service (systemd)

So it survives reboots on your dedicated Pi:

```ini
# /etc/systemd/system/pi-fleet-dashboard.service
[Unit]
Description=Pi Fleet Dashboard dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/pi-fleet-dashboard/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
User=pifleet
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

```bash
sudo cp -r pi-fleet-dashboard /opt/pi-fleet-dashboard
sudo useradd -r -s /usr/sbin/nologin pifleet
sudo chown -R pifleet:pifleet /opt/pi-fleet-dashboard
cd /opt/pi-fleet-dashboard/backend && sudo -u pifleet npm install --omit=dev
sudo systemctl enable --now pi-fleet-dashboard
```

## CSV device import

Settings &rarr; Import devices from CSV. Columns:

```
name,host,port,username,group,authType,secret,passphrase
```

`authType` is `password` or `key`; leave `port`, `group`, and `passphrase` blank
to use their defaults. For `key` auth, quote the `secret` field and keep the
private key's newlines inside the quotes (any spreadsheet app does this
automatically if you paste a multi-line value into a cell). Existing devices
(matched by host + port + username) are skipped, so it's safe to re-import
the same file. Download a template from the same Settings section.

## Windows integration (PuTTY / WinSCP)

By default, "Open in local terminal" generates an `ssh://` link, which opens
whatever your OS has registered as the default SSH handler. Under
Settings, you can switch that link to target PuTTY or WinSCP instead:

- **WinSCP** needs no extra setup — its installer registers `sftp://` /
  `scp://` links automatically (this is the default option when installing).
- **PuTTY** doesn't understand URLs on its own, so it needs a one-time setup:
  1. Copy `windows/putty-protocol-handler.vbs` from this repo somewhere
     permanent on the Windows machine, e.g. `C:\Tools\pi-fleet-dashboard\`.
  2. Open `windows/register-putty-protocol.reg` in a text editor and replace
     the placeholder path with wherever you put the `.vbs` file in step 1.
  3. Double-click the edited `.reg` file and confirm the prompt.
  4. In the dashboard, go to Settings &rarr; set "Open in local terminal" to
     PuTTY.

Both files assume PuTTY is installed at `C:\Program Files\PuTTY\putty.exe` —
edit the path in `putty-protocol-handler.vbs` if yours is elsewhere.

## Versioning

The current version is shown next to the dashboard's name in the top bar and
via `GET /api/version`. See [CHANGELOG.md](CHANGELOG.md) for release history.

## Troubleshooting

**`EADDRINUSE: address already in use 0.0.0.0:3000`** &mdash; something's
already listening on port 3000, most often a previous `node server.js`
that wasn't stopped, or the systemd service already running. Check
`sudo systemctl status pi-fleet-dashboard` first; if that's active you
don't need to (and shouldn't) also run `npm start` manually. Otherwise
find and stop the other process: `sudo lsof -i :3000`, then `kill <PID>`.

**"Could not decrypt stored credential"** &mdash; `backend/data/.key` no
longer matches what encrypted the secrets in `backend/data/devices.json`.
This happens if one of those two files gets replaced or regenerated
without the other (they're a pair: losing the key means the secrets it
encrypted are unrecoverable by design, same as losing an encryption key
for any encrypted volume). As of 1.2.1 this only affects the specific
device(s) involved, not the whole server. To recover:
- If you have a backup export made *before* the mismatch (Settings &rarr;
  Export backup), delete `backend/data/devices.json` and
  `backend/data/.key`, restart the server (it generates a fresh key), then
  restore from that backup.
- Otherwise, remove the affected device(s) and re-add them with their
  credentials.

## Setting up alerts

In Settings, turn Alerts on, paste a webhook URL, and pick the matching format:

- **Discord**: Server Settings &rarr; Integrations &rarr; Webhooks &rarr; New Webhook &rarr; copy its URL
- **Slack**: create an "Incoming Webhook" app for your workspace &rarr; copy its URL
- **ntfy.sh**: no account needed &mdash; just pick a topic name and use `https://ntfy.sh/your-topic-name` (subscribe to that same topic in the ntfy app on your phone)
- **Generic**: any endpoint that accepts a POST with `{"title": "...", "message": "..."}` as JSON

Use "Send test alert" to confirm it's wired up correctly before relying on it.

## How it works

- `backend/lib/ssh.js` opens a short-lived SSH connection per poll, runs a single
  compact shell script that prints hostname/uptime/load/mem/disk/temp/service-count,
  and parses the output. One connection per device per poll cycle, not one per metric.
- `backend/poller.js` runs that on an interval (default 15s) for every registered
  device, with a concurrency cap so a big fleet doesn't open dozens of SSH sessions
  at once. Results are cached in memory and pushed to connected browsers over
  `/ws/stats`.
- `backend/wsTerminal.js` opens a real interactive SSH shell (`conn.shell()`) per
  terminal session and proxies bytes between it and an xterm.js instance in the
  browser over `/ws/terminal?id=<deviceId>`.
- `backend/lib/store.js` + `backend/lib/crypto.js` persist devices to
  `backend/data/devices.json`, with passwords/private keys encrypted using a
  locally-generated key at `backend/data/.key` (mode 600). Back up or protect that
  directory the way you would `~/.ssh`.
- The frontend (`frontend/`) is plain HTML/CSS/JS — no build step — so it runs
  directly on a Pi without a Node toolchain for the client side.

## Security notes

- This dashboard has standing SSH credentials to your whole fleet. Run it behind
  your own network/firewall; it has no built-in login of its own. If you need to
  expose it beyond your LAN, put it behind a reverse proxy with auth (e.g. Caddy /
  nginx with basic auth, or a VPN like Tailscale/WireGuard) rather than opening it
  to the internet directly.
- Consider creating a dedicated low-privilege SSH user on each Pi for monitoring,
  rather than using a root/admin account, if all you need is read-only stats. The
  service-listing and stat commands don't require root. The terminal feature will
  of course only be as privileged as the account you configure.
- Private keys pasted into the "Add device" form are encrypted before being written
  to disk, but they do pass through the browser and this server's memory in
  plaintext during that request — same trust model as pasting them into any admin
  tool you self-host.

## What's next

This covers device management, live stats, service status, and SSH terminals —
the core of what you asked for. Natural follow-ups if you want them later:
historical charts (persist stats to disk/SQLite instead of memory-only), alerting
(e.g. push a notification when a Pi goes offline or disk fills up), and
authentication/login for the dashboard itself.
