// Shared logic for building and applying a backup bundle. Used by both
// the manual, passphrase-encrypted export/import (routes/backup.js) and
// the automatic, local-key-encrypted snapshots (lib/autoBackup.js), so
// the bundle shape and the duplicate-skipping import logic only exist in
// one place rather than two copies that could drift apart.

const store = require('./store');
const poller = require('../poller');

function buildBundle(clientSettings, order) {
  const devices = store.list().map((d) => {
    const full = store.getWithSecret(d.id);
    return {
      id: full.id, // preserved on restore so a saved card order still resolves, even into a fresh install
      name: full.name,
      host: full.host,
      port: full.port,
      username: full.username,
      authType: full.authType,
      secret: full.secret,
      passphrase: full.passphrase,
      group: full.group,
      tags: full.tags,
      alertOverrides: full.alertOverrides,
    };
  });

  return {
    exportedAt: new Date().toISOString(),
    devices,
    groups: store.listGroups(),
    alerts: store.loadAlertConfig(),
    commands: store.listCommands(),
    settings: clientSettings || null,
    order: order || null,
  };
}

// Creates any devices from the bundle that aren't already present
// (matched on host+port+username), so applying the same bundle twice
// doesn't create duplicates.
function applyBundle(bundle) {
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

  newIds.forEach((id) => poller.refreshDevice(id)); // don't block the caller on these
  (bundle.groups || []).forEach((name) => store.addGroup(name));
  if (bundle.alerts) store.saveAlertConfig(bundle.alerts);

  const existingCommands = new Set(store.listCommands().map((c) => `${c.label}::${c.command}`));
  (bundle.commands || []).forEach((c) => {
    const key = `${c.label}::${c.command}`;
    if (!existingCommands.has(key)) {
      store.createCommand({ label: c.label, command: c.command, timeoutSec: c.timeoutSec });
      existingCommands.add(key);
    }
  });

  return { imported, skipped, settings: bundle.settings || null, order: bundle.order || null };
}

module.exports = { buildBundle, applyBundle };
