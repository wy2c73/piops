// Simple JSON-file device registry. A personal fleet dashboard doesn't need
// a database -- a handful to a few dozen devices, low write frequency.
// Swap this module out for something heavier if the fleet ever gets huge.

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { encrypt, decrypt } = require('./crypto');

const DATA_PATH = path.join(__dirname, '..', 'data', 'devices.json');
const GROUPS_PATH = path.join(__dirname, '..', 'data', 'groups.json');
const ALERTS_PATH = path.join(__dirname, '..', 'data', 'alerts.json');
const COMMANDS_PATH = path.join(__dirname, '..', 'data', 'customCommands.json');

function load() {
  if (!fs.existsSync(DATA_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function save(devices) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(devices, null, 2), { mode: 0o600 });
}

// Strip the encrypted secret before sending a device out over the API.
function sanitize(device) {
  const { secret, ...rest } = device;
  return rest;
}

function list() {
  return load().map(sanitize);
}

// Internal use only (ssh.js) -- includes the decrypted secret.
function getWithSecret(id) {
  const device = load().find((d) => d.id === id);
  if (!device) return null;
  return { ...device, secret: device.secret ? decrypt(device.secret) : null };
}

function get(id) {
  const device = load().find((d) => d.id === id);
  return device ? sanitize(device) : null;
}

function create(input) {
  const devices = load();
  const device = {
    id: uuidv4(),
    name: input.name,
    host: input.host,
    port: input.port ? Number(input.port) : 22,
    username: input.username,
    authType: input.authType, // 'password' | 'key'
    secret: input.secret ? encrypt(input.secret) : null, // password or private key text
    passphrase: input.passphrase ? encrypt(input.passphrase) : null,
    group: input.group || 'Unsorted',
    tags: input.tags || [],
    createdAt: new Date().toISOString(),
  };
  devices.push(device);
  save(devices);
  return sanitize(device);
}

function update(id, input) {
  const devices = load();
  const idx = devices.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  const existing = devices[idx];
  const updated = {
    ...existing,
    name: input.name ?? existing.name,
    host: input.host ?? existing.host,
    port: input.port ? Number(input.port) : existing.port,
    username: input.username ?? existing.username,
    authType: input.authType ?? existing.authType,
    // Only overwrite the secret if a new one was actually provided --
    // otherwise editing a device would wipe out its stored credential.
    secret: input.secret ? encrypt(input.secret) : existing.secret,
    passphrase: input.passphrase ? encrypt(input.passphrase) : existing.passphrase,
    group: input.group ?? existing.group,
    tags: input.tags ?? existing.tags,
  };
  devices[idx] = updated;
  save(devices);
  return sanitize(updated);
}

function remove(id) {
  const devices = load();
  const next = devices.filter((d) => d.id !== id);
  save(next);
  return next.length !== devices.length;
}

module.exports = {
  list, get, getWithSecret, create, update, remove,
  listGroups, addGroup, removeGroup,
  loadAlertConfig, saveAlertConfig,
  listCommands, getCommand, createCommand, removeCommand,
};

// ---- Custom quick commands ----
// A global, curated list of {id, label, command} shown as buttons on every
// device's Actions tab. Deliberately global rather than per-device: these
// are almost always fleet-wide maintenance actions (restart Docker, update
// packages, clear logs...), and keeping one list avoids re-defining the
// same command on every device. Execution always looks a command up by id
// from this list rather than accepting raw command text from a request, so
// only commands the person has actually configured here can ever run.

function loadCommands() {
  if (!fs.existsSync(COMMANDS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(COMMANDS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function saveCommands(commands) {
  fs.mkdirSync(path.dirname(COMMANDS_PATH), { recursive: true });
  fs.writeFileSync(COMMANDS_PATH, JSON.stringify(commands, null, 2), { mode: 0o600 });
}

function listCommands() {
  return loadCommands();
}

function getCommand(id) {
  return loadCommands().find((c) => c.id === id) || null;
}

function createCommand({ label, command, timeoutSec }) {
  const commands = loadCommands();
  const entry = {
    id: uuidv4(),
    label,
    command,
    timeoutSec: Number(timeoutSec) > 0 ? Number(timeoutSec) : 120, // default well beyond the 60s used for reboot/shutdown/service actions
  };
  commands.push(entry);
  saveCommands(commands);
  return entry;
}

function removeCommand(id) {
  const commands = loadCommands().filter((c) => c.id !== id);
  saveCommands(commands);
  return commands;
}

// ---- Alert configuration ----
// A single config object (not per-device) controlling whether/how the
// dashboard sends webhook notifications on state changes the poller
// detects. Lives in its own file since it's unrelated to the device
// registry and, unlike device credentials, isn't sensitive.

const DEFAULT_ALERT_CONFIG = {
  enabled: false,
  webhookUrl: '',
  format: 'generic', // 'generic' | 'discord' | 'slack' | 'ntfy'
  notify: {
    offline: true,
    recovery: true,
    undervoltage: true,
    throttled: true,
    cpu: false,
    memory: false,
    disk: false,
    temp: false,
  },
  thresholds: {
    cpuPct: 90,
    memPct: 90,
    diskPct: 90,
    tempC: 75, // always Celsius internally, regardless of the dashboard's display setting
  },
};

function loadAlertConfig() {
  if (!fs.existsSync(ALERTS_PATH)) return structuredClone(DEFAULT_ALERT_CONFIG);
  try {
    const saved = JSON.parse(fs.readFileSync(ALERTS_PATH, 'utf8'));
    return {
      ...DEFAULT_ALERT_CONFIG,
      ...saved,
      notify: { ...DEFAULT_ALERT_CONFIG.notify, ...(saved.notify || {}) },
      thresholds: { ...DEFAULT_ALERT_CONFIG.thresholds, ...(saved.thresholds || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_ALERT_CONFIG);
  }
}

function saveAlertConfig(partial) {
  const current = loadAlertConfig();
  const updated = {
    ...current,
    ...partial,
    notify: { ...current.notify, ...(partial.notify || {}) },
    thresholds: { ...current.thresholds, ...(partial.thresholds || {}) },
  };
  fs.mkdirSync(path.dirname(ALERTS_PATH), { recursive: true });
  fs.writeFileSync(ALERTS_PATH, JSON.stringify(updated, null, 2), { mode: 0o600 });
  return updated;
}

// ---- Curated device groups ----
// A small, separate list of group names the person has explicitly created,
// so the "Add device" form can offer a dropdown instead of free text.
// Devices can still carry a group value that isn't in this list (e.g. one
// typed in before this existed) -- that's fine, it just won't show up here
// until added.

function loadGroups() {
  if (!fs.existsSync(GROUPS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(GROUPS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function saveGroups(groups) {
  fs.mkdirSync(path.dirname(GROUPS_PATH), { recursive: true });
  fs.writeFileSync(GROUPS_PATH, JSON.stringify(groups, null, 2), { mode: 0o600 });
}

function listGroups() {
  return loadGroups();
}

function addGroup(name) {
  const groups = loadGroups();
  if (!groups.some((g) => g.toLowerCase() === name.toLowerCase())) {
    groups.push(name);
    groups.sort((a, b) => a.localeCompare(b));
    saveGroups(groups);
  }
  return groups;
}

function removeGroup(name) {
  const groups = loadGroups().filter((g) => g !== name);
  saveGroups(groups);
  return groups;
}
