const express = require('express');
const router = express.Router();
const statsHistory = require('../lib/statsHistory');
const store = require('../lib/store');

router.get('/config', (req, res) => {
  res.json(statsHistory.loadConfig());
});

router.put('/config', (req, res) => {
  try {
    res.json(statsHistory.saveConfig(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:deviceId', (req, res) => {
  if (!store.get(req.params.deviceId)) return res.status(404).json({ error: 'Device not found' });
  res.json(statsHistory.getHistory(req.params.deviceId));
});

module.exports = router;
