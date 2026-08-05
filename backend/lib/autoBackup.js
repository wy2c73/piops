// Automatic, scheduled backups -- a safety net against accidentally
// deleting/corrupting the device registry, a bad update, or wanting to
// roll back a few days, not a substitute for the manual, passphrase-
// encrypted export in routes/backup.js.
//
// IMPORTANT LIMITATION, and it's a real one: these are encrypted with
// this install's own at-rest key (backend/data/.key -- the same one
// protecting devices.json) rather than a passphrase, since nothing is
// present to type one in on a schedule. That means an automatic backup
// is only ever readable by *this* install, and if the whole data
// directory is lost (a dead SD card, a wiped disk), the backups are
// lost right along with it -- this protects against "I fat-fingered a
// bulk delete" or "the last update broke something," not "my Pi's SD
// card died." For real disaster recovery, periodically copy this
// backup folder somewhere else, or take a manual export (Settings ->
// Backup) and store it off the device entirely.

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./dataDir');
const { encrypt, decrypt } = require('./crypto');
const { buildBundle, applyBundle } = require('./backupBundle');

const CONFIG_PATH = path.join(DATA_DIR, 'autoBackupConfig.json');
const BACKUP_DIR = path.join(DATA_DIR, 'auto-backups');
const FORMAT = 'piops-auto-backup';

const DEFAULT_CONFIG = { enabled: true, intervalHours: 24, retentionCount: 7, lastBackupAt: null };
const VALID_INTERVALS = new Set([24, 168]); // daily, weekly

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(partial) {
  const current = loadConfig();
  const updated = { ...current, ...partial };
  if (updated.intervalHours !== undefined && !VALID_INTERVALS.has(Number(updated.intervalHours))) {
    throw new Error('intervalHours must be 24 (daily) or 168 (weekly)');
  }
  if (updated.retentionCount !== undefined) {
    const n = Number(updated.retentionCount);
    if (!Number.isInteger(n) || n < 1 || n > 30) throw new Error('retentionCount must be an integer between 1 and 30');
  }
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), { mode: 0o600 });
  return updated;
}

function safeTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('auto-') && f.endsWith('.json'))
    .map((filename) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, filename));
      return { filename, createdAt: stat.mtime.toISOString(), sizeBytes: stat.size };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
}

function takeBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const bundle = buildBundle(null, null);
  const payload = {
    format: FORMAT,
    version: 1,
    createdAt: new Date().toISOString(),
    deviceCount: bundle.devices.length,
    encrypted: encrypt(JSON.stringify(bundle)),
  };
  const filename = `auto-${safeTimestamp(new Date())}.json`;
  fs.writeFileSync(path.join(BACKUP_DIR, filename), JSON.stringify(payload), { mode: 0o600 });

  const config = loadConfig();
  saveConfig({ lastBackupAt: payload.createdAt });
  pruneOldBackups(config.retentionCount);
  return { filename, deviceCount: payload.deviceCount };
}

function pruneOldBackups(retentionCount) {
  const backups = listBackups();
  for (const old of backups.slice(retentionCount)) {
    fs.unlinkSync(path.join(BACKUP_DIR, old.filename));
  }
}

function restoreBackup(filename) {
  // Reject anything that isn't exactly a filename we generated -- no
  // path separators, no traversal, since this ends up in a filesystem
  // path built from user input (the request body).
  if (!/^auto-[0-9T-]+Z\.json$/.test(filename)) {
    throw new Error('Invalid backup filename');
  }
  const fullPath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(fullPath)) throw new Error('Backup file not found');

  const payload = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  if (payload.format !== FORMAT) throw new Error('Not a recognized automatic backup file');
  const bundle = JSON.parse(decrypt(payload.encrypted));
  return applyBundle(bundle);
}

// Checks whether a scheduled backup is due and takes one if so. Safe to
// call frequently (e.g. hourly) -- it's a no-op unless intervalHours
// have actually elapsed since the last one, and also catches up on a
// missed backup if the server was down when one was due.
function maybeRunScheduledBackup() {
  const config = loadConfig();
  if (!config.enabled) return;
  const dueAt = config.lastBackupAt
    ? new Date(config.lastBackupAt).getTime() + config.intervalHours * 60 * 60 * 1000
    : 0; // never backed up before -- due immediately
  if (Date.now() >= dueAt) {
    try {
      takeBackup();
    } catch (err) {
      console.error('[autoBackup] scheduled backup failed:', err.message);
    }
  }
}

module.exports = { loadConfig, saveConfig, listBackups, takeBackup, restoreBackup, maybeRunScheduledBackup };
