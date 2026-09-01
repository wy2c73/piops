// The documented, token-authenticated read API (see API.md) -- separate
// from the internal /api/* routes the dashboard itself uses (which are
// session-cookie authenticated and aren't a stable, external contract).
//
// Deliberately conservative about what a token can see: this builds an
// explicit allowlist of fields rather than reusing store.js's internal
// sanitize() output, so a field added to the internal device shape later
// (even something already non-secret, like a future field only meant for
// the dashboard's own UI) doesn't silently leak into this external
// surface just because it happened to be present.
//
// Read-only on purpose -- no route here can change anything. A leaked
// token should only ever expose stats, never let someone reboot a
// device, run a command, or touch settings.

const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const poller = require('../poller');
const apiTokens = require('../lib/apiTokens');

function requireToken(req, res, next) {
  const match = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  const tokenId = match ? apiTokens.verifyToken(match[1]) : null;
  if (!tokenId) {
    return res.status(401).json({ error: 'Missing or invalid API token. See API.md for how to create one in Settings -> Security.' });
  }
  next();
}

router.use(requireToken);

function publicDeviceView(device, stats) {
  return {
    id: device.id,
    name: device.name,
    host: device.host,
    port: device.port,
    group: device.group,
    tags: device.tags || [],
    status: stats?.status || 'unknown',
    error: stats?.error || null,
    cpuUsedPct: stats?.cpuUsedPct ?? null,
    memory: stats?.memory || null,
    disk: stats?.disk || null,
    tempC: stats?.tempC ?? null,
    loadAvg: stats?.loadAvg || null,
    uptime: stats?.uptime || null,
    os: stats?.os || null,
    kernel: stats?.kernel || null,
    model: stats?.model || null,
    throttled: stats?.throttled || null,
    servicesRunning: stats?.servicesRunning ?? null,
    lastSeen: stats?.lastSeen || null,
  };
}

router.get('/devices', (req, res) => {
  const cache = poller.getAllCached();
  res.json(store.list().map((d) => publicDeviceView(d, cache[d.id])));
});

router.get('/devices/:id', (req, res) => {
  const device = store.get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  res.json(publicDeviceView(device, poller.getCached(device.id)));
});

router.get('/summary', (req, res) => {
  const devices = store.list();
  const cache = poller.getAllCached();
  const statuses = devices.map((d) => cache[d.id]?.status || 'unknown');
  res.json({
    deviceCount: devices.length,
    online: statuses.filter((s) => s === 'online').length,
    offline: statuses.filter((s) => s === 'offline').length,
    unknown: statuses.filter((s) => s === 'unknown').length,
  });
});

module.exports = router;
