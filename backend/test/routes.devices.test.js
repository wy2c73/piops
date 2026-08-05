const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestServer } = require('./helpers');

// Creating/updating a device fires a non-blocking background connection
// check (poller.refreshDevice) so the UI shows fresh stats without
// waiting for the next poll cycle -- expected, harmless "stats
// collection failed" noise on stderr below is that check failing
// against these fake test IPs, not a real problem.

let baseUrl, close;

before(async () => {
  ({ baseUrl, close } = await setupTestServer());
});

after(async () => {
  await close();
});

test('POST /api/devices creates a device and never returns the secret', async () => {
  const res = await fetch(`${baseUrl}/api/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Pi', host: '127.0.0.1', port: 54321, username: 'pi', authType: 'password', secret: 'hunter2' }),
  });
  assert.equal(res.status, 201);
  const device = await res.json();
  assert.equal(device.name, 'Test Pi');
  assert.equal(device.host, '127.0.0.1');
  assert.equal('secret' in device, false, 'the plaintext secret must never come back in the response');
});

test('GET /api/devices lists what was created', async () => {
  const res = await fetch(`${baseUrl}/api/devices`);
  assert.equal(res.status, 200);
  const devices = await res.json();
  assert.equal(Array.isArray(devices), true);
  assert.equal(devices.some((d) => d.name === 'Test Pi'), true);
});

test('POST /api/devices rejects a missing required field', async () => {
  const res = await fetch(`${baseUrl}/api/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'No Host Device', port: 22, username: 'pi', authType: 'password', secret: 'x' }),
  });
  assert.equal(res.status, 400);
});

test('DELETE /api/devices/:id removes it', async () => {
  const createRes = await fetch(`${baseUrl}/api/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Temp Device', host: '127.0.0.1', port: 54322, username: 'pi', authType: 'password', secret: 'x' }),
  });
  const created = await createRes.json();

  const delRes = await fetch(`${baseUrl}/api/devices/${created.id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 204);

  const listRes = await fetch(`${baseUrl}/api/devices`);
  const devices = await listRes.json();
  assert.equal(devices.some((d) => d.id === created.id), false);
});
