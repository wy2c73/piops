# Changelog

## 1.9.3

- Replaced `docs/screenshots/card-view.png` with a fuller capture showing
  the whole fleet grid (6 devices, a mix of online/offline/N/A statuses,
  and the bulk-selection bar) instead of a single card.

## 1.9.2

- Added real screenshots to `docs/screenshots/` (card view, list view,
  detail view, terminal) -- the README's image references now resolve
  instead of showing as broken links on GitHub.

## 1.9.1

- Rewrote the README's opening for a stronger pitch and added an honest
  comparison table against Grafana+Prometheus, Netdata, and Uptime Kuma
  (agentless setup, Pi-specific under-voltage detection, and being a
  control panel rather than just a viewer are the genuine differentiators
  -- the comparison also calls out where those other tools are the better
  choice, e.g. Grafana/Netdata for deep long-running metrics at scale).
- Added screenshot placeholders (`docs/screenshots/*.png`, referenced from
  the main README) plus a capture guide (`docs/screenshots/README.md`)
  spelling out exactly what to capture and the expected filenames --
  no code changes, just needs real screenshots dropped in.

## 1.9.0

- **Network scanning**: "Scan network" in the toolbar sweeps a subnet
  (auto-detected, or a CIDR you enter) for hosts with SSH open, via a
  plain TCP connect scan -- no root, no raw sockets. Verified against a
  real listener: found the one open host among 254 addresses scanned in
  ~2.8s with zero false positives. Discovered hosts can be bulk-added
  with one shared username/credential set (most home-lab fleets share a
  login), and already-added devices are flagged so you don't create
  duplicates. Capped at /20 (1022 addresses) to keep scan time bounded.
- **Optional password gate** (Settings -> Security): a single shared
  password in front of the whole dashboard, off by default so existing
  installs aren't locked out on upgrade. Scrypt password hashing,
  HMAC-signed stateless session tokens (survive a server restart without
  forcing re-login), a themed login page, and protection on every API
  route, static page, and both WebSocket upgrades (which otherwise
  would've bypassed the gate entirely). Verified end-to-end: disabled by
  default, enabling requires no prior password, wrong passwords rejected,
  valid sessions grant access, protected routes 401 without one, the
  login page itself stays reachable, WebSocket upgrades reject without a
  session, and disabling/changing the password correctly requires both
  a valid session and the current password.
- Updated security notes throughout the README to reflect the new gate
  (and its real limits -- single shared password, not a user system, and
  the session cookie isn't marked Secure since that would break plain-HTTP
  LAN usage, so this doesn't substitute for a VPN/reverse-proxy if
  exposed beyond your LAN).

## 1.8.0

- **Update notifications**: a new `GET /api/version/check` endpoint
  compares the running version against `package.json` on your GitHub
  repo's `main` branch (via `raw.githubusercontent.com`, no auth needed
  for public repos) and shows a small "vX.Y.Z available" badge in the top
  bar when one exists. Purely informational -- disabled by default until
  you set `GITHUB_REPO=owner/repo`, and never applies anything on its
  own. Verified the version-comparison logic (including the
  numeric-vs-string edge case, e.g. 1.7.10 > 1.7.9), the disabled state,
  and both a real successful fetch and a real failure case against actual
  GitHub URLs.
- **Docker auto-update pipeline (opt-in)**: added
  `.github/workflows/docker-publish.yml`, which builds and pushes a
  multi-arch image to GHCR on every push to `main`. Documented in
  DOCKER.md alongside Watchtower as the piece that actually auto-pulls
  and restarts the container, with the trade-offs spelled out clearly
  (no review gate between a push and a live deployment with fleet-wide
  SSH/reboot access) so it's an informed opt-in rather than a default.
  Native (non-Docker) installs intentionally do not get an equivalent
  auto-apply mechanism -- safely restarting a live Node process from
  within itself is meaningfully riskier than Docker's container-swap
  model, so that install path stays notification-only.

## 1.7.0

