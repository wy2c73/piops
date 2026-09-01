// Tokens for the read-only external API (routes/apiV1.js) -- deliberately
// separate from the dashboard's own password/session system (lib/auth.js).
// A leaked API token should only ever expose read access to device stats,
// never the ability to log into the dashboard itself or take actions.
//
// The token itself is high-entropy (32 random bytes), so unlike the
// dashboard password this doesn't need scrypt -- a plain SHA-256 hash is
// the standard, appropriate choice here (same reasoning most API-token
// systems use: brute-forcing a hash of a 256-bit random value is
// infeasible regardless of hash speed). Only the hash is ever stored --
// the plaintext token is shown once, at creation, and is not recoverable
// after that; losing it means generating a new one.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { DATA_DIR } = require('./dataDir');

const TOKENS_PATH = path.join(DATA_DIR, 'apiTokens.json');
const MAX_LABEL_LEN = 60;

function load() {
  if (!fs.existsSync(TOKENS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function save(tokens) {
  fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

function hashToken(plaintext) {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

// Returns { id, label, token, createdAt } -- `token` is the plaintext,
// shown to the caller exactly once. Everything else in this module only
// ever deals with the hash from this point on.
function createToken(label) {
  const trimmed = String(label || '').trim();
  if (!trimmed) throw new Error('A label is required');
  if (trimmed.length > MAX_LABEL_LEN) throw new Error(`Label must be ${MAX_LABEL_LEN} characters or fewer`);

  const token = `piops_${crypto.randomBytes(32).toString('hex')}`;
  const record = { id: uuidv4(), label: trimmed, tokenHash: hashToken(token), createdAt: new Date().toISOString(), lastUsedAt: null };

  const tokens = load();
  tokens.push(record);
  save(tokens);

  return { id: record.id, label: record.label, token, createdAt: record.createdAt };
}

// Safe to expose to the dashboard UI -- never includes tokenHash.
function listTokens() {
  return load().map(({ id, label, createdAt, lastUsedAt }) => ({ id, label, createdAt, lastUsedAt }));
}

function revokeToken(id) {
  const tokens = load();
  const filtered = tokens.filter((t) => t.id !== id);
  if (filtered.length === tokens.length) throw new Error('Token not found');
  save(filtered);
}

// Verifies a plaintext token from an incoming request. Returns the
// matching token's id if valid (and records it as used), or null.
function verifyToken(plaintext) {
  if (!plaintext) return null;
  const hash = hashToken(plaintext);
  const hashBuf = Buffer.from(hash, 'hex');
  const tokens = load();

  const match = tokens.find((t) => {
    const storedBuf = Buffer.from(t.tokenHash, 'hex');
    return storedBuf.length === hashBuf.length && crypto.timingSafeEqual(storedBuf, hashBuf);
  });
  if (!match) return null;

  match.lastUsedAt = new Date().toISOString();
  save(tokens);
  return match.id;
}

module.exports = { createToken, listTokens, revokeToken, verifyToken };
