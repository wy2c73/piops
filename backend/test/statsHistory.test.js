const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'piops-statshistory-test-'));
process.env.PIOPS_DATA_DIR = tmpDir;
const statsHistory = require('../lib/statsHistory');

beforeEach(() => {
  statsHistory._setSampleIntervalForTests(5 * 60 * 1000);
});

test('defaults: off, 7-day retention, sparkline on', () => {
  const config = statsHistory.loadConfig();
  assert.equal(config.enabled, false);
  assert.equal(config.retentionDays, 7);
  assert.equal(config.sparklineEnabled, true);
});

test('saveConfig rejects an invalid retention value', () => {
  assert.throws(() => statsHistory.saveConfig({ retentionDays: 3 }), /1, 7, or 30/);
});

test('maybeRecordSample does nothing while disabled', () => {
  statsHistory.saveConfig({ enabled: false });
  statsHistory.maybeRecordSample('device-a', { cpuUsedPct: 50 });
  assert.deepEqual(statsHistory.getHistory('device-a'), []);
});

test('maybeRecordSample records a sample once enabled', () => {
  statsHistory.saveConfig({ enabled: true });
  statsHistory.maybeRecordSample('device-b', { cpuUsedPct: 42, memory: { usedPct: 30 }, disk: { usedPct: 20 }, tempC: 45.5 });

  const history = statsHistory.getHistory('device-b');
  assert.equal(history.length, 1);
  assert.equal(history[0].cpu, 42);
  assert.equal(history[0].mem, 30);
  assert.equal(history[0].disk, 20);
  assert.equal(history[0].temp, 45.5);
  assert.ok(history[0].t);
});

test('downsamples: a second poll immediately after does not add another sample', () => {
  statsHistory.saveConfig({ enabled: true });
  statsHistory.maybeRecordSample('device-c', { cpuUsedPct: 10 });
  statsHistory.maybeRecordSample('device-c', { cpuUsedPct: 90 }); // called again right away
  assert.equal(statsHistory.getHistory('device-c').length, 1, 'should not have recorded a second sample yet');
});

test('records a new sample once the sample interval has actually passed', async () => {
  statsHistory._setSampleIntervalForTests(50);
  statsHistory.saveConfig({ enabled: true });
  statsHistory.maybeRecordSample('device-d', { cpuUsedPct: 10 });
  await new Promise((r) => setTimeout(r, 80));
  statsHistory.maybeRecordSample('device-d', { cpuUsedPct: 20 });
  assert.equal(statsHistory.getHistory('device-d').length, 2);
});

test('handles a missing/null stat gracefully (device offline, no readings)', () => {
  statsHistory.saveConfig({ enabled: true });
  statsHistory.maybeRecordSample('device-e', { status: 'offline', cpuUsedPct: null, memory: null, disk: null, tempC: null });
  const history = statsHistory.getHistory('device-e');
  assert.equal(history.length, 1);
  assert.equal(history[0].cpu, null);
  assert.equal(history[0].mem, null);
});

test('retention: samples older than the retention window get pruned on the next write', async () => {
  statsHistory._setSampleIntervalForTests(10);
  statsHistory.saveConfig({ enabled: true, retentionDays: 1 });

  // Manually seed one very old sample (older than 1 day), bypassing the
  // normal recording path, to test pruning without waiting a real day.
  const oldSample = { t: Date.now() - 2 * 24 * 60 * 60 * 1000, cpu: 1, mem: 1, disk: 1, temp: 1 };
  fs.mkdirSync(path.join(tmpDir, 'stats-history'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'stats-history', 'device-f.json'), JSON.stringify([oldSample]));

  // The next recorded sample should trigger pruning of that old one.
  await new Promise((r) => setTimeout(r, 20));
  statsHistory.maybeRecordSample('device-f', { cpuUsedPct: 99 });

  const history = statsHistory.getHistory('device-f');
  assert.equal(history.length, 1, 'the old sample should have been pruned, leaving only the new one');
  assert.equal(history[0].cpu, 99);
});

test('deleteHistory removes a device\'s file without throwing for one that never existed', () => {
  statsHistory.saveConfig({ enabled: true });
  statsHistory.maybeRecordSample('device-g', { cpuUsedPct: 5 });
  assert.equal(statsHistory.getHistory('device-g').length, 1);

  statsHistory.deleteHistory('device-g');
  assert.deepEqual(statsHistory.getHistory('device-g'), []);

  assert.doesNotThrow(() => statsHistory.deleteHistory('never-existed'));
});

test('devices have independent history', () => {
  statsHistory.saveConfig({ enabled: true });
  statsHistory.maybeRecordSample('device-h1', { cpuUsedPct: 1 });
  statsHistory.maybeRecordSample('device-h2', { cpuUsedPct: 2 });
  assert.equal(statsHistory.getHistory('device-h1')[0].cpu, 1);
  assert.equal(statsHistory.getHistory('device-h2')[0].cpu, 2);
});
