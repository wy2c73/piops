const express = require('express');
const router = express.Router();
const auth = require('../lib/auth');

router.get('/status', (req, res) => {
  const config = auth.loadAuthConfig();
  res.json({ enabled: config.enabled, authenticated: auth.isAuthenticated(req) });
});

router.post('/login', (req, res) => {
  const config = auth.loadAuthConfig();
  if (!config.enabled) return res.json({ ok: true }); // nothing to log into
  const { password } = req.body || {};
  if (!auth.verifyPassword(password, config)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  res.setHeader('Set-Cookie', auth.sessionCookieHeader(auth.createSessionToken()));
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', auth.clearCookieHeader());
  res.json({ ok: true });
});

// Enabling for the first time needs no current password (there isn't one
// yet). Changing the password or disabling once it's already on requires
// the current password.
router.put('/config', (req, res) => {
  const config = auth.loadAuthConfig();
  if (config.enabled && !auth.isAuthenticated(req)) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { action, currentPassword, newPassword } = req.body || {};

  if (action === 'disable') {
    if (config.enabled && !auth.verifyPassword(currentPassword, config)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    auth.disable();
    res.setHeader('Set-Cookie', auth.clearCookieHeader());
    return res.json({ enabled: false });
  }

  if (action === 'setPassword') {
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (config.enabled && !auth.verifyPassword(currentPassword, config)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    auth.setPassword(newPassword);
    res.setHeader('Set-Cookie', auth.sessionCookieHeader(auth.createSessionToken()));
    return res.json({ enabled: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
});

module.exports = router;
