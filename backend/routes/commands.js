const express = require('express');
const router = express.Router();
const store = require('../lib/store');

const MAX_LABEL_LEN = 60;
const MAX_COMMAND_LEN = 4000;
const MIN_TIMEOUT_SEC = 5;
const MAX_TIMEOUT_SEC = 1800; // 30 minutes -- generous ceiling for something like a full package upgrade

router.get('/', (req, res) => {
  res.json(store.listCommands());
});

router.post('/', (req, res) => {
  const label = String(req.body?.label || '').trim();
  const command = String(req.body?.command || '').trim();
  const timeoutSec = req.body?.timeoutSec;
  if (!label || !command) {
    return res.status(400).json({ error: 'label and command are both required' });
  }
  if (label.length > MAX_LABEL_LEN) {
    return res.status(400).json({ error: `Label must be ${MAX_LABEL_LEN} characters or fewer` });
  }
  if (command.length > MAX_COMMAND_LEN) {
    return res.status(400).json({ error: `Command must be ${MAX_COMMAND_LEN} characters or fewer` });
  }
  if (timeoutSec !== undefined && (Number(timeoutSec) < MIN_TIMEOUT_SEC || Number(timeoutSec) > MAX_TIMEOUT_SEC)) {
    return res.status(400).json({ error: `Timeout must be between ${MIN_TIMEOUT_SEC} and ${MAX_TIMEOUT_SEC} seconds` });
  }
  res.status(201).json(store.createCommand({ label, command, timeoutSec }));
});

router.delete('/:id', (req, res) => {
  res.json(store.removeCommand(req.params.id));
});

module.exports = router;
