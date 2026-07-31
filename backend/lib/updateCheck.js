// Checks whether a newer version is available by comparing the running
// package.json version against whatever's on the configured GitHub repo's
// main branch. This is informational only -- it never applies anything.
//
// Configure via the GITHUB_REPO env var, format "owner/repo". If unset,
// the check is simply disabled (returns configured: false) rather than
// erroring, since not everyone has pushed this to their own GitHub yet.

const CURRENT_VERSION = require('../package.json').version;
const GITHUB_REPO = process.env.GITHUB_REPO || '';
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // don't hit GitHub more than once an hour

let cache = { checkedAt: 0, latest: null, error: null };

function isNewer(latest, current) {
  const a = String(latest).split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(current).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

async function fetchLatestVersion() {
  const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/backend/package.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GitHub responded HTTP ${res.status} -- check GITHUB_REPO is correct and the repo/branch is public`);
  const data = await res.json();
  if (!data.version) throw new Error('package.json on that branch has no version field');
  return data.version;
}

async function checkForUpdate() {
  if (!GITHUB_REPO) {
    return { current: CURRENT_VERSION, latest: null, updateAvailable: false, configured: false };
  }

  if (Date.now() - cache.checkedAt < CHECK_INTERVAL_MS && (cache.latest || cache.error)) {
    return buildResult();
  }

  try {
    const latest = await fetchLatestVersion();
    cache = { checkedAt: Date.now(), latest, error: null };
  } catch (err) {
    cache = { checkedAt: Date.now(), latest: cache.latest, error: err.message };
  }
  return buildResult();
}

function buildResult() {
  return {
    current: CURRENT_VERSION,
    latest: cache.latest,
    updateAvailable: cache.latest ? isNewer(cache.latest, CURRENT_VERSION) : false,
    configured: true,
    repo: GITHUB_REPO,
    releaseNotesUrl: GITHUB_REPO ? `https://github.com/${GITHUB_REPO}/blob/main/CHANGELOG.md` : null,
    error: cache.error,
  };
}

module.exports = { checkForUpdate, isNewer };
