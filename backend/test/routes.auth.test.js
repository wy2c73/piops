const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestServer } = require('./helpers');

let baseUrl, close;

before(async () => {
  ({ baseUrl, close } = await setupTestServer());
});

after(async () => {
  await close();
});

function getCookie(res) {
  const raw = res.headers.get('set-cookie') || '';
  const match = raw.match(/session=[^;]+/);
  return match ? match[0] : null;
}

test('disabled by default: API works with no session', async () => {
  const res = await fetch(`${baseUrl}/api/devices`);
  assert.equal(res.status, 200);
  const status = await (await fetch(`${baseUrl}/api/auth/status`)).json();
  assert.equal(status.enabled, false);
});

test('enabling requires no prior password, then gates API access', async () => {
  const enableRes = await fetch(`${baseUrl}/api/auth/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'setPassword', newPassword: 'correct-horse-battery' }),
  });
  assert.equal(enableRes.status, 200);

  // No session cookie -- should now be locked out.
  const blockedRes = await fetch(`${baseUrl}/api/devices`);
  assert.equal(blockedRes.status, 401);
});

test('wrong password is rejected, correct password grants a working session', async () => {
  const wrongRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' }),
  });
  assert.equal(wrongRes.status, 401);

  const rightRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'correct-horse-battery' }),
  });
  assert.equal(rightRes.status, 200);
  const cookie = getCookie(rightRes);
  assert.ok(cookie, 'login should set a session cookie');

  const authedRes = await fetch(`${baseUrl}/api/devices`, { headers: { cookie } });
  assert.equal(authedRes.status, 200);
});

test('login.html and static assets stay reachable without a session even when enabled', async () => {
  const res = await fetch(`${baseUrl}/login.html`);
  assert.equal(res.status, 200);
});

test('disabling requires the current password', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'correct-horse-battery' }),
  });
  const cookie = getCookie(loginRes);

  const wrongDisable = await fetch(`${baseUrl}/api/auth/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ action: 'disable', currentPassword: 'wrong' }),
  });
  assert.equal(wrongDisable.status, 401);

  const rightDisable = await fetch(`${baseUrl}/api/auth/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ action: 'disable', currentPassword: 'correct-horse-battery' }),
  });
  assert.equal(rightDisable.status, 200);

  // Gate should be open again now, no session needed.
  const res = await fetch(`${baseUrl}/api/devices`);
  assert.equal(res.status, 200);
});
