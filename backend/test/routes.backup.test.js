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

test('POST /api/backup/export rejects a too-short passphrase', async () => {
  const res = await fetch(`${baseUrl}/api/backup/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase: 'short' }),
  });
  assert.equal(res.status, 400);
});

test('export produces the current format string', async () => {
  const res = await fetch(`${baseUrl}/api/backup/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase: 'testpass123' }),
  });
  const backup = await res.json();
  assert.equal(backup.format, 'piops-backup');
  assert.ok(backup.salt && backup.iv && backup.tag && backup.data);
});

test('export -> import round trip: new device gets created, re-importing skips it', async () => {
  await fetch(`${baseUrl}/api/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Roundtrip Pi', host: '127.0.0.1', port: 54323, username: 'pi', authType: 'password', secret: 'x' }),
  });

  const exportRes = await fetch(`${baseUrl}/api/backup/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase: 'testpass123' }),
  });
  const backup = await exportRes.json();

  // Delete the device locally, then restore it from the backup we just took.
  const listRes = await fetch(`${baseUrl}/api/devices`);
  const devices = await listRes.json();
  const device = devices.find((d) => d.name === 'Roundtrip Pi');
  await fetch(`${baseUrl}/api/devices/${device.id}`, { method: 'DELETE' });

  const import1 = await fetch(`${baseUrl}/api/backup/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase: 'testpass123', file: backup }),
  });
  const result1 = await import1.json();
  assert.equal(result1.imported, 1);

  // Importing the exact same file again should skip everything (all
  // devices already present, matched by host:port:username) rather than
  // creating duplicates.
  const import2 = await fetch(`${baseUrl}/api/backup/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase: 'testpass123', file: backup }),
  });
  const result2 = await import2.json();
  assert.equal(result2.imported, 0);
  assert.ok(result2.skipped >= 1);
});

test('import rejects the wrong passphrase', async () => {
  const exportRes = await fetch(`${baseUrl}/api/backup/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase: 'testpass123' }),
  });
  const backup = await exportRes.json();

  const res = await fetch(`${baseUrl}/api/backup/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase: 'wrong-passphrase', file: backup }),
  });
  assert.equal(res.status, 400);
});

test('import accepts the legacy pre-rename format string', async () => {
  // A real, validly-encrypted backup -- just with the format field
  // rewritten to what backups exported before the PiOps rename actually
  // said. This is exactly the compatibility path added during the rename,
  // and it's the kind of thing that's easy to silently break later
  // without a test guarding it.
  const exportRes = await fetch(`${baseUrl}/api/backup/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase: 'testpass123' }),
  });
  const backup = await exportRes.json();
  const legacyBackup = { ...backup, format: 'pi-fleet-dashboard-backup' };

  const res = await fetch(`${baseUrl}/api/backup/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase: 'testpass123', file: legacyBackup }),
  });
  assert.equal(res.status, 200);
  const result = await res.json();
  assert.ok('imported' in result);
});

test('import rejects a file with an unrecognized format string', async () => {
  const exportRes = await fetch(`${baseUrl}/api/backup/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase: 'testpass123' }),
  });
  const backup = await exportRes.json();
  const bogusBackup = { ...backup, format: 'some-other-apps-backup' };

  const res = await fetch(`${baseUrl}/api/backup/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase: 'testpass123', file: bogusBackup }),
  });
  assert.equal(res.status, 400);
});
