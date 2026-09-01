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

test('GET /api/tokens starts empty', async () => {
  const res = await fetch(`${baseUrl}/api/tokens`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test('POST /api/tokens creates a token, returned once, never leaked via GET afterward', async () => {
  const createRes = await fetch(`${baseUrl}/api/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'Home Assistant' }),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  assert.match(created.token, /^piops_[0-9a-f]{64}$/);

  const listRes = await fetch(`${baseUrl}/api/tokens`);
  const list = await listRes.json();
  assert.equal(list.length, 1);
  assert.equal(list[0].label, 'Home Assistant');
  assert.equal('token' in list[0], false);
  assert.equal('tokenHash' in list[0], false);
});

test('POST /api/tokens rejects a missing label', async () => {
  const res = await fetch(`${baseUrl}/api/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test('DELETE /api/tokens/:id revokes it', async () => {
  const createRes = await fetch(`${baseUrl}/api/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'Temporary' }),
  });
  const { id } = await createRes.json();

  const delRes = await fetch(`${baseUrl}/api/tokens/${id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 204);

  const list = await (await fetch(`${baseUrl}/api/tokens`)).json();
  assert.equal(list.some((t) => t.id === id), false);
});

test('DELETE /api/tokens/:id for an unknown id returns 404', async () => {
  const res = await fetch(`${baseUrl}/api/tokens/not-a-real-id`, { method: 'DELETE' });
  assert.equal(res.status, 404);
});
