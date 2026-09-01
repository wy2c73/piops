const express = require('express');
const router = express.Router();
const apiTokens = require('../lib/apiTokens');

router.get('/', (req, res) => {
  res.json(apiTokens.listTokens());
});

router.post('/', (req, res) => {
  try {
    res.status(201).json(apiTokens.createToken(req.body?.label));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    apiTokens.revokeToken(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

module.exports = router;
