const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestServer } = require('./helpers');
const rateLimit = require('../lib/loginRateLimit');

let baseUrl, close;

before(async () => {
  ({ baseUrl, close } = await setupTestServer());
  await fetch(`${baseUrl}/api/auth/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'setPassword', newPassword: 'correct-horse-battery' }),
  });
});

after(async () => {
  await close();
});

beforeEach(() => {
  rateLimit._resetForTests();
  rateLimit._setTimingForTests({ maxAttempts: 5, windowMs: 15 * 60 * 1000, lockoutMs: 15 * 60 * 1000 });
});

test('failed logins under the limit return 401, not 429', async () => {
  for (let i = 0; i < rateLimit.MAX_ATTEMPTS - 1; i++) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    assert.equal(res.status, 401);
  }
});

test('exceeding the limit returns 429 with a Retry-After header, even with the correct password', async () => {
  for (let i = 0; i < rateLimit.MAX_ATTEMPTS; i++) {
    await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
  }

  const lockedRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' }),
  });
  assert.equal(lockedRes.status, 429);
  assert.ok(lockedRes.headers.get('retry-after'));

  // Even the *correct* password should be blocked while locked out --
  // otherwise the limiter is trivially bypassed by anyone who happens
  // to know the real password, which defeats checking it before
  // verifying credentials at all.
  const correctButLockedRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'correct-horse-battery' }),
  });
  assert.equal(correctButLockedRes.status, 429);
});

test('a successful login resets the count, so later mistakes do not immediately lock out', async () => {
  for (let i = 0; i < rateLimit.MAX_ATTEMPTS - 1; i++) {
    await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
  }

  const successRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'correct-horse-battery' }),
  });
  assert.equal(successRes.status, 200);

  // Should behave like a fresh start now, not one mistake from lockout.
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' }),
  });
  assert.equal(res.status, 401);
});
