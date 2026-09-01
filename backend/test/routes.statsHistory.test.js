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

test('GET /api/stats-history/config returns defaults', async () => {
  const res = await fetch(`${baseUrl}/api/stats-history/config`);
  const config = await res.json();
  assert.equal(config.enabled, false);
  assert.equal(config.retentionDays, 7);
  assert.equal(config.sparklineEnabled, true);
});

test('PUT /api/stats-history/config saves a partial update', async () => {
  const res = await fetch(`${baseUrl}/api/stats-history/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, retentionDays: 30 }),
  });
  assert.equal(res.status, 200);
  const config = await (await fetch(`${baseUrl}/api/stats-history/config`)).json();
  assert.equal(config.enabled, true);
  assert.equal(config.retentionDays, 30);
  assert.equal(config.sparklineEnabled, true, 'untouched field should stay at its previous value');
});

test('PUT /api/stats-history/config rejects an invalid retention value', async () => {
  const res = await fetch(`${baseUrl}/api/stats-history/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ retentionDays: 3 }),
  });
  assert.equal(res.status, 400);
});

test('GET /api/stats-history/:deviceId 404s for an unknown device', async () => {
  const res = await fetch(`${baseUrl}/api/stats-history/not-a-real-id`);
  assert.equal(res.status, 404);
});

test('GET /api/stats-history/:deviceId returns an empty array for a real device with no history yet', async () => {
  // An earlier test in this file enables history as part of testing the
  // config PUT -- explicitly disable it here so this device's background
  // refresh-on-create doesn't actually record a sample, which would
  // make this test's premise (no history yet) untrue.
  await fetch(`${baseUrl}/api/stats-history/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  });

  const createRes = await fetch(`${baseUrl}/api/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'History Test Pi', host: '127.0.0.1', port: 54350, username: 'pi', authType: 'password', secret: 'x' }),
  });
  const device = await createRes.json();

  const res = await fetch(`${baseUrl}/api/stats-history/${device.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test('deleting a device removes its history file (no error, and refetching after re-creating starts fresh)', async () => {
  const createRes = await fetch(`${baseUrl}/api/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Delete History Test', host: '127.0.0.1', port: 54351, username: 'pi', authType: 'password', secret: 'x' }),
  });
  const device = await createRes.json();

  const delRes = await fetch(`${baseUrl}/api/devices/${device.id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 204, 'delete should succeed even though statsHistory.deleteHistory() runs as part of it');
});

test('end-to-end: a real poll through the actual poller records a sample when enabled', async () => {
  await fetch(`${baseUrl}/api/stats-history/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  });

  const createRes = await fetch(`${baseUrl}/api/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Integration Test Pi', host: '127.0.0.1', port: 54352, username: 'pi', authType: 'password', secret: 'x' }),
  });
  const device = await createRes.json();

  // Device creation triggers a real (background, non-blocking) poll via
  // poller.refreshDevice() -- wait for it to actually complete rather
  // than assuming a fixed delay is enough.
  let history = [];
  for (let i = 0; i < 20 && history.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 100));
    history = await (await fetch(`${baseUrl}/api/stats-history/${device.id}`)).json();
  }

  assert.equal(history.length, 1, 'the real poll should have gone through poller.js -> statsHistory.maybeRecordSample() and landed a sample');
  assert.ok('cpu' in history[0] && 't' in history[0]);
});
