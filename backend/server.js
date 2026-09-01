const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');

// Defense in depth: an uncaught error in one request (e.g. a corrupted
// stored credential) should never take down monitoring for the whole
// fleet. Log it and keep running rather than crashing the process.
process.on('unhandledRejection', (err) => {
  console.error('[server] Unhandled promise rejection (server is still running):', err);
});
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception (server is still running):', err);
});

const devicesRouter = require('./routes/devices');
const backupRouter = require('./routes/backup');
const groupsRouter = require('./routes/groups');
const alertsRouter = require('./routes/alerts');
const commandsRouter = require('./routes/commands');
const scanRouter = require('./routes/scan');
const settingsRouter = require('./routes/settings');
const apiTokensRouter = require('./routes/apiTokens');
const apiV1Router = require('./routes/apiV1');
const authRouter = require('./routes/auth');
const auth = require('./lib/auth');
const { checkForUpdate } = require('./lib/updateCheck');
const autoBackup = require('./lib/autoBackup');
const poller = require('./poller');
const wsTerminal = require('./wsTerminal');

const PORT = process.env.PORT || 3000;
// Bind to all interfaces so the dashboard is reachable at the host's LAN IP,
// not just localhost. Override with HOST=127.0.0.1 to restrict to local-only.
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Paths reachable without a session even when the password gate is on --
// the login page itself, its supporting assets, and health/version info
// that isn't sensitive.
const PUBLIC_PATHS = new Set(['/login.html', '/style.css', '/api/health', '/api/version']);

app.use('/api/auth', authRouter);
app.use('/api/v1', apiV1Router); // own token-based auth (see requireToken in routes/apiV1.js) -- bypasses the session gate below entirely, same reason /api/auth does
app.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path) || auth.isAuthenticated(req)) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/ws/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  return res.redirect('/login.html');
});

app.use('/api/devices', devicesRouter);
app.use('/api/backup', backupRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/commands', commandsRouter);
app.use('/api/scan', scanRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/tokens', apiTokensRouter);
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/version', (req, res) => res.json({ version: require('./package.json').version }));
app.get('/api/version/check', async (req, res) => {
  try {
    res.json(await checkForUpdate());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Serve the static frontend (no build step needed). no-cache forces the
// browser to revalidate on every load instead of serving a stale copy of
// index.html/app.js/style.css after an update -- important since this
// project gets updated in place fairly often.
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR, {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return res.status(404).end();
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

const server = http.createServer(app);
// Node's http server kills any request still open after 5 minutes by
// default (server.requestTimeout). Custom quick commands can legitimately
// run longer than that (e.g. a full package upgrade), so disable it here --
// the per-command timeout in routes/devices.js is the real limit instead.
server.requestTimeout = 0;
server.headersTimeout = 0;

// Two websocket endpoints on the same HTTP server, routed by path.
const statsWss = new WebSocketServer({ noServer: true });
const terminalWss = new WebSocketServer({ noServer: true });

statsWss.on('connection', (ws) => {
  poller.subscribe(ws);
  ws.send(JSON.stringify({ type: 'snapshot', stats: poller.getAllCached() }));
});
wsTerminal.attach(terminalWss);

server.on('upgrade', (req, socket, head) => {
  if (!auth.isAuthenticated(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/ws/stats') {
    statsWss.handleUpgrade(req, socket, head, (ws) => statsWss.emit('connection', ws, req));
  } else if (url.pathname === '/ws/terminal') {
    terminalWss.handleUpgrade(req, socket, head, (ws) => terminalWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// Starting the poller and binding to a port are real side effects that
// tests need to avoid -- guard them so `require('./server')` (used by
// the test suite to get the Express app) doesn't also start polling
// devices or bind a port. Running it normally (`node server.js`) is
// completely unaffected: require.main === module is true in that case,
// so this still runs exactly as before.
if (require.main === module) {
  poller.start();

  // Checked hourly -- cheap no-op unless a backup is actually due (see
  // lib/autoBackup.js). Also runs once at startup so a backup that was
  // due while the server was down gets caught up on promptly rather
  // than waiting for the next hourly tick.
  autoBackup.maybeRunScheduledBackup();
  setInterval(() => autoBackup.maybeRunScheduledBackup(), 60 * 60 * 1000);

  server.listen(PORT, HOST, () => {
    console.log(`PiOps listening on ${HOST}:${PORT}`);
    console.log(`  -> http://localhost:${PORT}`);
    for (const addr of listLanAddresses()) {
      console.log(`  -> http://${addr}:${PORT}`);
    }
  });
}

function listLanAddresses() {
  const os = require('os');
  const results = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const info of iface || []) {
      if (info.family === 'IPv4' && !info.internal) results.push(info.address);
    }
  }
  return results;
}

module.exports = { app, server };
