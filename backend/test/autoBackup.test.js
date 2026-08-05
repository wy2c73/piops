const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piops-autobackup-test-'));
process.env.PIOPS_DATA_DIR = tmpDir;
const autoBackup = require('../lib/autoBackup');
const store = require('../lib/store');

test('defaults: enabled, daily, keep 7', () => {
  const config = autoBackup.loadConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.intervalHours, 24);
  assert.equal(config.retentionCount, 7);
  assert.equal(config.lastBackupAt, null);
});

test('rejects invalid config values', () => {
  assert.throws(() => autoBackup.saveConfig({ intervalHours: 5 }), /24.*168|daily.*weekly/i);
  assert.throws(() => autoBackup.saveConfig({ retentionCount: 0 }));
  assert.throws(() => autoBackup.saveConfig({ retentionCount: 31 }));
});

test('takeBackup creates a file and updates lastBackupAt', () => {
  store.create({ name: 'Test', host: '127.0.0.1', port: 22, username: 'pi', authType: 'password', secret: 'x' });
  const result = autoBackup.takeBackup();
  assert.match(result.filename, /^auto-.+\.json$/);
  assert.equal(result.deviceCount, 1);
  assert.ok(autoBackup.loadConfig().lastBackupAt);
});

test('restoreBackup brings back a deleted device', () => {
  const { filename } = autoBackup.takeBackup();
  const before = store.list();
  for (const d of before) store.remove(d.id);
  assert.equal(store.list().length, 0);

  const result = autoBackup.restoreBackup(filename);
  assert.ok(result.imported >= 1);
  assert.ok(store.list().length >= 1);
});

test('restoreBackup rejects path traversal attempts', () => {
  assert.throws(() => autoBackup.restoreBackup('../../../etc/passwd'), /invalid/i);
  assert.throws(() => autoBackup.restoreBackup('auto-x.json/../../secrets'), /invalid/i);
  assert.throws(() => autoBackup.restoreBackup('not-even-close-to-valid'), /invalid/i);
});

test('restoreBackup rejects a nonexistent (but validly-named) file', () => {
  assert.throws(() => autoBackup.restoreBackup('auto-2000-01-01T00-00-00-000Z.json'), /not found/i);
});

test('retention: keeps only the newest N backups', async () => {
  autoBackup.saveConfig({ retentionCount: 3 });
  for (let i = 0; i < 5; i++) {
    autoBackup.takeBackup();
    await new Promise((r) => setTimeout(r, 15)); // ensure distinct timestamps/filenames
  }
  assert.equal(autoBackup.listBackups().length, 3);
});

test('scheduler: does nothing while disabled', () => {
  autoBackup.saveConfig({ enabled: false });
  const before = autoBackup.listBackups().length;
  autoBackup.maybeRunScheduledBackup();
  assert.equal(autoBackup.listBackups().length, before);
});

test('scheduler: backs up immediately if never backed up before, then waits for the next interval', () => {
  autoBackup.saveConfig({ enabled: true, lastBackupAt: null, retentionCount: 30 });
  const before = autoBackup.listBackups().length;
  autoBackup.maybeRunScheduledBackup();
  assert.equal(autoBackup.listBackups().length, before + 1);

  // Immediately after, nothing is due yet -- should not take another one.
  autoBackup.maybeRunScheduledBackup();
  assert.equal(autoBackup.listBackups().length, before + 1);
});
