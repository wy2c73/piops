const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const { sendWebhook } = require('../lib/alertNotifier');

router.get('/', (req, res) => {
  res.json(store.loadAlertConfig());
});

router.put('/', (req, res) => {
  const updated = store.saveAlertConfig(req.body || {});
  res.json(updated);
});

router.post('/test', async (req, res) => {
  try {
    const config = store.loadAlertConfig();
    if (!config.webhookUrl) {
      return res.status(400).json({ error: 'Set a webhook URL first' });
    }
    await sendWebhook(config, {
      title: 'PiOps test alert',
      message: 'If you can see this, your webhook is configured correctly.',
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
