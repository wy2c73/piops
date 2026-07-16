const express = require('express');
const router = express.Router();
const store = require('../lib/store');

const MAX_LABEL_LEN = 60;
const MAX_COMMAND_LEN = 4000;

router.get('/', (req, res) => {
  res.json(store.listCommands());
});

router.post('/', (req, res) => {
  const label = String(req.body?.label || '').trim();
  const command = String(req.body?.command || '').trim();
  if (!label || !command) {
    return res.status(400).json({ error: 'label and command are both required' });
  }
  if (label.length > MAX_LABEL_LEN) {
    return res.status(400).json({ error: `Label must be ${MAX_LABEL_LEN} characters or fewer` });
  }
  if (command.length > MAX_COMMAND_LEN) {
    return res.status(400).json({ error: `Command must be ${MAX_COMMAND_LEN} characters or fewer` });
  }
  res.status(201).json(store.createCommand({ label, command }));
});

router.delete('/:id', (req, res) => {
  res.json(store.removeCommand(req.params.id));
});

module.exports = router;
