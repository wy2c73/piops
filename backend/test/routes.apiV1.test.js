const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestServer } = require('./helpers');

let baseUrl, close, token;

before(async () => {
  ({ baseUrl, close } = await setupTestServer());
  const res = await fetch(`${baseUrl}/api/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'Test token' }),
  });
  ({ token } = await res.json());
});

after(async () => {
  await close();
});

test('rejects a request with no token at all', async () => {
  const res = await fetch(`${baseUrl}/api/v1/devices`);
  assert.equal(res.status, 401);
});

test('rejects a garbage/invalid token', async () => {
  const res = await fetch(`${baseUrl}/api/v1/devices`, { headers: { Authorization: 'Bearer not-a-real-token' } });
  assert.equal(res.status, 401);
});

test('rejects a malformed Authorization header (missing "Bearer ")', async () => {
  const res = await fetch(`${baseUrl}/api/v1/devices`, { headers: { Authorization: token } });
  assert.equal(res.status, 401);
});

test('GET /api/v1/devices with a valid token returns the device list, with no secrets', async () => {
  await fetch(`${baseUrl}/api/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'API Test Pi', host: '127.0.0.1', port: 54340, username: 'pi', authType: 'password', secret: 'hunter2' }),
  });

  const res = await fetch(`${baseUrl}/api/v1/devices`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const devices = await res.json();
  const device = devices.find((d) => d.name === 'API Test Pi');
  assert.ok(device);
  assert.equal('secret' in device, false);
  assert.equal('passphrase' in device, false);
  assert.equal('username' in device, false, 'username is deliberately excluded from the external API');
  assert.ok('status' in device);
});

test('GET /api/v1/devices/:id returns a single device, 404 for an unknown id', async () => {
  const listRes = await fetch(`${baseUrl}/api/v1/devices`, { headers: { Authorization: `Bearer ${token}` } });
  const [first] = await listRes.json();

  const res = await fetch(`${baseUrl}/api/v1/devices/${first.id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).id, first.id);

  const notFoundRes = await fetch(`${baseUrl}/api/v1/devices/not-a-real-id`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(notFoundRes.status, 404);
});

test('GET /api/v1/summary returns fleet counts', async () => {
  const res = await fetch(`${baseUrl}/api/v1/summary`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const summary = await res.json();
  assert.ok(typeof summary.deviceCount === 'number');
  assert.ok(typeof summary.online === 'number');
  assert.ok(typeof summary.offline === 'number');
});

test('a revoked token stops working immediately', async () => {
  const createRes = await fetch(`${baseUrl}/api/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'About to revoke' }),
  });
  const revocable = await createRes.json();

  const workingRes = await fetch(`${baseUrl}/api/v1/summary`, { headers: { Authorization: `Bearer ${revocable.token}` } });
  assert.equal(workingRes.status, 200);

  await fetch(`${baseUrl}/api/tokens/${revocable.id}`, { method: 'DELETE' });

  const afterRevokeRes = await fetch(`${baseUrl}/api/v1/summary`, { headers: { Authorization: `Bearer ${revocable.token}` } });
  assert.equal(afterRevokeRes.status, 401);
});

test('a valid API token works even when the dashboard password gate is enabled', async () => {
  await fetch(`${baseUrl}/api/auth/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'setPassword', newPassword: 'correct-horse-battery' }),
  });

  try {
    // No session cookie at all -- the dashboard's own /api/devices should
    // now be locked out...
    const dashboardRes = await fetch(`${baseUrl}/api/devices`);
    assert.equal(dashboardRes.status, 401, 'sanity check: the password gate should actually be active now');

    // ...but the token-authenticated read API should be entirely
    // unaffected, since it doesn't rely on the session gate at all.
    const apiRes = await fetch(`${baseUrl}/api/v1/summary`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(apiRes.status, 200);
  } finally {
    await fetch(`${baseUrl}/api/auth/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disable', currentPassword: 'correct-horse-battery' }),
    });
  }
});
