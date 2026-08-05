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

test('POST /api/groups creates a group', async () => {
  const res = await fetch(`${baseUrl}/api/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Home Lab' }),
  });
  assert.equal(res.status, 201);
});

test('GET /api/groups lists it', async () => {
  const res = await fetch(`${baseUrl}/api/groups`);
  const groups = await res.json();
  assert.equal(groups.includes('Home Lab'), true);
});

test('POST /api/groups rejects an empty name', async () => {
  const res = await fetch(`${baseUrl}/api/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '   ' }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/groups rejects a name over 60 characters', async () => {
  const res = await fetch(`${baseUrl}/api/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x'.repeat(61) }),
  });
  assert.equal(res.status, 400);
});

test('DELETE /api/groups/:name removes it', async () => {
  await fetch(`${baseUrl}/api/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Temp Group' }),
  });
  const delRes = await fetch(`${baseUrl}/api/groups/${encodeURIComponent('Temp Group')}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);

  const listRes = await fetch(`${baseUrl}/api/groups`);
  const groups = await listRes.json();
  assert.equal(groups.includes('Temp Group'), false);
});
