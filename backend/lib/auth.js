// A simple single-password gate for the whole dashboard -- not a user
// system. One shared password, one session type. Meant to keep this off
// casual/unintended access on a home LAN, not to secure an internet-facing
// deployment on its own.
//
// Off by default (existing installs aren't suddenly locked out on
// upgrade). Enable it in Settings -> Security.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUTH_PATH = path.join(__dirname, '..', 'data', 'auth.json');
const SESSION_SECRET_PATH = path.join(__dirname, '..', 'data', '.session-secret');
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days -- personal tool, not re-prompting constantly

function loadOrCreateSessionSecret() {
  if (fs.existsSync(SESSION_SECRET_PATH)) return fs.readFileSync(SESSION_SECRET_PATH);
  const secret = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(SESSION_SECRET_PATH), { recursive: true });
  fs.writeFileSync(SESSION_SECRET_PATH, secret, { mode: 0o600 });
  return secret;
}
const SESSION_SECRET = loadOrCreateSessionSecret();

function loadAuthConfig() {
  if (!fs.existsSync(AUTH_PATH)) return { enabled: false, passwordSalt: null, passwordHash: null };
  try {
    return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  } catch {
    return { enabled: false, passwordSalt: null, passwordHash: null };
  }
}

function saveAuthConfig(config) {
  fs.mkdirSync(path.dirname(AUTH_PATH), { recursive: true });
  fs.writeFileSync(AUTH_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return { passwordSalt: salt.toString('hex'), passwordHash: hash.toString('hex') };
}

function verifyPassword(password, config) {
  if (!config.passwordHash || !config.passwordSalt) return false;
  const testHash = crypto.scryptSync(password || '', Buffer.from(config.passwordSalt, 'hex'), 64);
  const storedHash = Buffer.from(config.passwordHash, 'hex');
  if (testHash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(testHash, storedHash);
}

function setPassword(password) {
  const config = { enabled: true, ...hashPassword(password) };
  saveAuthConfig(config);
  return config;
}

function disable() {
  const config = { enabled: false, passwordSalt: null, passwordHash: null };
  saveAuthConfig(config);
  return config;
}

// Stateless, HMAC-signed session tokens rather than server-side session
// storage -- so a restart (e.g. after an update) doesn't force everyone
// to log in again.
function createSessionToken() {
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  const payload = String(expiresAt);
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`, 'utf8').toString('base64url');
}

function verifySessionToken(token) {
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const dotIdx = decoded.lastIndexOf('.');
    if (dotIdx === -1) return false;
    const payload = decoded.slice(0, dotIdx);
    const sig = decoded.slice(dotIdx + 1);
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return false;
    return Date.now() < Number(payload);
  } catch {
    return false;
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function sessionCookieHeader(token) {
  const maxAge = Math.floor(SESSION_MAX_AGE_MS / 1000);
  return `session=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function clearCookieHeader() {
  return 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax';
}

function isAuthenticated(req) {
  const config = loadAuthConfig();
  if (!config.enabled) return true;
  return verifySessionToken(getCookie(req, 'session'));
}

module.exports = {
  loadAuthConfig, saveAuthConfig, verifyPassword, setPassword, disable,
  createSessionToken, verifySessionToken, getCookie, isAuthenticated,
  sessionCookieHeader, clearCookieHeader, SESSION_MAX_AGE_MS,
};
