# Installing PiOps

This guide covers a from-scratch install on the machine that will host the
dashboard (a dedicated Raspberry Pi, per the recommended setup) running a
Debian-based OS such as Raspberry Pi OS. The same steps work on any other
Debian/Ubuntu-based Linux with minor adjustments.

**In a hurry?** `install.sh` in the repo root automates everything below
(Node.js, cloning, the dedicated system user, and the systemd service) in
one command -- see the "Fastest path" section in the main
[README.md](README.md). The rest of this guide is for doing it by hand,
or for systems `install.sh` doesn't target.

## System requirements

**Dashboard host** (the machine running the dashboard itself):

| Requirement | Minimum | Notes |
|---|---|---|
| OS | Raspberry Pi OS (Bullseye or Bookworm), Debian 11+, Ubuntu 20.04+ | Anything with Node.js 18+ available works |
| CPU / RAM | Raspberry Pi 3B+ or newer, 512MB RAM free | Node.js footprint is small; a Pi Zero 2 W is workable for a handful of devices |
| Disk | ~200MB free | Mostly `node_modules`; the device registry itself is a few KB |
| Network | LAN access (SSH, port 22 by default) to every monitored device | The dashboard itself listens on port 3000 by default |

**Monitored devices** (the Pis being watched):

| Requirement | Notes |
|---|---|
| SSH server | Enabled and reachable (`sudo raspi-config` &rarr; Interface Options &rarr; SSH, on Raspberry Pi OS) |
| Shell access | The SSH account used must have a working login shell (not `/usr/sbin/nologin`) and no forced command |
| `systemd` | Used for the services list and running-service count (`systemctl`) &mdash; standard on all current Raspberry Pi OS / Debian / Ubuntu releases |
| Nothing else | No agent, package, or open port beyond SSH is required on monitored devices |

## Software requirements

- **Node.js 18 or newer** (LTS recommended) and npm, on the dashboard host only
- Internet access on the dashboard host during install, to fetch npm packages and the CDN-hosted frontend libraries (xterm.js, PapaParse) the UI uses at runtime
- Optional: `git`, if you're pulling the project from a repository instead of copying files over

## 1. Install Node.js

Raspberry Pi OS's default `apt` repository often carries an older Node.js
version, so installing from NodeSource is recommended:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # should print v20.x or newer
npm -v
```

## 2. Get the project onto the Pi

Either clone it with git:

```bash
git clone <your-repository-url> piops
cd piops
```

...or copy the extracted project folder over with `scp`/`rsync` from
another machine, then `cd` into it.

## 3. Install dependencies

```bash
cd backend
npm install
```

This installs `express`, `ssh2`, `ws`, `uuid`, and `cors`. You may see an
`npm warn install-scripts` notice about `ssh2`/`cpu-features` &mdash; that's
expected and harmless; see the note in the main README.

## 4. First run (foreground, for testing)

```bash
npm start
```

You should see something like:

```
PiOps listening on 0.0.0.0:3000
  -> http://localhost:3000
  -> http://192.168.1.50:3000
```

Open the printed LAN address from any device on your network. Press
Ctrl+C to stop it once you've confirmed it works &mdash; the next step makes
it persistent.

If you don't see the second line, or it doesn't load from another device,
check the Pi's firewall (`sudo ufw allow 3000/tcp` if `ufw` is active).

## 5. Run it as a systemd service (recommended)

This keeps it running after reboots and restarts it if it crashes.

```bash
sudo mkdir -p /opt/piops
sudo cp -r . /opt/piops/
sudo useradd -r -s /usr/sbin/nologin piops
sudo chown -R piops:piops /opt/piops
cd /opt/piops/backend
sudo -u piops npm install --omit=dev
```

Create `/etc/systemd/system/piops.service`:

```ini
[Unit]
Description=PiOps
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/piops/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
User=piops
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now piops
sudo systemctl status piops
```

## 6. Configure the devices to monitor

Everything from here happens in the web UI &mdash; no config files to hand-edit:

- Click **+ Add device** to add Pis one at a time, or use **Settings &rarr;
  Import devices from CSV** to bulk-add them (template available in the
  same panel).
- Each device needs SSH reachability and an account with a normal shell &mdash;
  see the monitored-device requirements table above.

## Upgrading later

```bash
cd /opt/piops
sudo systemctl stop piops
# pull/copy the new version over the old files, then:
cd backend && sudo -u piops npm install --omit=dev
sudo systemctl start piops
```

Your device registry (`backend/data/devices.json`) and encryption key
(`backend/data/.key`) aren't touched by an upgrade as long as you don't
overwrite the `data/` directory. Back that directory up before major
upgrades regardless &mdash; or use Settings &rarr; Export backup, which is the
portable, passphrase-protected way to do it.

To get a small "update available" badge in the dashboard's top bar when a
newer version exists on your GitHub repo, set `GITHUB_REPO` before starting
it, e.g. add `Environment=GITHUB_REPO=wy2c73/piops` to
the systemd service file above. This only checks and displays a
notification &mdash; it never updates anything automatically. There's no
equivalent automatic-update pipeline for native installs (unlike the
Docker + Watchtower option in [DOCKER.md](DOCKER.md)); applying the
upgrade steps above is still a manual step.

## Uninstalling

See [UNINSTALL.md](UNINSTALL.md) for the full removal steps (systemd
service, install directory, dedicated system user, and optional cleanup
of anything else it touched).

## Troubleshooting

- **Blank page / nothing loads**: check `node server.js`'s console output
  for errors, and your browser's dev tools console/network tab.
- **Device shows "Unreachable"**: usually a network/firewall issue between
  the dashboard host and that device, or wrong credentials &mdash; the exact
  error is shown on the device's card.
- **Device shows "Unable to exec"**: SSH connected and authenticated fine,
  but the server refused to run a command &mdash; check the account's login
  shell (`getent passwd <user>` on the monitored device) isn't `nologin`,
  and that there's no `ForceCommand`/forced-command key restriction.
- **"Could not decrypt stored credential" / `EADDRINUSE`**: see the
  Troubleshooting section in the main [README.md](README.md).

See the main [README.md](README.md) for architecture details, security
notes, and the Windows/PuTTY/WinSCP integration guide.
