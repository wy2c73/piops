const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piops-apitokens-test-'));
process.env.PIOPS_DATA_DIR = tmpDir;
const apiTokens = require('../lib/apiTokens');

test('createToken returns a usable plaintext token, once', () => {
  const result = apiTokens.createToken('Home Assistant');
  assert.equal(result.label, 'Home Assistant');
  assert.match(result.token, /^piops_[0-9a-f]{64}$/);
  assert.ok(result.id);
});

test('createToken rejects an empty or overlong label', () => {
  assert.throws(() => apiTokens.createToken(''), /label/i);
  assert.throws(() => apiTokens.createToken('   '), /label/i);
  assert.throws(() => apiTokens.createToken('x'.repeat(61)), /label/i);
});

test('verifyToken accepts a real token and rejects garbage', () => {
  const { token, id } = apiTokens.createToken('Grafana');
  assert.equal(apiTokens.verifyToken(token), id);
  assert.equal(apiTokens.verifyToken('piops_not-a-real-token'), null);
  assert.equal(apiTokens.verifyToken(''), null);
  assert.equal(apiTokens.verifyToken(undefined), null);
});

test('verifyToken records lastUsedAt', () => {
  const { token, id } = apiTokens.createToken('Uptime check');
  assert.equal(apiTokens.listTokens().find((t) => t.id === id).lastUsedAt, null);

  apiTokens.verifyToken(token);
  const after = apiTokens.listTokens().find((t) => t.id === id);
  assert.ok(after.lastUsedAt);
});

test('listTokens never includes the hash or the plaintext token', () => {
  apiTokens.createToken('Should not leak');
  const tokens = apiTokens.listTokens();
  for (const t of tokens) {
    assert.equal('tokenHash' in t, false);
    assert.equal('token' in t, false);
  }
});

test('revokeToken removes it, so it no longer verifies', () => {
  const { token, id } = apiTokens.createToken('Temporary');
  apiTokens.revokeToken(id);
  assert.equal(apiTokens.verifyToken(token), null);
  assert.equal(apiTokens.listTokens().some((t) => t.id === id), false);
});

test('revokeToken throws for an id that does not exist', () => {
  assert.throws(() => apiTokens.revokeToken('not-a-real-id'), /not found/i);
});

test('multiple tokens coexist independently', () => {
  const a = apiTokens.createToken('Token A');
  const b = apiTokens.createToken('Token B');
  assert.equal(apiTokens.verifyToken(a.token), a.id);
  assert.equal(apiTokens.verifyToken(b.token), b.id);

  apiTokens.revokeToken(a.id);
  assert.equal(apiTokens.verifyToken(a.token), null);
  assert.equal(apiTokens.verifyToken(b.token), b.id, 'revoking one token should not affect another');
});
