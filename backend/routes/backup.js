const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const poller = require('../poller');
const { encryptWithPassphrase, decryptWithPassphrase } = require('../lib/crypto');

const MIN_PASSPHRASE_LEN = 8;

// Bundles every device (with its decrypted credential) and the client's
// unit preferences into one JSON payload, then encrypts that whole payload
// with a key derived from a passphrase the user supplies here -- not the
// server's own at-rest key, so the resulting file is portable.
router.post('/export', (req, res) => {
  const { passphrase, clientSettings } = req.body || {};
  if (!passphrase || passphrase.length < MIN_PASSPHRASE_LEN) {
    return res.status(400).json({ error: `Passphrase must be at least ${MIN_PASSPHRASE_LEN} characters` });
  }

  const devices = store.list().map((d) => {
    const full = store.getWithSecret(d.id);
    return {
      name: full.name,
      host: full.host,
      port: full.port,
      username: full.username,
      authType: full.authType,
      secret: full.secret,
      passphrase: full.passphrase,
      group: full.group,
      tags: full.tags,
    };
  });

  const bundle = JSON.stringify({
    exportedAt: new Date().toISOString(),
    devices,
    groups: store.listGroups(),
    alerts: store.loadAlertConfig(),
    commands: store.listCommands(),
    settings: clientSettings || null,
  });

  const blob = encryptWithPassphrase(passphrase, bundle);
  res.json({ format: 'pi-fleet-dashboard-backup', version: 1, deviceCount: devices.length, ...blob });
});

// Decrypts a previously exported file and creates any devices that aren't
// already present (matched on host+port+username), so importing the same
// file twice doesn't create duplicates.
router.post('/import', async (req, res) => {
  const { passphrase, file } = req.body || {};
  if (!passphrase || !file) {
    return res.status(400).json({ error: 'A passphrase and backup file are both required' });
  }
  if (file.format !== 'pi-fleet-dashboard-backup' || !file.salt || !file.iv || !file.tag || !file.data) {
    return res.status(400).json({ error: 'This does not look like a Pi Fleet Dashboard backup file' });
  }

  let bundle;
  try {
    bundle = JSON.parse(decryptWithPassphrase(passphrase, file));
  } catch {
    return res.status(400).json({ error: 'Could not decrypt this file -- check the passphrase' });
  }

  const existingKey = (d) => `${d.host}:${d.port}:${d.username}`.toLowerCase();
  const seen = new Set(store.list().map(existingKey));

  let imported = 0;
  let skipped = 0;
  const newIds = [];
  for (const device of bundle.devices || []) {
    const key = existingKey(device);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    const created = store.create(device); // input.secret here is the plaintext credential; store.create() re-encrypts it with this install's own key
    newIds.push(created.id);
    seen.add(key);
    imported++;
  }

  newIds.forEach((id) => poller.refreshDevice(id)); // don't block the response on these
  (bundle.groups || []).forEach((name) => store.addGroup(name));
  if (bundle.alerts) store.saveAlertConfig(bundle.alerts);

  const existingCommands = new Set(store.listCommands().map((c) => `${c.label}::${c.command}`));
  (bundle.commands || []).forEach((c) => {
    const key = `${c.label}::${c.command}`;
    if (!existingCommands.has(key)) {
      store.createCommand({ label: c.label, command: c.command });
      existingCommands.add(key);
    }
  });

  res.json({ imported, skipped, settings: bundle.settings || null });
});

module.exports = router;
