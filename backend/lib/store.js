// Simple JSON-file device registry. A personal fleet dashboard doesn't need
// a database -- a handful to a few dozen devices, low write frequency.
// Swap this module out for something heavier if the fleet ever gets huge.

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { encrypt, decrypt } = require('./crypto');

const DATA_PATH = path.join(__dirname, '..', 'data', 'devices.json');

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

module.exports = { list, get, getWithSecret, create, update, remove };
