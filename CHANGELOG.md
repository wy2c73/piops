# Changelog

## 1.23.0

- **Stats history**, off by default. Records a CPU/memory/disk/
  temperature sample every 5 minutes per device (downsampled from the
  15s poll interval on purpose -- on a Raspberry Pi, extra writes mean
  extra SD card wear, so this stays off unless you turn it on), with
  configurable retention (24 hours / 7 days / 30 days). Shows up two
  places, both configurable independently in Settings -> General:
  - A new **History** tab on each device, with a chart per metric
    (current/min/max shown alongside each).
  - An optional small CPU-trend **sparkline** right on the card/row,
    with its own separate on/off toggle.
  Charts are hand-rolled inline SVG, not a charting library -- the
  data (one line, evenly spaced points) is simple enough that this
  project's own stated bar for "write it directly instead of adding a
  dependency" (see CONTRIBUTING.md) clearly applies.
  18 new tests across three files (storage/sampling/retention, the
  routes, and the SVG chart-building math itself -- extracted directly
  from app.js, not a copy, so it can't silently drift), 134 total
  passing. Proved the retention pruning actually matters by breaking
  it and watching a test fail, then restoring it.
  Caught and fixed two real bugs in my own test-extraction tooling
  along the way (not app bugs): a brace-counting helper, used to pull
  a function's source directly out of app.js for testing, mistook a
  destructured parameter's own `{...}` for the function body and
  silently truncated the extraction. Fixed in both places it existed,
  proactively fixed a third that wasn't yet affected but used the same
  fragile logic. Also verified the full pipeline end to end against a
  real running server with realistic seeded data, after an actual SSH
  server wasn't available to test against in this environment.

## 1.22.0

- **CI: a GitHub Actions workflow now runs the test suite** on every
  push and PR against main (`.github/workflows/test.yml`), matching
  the existing `docker-publish.yml`'s conventions. Previously the 110
  tests only ran when I ran them by hand before a release -- this
  catches a regression the moment it lands on `main`, including from
  an edit made directly on GitHub's web UI rather than the usual
  local-clone workflow.
- **Closed the last two real test-coverage gaps**: `lib/alertEngine.js`
  (16 new tests total across both files) -- the transition-detection
  logic (fires only on an actual state *change*, not every poll while
  a condition persists), per-device threshold overrides, and the
  under-voltage/throttling/CPU/memory/disk/temp checks -- and
  `lib/alertNotifier.js` -- the exact payload shape sent to Discord,
  Slack, ntfy, and the generic format, using a mocked `fetch`. Proved
  both matter: broke the transition-only logic and the Discord
  formatting, one at a time, confirmed each corresponding test failed,
  restored both.
- **A documented, token-authenticated read API** (see `API.md`) for
  pulling device stats into Home Assistant, Grafana, or your own
  scripts -- `GET /api/v1/devices`, `/devices/:id`, `/summary`.
  Deliberately separate from the dashboard's own session/password
  system: tokens are generated in Settings -> Security, shown once at
  creation (only a SHA-256 hash is stored after that, same as the
  dashboard password's own hashing approach), and work independently
  of the password gate -- a valid token still works even when that
  gate is turned on. Read-only by construction: no route in this API
  can change anything. Built with an explicit field allowlist rather
  than reusing the internal device shape, specifically so a field
  added later for the dashboard's own internal use can't silently leak
  into this external, documented contract just by existing.
  21 new tests across four files (token generation/storage/revocation,
  the management routes, and the v1 endpoints themselves), 110 total
  passing. Specifically proved the most important guarantee -- that a
  token works independently of the session gate -- by deliberately
  moving the new router's mount point to *after* the session-gate
  middleware (the exact mistake that would silently break this) and
  confirming the test caught it before restoring the correct order.
  Also did a real end-to-end server boot test (create a token via
  curl, call the API with it, confirm a request with no token gets a
  401) rather than trusting the test suite alone.
  `API.md` documents authentication, all three endpoints with real
  example responses (captured from an actual running server, then
  corrected once against the real source when the hand-built
  `throttled` object example turned out to be missing several real
  fields), a field reference table, and a Home Assistant REST sensor
  example. Linked from the README.

## 1.21.0

- **Login rate limiting.** 5 failed attempts locks that IP out for 15
  minutes -- previously nothing stood between the password gate and a
  script trying passwords as fast as the network allowed. Hand-rolled
  (`lib/loginRateLimit.js`), no new dependency, matching how
  auth/sessions are already implemented directly rather than pulled
  from npm. In-memory, not persisted -- resets on restart, a
  reasonable trade-off for a home dashboard. Locks out the *correct*
  password too while an IP is locked out (checked before verifying
  credentials at all), since otherwise the limiter would be trivially
  bypassed by anyone who actually knows the password -- a real login
  briefly sharing that cost is an accepted, standard trade-off for
  this kind of lockout. A successful login resets the count.
  Documented the one real caveat directly in the README: this keys on
  the direct TCP peer address, so running behind a reverse proxy
  without Express's "trust proxy" configured means everyone behind it
  shares one bucket.
  10 new tests (7 unit against the limiter directly with mock
  requests, 3 HTTP-level against the real login route), including
  genuine time-based verification (actually waiting out a shortened
  test window/lockout rather than just asserting on logic) and proof
  the tests catch a real regression: removed the rate-limit check,
  confirmed the relevant test failed, restored it.
- **`CONTRIBUTING.md`**, now that the repo is public: setup, running
  tests, the project's actual conventions (minimal dependencies,
  agentless as a hard constraint, comments explain *why*, backward
  compatibility on renames), what a good PR looks like, and where to
  report a security issue privately rather than in a public issue.
  Linked from the README.

## 1.20.3

- Documented where automatic backups actually live on disk -- until
  now this only existed in the in-app UI text, a code comment, and the
  v1.19.0 changelog entry, not in any doc someone would actually find
  while reading the repo. DOCKER.md's "Persistent data" section now
  mentions `data/auto-backups/` alongside the device registry and
  encryption key it already covered, with the exact host-path
  implication for a typical `./data:/app/backend/data` mount.
  INSTALL.md's equivalent "Upgrading later" section gets the same
  addition for a native install (`backend/data/auto-backups/`). Both
  repeat the same disaster-recovery caveat already in the UI: these
  share a disk with everything else, so they're not a substitute for
  a manual, off-device export.

## 1.20.2

- The version badge in the top-left of the topbar is now a link to the
  GitHub repo (opens in a new tab). Purely a markup/CSS change --
  `<span>` swapped for `<a>`, same styling otherwise, no JS changes
  needed since the version text is still just set via `.textContent`.

## 1.20.1

- **Added a favicon.** Wasn't Docker-specific -- there was no favicon at
  all, anywhere, in any deployment method; just noticed via Docker.
  New `frontend/favicon.svg` (primary, theme-aware via a
  `prefers-color-scheme` media query inside the SVG itself, matching
  the app's existing light/dark theming), `favicon.ico` (multi-
  resolution 16/32/48px fallback for browsers without SVG favicon
  support), and `apple-touch-icon.png` (180px, for iOS home-screen
  bookmarks). Design echoes the app's own most recognizable visual
  motif -- the status-LED dot used on every device card. Linked from
  both index.html and login.html.
  Actually rendered and visually reviewed the icon at real favicon
  sizes (not just written blind) before finalizing -- caught a real
  mistake along the way: the first attempt at building the
  multi-resolution .ico only embedded one size despite asking Pillow's
  ICO writer for three (a wrong assumption about `append_images` for
  this format, not the intended `sizes=` resize-from-source behavior).
  Confirmed no `.dockerignore`/`.gitignore` pattern excludes the new
  files, and that Express serves each with the correct MIME type.
  Couldn't run an actual `docker build` in this environment to verify
  end to end -- verified the exact copy/ignore mechanics that determine
  it instead, but a real rebuild is worth confirming on your end too.

## 1.20.0

- **Settings sync across browsers/devices.** Theme, units, view mode,
  local terminal app choice, and card order now live on the server
  (`GET`/`PUT /api/settings`) instead of being stuck in one browser's
  localStorage -- open the dashboard from your phone and your laptop
  and they now show the same thing. The first browser to connect after
  updating migrates its existing values up automatically (server has
  "never saved before" -> push this browser's current values), so
  nobody's existing preferences get silently reset. localStorage stays
  in the picture as a fast local *cache*, specifically so the very
  first paint can still pick the right theme instantly without a
  flash-of-wrong-theme -- the server stays authoritative, and the cache
  self-corrects (re-applying only if something's actually different)
  shortly after each page load.
  Tested in an actual jsdom browser environment (real localStorage,
  real fetch against a real running test server), extracting the exact
  sync/migration code by name straight from app.js rather than
  reimplementing it for the test, so it can't silently drift from what
  ships. jsdom added as a dev-only dependency -- confirmed `npm install
  --omit=dev` (what install.sh/Docker actually use) does not pull it
  into production.
  This testing caught a real bug in the app logic itself, not just the
  test: the "did anything actually change" check compared the full
  settings object including an `order` field that only exists on the
  server-stored version, so it was spuriously true on every sync
  (harmless in effect -- it only meant needlessly re-applying an
  unchanged theme -- but defeated the point of only re-applying on a
  real change). Proved the fix mattered by reverting it and confirming
  the test caught the regression, then restored it.

## 1.19.0

- **Automatic backups** (Settings → Backup), on by default. Takes a
  periodic server-side snapshot -- daily or weekly, configurable
  retention (default: keep the last 7) -- encrypted with this install's
  own at-rest key rather than a passphrase, since nothing's present to
  type one in on a schedule. Includes a "Back up now" button and a list
  of existing snapshots each with its own Restore button.
  Documented honestly, in the UI itself: this protects against an
  accidental bulk delete or a bad edit, **not** against the whole disk/
  SD card failing, since these backups live in the same place as
  everything else -- the manual, off-device export is still what you
  want for real disaster recovery.
  Refactored `routes/backup.js` first: extracted the shared bundle-
  build/apply logic into `lib/backupBundle.js` so manual (passphrase)
  and automatic (local-key) backups both use the same code instead of
  duplicating it -- confirmed the refactor didn't break anything by
  running the existing backup tests immediately after, before adding
  anything new.
  Added 14 new tests (9 unit + 5 HTTP-level), all passing alongside the
  existing 40 (54 total). Caught and fixed a real bug while testing:
  the restore filename validation didn't account for the trailing "Z"
  in ISO timestamps, which would have rejected every legitimately-
  generated backup filename. Also specifically verified path-traversal
  attempts are rejected, retention pruning keeps exactly the newest N
  files, and a real server boot correctly took its first automatic
  backup on startup.

## 1.18.0

- **Automated test suite** (`npm test` in `backend/`), using Node's
  built-in test runner -- no new dependency. 40 tests across 8 files,
  running in under 3 seconds:
  - Backend API tested end-to-end against the real Express app:
    devices, groups, alerts, backup export/import (including the
    legacy pre-rename format string), and the full auth/session gate
    (login, wrong password, disable requiring current password,
    login.html staying reachable).
  - Unit tests for logic that's had real bugs before: version
    comparison, CIDR parsing/IP sorting, password hashing and session
    token tamper-resistance.
  - `install.sh`'s URL-parsing (`GITHUB_REPO` derivation) is tested by
    extracting and sourcing the function directly from the real file,
    not a separate copy -- can't silently drift from what the script
    actually does.
  - Proved these actually catch regressions rather than just passing
    trivially: deliberately broke the version-comparison logic, the
    legacy-backup-format compatibility, and the install.sh regex, and
    confirmed each corresponding test failed, then restored and
    re-confirmed passing.
- **Refactored for testability**, both changes backward compatible with
  zero effect on normal operation:
  - `server.js` now exports `{ app, server }` and guards
    `poller.start()`/`server.listen()` behind a `require.main ===
    module` check, so tests can import the real app without starting a
    real server or polling actual devices. Running it normally (`node
    server.js`) is completely unaffected.
  - New `lib/dataDir.js` centralizes the data directory path behind an
    overridable `PIOPS_DATA_DIR` env var (`store.js`/`auth.js`/
    `crypto.js` updated to use it), so tests run against a fully
    isolated temp directory and never touch a real device registry.
  - `install.sh`'s URL-derivation logic was pulled into a named
    function (`derive_github_repo_slug`) specifically so it could be
    sourced and tested directly -- no behavior change, verified with a
    full fresh-install re-test afterward.
- Also caught two bugs in the tests themselves while writing them (not
  app bugs): wrong expected HTTP status codes for device creation/
  deletion (the app correctly uses 201/204, standard REST conventions,
  which I'd assumed were 200), and a regex in the CIDR test that didn't
  actually match the real error message. Both fixed before landing.
- Documented in the README ("Running tests"), including what this
  suite deliberately doesn't cover (real SSH, real browser rendering)
  and still needs the kind of manual testing used throughout this
  project.

## 1.17.1

- Added `sudo journalctl -u piops -f` to the "Run it as a systemd
  service" sections of both README.md and INSTALL.md, with a
  plain-language explanation (a live feed of the service's log output,
  not a one-time snapshot) for anyone less familiar with Linux
  commands. Also updated the wiki's Troubleshooting page with the same
  tip plus the Docker equivalent (`docker compose logs -f`) -- delivered
  separately from this zip since the wiki lives in its own repo outside
  this project.

## 1.17.0

- **One-line uninstall** (`uninstall.sh`), matching `install.sh` for
  parity: stops/disables the service, removes the install directory
  and dedicated system user. Unlike install, this is destructive, so it
  asks for confirmation by default (reading from `/dev/tty` specifically,
  since normal stdin is consumed by the piped script itself) -- set
  `PIOPS_UNINSTALL_YES=1` to skip the prompt for scripted use. Tested all
  three paths for real: declining (confirmed nothing gets touched),
  confirming via an actual pseudo-terminal (not just reading the code),
  and the non-interactive env-var path -- all three verified against
  real before/after filesystem state. Caught and fixed a real bug during
  this testing: `systemctl daemon-reload` had no failure tolerance,
  so on any system where that call fails for any reason, `set -e` would
  have killed the script before it reached the (more important) steps of
  actually removing the install directory and system user.
- **`install.sh` now auto-configures the "update available" badge.**
  It already existed (since 1.8.0) but needed `GITHUB_REPO` set
  manually. Since `install.sh` already knows the repo URL, it now
  derives `owner/repo` from it automatically (when it's a plain
  `github.com` HTTPS URL) and adds it to the generated systemd service
  -- the badge just works after a one-line install, zero extra config.
  Falls back to leaving it unset (badge stays off, exactly like before)
  for anything it doesn't recognize -- a fork hosted elsewhere, an
  SSH-style URL, etc. Worth noting for anyone reading the diff: an
  earlier version of this used a "non-greedy" regex quantifier to strip
  a trailing `.git` from the URL, which doesn't actually exist in the
  POSIX-ERE dialect bash's `[[ =~ ]]` uses (that's PCRE syntax) --
  caught by testing it against real URLs rather than assuming the
  regex worked, and replaced with plain, reliable bash suffix-stripping
  instead.
- README/INSTALL.md/UNINSTALL.md reorganized so install, upgrade, and
  uninstall are each a single clearly-labeled command in one place,
  instead of upgrade being implied ("re-run install.sh") and uninstall
  requiring a multi-step manual sequence.

## 1.16.3

- Added a show/hide toggle (eye icon) to every password field in the
  app, not just the Security tab one that prompted this -- all 7:
  Security's current/new password, Backup's export/import passphrase,
  Scan Network's key passphrase, the Add/Edit device key passphrase,
  and the login page. Built as one small shared script
  (`password-toggle.js`) rather than duplicating the logic 7 times, so
  both index.html and the standalone login.html (which doesn't load
  app.js) can use it. Icons are inline SVG, not an emoji -- this
  project already learned that lesson once (the power-indicator emoji
  couldn't be recolored via CSS and had to be replaced with SVG back in
  1.5.6), so didn't want to reintroduce the same class of problem here.
  Verified with an actual simulated click (via jsdom, not just reading
  the code): confirms the input type toggles password/text correctly
  on click, the icon and aria-label swap in sync, the value is
  preserved across toggles, and a button with no matching input doesn't
  crash.

## 1.16.2

- Fixed a real install.sh failure reported from an actual Raspberry Pi:
  `npm install` failed with `EACCES: permission denied, mkdir
  '/home/piops'`. Root cause: `useradd -r` assigns a home directory in
  `/etc/passwd` (`/home/piops`) but does not actually create it on
  Debian/Raspberry Pi OS -- so anything needing to write there (npm's
  cache, notably) fails on a directory that was never created. Fixed by
  explicitly creating and owning that directory, and repairing it even
  for an already-existing user (since a user could already be stuck in
  this exact broken state -- which is precisely what a fresh re-run
  needs to detect and fix, not just skip because the user already
  exists).
- Also made `run_as_service_user()` explicitly set `HOME` for the
  command it runs, instead of trusting `su`/`sudo` to set it correctly
  on their own -- they turned out to disagree. A non-login `su user -c
  cmd` doesn't reset HOME at all (inherits the caller's); `sudo -u user
  cmd` does. This is what actually explains why this bug shipped
  undetected: **all of my prior testing of this script ran as root**,
  which exercises the `su` branch -- but a real user follows the
  documented setup (a regular account with sudo), which exercises the
  `sudo` branch instead, and only that branch actually hit the missing
  home directory. Testing exclusively as root was a real gap in how
  this got tested, not just an unlucky miss.
  Re-tested properly this time: fresh install as root (the `su`
  branch), fresh install as a genuine non-root sudo-capable user (the
  `sudo` branch -- the one that actually matters), and, critically, a
  re-run against a user already stuck in the exact broken state a real
  install could be in right now (existing user, missing home directory)
  to confirm the fix repairs it rather than only handling brand-new
  installs. All three passed, including a real `npm install` completing
  successfully in each case.

## 1.16.1

- Added UNINSTALL.md, covering both install methods:
  - Native (systemd): stopping/disabling/removing the service, deleting
    the install directory, removing the dedicated system user -- plus
    optional cleanup (Node.js, the firewall rule) for anything installed
    specifically for PiOps.
  - Docker: `docker compose down`, removing the image, deleting the
    project folder (including the data volume), and removing Watchtower
    if it was set up solely for this container.
  - A third section for things PiOps configured outside the dashboard
    host itself: the sudoers entry on each monitored Pi, browser
    localStorage keys, and the Windows/Linux terminal protocol handler
    registrations.
  Every path, username, and filename in it was cross-checked directly
  against what install.sh and docker-compose.yml actually create
  (`/opt/piops`, the `piops` system user, `piops.service`,
  `/etc/sudoers.d/piops`) rather than approximated from memory. Linked
  from README.md, INSTALL.md, and DOCKER.md so it's actually
  discoverable.

## 1.16.0

- Added a light/dark theme toggle (Settings -> General), defaulting to
  dark. This turned out to be more than a simple variable swap:
  - Two hardcoded colors (`#06121c`, used as button/active-segment text
    on top of the accent color) and several hardcoded rgba() tints (the
    topbar's translucent background, the body's ambient background
    glow) would not have adapted to a light theme at all if left as
    literals -- promoted all of them to theme-aware CSS variables
    (`--on-accent`, `--topbar-bg`, `--ambient-1/2`).
  - The in-browser terminal's colors are set via xterm.js JS options,
    not CSS, so they don't come along for free with a CSS variable
    switch -- added a separate light/dark terminal palette that updates
    live if the theme is changed while a terminal is open.
  - Applied the theme via a tiny inline script in the `<head>` of both
    index.html and login.html (not just in app.js, which loads at the
    end of body) specifically so light-theme users don't see a flash of
    dark theme on every page load while the rest of the JS is still
    loading.
  - Computed actual WCAG contrast ratios for every new light-theme color
    pair rather than eyeballing them -- caught real problems this way:
    the initial accent blue and status green both cleared the lenient
    "large text/UI component" 3:1 threshold but failed the 4.5:1 normal-
    text threshold, and the initial `--text-dim` failed contrast
    outright. Darkened all three until they cleared 4.5:1 with real
    margin, then re-verified. (Left the pre-existing dark theme's
    `--text-dim` alone despite it having the same underlying contrast
    gap -- that's an already-shipped, already-reviewed design choice,
    out of scope for what was asked here.)

## 1.15.0

- Reorganized Settings into tabs (General, Devices, Alerts, Security,
  Commands, Backup) instead of one long flat scroll through 8 stacked
  sections -- was already getting unwieldy and would only get worse as
  more settings (theme, stats history) land. Reuses the exact tab
  pattern from the device detail drawer for visual consistency, but
  with an independently-scoped click handler (`.settings-tab-btn`,
  not `.tab-btn`) rather than sharing the drawer's tab-switching
  function directly -- that function hardcodes the drawer's own panel
  IDs, so reusing it verbatim would have made clicking a Settings tab
  also try to toggle the (unrelated, and in this modal nonexistent)
  device-detail panels.
  Widened the modal to match the drawer's width for better breathing
  room, which also means it automatically inherits the single-scroll-
  region-plus-sticky-tab-bar behavior already hardened across mobile,
  desktop, and vertically-short screens in 1.10.x/1.11.1 -- no new
  scroll-handling code needed for this to work correctly everywhere.
  No behavior changes to any individual setting -- every input, button,
  and save action works exactly as before, just regrouped into tabs.
  Verified every one of the ~45 element IDs referenced by existing JS
  still exists exactly once after the restructuring, and that the two
  tab-button classes don't collide.

## 1.14.0

- **Renamed the project from Pi Fleet Dashboard to PiOps.** Went through
  every file rather than just the visible UI text:
  - npm package name (`piops-backend`), UI brand text/page titles
    (`PI OPS` / `PiOps`), systemd service (`piops.service`), dedicated
    system user (`piops`, was `pifleet`), install directory (`/opt/piops`,
    was `/opt/pi-fleet-dashboard`), Docker image/container name, the GHCR
    workflow (also switched from a hardcoded repo name to
    `ghcr.io/${{ github.repository }}`, so it can't go stale on a future
    rename), install.sh's env var prefix (`PIOPS_*`, was `PI_FLEET_*`),
    and every README/INSTALL.md/DOCKER.md/linux+windows integration doc.
  - Download filename conventions (backup export, CSV template/export)
    updated to the new name -- no compatibility concern there, they're
    just filenames.
  - Two places got deliberate backward-compatible handling instead of a
    clean rename, since they affect continuity for whoever already has
    data: the backup-file format identifier (writes `piops-backup` now,
    but still accepts the legacy `pi-fleet-dashboard-backup` string on
    import) and the browser localStorage keys for settings/card order
    (new keys, with a one-time fallback read from the old ones so
    existing saved preferences carry over instead of resetting).
  - Old CHANGELOG entries were left untouched -- they're a historical
    record of what was true at the time, not living documentation.
  - Added a LICENSE file (MIT) in 1.13.2, immediately before this --
    worth knowing this rename shipped right after going public-ready.
- Tested thoroughly rather than assuming a rename this size went
  cleanly: full fresh-install and update-path runs of the renamed
  install.sh against a real git remote (confirmed system user, install
  directory, ownership, and the systemd unit file all correct); the
  localStorage migration logic against all three real scenarios (fresh
  install, existing user with only the old key, and a user who already
  has both); and a full backup export/import round-trip confirming both
  the new format string and the legacy one are each accepted correctly.

## 1.13.2

- Added a LICENSE file (MIT) and a License section in the README.
  Without one, a public repo is legally "all rights reserved" by
  default -- visitors can view the code but have no actual right to
  use/copy/modify it, which matters now that this is going public.
- Verified (before recommending going public) that no gitignored
  secret file -- devices.json, .key, auth.json, groups.json,
  alerts.json, customCommands.json, .session-secret -- was ever
  committed at any point across the full history, and searched every
  commit's full diff for private-key headers or credential-shaped
  strings. Both checks came back clean.
- Backfilled annotated git tags for the entire version history
  (v1.1.0 through v1.13.1, 33 tags total) by matching each commit's
  exact message text rather than hash, since hashes differ between
  separately-made local commits even with identical content. Verified
  every single tag resolves to a commit whose message matches that
  version. (This was done as a one-time local script, not shipped as
  part of the project -- see chat for the exact tool and instructions
  to run the same backfill against your own local clone.)

## 1.13.1

- Baked the real GitHub username (wy2c73) into every "yourusername"
  placeholder across README.md, INSTALL.md, DOCKER.md,
  docker-compose.yml, and install.sh -- the one-liner, GITHUB_REPO
  examples, and GHCR image references are all real, working commands
  now instead of needing manual substitution first. Also removed
  install.sh's placeholder-detection check, since REPO_URL is now a
  real default rather than a generic placeholder to guard against.
  (linux/README.md's `/home/YOURUSERNAME` is intentionally left alone --
  that's a local machine username for whoever sets up the SSH handler
  script, unrelated to GitHub.)

## 1.13.0

- **One-line installer** (`install.sh`): handles installing git/Node.js
  20.x (via NodeSource, skipping if a recent-enough version is already
  present), clones this repo into `/opt/pi-fleet-dashboard`, creates a
  dedicated unprivileged system user, installs npm dependencies, and
  sets up + starts a systemd service, printing the LAN URL(s) at the
  end. Safe to re-run -- detects an existing install and updates it in
  place instead of starting over, so it's also the update mechanism.
  Passed a clean ShellCheck run with zero warnings.
  Actually ran this end-to-end in testing (fresh install and the
  update/re-run path both), which caught a real bug before it shipped:
  the original design cloned as root then `chown -R`'d the result to the
  service user afterward, but git refuses to operate on a repo owned by
  a different user than the one running it -- meaning every future
  "update" run (which did `sudo git pull` as root against a
  service-user-owned repo) would have failed with a "dubious ownership"
  error. Fixed by creating the service user first and cloning/pulling
  as that user from the start, matching how npm install already
  correctly ran. Confirmed the fix with a full fresh-install run followed
  by an actual re-run, verifying ownership was correct throughout and
  the update path completed without error. (The final systemd
  activation step can't be verified in this sandbox specifically --
  same "no real init system in a container" limitation hit throughout
  this project's testing -- but everything up to that point, including
  the exact bug this testing caught, is confirmed working.)

## 1.12.0

- **Native terminal launching, properly explained and fixed.** A website
  genuinely cannot launch a native app directly (deliberate browser
  security boundary) -- the only mechanism the web platform provides is
  a registered URL protocol handler, which has to be set up once per
  machine. Previously that only existed for PuTTY; "System default" (the
  actual `ssh://` link) had nothing to hand off to on a fresh Windows or
  Linux install, which is why it looked like it was "trying to open via
  http://" -- there was nothing registered at all.
  - **Windows**: new `windows/ssh-protocol-handler.vbs` +
    `register-ssh-protocol.reg` register `ssh://` to open Windows
    Terminal (falling back to Command Prompt) running the `ssh` client
    built into Windows 10/11 -- no PuTTY required unless you want it.
  - **Linux**: new `linux/` folder with a handler script + `.desktop`
    file + `xdg-mime` registration instructions, trying several common
    terminal emulators. Verified end-to-end in this repo's own testing --
    confirmed `xdg-mime` registration resolves correctly and the parsed
    `ssh user@host -p port` command comes out exactly right, using a
    logging stand-in in place of the real terminal launch (this sandbox
    has no display server to prove out a real GUI window opening, so
    that's as far as it verifies, but the actual resolution chain that
    matters -- URI to registered handler to correctly parsed command --
    is confirmed working).
- Fixed a real, separate bug while investigating this: the in-browser
  terminal could render as an empty black box (screenshot showed exactly
  this) even with a working connection. `fitAddon.fit()` was called in
  the same tick as unhiding the terminal modal, which can measure the
  container before the browser has actually applied its new layout,
  computing a 0-row/0-col terminal. Deferred it behind a double
  `requestAnimationFrame`, the standard reliable way to wait for a real
  layout+paint instead of guessing with a timeout.

## 1.11.1

- Fixed the device detail drawer getting cut off on vertically-short
  screens (reported on a widescreen laptop -- plenty of width, not much
  height -- where the same drawer rendered fine on a larger external
  monitor). This was the same underlying design flaw as the earlier
  mobile fixes (1.10.2/1.10.3), just triggered by a different dimension:
  the drawer kept its stat grid + tabs fixed and only scrolled the inner
  list, which depends on the fixed header always leaving "enough" room
  for the list -- true on a tall monitor, false on a short one (a 78vh
  modal on a short window just doesn't have much room left over after
  the header).
  Rather than add another one-off breakpoint, replaced the whole
  fixed-header design everywhere (all screen sizes, not just mobile) with
  one that can't have this failure mode at all: the entire drawer now
  scrolls as a single block, with the tab bar kept visible via
  `position: sticky` instead of a flex-height budget. Sticky positioning
  doesn't need to know the header's height in advance, so it can't run
  out of room regardless of viewport width or height. This also let me
  delete the separate mobile-only override from 1.10.2 entirely, since
  the universal version now covers that case too -- less code, and one
  fewer place for this exact bug to come back a third time.

## 1.11.0

- Added Start and Stop buttons alongside Restart on every service row.
  Backend already supported all three actions on the same endpoint (only
  Restart was wired up in the UI) -- this was purely a frontend change.
  Verified end-to-end against a real SSH server with scoped sudo: both
  new actions correctly reach `sudo systemctl start/stop` with proper
  authorization (confirmed by the response showing the actual systemctl
  error, not a sudo permission error -- this sandbox just doesn't have
  real systemd as PID 1 to fully execute against).
  Each action has its own confirmation dialog and toast message (Stop's
  confirmation specifically calls out that it may disrupt anything
  relying on that service). Column widths and the mobile stacked layout
  both rebalanced to fit three buttons instead of one.
- Updated README wording (feature list + quick actions setup) to
  reflect start/stop/restart -- the sudoers example already covered all
  three, just the prose was restart-only.

## 1.10.4

- Actually found and fixed the "*"/"dead" text bug flagged across the
  last two screenshots -- it was a real parsing bug in `listServices()`,
  not a rendering artifact as I'd guessed. Some systemd versions prefix
  a per-unit status bullet (`●`/`○`/etc.) before the unit name for
  certain states. The parsing regex captured that bullet as the service
  "name," which shifted every field after it by one position -- the real
  ACTIVE value landed where SUB should be (explaining why the status
  badge showed "inactive" instead of "dead"), and the real DESCRIPTION
  got a stray "dead"/"running" glued to its front (explaining the
  "dead auditd.service" text). Confirmed by reproducing the exact
  shifted output against the old regex, then verified the fix against
  the bug case, normal bullet-free lines (to confirm no regression), and
  a service name containing "@" (to confirm nothing gets falsely
  stripped from legitimate unit names).

## 1.10.3

- Fixed the Services tab requiring horizontal scroll on mobile (a third
  real screenshot showed the Restart button cut off, only a thin sliver
  visible at the right edge). Rather than keep tuning the horizontal-
  scroll min-width, converted the services table to a stacked layout on
  mobile using the standard CSS-only responsive-table technique: each
  service becomes its own full-width block (name, then status badge,
  then a full-width Restart button) instead of cramped table columns. No
  more horizontal scrolling needed for this list at all. Tap-to-sort by
  Name/Status is preserved as a compact header row above the stacked list
  rather than being removed.
- Worth being upfront about: that screenshot also showed some odd text
  (a "*" and "dead" appearing to merge into the service name) that I
  could not conclusively explain from the parsing logic alone -- tested
  the actual regex against realistic systemctl output and it parsed
  correctly, so this looked like a rendering artifact of the cramped
  table cells rather than a data bug, but I can't fully confirm that
  without seeing it rendered directly. The stacked layout should
  eliminate that whole category of cramped-rendering issue regardless;
  flagging it in case it's still visible after this update.

## 1.10.2

- Fixed detail-drawer tab content (Services/Ports/Actions) rendering as
  effectively empty on mobile -- reported via a second real screenshot
  showing the Ports tab's description text cut off with no port chips
  visible and the modal's own rounded corner right there, confirming it
  wasn't a scroll issue this time. Different root cause than 1.10.1: the
  drawer normally keeps stats/tabs fixed and scrolls only the inner list,
  which depends on the fixed header leaving enough height for the list.
  On a phone the stat grid is forced to 2 columns (5 rows for ~10 boxes)
  and can eat nearly all of the modal's 92vh on its own, squeezing the
  list's flex:1 share toward zero. Fixed by having the whole modal body
  scroll as one unit on mobile instead of trying to keep a fixed header
  with only the list scrolling -- avoids depending on the header ever
  leaving "enough" room, regardless of how tall the stat grid gets.

## 1.10.1

- Fixed the device detail drawer (and other modals) getting cut off at
  the bottom on mobile Safari with no way to scroll and see the rest --
  reported with a real screenshot on an iPhone, showing the Services tab
  filter bar as the last visible thing. Root cause: `.modal-backdrop` used
  `align-items: center` with no `overflow-y` set at all -- a well-known
  CSS trap where a centered flex child taller than its container becomes
  genuinely inaccessible (no scrollbar, no way to reach the overflow),
  independent of any mobile viewport-unit quirk. Fixed with the standard
  pattern: `overflow-y: auto` on the backdrop, and `margin: auto` on the
  modal itself instead of `align-items: center` -- centers when it fits,
  scrolls from the top when it doesn't. Also had to explicitly set
  `align-items: flex-start` on the backdrop (removing `center` without a
  replacement would have defaulted to `stretch`, which would have made
  every modal always render at full height regardless of how much content
  it actually had).

## 1.10.0

- **Mobile layout pass.** Found and fixed several real issues by auditing
  the CSS directly (couldn't get a real browser rendering in this
  sandbox to verify visually -- see note below):
  - The toolbar and bulk-action bar had no `flex-wrap`, so they'd overflow
    horizontally on narrow screens instead of wrapping.
  - The biggest one: the List View table (13 columns) and the Services
    table both used `table-layout: fixed; width: 100%` with no minimum
    width, so on a phone they'd squish every column into illegibility
    (e.g. a 3%-wide checkbox column) instead of actually triggering the
    horizontal scroll that was already set up on their containers. Fixed
    with a sensible `min-width` on each table so mobile now scrolls
    sideways with legible columns, same as desktop.
  - Modals now use nearly the full screen on narrow viewports instead of
    fixed desktop widths/heights, with a `dvh`-aware height for the
    terminal/detail drawers to avoid mobile browsers' collapsing address
    bar clipping content.
  - Settings threshold rows, the detail stat grid, and the bulk-bar's
    group-assign controls now stack instead of cramming into one line.
  - Slightly larger touch targets for buttons and selection checkboxes.
- **Caveat worth knowing**: I could not get an actual browser to render
  this at mobile viewport width in this environment (tried Puppeteer and
  a direct Chromium install; neither could complete here) to visually
  confirm these fixes. Everything above is based on direct CSS review,
  not a real screenshot -- if anything looks off on an actual phone,
  a screenshot would help fix it fast, the same way earlier LED/icon
  color bugs were only caught that way rather than through code review.

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
