# Changelog

## 1.2.0

- Fixed the version number not showing in the top bar (added error logging
  instead of a silent failure, and disabled asset caching so updates don't
  need a manual hard-refresh)
- Added curated device groups: manage group names in Settings, and the
  Add/Edit device form now uses a dropdown fed by that list instead of free
  text
- Added an open-ports tab to the device detail view (via `ss`/`netstat`,
  no extra privileges needed) &mdash; recognized web ports (Grafana, Home
  Assistant, Node-RED, Plex, Jellyfin, and other common self-hosted UIs)
  render as clickable links
- Device backups now also include the curated groups list

## 1.1.0

- Renamed the project to **Pi Fleet Dashboard**
- Added a card / detail-table view toggle
- Added drag-to-reorder for devices in both views (saved per browser)
- Added CSV import for bulk-adding devices, with a downloadable template
- Added an option to open "local terminal" links in PuTTY or WinSCP instead
  of the system default `ssh://` handler (Settings), with a ready-made
  Windows protocol-handler script for PuTTY
- Added uptime, OS version, and hardware model to device cards, and
  hardware model to the device detail view
- Added versioning: current version shown in the top bar and via
  `GET /api/version`
- Hardened remote command execution: stats and service-list commands are
  now sent as a single base64-encoded line instead of raw multi-line/quoted
  text, avoiding a class of quoting-related exec failures
- Upgraded `uuid` to 11.1.1 (patches a moderate-severity advisory in
  `uuid@<11.1.1`; this project was never actually exposed to it, since it
  only uses `v4()`)
- Fixed a CSS bug where all modals (Add Device, Device Detail, Terminal)
  rendered on top of the page regardless of their `hidden` attribute
- Server now binds explicitly to `0.0.0.0` and prints every LAN address
  it's reachable on at startup

## 1.0.0

- Initial release: agentless SSH-based monitoring for a Raspberry Pi fleet
- Add / edit / remove devices from the UI
- Live CPU, memory, disk, temperature, load, and running-service-count
  stats, polled every 15s and pushed to the browser over a websocket
- Per-device services tab (`systemctl` status, filterable)
- In-browser SSH terminal (xterm.js) proxied over SSH, plus an `ssh://`
  link to open a local terminal app
- Metric/Imperial and °C/°F display settings
- Encrypted (AES-256-GCM) backup export/import, portable across installs
  via a user-chosen passphrase
- Credentials encrypted at rest using a locally-generated key
