const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const poller = require('../poller');
const { testConnection, listServices, listPorts, runCommand } = require('../lib/ssh');
const statsHistory = require('../lib/statsHistory');

const SERVICE_NAME_PATTERN = /^[a-zA-Z0-9@._-]+\.service$/;
const SERVICE_ACTIONS = new Set(['start', 'stop', 'restart']);

// List devices merged with their latest cached stats.
router.get('/', (req, res) => {
  const devices = store.list();
  const cached = poller.getAllCached();
  res.json(devices.map((d) => ({ ...d, stats: cached[d.id] || { status: 'unknown' } })));
});

router.get('/:id', (req, res) => {
  const device = store.get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  res.json({ ...device, stats: poller.getCached(device.id) || { status: 'unknown' } });
});

router.post('/', async (req, res) => {
  const { name, host, username, authType, secret } = req.body;
  if (!name || !host || !username || !authType || !secret) {
    return res.status(400).json({ error: 'name, host, username, authType and secret are required' });
  }
  const device = store.create(req.body);
  poller.refreshDevice(device.id).catch((err) => console.error(`[devices] background refresh failed for ${device.id}:`, err.message)); // kick off an immediate check, don't block the response
  res.status(201).json(device);
});

router.put('/:id', (req, res) => {
  const device = store.update(req.params.id, req.body);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  poller.refreshDevice(device.id).catch((err) => console.error(`[devices] background refresh failed for ${device.id}:`, err.message));
  res.json(device);
});

router.delete('/:id', (req, res) => {
  const ok = store.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Device not found' });
  statsHistory.deleteHistory(req.params.id);
  res.status(204).end();
});

router.post('/:id/test', async (req, res) => {
  try {
    const device = store.getWithSecret(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    await testConnection(device);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post('/:id/refresh', async (req, res) => {
  const device = store.get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  try {
    const stats = await poller.refreshDevice(device.id);
    res.json(stats);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/:id/services', async (req, res) => {
  try {
    const device = store.getWithSecret(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    const services = await listServices(device);
    res.json(services);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/:id/ports', async (req, res) => {
  try {
    const device = store.getWithSecret(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    const ports = await listPorts(device);
    res.json(ports);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---- Quick actions ----
// All of these require the device's SSH account to have passwordless sudo
// (`sudo -n ...`) for the specific command -- `-n` fails fast with a clear
// error instead of hanging if a password would actually be required.

router.post('/:id/actions/reboot', async (req, res) => {
  try {
    const device = store.getWithSecret(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    const result = await runCommand(device, 'sudo -n reboot');
    res.json({ ok: result.code === 0, ...result });
  } catch (err) {
    // A successful reboot can itself cause the connection to drop before a
    // clean response comes back -- that's not necessarily a failure.
    res.status(502).json({
      ok: false,
      error: err.message,
      note: 'The connection may have dropped because the reboot actually succeeded. Give it a minute and check the device status.',
    });
  }
});

router.post('/:id/actions/shutdown', async (req, res) => {
  try {
    const device = store.getWithSecret(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    const result = await runCommand(device, 'sudo -n shutdown -h now');
    res.json({ ok: result.code === 0, ...result });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: err.message,
      note: 'The connection may have dropped because the shutdown actually succeeded.',
    });
  }
});

router.post('/:id/services/:name/action', async (req, res) => {
  const action = req.body?.action;
  const serviceName = req.params.name;
  if (!SERVICE_ACTIONS.has(action)) {
    return res.status(400).json({ error: 'action must be start, stop, or restart' });
  }
  if (!SERVICE_NAME_PATTERN.test(serviceName)) {
    return res.status(400).json({ error: 'Invalid service name' });
  }
  try {
    const device = store.getWithSecret(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    const result = await runCommand(device, `sudo -n systemctl ${action} '${serviceName}'`);
    res.json({ ok: result.code === 0, ...result });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

// Only ever runs a command that already exists in the curated custom
// commands list (see routes/commands.js) -- never raw text from the
// request body. That list is itself deliberately powerful (arbitrary
// shell), but requiring it to be pre-defined in Settings means this
// endpoint can't be used to run something that hasn't been configured.
router.post('/:id/actions/run-command', async (req, res) => {
  const cmd = store.getCommand(req.body?.commandId);
  if (!cmd) return res.status(404).json({ error: 'Command not found' });
  try {
    const device = store.getWithSecret(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    const result = await runCommand(device, cmd.command, (cmd.timeoutSec || 120) * 1000);
    res.json({ ok: result.code === 0, ...result });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

module.exports = router;
