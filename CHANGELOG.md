# Changelog

## 1.3.0

- Reworked the device detail drawer's layout: it previously nested two
  independent scrollbars (the whole drawer, and the services list inside
  it) whenever content got tall. Now the header, stats, and tabs stay
  fixed and only the active tab's list scrolls &mdash; a single scrollbar.
- Services list is now a sortable table: click "Name" or "Status" to sort
  (click again to reverse), with a clear active-sort indicator. Status
  sorts group active services first, then failed, then inactive.

## 1.2.5

- Fixed restored device groups not appearing after Settings &rarr; Restore
  from backup. The backend was already restoring them correctly (since
  1.2.0); the frontend just wasn't re-fetching the groups list afterward,
  so they stayed invisible until a page reload.
- Renamed the view-toggle buttons from "Cards"/"Details" to "Card View"/
  "List View"

## 1.2.4

- Fixed the Terminal button wrapping onto two lines in the Details table
  view (a side effect of the 1.2.3 fix). Column widths are now all
  percentage-based and sum to exactly 100%, which also avoids a subtle
  overflow that mixing fixed-pixel and percentage widths could cause on
  wide screens.

## 1.2.3

- Fixed horizontal scrolling in the Details (table) view when a device
  name or other field was long. Columns now have fixed widths and wrap
  text instead of forcing the table wider than its container.

## 1.2.2

- CSV import now validates the header row explicitly. Previously, a CSV
  missing its header line (or with an altered one) would silently mark
  every single row as invalid with no explanation; now it fails once with
  a clear message naming the missing column(s) and the expected header.

## 1.2.1

- Fixed a bug where a device with an undecryptable stored credential (e.g.
  `backend/data/.key` and `backend/data/devices.json` getting out of sync)
  could crash the *entire* server, taking down monitoring for every device.
  The `/test`, `/services`, `/ports`, and `/refresh` endpoints now handle
  this cleanly and return a clear error instead.
- Added process-level safety nets (`unhandledRejection`/`uncaughtException`
  handlers) so an unexpected error anywhere else can't silently kill the
  whole process either
- Clearer error message when a stored credential can't be decrypted,
  explaining the likely cause and that the device will need its
  credential re-entered (or restored from a backup export made before
  the mismatch)

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
