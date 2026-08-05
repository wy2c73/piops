const express = require('express');
const router = express.Router();
const { encryptWithPassphrase, decryptWithPassphrase } = require('../lib/crypto');
const { buildBundle, applyBundle } = require('../lib/backupBundle');
const autoBackup = require('../lib/autoBackup');

const MIN_PASSPHRASE_LEN = 8;

// Bundles every device (with its decrypted credential) and the client's
// unit preferences into one JSON payload, then encrypts that whole payload
// with a key derived from a passphrase the user supplies here -- not the
// server's own at-rest key, so the resulting file is portable.
router.post('/export', (req, res) => {
  const { passphrase, clientSettings, order } = req.body || {};
  if (!passphrase || passphrase.length < MIN_PASSPHRASE_LEN) {
    return res.status(400).json({ error: `Passphrase must be at least ${MIN_PASSPHRASE_LEN} characters` });
  }

  const bundle = buildBundle(clientSettings, order);
  const blob = encryptWithPassphrase(passphrase, JSON.stringify(bundle));
  res.json({ format: 'piops-backup', version: 1, deviceCount: bundle.devices.length, ...blob });
});

// Decrypts a previously exported file and applies it (creating any
// devices that aren't already present).
router.post('/import', async (req, res) => {
  const { passphrase, file } = req.body || {};
  if (!passphrase || !file) {
    return res.status(400).json({ error: 'A passphrase and backup file are both required' });
  }
  // Accept the legacy format string too, so a backup exported before the
  // PiOps rename still imports correctly.
  const validFormats = new Set(['piops-backup', 'pi-fleet-dashboard-backup']);
  if (!validFormats.has(file.format) || !file.salt || !file.iv || !file.tag || !file.data) {
    return res.status(400).json({ error: 'This does not look like a PiOps backup file' });
  }

  let bundle;
  try {
    bundle = JSON.parse(decryptWithPassphrase(passphrase, file));
  } catch {
    return res.status(400).json({ error: 'Could not decrypt this file -- check the passphrase' });
  }

  res.json(applyBundle(bundle));
});

// ---- Automatic backups (server-side, encrypted with this install's own
// at-rest key -- see lib/autoBackup.js for the important limitation) ----

router.get('/auto', (req, res) => {
  res.json({ config: autoBackup.loadConfig(), backups: autoBackup.listBackups() });
});

router.put('/auto/config', (req, res) => {
  try {
    res.json(autoBackup.saveConfig(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/auto/run-now', (req, res) => {
  try {
    res.json(autoBackup.takeBackup());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/auto/:filename/restore', (req, res) => {
  try {
    res.json(autoBackup.restoreBackup(req.params.filename));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