- **Docker support**: added `Dockerfile` and `docker-compose.yml` as an
  alternative to the native systemd install. New [DOCKER.md](DOCKER.md)
  covers general Docker usage plus specific steps for Synology Container
  Manager (both the GUI Project-import workflow and the SSH/CLI route).
  Device data (registry, encryption key, groups, alerts, custom commands)
  persists via a mounted volume, independent of container rebuilds.
  `ssh2`'s optional native acceleration is skipped in the image
  (`--ignore-scripts`) since it isn't required and this avoids needing a
  build toolchain in the container at all -- particularly relevant for
  ARM-based NAS models.
  Verified as much as this environment allows: `npm install
  --ignore-scripts` and the app itself run cleanly with the exact
  dependency set and file layout the image uses. Actually pulling and
  building the `node:20-bookworm-slim` base image itself could not be
  tested here (this sandbox can reach package registries like npm/pip/apt
  but not container registries) -- if the build behaves differently on
  your NAS, let me know what you see and I'll adjust.

## 1.6.0

- **Per-device alert threshold overrides**: the Add/Edit device form now
  has a collapsible "Alert threshold overrides" section (CPU/Memory/Disk/
  Temp). Leave any blank to use the global threshold from Settings ->
  Alerts; set one to give that specific device its own number instead
  (e.g. a Pi that normally runs hotter, or one with less disk to spare).
  Verified against the alert engine directly: a device with no override
  uses the global threshold, a device with an override uses its own value
  even when it's more lenient or more strict than global, and a partial
  override (only one stat set) correctly falls back to global for the
  others. Included in backup export/import alongside the rest of a
  device's settings.
- Shipped zip filenames now include the version number.

## 1.5.6

- Fixed the power/throttling icon always appearing yellow in List View
  regardless of actual status (visible in a side-by-side screenshot: a
  device Card View correctly showed gray "N/A" while List View showed the
  same yellow bolt as every other device). Root cause: the `\u26a1` emoji
  character renders as a fixed-color, multi-color glyph in many browsers/
  fonts, which CSS `color` cannot override at all -- Card View's colored
  pill background masked this, List View's bare icon fully exposed it.
  Replaced with an inline SVG using `fill=\"currentColor\"`, which is a
  real monochrome vector shape that correctly inherits color from the
  `.throttle-*` class in both views.

## 1.5.5

- Fixed the status LED being invisible in List View. The `.led` class
  never declared a `display` property, so as a `<span>` it defaulted to
  `display: inline` -- width/height are simply ignored on inline
  elements per the CSS spec. It looked fine on cards only because that
  span sits inside a flex container there (flex "blockifies" its
  children automatically); in List View it sits in a plain `<td>`, where
  it stayed truly inline and effectively invisible. Fixed with
  `display: inline-block`, which works correctly in both contexts.
- The under-voltage/throttling indicator now always shows on cards and
  in List View, not just when there's a problem: green "OK" when
  everything's fine, red for an active issue, amber for a past issue,
  and a muted gray "N/A" when unavailable (not a Pi, or the device is
  offline) -- so its absence never has to be interpreted as "fine."

## 1.5.4

- Fixed the Actions tab output panel still getting cut off after the
  1.5.2/1.5.3 fixes -- there was a second, nested scroll region
  (`#actionsOutputBody` had its own `max-height`/`overflow-y`, inside the
  already-scrollable outer tab), the same double-scrollbar pattern
  originally fixed in the Services tab. Collapsed to a single scroll
  region on the outer container, same as Services/Ports.
- Fixed drag-to-reorder card order not surviving backup export/import.
  Two things were needed: card order is now included in the backup
  bundle, and restored devices keep their **original ID** instead of
  getting a fresh one on restore -- otherwise an order reference would
  silently fail to match anything after a fresh-install restore, since
  every device would get a new random ID. Verified end-to-end: export a
  specific order, wipe the install completely, restore, and confirm both
  the device IDs and the order came back exactly as exported.

## 1.5.3

- Fixed a regression from 1.5.2: the Actions tab's fix used
  `display: flex !important` on an ID selector, which beats
  `.tab-panel[hidden] { display: none !important }` regardless of the
  `hidden` attribute (ID selectors always outrank class/attribute
  selectors, even between two `!important` declarations) -- so the
  Actions tab content was rendering underneath every other tab
  regardless of which was actually active. Fixed by scoping the rule to
  `:not([hidden])` so it's mutually exclusive with the hidden-state rule
  by construction, instead of trying to out-specificity it.
- Fixed backup restore dropping a custom command's configured timeout
  back to the 120s default -- the restore path wasn't passing
  `timeoutSec` through when recreating commands from the backup file.

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
