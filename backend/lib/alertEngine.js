// Compares a device's previous poll result to its latest one and decides
// whether anything alert-worthy happened. Fires only on the actual
// transition (e.g. online -> offline), not on every poll while a condition
// remains true -- otherwise an offline device would spam a notification
// every 15 seconds forever.

const store = require('./store');
const { sendWebhook } = require('./alertNotifier');

function overThreshold(enabled, oldVal, newVal, threshold) {
  if (!enabled || threshold === null || threshold === undefined) return false;
  if (newVal === null || newVal === undefined) return false;
  const wasOver = oldVal !== null && oldVal !== undefined && oldVal >= threshold;
  const isOver = newVal >= threshold;
  return isOver && !wasOver;
}

// A device's own alertOverrides (set via Add/Edit device) win over the
// global default from Settings -> Alerts for that specific stat, so one
// unusually hot or busy Pi can have its own threshold without changing
// the fleet-wide default for everything else.
function effectiveThreshold(device, key, globalThresholds) {
  const override = device.alertOverrides?.[key];
  return override !== undefined && override !== null ? override : globalThresholds[key];
}

function buildEvents(device, oldStats, newStats, config) {
  const events = [];
  const wasOnline = oldStats?.status === 'online';
  const isOnline = newStats.status === 'online';
  const seenBefore = !!oldStats; // avoid firing offline/recovery on a device's very first poll
  const cpuThreshold = effectiveThreshold(device, 'cpuPct', config.thresholds);
  const memThreshold = effectiveThreshold(device, 'memPct', config.thresholds);
  const diskThreshold = effectiveThreshold(device, 'diskPct', config.thresholds);
  const tempThreshold = effectiveThreshold(device, 'tempC', config.thresholds);

  if (config.notify.offline && seenBefore && wasOnline && !isOnline) {
    events.push({
      title: `${device.name} is offline`,
      message: `${device.name} (${device.host}) stopped responding: ${newStats.error || 'unknown error'}`,
    });
  }

  if (config.notify.recovery && seenBefore && !wasOnline && isOnline) {
    events.push({
      title: `${device.name} is back online`,
      message: `${device.name} (${device.host}) is responding again.`,
    });
  }

  if (isOnline) {
    const oldT = oldStats?.throttled || {};
    const newT = newStats.throttled || {};

    if (config.notify.undervoltage && newT.underVoltageNow && !oldT.underVoltageNow) {
      events.push({
        title: `${device.name}: under-voltage detected`,
        message: `${device.name} (${device.host}) is reporting a power under-voltage condition right now. Check its power supply and cable.`,
      });
    }

    if (config.notify.throttled && newT.throttledNow && !oldT.throttledNow) {
      events.push({
        title: `${device.name}: throttling detected`,
        message: `${device.name} (${device.host}) is being throttled right now (power or thermal).`,
      });
    }

    if (overThreshold(config.notify.cpu, oldStats?.cpuUsedPct, newStats.cpuUsedPct, cpuThreshold)) {
      events.push({
        title: `${device.name}: CPU usage high`,
        message: `${device.name} (${device.host}) CPU usage is ${newStats.cpuUsedPct}% (threshold ${cpuThreshold}%).`,
      });
    }
    if (overThreshold(config.notify.memory, oldStats?.memory?.usedPct, newStats.memory?.usedPct, memThreshold)) {
      events.push({
        title: `${device.name}: memory usage high`,
        message: `${device.name} (${device.host}) memory usage is ${newStats.memory.usedPct}% (threshold ${memThreshold}%).`,
      });
    }
    if (overThreshold(config.notify.disk, oldStats?.disk?.usedPct, newStats.disk?.usedPct, diskThreshold)) {
      events.push({
        title: `${device.name}: disk usage high`,
        message: `${device.name} (${device.host}) disk usage is ${newStats.disk.usedPct}% (threshold ${diskThreshold}%).`,
      });
    }
    if (overThreshold(config.notify.temp, oldStats?.tempC, newStats.tempC, tempThreshold)) {
      events.push({
        title: `${device.name}: temperature high`,
        message: `${device.name} (${device.host}) temperature is ${newStats.tempC}\u00b0C (threshold ${tempThreshold}\u00b0C).`,
      });
    }
  }

  return events;
}

async function evaluate(device, oldStats, newStats) {
  const config = store.loadAlertConfig();
  if (!config.enabled || !config.webhookUrl) return;

  const events = buildEvents(device, oldStats, newStats, config);
  for (const event of events) {
    try {
      await sendWebhook(config, event);
    } catch (err) {
      console.error(`[alerts] failed to send webhook for ${device.name}:`, err.message);
    }
  }
}

module.exports = { evaluate, buildEvents };
