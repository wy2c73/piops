const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const poller = require('../poller');
const { testConnection, listServices, listPorts } = require('../lib/ssh');

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

module.exports = router;
