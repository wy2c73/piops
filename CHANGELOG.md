# Changelog

## 1.5.2

- Fixed port chips in the Ports tab rendering as tall, stretched columns
  instead of compact chips (a flexbox `align-items: stretch` default,
  triggered once the container became `flex: 1` for the single-scrollbar
  fix in 1.3.0).
- Fixed the Actions tab's output panel getting cut off at the bottom of
  the drawer instead of scrolling into view. The previous rule only
  overrode `overflow-y` via an ID selector while other required
  properties came from a separate class rule -- replaced with one
  self-contained, `!important`-forced rule so it can't silently lose to
  the wrong side of a cascade tie again.

## 1.5.1

- Custom commands now have a configurable timeout (5s&ndash;30min, default
  120s) instead of sharing the fixed 60s used by reboot/shutdown/service
  actions &mdash; long-running commands like a package upgrade need more room
  than that.
- Fixed Node's default 5-minute HTTP request timeout, which would have
  silently killed any custom command running longer than that regardless
  of its own configured timeout.
- Verified both directions end-to-end against a real SSH server: a command
  exceeding its timeout fails at exactly that mark, and the same command
  with a longer timeout completes successfully.
- Settings now shows each custom command's configured timeout, and the
  Actions tab shows it in the button tooltip and while a command is running.

## 1.5.0

- **Fleet actions**: new "Actions" tab in the device detail view with
  Reboot and Shutdown buttons (confirmation required), plus a "Restart"
  button on every row in the Services tab. All run over the existing SSH
  connection using `sudo -n` (fails fast with a clear error instead of
  hanging if a password would be required) &mdash; see the new "Setting up
  quick actions" section in the README for the sudoers config needed.
- **Custom quick commands**: define reusable commands in Settings (label +
  shell command) that show up as buttons on every device's Actions tab.
  Each run still requires confirming the exact command text for that
  specific device before it executes. Commands are only ever run by
  looking up a pre-defined ID server-side, never from raw text in a
  request. Included in backup export/import.
- **Bulk actions**: selection checkboxes on cards and list rows, a "Select
  all" toggle, and a bulk action bar to assign a group, export the
  selection to CSV, or delete multiple devices at once. Bulk CSV export
  is the reverse of CSV import for reviewing/documenting your fleet, but
  intentionally excludes credentials (the API never returns them) &mdash;
  re-add those before importing the file elsewhere.
- Verified reboot/shutdown/service-restart/custom-command execution
  end-to-end against a real local SSH server with scoped passwordless
  sudo, including confirming a disallowed command is correctly rejected
  and a service-name injection attempt is blocked before it can execute.
- Fixed a bug (caught during that testing) where the reboot/shutdown
  endpoints reported success unconditionally regardless of the command's
  actual exit code.

## 1.4.0

- **Alerting**: configurable webhook notifications (Discord, Slack,
  ntfy.sh, or generic JSON) for device offline/recovery, Pi under-voltage
  or throttling, and CPU/memory/disk/temperature thresholds you set.
  Runs server-side against the poller, so it fires even with no browser
  open, and only on the actual state transition (not every 15s while a
  condition persists). Includes a "Send test alert" button. Config is
  included in backup export/import.
- **Under-voltage / throttling indicator**: reads `vcgencmd get_throttled`
  and decodes it into current vs. since-boot conditions. Shows a red
  "Power issue" badge on cards when something's actively wrong, amber if
  it happened since boot but has since cleared, and a full breakdown in
  the device detail view. No-ops cleanly on non-Pi devices.

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
