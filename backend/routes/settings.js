const express = require('express');
const router = express.Router();
const store = require('../lib/store');

router.get('/', (req, res) => {
  res.json({ settings: store.loadClientSettings(), everSaved: store.hasClientSettings() });
});

router.put('/', (req, res) => {
  res.json(store.saveClientSettings(req.body || {}));
});

module.exports = router;
