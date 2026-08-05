// Encrypts SSH passwords / private keys before they touch disk.
// A random 32-byte master key is generated once and stored in data/.key
// (file permissions 600). Anyone who can read that file AND devices.json
// can decrypt credentials -- treat both as sensitive, same as ~/.ssh.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./dataDir');

const KEY_PATH = path.join(DATA_DIR, '.key');
const ALGO = 'aes-256-gcm';

function loadOrCreateKey() {
  if (fs.existsSync(KEY_PATH)) {
    return fs.readFileSync(KEY_PATH);
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
  fs.writeFileSync(KEY_PATH, key, { mode: 0o600 });
  return key;
}

const KEY = loadOrCreateKey();

function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(payload) {
  if (!payload) return null;
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  try {
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    // This means backend/data/.key doesn't match whatever encrypted this
    // value -- almost always because the .key file and devices.json got
    // separated (one replaced/regenerated without the other). The original
    // secret can't be recovered without the original key; the device will
    // need its credential re-entered, or restored from a backup export
    // made before the mismatch happened.
    throw new Error('Could not decrypt stored credential -- data/.key does not match the key this value was encrypted with');
  }
}

module.exports = { encrypt, decrypt, encryptWithPassphrase, decryptWithPassphrase };

// ---- Passphrase-based encryption for exportable backup files ----
// Distinct from encrypt()/decrypt() above: those use a key generated once
// per install and never leave this machine, so they can't be used for a
// backup file meant to be portable. These derive a key from a passphrase
// the user chooses at export time, so the file is self-contained and can
// be restored on a different install (or the same one after reinstalling).

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32);
}

function encryptWithPassphrase(passphrase, plaintext) {
  const salt = crypto.randomBytes(16);
  const key = deriveKey(passphrase, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

function decryptWithPassphrase(passphrase, blob) {
  const salt = Buffer.from(blob.salt, 'base64');
  const key = deriveKey(passphrase, salt);
  const iv = Buffer.from(blob.iv, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  const data = Buffer.from(blob.data, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}
