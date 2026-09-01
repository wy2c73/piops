const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildEvents } = require('../lib/alertEngine');

const device = { name: 'Test Pi', host: '192.168.1.50' };

const baseConfig = {
  enabled: true,
  notify: { offline: true, recovery: true, undervoltage: true, throttled: true, cpu: true, memory: true, disk: true, temp: true },
  thresholds: { cpuPct: 90, memPct: 90, diskPct: 90, tempC: 80 },
};

test('does not fire offline on a device\'s very first poll (no prior stats to compare against)', () => {
  const events = buildEvents(device, null, { status: 'offline', error: 'timeout' }, baseConfig);
  assert.deepEqual(events, []);
});

test('fires offline only on the online -> offline transition', () => {
  const online = { status: 'online' };
  const offline = { status: 'offline', error: 'ECONNREFUSED' };

  const events = buildEvents(device, online, offline, baseConfig);
  assert.equal(events.length, 1);
  assert.match(events[0].title, /offline/i);

  // Staying offline on a SUBSEQUENT poll should not fire again --
  // otherwise a downed device would spam a notification every poll
  // cycle forever.
  const stillOffEvents = buildEvents(device, offline, offline, baseConfig);
  assert.deepEqual(stillOffEvents, []);
});

test('fires recovery only on the offline -> online transition', () => {
  const offline = { status: 'offline' };
  const online = { status: 'online', cpuUsedPct: 5 };

  const events = buildEvents(device, offline, online, baseConfig);
  assert.equal(events.length, 1);
  assert.match(events[0].title, /back online/i);
});

test('respects notify toggles -- off means no event even on a real transition', () => {
  const config = { ...baseConfig, notify: { ...baseConfig.notify, offline: false } };
  const events = buildEvents(device, { status: 'online' }, { status: 'offline' }, config);
  assert.deepEqual(events, []);
});

test('threshold: fires only when crossing upward, not while already over it', () => {
  const under = { status: 'online', cpuUsedPct: 50 };
  const over = { status: 'online', cpuUsedPct: 95 };

  const crossing = buildEvents(device, under, over, baseConfig);
  assert.equal(crossing.length, 1);
  assert.match(crossing[0].title, /cpu/i);

  // Still over on the next poll -- should not fire again.
  const stillOver = buildEvents(device, over, over, baseConfig);
  assert.deepEqual(stillOver, []);
});

test('threshold: does not fire when staying under it', () => {
  const events = buildEvents(device, { status: 'online', cpuUsedPct: 40 }, { status: 'online', cpuUsedPct: 60 }, baseConfig);
  assert.deepEqual(events, []);
});

test('per-device alertOverrides win over the global threshold', () => {
  const hotDevice = { ...device, alertOverrides: { cpuPct: 97 } };
  // 95% crosses the global 90% threshold but not this device's own 97% override.
  const events = buildEvents(hotDevice, { status: 'online', cpuUsedPct: 50 }, { status: 'online', cpuUsedPct: 95 }, baseConfig);
  assert.deepEqual(events, []);
});

test('under-voltage and throttling fire on the false -> true transition only', () => {
  const notThrottled = { status: 'online', throttled: { underVoltageNow: false, throttledNow: false } };
  const throttled = { status: 'online', throttled: { underVoltageNow: true, throttledNow: true } };

  const events = buildEvents(device, notThrottled, throttled, baseConfig);
  assert.equal(events.length, 2);
  assert.ok(events.some((e) => /under-voltage/i.test(e.title)));
  assert.ok(events.some((e) => /throttl/i.test(e.title)));

  // Staying throttled shouldn't fire again.
  assert.deepEqual(buildEvents(device, throttled, throttled, baseConfig), []);
});

test('memory/disk threshold events read from the nested stats shape correctly', () => {
  const under = { status: 'online', memory: { usedPct: 50 }, disk: { usedPct: 50 } };
  const over = { status: 'online', memory: { usedPct: 95 }, disk: { usedPct: 95 } };
  const events = buildEvents(device, under, over, baseConfig);
  assert.equal(events.length, 2);
  assert.ok(events.some((e) => /memory/i.test(e.title)));
  assert.ok(events.some((e) => /disk/i.test(e.title)));
});
