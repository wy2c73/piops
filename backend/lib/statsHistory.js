// Historical CPU/memory/disk/temperature samples per device, for the
// device detail "History" chart and the optional card/row sparkline.
// Off by default -- this is extra disk writes on every poll cycle
// otherwise, and on a Pi that means extra SD card wear for a feature
// most people won't look at often. One JSON file per device
// (data/stats-history/<deviceId>.json), each holding a capped, oldest-
// pruned array of compact samples.
//
// Deliberately downsampled from the poll interval (default every 15s)
// rather than recording every single poll -- a point every 5 minutes
// is still plenty of resolution for a chart spanning days, and cuts
// the write volume (and resulting SD card wear) by roughly 20x
// compared to recording every poll.

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./dataDir');

const CONFIG_PATH = path.join(DATA_DIR, 'statsHistoryConfig.json');
const HISTORY_DIR = path.join(DATA_DIR, 'stats-history');

let SAMPLE_INTERVAL_MS = 5 * 60 * 1000; // how often a poll result actually gets recorded
const DEFAULT_CONFIG = { enabled: false, retentionDays: 7, sparklineEnabled: true };
const VALID_RETENTION_DAYS = new Set([1, 7, 30]);

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(partial) {
  const updated = { ...loadConfig(), ...partial };
  if (updated.retentionDays !== undefined && !VALID_RETENTION_DAYS.has(Number(updated.retentionDays))) {
    throw new Error('retentionDays must be 1, 7, or 30');
  }
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), { mode: 0o600 });
  return updated;
}

function historyPath(deviceId) {
  // Device ids are server-generated UUIDs (see store.js's uuidv4()), never
  // taken from this function's caller, so there's no path-traversal input
  // to sanitize here the way lib/autoBackup.js has to for a
  // request-supplied filename.
  return path.join(HISTORY_DIR, `${deviceId}.json`);
}

function loadHistory(deviceId) {
  const p = historyPath(deviceId);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

function saveHistory(deviceId, samples) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  fs.writeFileSync(historyPath(deviceId), JSON.stringify(samples), { mode: 0o600 });
}

// Compact keys on purpose (t/cpu/mem/disk/temp, not the verbose field
// names collectStats() itself uses) -- this file is written repeatedly
// over a long retention window, so shaving bytes per sample adds up.
function toSample(stats) {
  return {
    t: Date.now(),
    cpu: stats.cpuUsedPct ?? null,
    mem: stats.memory?.usedPct ?? null,
    disk: stats.disk?.usedPct ?? null,
    temp: stats.tempC ?? null,
  };
}

// Called after every poll (online or offline) -- a no-op unless the
// feature is enabled AND enough time has passed since this device's
// last recorded sample. Safe and cheap to call on every poll cycle.
function maybeRecordSample(deviceId, stats) {
  const config = loadConfig();
  if (!config.enabled) return;

  const samples = loadHistory(deviceId);
  const last = samples[samples.length - 1];
  if (last && Date.now() - last.t < SAMPLE_INTERVAL_MS) return;

  samples.push(toSample(stats));

  const cutoff = Date.now() - config.retentionDays * 24 * 60 * 60 * 1000;
  const pruned = samples.filter((s) => s.t >= cutoff);
  saveHistory(deviceId, pruned);
}

function getHistory(deviceId) {
  return loadHistory(deviceId);
}

function deleteHistory(deviceId) {
  try {
    fs.unlinkSync(historyPath(deviceId));
  } catch {
    // Nothing recorded for this device yet -- fine, nothing to clean up.
  }
}

function _setSampleIntervalForTests(ms) {
  SAMPLE_INTERVAL_MS = ms;
}

module.exports = {
  loadConfig, saveConfig, maybeRecordSample, getHistory, deleteHistory,
  _setSampleIntervalForTests,
  get SAMPLE_INTERVAL_MS() { return SAMPLE_INTERVAL_MS; },
};
