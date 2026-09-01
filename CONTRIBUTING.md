# Contributing to PiOps

Thanks for considering it. This is a solo-maintained personal project
that happens to be public, so keeping contributions lightweight and
low-friction matters more here than in a big open source project with
a formal process.

## Before writing code

For anything beyond a small fix (typo, one-line bug), open an issue
first describing what you want to change and why. Saves both of us
time if it turns out to be out of scope, already planned, or there's
a reason it works the way it does that isn't obvious from the outside.

## Project values, worth knowing before you dive in

- **Minimal footprint.** Production dependencies are `express`, `ws`,
  `ssh2`, `uuid`, `cors` -- that's it. A new dependency needs a real
  reason; if the standard library or ~20 lines of code can do it,
  that's preferred. Test-only tooling belongs in `devDependencies`
  (see `jsdom` for the pattern), never `dependencies`.
- **Agentless is a constraint, not a preference.** PiOps only ever
  connects *out* to devices over SSH -- nothing gets installed on a
  monitored Pi. PRs that require an agent on the monitored side won't
  be accepted, however useful the feature.
- **Honest documentation.** Limitations get stated plainly, including
  in the UI itself, not glossed over. See the automatic backups
  section in Settings for an example -- it says directly that they
  don't protect against a dead disk, right where someone would
  otherwise assume they do.
- **No new dependency for something small enough to write directly.**
  The login rate limiter, the session/auth system, and the SSH layer
  are all hand-rolled rather than pulled in from npm, on purpose.

## Setup

```bash
git clone https://github.com/wy2c73/piops.git
cd piops/backend
npm install
npm start
```

Opens on `http://localhost:3000`. You'll want at least one real
SSH-reachable device (a Pi, a VM, even `localhost` with SSH enabled) to
exercise anything beyond the empty-fleet state.

## Running tests

```bash
cd backend
npm test
```

Needs **Node 22.22.2 or newer** to run -- not because PiOps itself
needs it (the app runs fine on Node 18+, see the Dockerfile), but
because `jsdom` (a dev-only dependency, a couple of the settings-sync
and chart-building tests use it) requires it, and fails with a real
crash rather than just a warning on anything older. If `npm test`
dies immediately with an error inside `node_modules/undici`, this is
almost certainly why -- check `node --version` first.

See the "Running tests" section of the main README for what the suite
covers and, just as importantly, what it deliberately doesn't (real
SSH, real browser rendering).

**New logic needs a test.** Not full coverage of everything you touch,
but the actual new behavior -- a new route, a new bit of parsing, a new
edge case in existing logic. Look at an existing test file close to
what you're adding for the pattern (`test/routes.*.test.js` for HTTP
endpoints, plain `test/*.test.js` for pure logic).

If you're fixing a bug, a test that fails before your fix and passes
after it is the clearest possible evidence the fix actually works --
genuinely worth the extra few minutes even for a one-line change.

## Code style

No linter or formatter is enforced (no ESLint/Prettier config in the
repo) -- match the style of the file you're editing. A few things that
matter more than formatting:

- **Comments explain *why*, not *what*.** `// use encrypt() not
  encryptWithPassphrase() -- no user is present to type one in on a
  schedule` is useful. `// encrypt the bundle` is not.
- **Real error messages.** `res.status(400).json({ error: 'Passphrase
  must be at least 8 characters' })`, not `{ error: 'Invalid input' }`.
  Someone using this dashboard is going to read that message.
- **Backward-compatible by default.** Renamed a setting, a
  localStorage key, a backup format string? Keep reading the old one
  as a fallback (see `LEGACY_SETTINGS_KEY` in `app.js`, or the
  `pi-fleet-dashboard-backup` format string still accepted on import)
  rather than silently breaking existing installs on upgrade.

## Submitting a change

1. Fork, branch, make the change.
2. `npm test` passes.
3. Update `CHANGELOG.md` with a short entry describing what changed
   and, if it's not obvious, why. Look at recent entries for the tone
   -- specific and honest about trade-offs, not marketing copy.
4. Open a PR describing what changed and why. Screenshots/GIFs for
   anything UI-visible make review much faster.

Versioning, tagging releases, and publishing to GHCR are handled by
the maintainer -- no need to bump `package.json`'s version yourself.

## Reporting a bug

Include: what you did, what you expected, what actually happened, and
your setup (native install or Docker, OS, Node version if native).
For anything SSH-related, whether you can reach that device with a
plain `ssh user@host` from the machine running PiOps is usually the
first thing worth checking and mentioning.

## Security issues

Please don't open a public issue for anything that looks like a real
security vulnerability (auth bypass, credential exposure, command
injection, etc.) -- open a private security advisory on GitHub instead
(Security tab -> Report a vulnerability), or reach out to the
maintainer directly.
