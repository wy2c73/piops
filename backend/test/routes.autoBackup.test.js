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

test('GET /api/backup/auto returns config and an empty backup list initially', async () => {
  const res = await fetch(`${baseUrl}/api/backup/auto`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.config.enabled, true);
  assert.deepEqual(body.backups, []);
});

test('PUT /api/backup/auto/config rejects an invalid interval', async () => {
  const res = await fetch(`${baseUrl}/api/backup/auto/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intervalHours: 3 }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/backup/auto/run-now takes a real backup, visible in the list', async () => {
  await fetch(`${baseUrl}/api/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Auto Test Pi', host: '127.0.0.1', port: 54330, username: 'pi', authType: 'password', secret: 'x' }),
  });

  const runRes = await fetch(`${baseUrl}/api/backup/auto/run-now`, { method: 'POST' });
  assert.equal(runRes.status, 200);
  const { filename } = await runRes.json();
  assert.match(filename, /^auto-.+\.json$/);

  const listRes = await fetch(`${baseUrl}/api/backup/auto`);
  const { backups } = await listRes.json();
  assert.ok(backups.some((b) => b.filename === filename));
});

test('POST /api/backup/auto/:filename/restore restores a deleted device', async () => {
  const runRes = await fetch(`${baseUrl}/api/backup/auto/run-now`, { method: 'POST' });
  const { filename } = await runRes.json();

  const listRes = await fetch(`${baseUrl}/api/devices`);
  const devices = await listRes.json();
  for (const d of devices) {
    await fetch(`${baseUrl}/api/devices/${d.id}`, { method: 'DELETE' });
  }
  assert.equal((await (await fetch(`${baseUrl}/api/devices`)).json()).length, 0);

  const restoreRes = await fetch(`${baseUrl}/api/backup/auto/${filename}/restore`, { method: 'POST' });
  assert.equal(restoreRes.status, 200);
  const result = await restoreRes.json();
  assert.ok(result.imported >= 1);
});

test('POST /api/backup/auto/:filename/restore rejects a path-traversal filename', async () => {
  const res = await fetch(`${baseUrl}/api/backup/auto/${encodeURIComponent('../../etc/passwd')}/restore`, { method: 'POST' });
  assert.equal(res.status, 400);
});
