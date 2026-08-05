const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// auth.js resolves its data directory (and generates a session secret
// file) the moment it's first required, so the override has to be set
// before that happens.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piops-auth-test-'));
process.env.PIOPS_DATA_DIR = tmpDir;
const auth = require('../lib/auth');

test('disabled by default with no configuration', () => {
  const config = auth.loadAuthConfig();
  assert.equal(config.enabled, false);
  assert.equal(auth.isAuthenticated({ headers: {} }), true);
});

test('password set/verify round-trip', () => {
  const config = auth.setPassword('correct-horse-battery');
  assert.equal(config.enabled, true);
  assert.equal(auth.verifyPassword('correct-horse-battery', config), true);
  assert.equal(auth.verifyPassword('wrong-password', config), false);
  assert.equal(auth.verifyPassword('', config), false);
});

test('session tokens: valid, garbage, empty, and tampered', () => {
  const token = auth.createSessionToken();
  assert.equal(auth.verifySessionToken(token), true);
  assert.equal(auth.verifySessionToken('garbage-not-a-real-token'), false);
  assert.equal(auth.verifySessionToken(''), false);
  assert.equal(auth.verifySessionToken(token.slice(0, -2) + 'xx'), false);
});

test('isAuthenticated: gates correctly once enabled, using a real cookie', () => {
  auth.setPassword('correct-horse-battery');
  const token = auth.createSessionToken();
  assert.equal(auth.isAuthenticated({ headers: { cookie: `session=${token}` } }), true);
  assert.equal(auth.isAuthenticated({ headers: {} }), false);
  assert.equal(auth.isAuthenticated({ headers: { cookie: 'session=nonsense' } }), false);
});

test('disable() removes the gate', () => {
  auth.setPassword('correct-horse-battery');
  auth.disable();
  assert.equal(auth.isAuthenticated({ headers: {} }), true);
  assert.equal(auth.loadAuthConfig().enabled, false);
});
