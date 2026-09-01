// A simple in-memory rate limiter for the login endpoint -- the one
// place an attacker could brute-force a password with no prior
// authentication at all. Deliberately not a general-purpose npm
// package: this project stays dependency-light, and the actual logic
// needed here (count failures per IP, lock out after too many, reset
// on success) is small enough to just write directly.
//
// State lives in memory, not on disk -- a restart clearing it is a
// reasonable trade-off (this is a home dashboard, not a bank), and
// avoids extra file I/O on every login attempt.
//
// Caveat worth knowing: this keys on req.ip, which is the direct TCP
// peer address unless Express's "trust proxy" setting is configured.
// Running this behind a reverse proxy without that configured means
// every request appears to come from the proxy's own address, so
// everyone behind it would share one rate-limit bucket. That's a
// reverse-proxy configuration concern broader than this file; not
// addressed here.

let MAX_ATTEMPTS = 5;
let WINDOW_MS = 15 * 60 * 1000; // failures older than this no longer count
let LOCKOUT_MS = 15 * 60 * 1000; // how long a lockout lasts once triggered

const attempts = new Map(); // ip -> { count, firstAttemptAt, lockedUntil }

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// Call before verifying a password. Returns { allowed: true } or
// { allowed: false, retryAfterMs } if this IP is currently locked out.
function checkRateLimit(req) {
  const record = attempts.get(getClientIp(req));
  if (!record) return { allowed: true };

  if (record.lockedUntil) {
    if (Date.now() < record.lockedUntil) {
      return { allowed: false, retryAfterMs: record.lockedUntil - Date.now() };
    }
    // Lockout has expired -- clear it out rather than leaving a stale record.
    attempts.delete(getClientIp(req));
    return { allowed: true };
  }

  return { allowed: true };
}

// Call after a failed password check.
function recordFailure(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  const record = attempts.get(ip);

  if (!record || now - record.firstAttemptAt > WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAttemptAt: now, lockedUntil: null });
    return;
  }

  record.count++;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
  }
}

// Call after a successful login -- a real login shouldn't stay
// penalized for earlier mistakes (e.g. someone fat-fingering their own
// password a few times before getting it right).
function recordSuccess(req) {
  attempts.delete(getClientIp(req));
}

// Test-only: state is otherwise process-lifetime, which would leak
// between test cases run in the same file.
function _resetForTests() {
  attempts.clear();
}

// Test-only: swap in much shorter windows so tests can verify real
// time-based expiry without waiting out the real 15-minute values.
function _setTimingForTests({ maxAttempts, windowMs, lockoutMs } = {}) {
  if (maxAttempts !== undefined) MAX_ATTEMPTS = maxAttempts;
  if (windowMs !== undefined) WINDOW_MS = windowMs;
  if (lockoutMs !== undefined) LOCKOUT_MS = lockoutMs;
}

module.exports = {
  checkRateLimit, recordFailure, recordSuccess,
  _resetForTests, _setTimingForTests,
  get MAX_ATTEMPTS() { return MAX_ATTEMPTS; },
  get LOCKOUT_MS() { return LOCKOUT_MS; },
};
