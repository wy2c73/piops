const express = require('express');
const router = express.Router();
const store = require('../lib/store');

const MAX_NAME_LEN = 60;

router.get('/', (req, res) => {
  res.json(store.listGroups());
});

router.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Group name is required' });
  if (name.length > MAX_NAME_LEN) return res.status(400).json({ error: `Group name must be ${MAX_NAME_LEN} characters or fewer` });
  res.status(201).json(store.addGroup(name));
});

router.delete('/:name', (req, res) => {
  res.json(store.removeGroup(req.params.name));
});

module.exports = router;
