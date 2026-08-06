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

test('GET /api/settings returns defaults and reports never having been saved', async () => {
  const res = await fetch(`${baseUrl}/api/settings`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.everSaved, false);
  assert.equal(body.settings.theme, 'dark');
  assert.equal(body.settings.viewMode, 'grid');
  assert.deepEqual(body.settings.order, []);
});

test('PUT /api/settings saves a partial update and everSaved becomes true', async () => {
  const putRes = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme: 'light' }),
  });
  assert.equal(putRes.status, 200);

  const getRes = await fetch(`${baseUrl}/api/settings`);
  const body = await getRes.json();
  assert.equal(body.everSaved, true);
  assert.equal(body.settings.theme, 'light');
  // Untouched fields should still be at their defaults, not wiped out.
  assert.equal(body.settings.unitSystem, 'metric');
});

test('PUT /api/settings merges rather than replaces the whole object', async () => {
  await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unitSystem: 'imperial' }),
  });
  const res = await fetch(`${baseUrl}/api/settings`);
  const body = await res.json();
  // theme=light was set by the previous test; this update only touched
  // unitSystem, so theme must still be light, not reset to the default.
  assert.equal(body.settings.theme, 'light');
  assert.equal(body.settings.unitSystem, 'imperial');
});

test('PUT /api/settings can save card order', async () => {
  await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order: ['device-a', 'device-b', 'device-c'] }),
  });
  const res = await fetch(`${baseUrl}/api/settings`);
  const body = await res.json();
  assert.deepEqual(body.settings.order, ['device-a', 'device-b', 'device-c']);
});
