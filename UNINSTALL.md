# Uninstalling PiOps

Removes PiOps from the machine it's running on. Pick the section that
matches how you installed it.

**Before you start**: if you want to keep your device list, credentials,
or preferences for later, export a backup first (Settings → Backup →
Export backup) — every command below deletes that data permanently along
with everything else.

## Native install (systemd)

This reverses exactly what `install.sh` (or the manual systemd steps in
INSTALL.md) set up:

```bash
sudo systemctl stop piops
sudo systemctl disable piops
sudo rm /etc/systemd/system/piops.service
sudo systemctl daemon-reload

sudo rm -rf /opt/piops    # the app itself, including your device
                           # registry and encryption key

sudo userdel -r piops     # the dedicated system user PiOps ran as
```

If you customized the install directory or service user (via the
`PIOPS_INSTALL_DIR`/`PIOPS_SERVICE_USER` environment variables when
running `install.sh`), substitute those in place of `/opt/piops`/`piops`
above.

### Optional cleanup

PiOps is fully removed after the steps above — these are only relevant if
you also want to undo things that were installed *for* PiOps and aren't
used for anything else on this machine:

- **Node.js**, if `install.sh` installed it and you don't need it for
  anything else:
  ```bash
  sudo apt-get remove --purge nodejs
  sudo rm /etc/apt/sources.list.d/nodesource.list
  ```
- **Firewall rule**, if you opened one for this:
  ```bash
  sudo ufw delete allow 3000/tcp   # adjust the port if you used a different one
  ```

## Docker install

```bash
cd /path/to/piops        # wherever your docker-compose.yml lives
docker compose down
docker rmi piops:local   # or ghcr.io/wy2c73/piops:latest if you were
                          # pulling the published image instead of
                          # building locally
```

Then delete the project folder itself — this includes the `data/` folder
holding your device registry and encryption key:

```bash
cd ..
rm -rf piops
```

If you set up [Watchtower](DOCKER.md) specifically to auto-update this
container and aren't using it to watch anything else, remove that too:

```bash
docker stop watchtower && docker rm watchtower
```

## Things PiOps configured elsewhere (optional)

None of these need to happen for PiOps itself to be gone — they're other
systems it touched while running, worth knowing about for a fully clean
removal:

- **Monitored Pis**: if you set up passwordless sudo for quick actions
  (reboot/shutdown/service control — see "Setting up quick actions" in
  the README), remove that sudoers entry on each Pi you added it to:
  ```bash
  sudo rm /etc/sudoers.d/piops   # or whatever filename you used
  ```
- **Your browser**: PiOps stores your theme/unit preferences and card
  order in this browser's local storage, not on the server — removing
  the server doesn't touch this. Not necessary to clean up (it's a few
  harmless keys that will simply never be read again), but if you want
  to: open your browser's dev tools → Application/Storage → Local
  Storage for the dashboard's URL, and remove the `piOpsSettings` /
  `piOpsOrder` keys (or just clear all site data for that URL).
- **Terminal protocol handlers**: if you set up "Open in local terminal"
  registration (see "Windows integration" / "Linux integration" in the
  README), that's a one-time OS-level registration independent of PiOps
  itself:
  - **Windows**: delete the `ssh` (and/or `putty`) key under
    `HKEY_CURRENT_USER\Software\Classes\` in the Registry Editor.
  - **Linux**: `xdg-mime default "" x-scheme-handler/ssh` clears the
    association, and you can delete the `.desktop` file and handler
    script from wherever you placed them (`~/.local/share/applications/`
    and `~/.local/bin/` by default, per linux/README.md).
