// Polls every registered device on an interval, keeps the latest stats in
// memory, and broadcasts updates to any connected dashboard clients over
// the /ws/stats websocket so the UI updates live without polling itself.

const store = require('./lib/store');
const { collectStats } = require('./lib/ssh');

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15000);
const CONCURRENCY = Number(process.env.POLL_CONCURRENCY || 5);

const cache = new Map(); // deviceId -> stats
const subscribers = new Set(); // ws clients

function getCached(id) {
  return cache.get(id) || null;
}

function getAllCached() {
  const out = {};
  for (const [id, stats] of cache.entries()) out[id] = stats;
  return out;
}

function broadcast(deviceId, stats) {
  const payload = JSON.stringify({ type: 'stats', deviceId, stats });
  for (const ws of subscribers) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

function subscribe(ws) {
  subscribers.add(ws);
  ws.on('close', () => subscribers.delete(ws));
}

async function pollDevice(device) {
  const stats = await collectStats(device);
  cache.set(device.id, stats);
  broadcast(device.id, stats);
  return stats;
}

// Simple concurrency-limited batch runner so a fleet of 30+ Pis doesn't
// open 30 simultaneous SSH connections at once.
async function pollAll() {
  const devices = store.list();
  const queue = [...devices];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const device = queue.shift();
      if (!device) return;
      try {
        await pollDevice(store.getWithSecret(device.id));
      } catch (err) {
        cache.set(device.id, {
          status: 'offline',
          error: err.message,
          lastSeen: null,
        });
      }
    }
  });
  await Promise.all(workers);
}

let interval;
function start() {
  pollAll();
  interval = setInterval(pollAll, POLL_INTERVAL_MS);
}

function stop() {
  if (interval) clearInterval(interval);
}

// Called after add/edit/delete or a manual refresh so the UI doesn't wait
// for the next scheduled tick.
async function refreshDevice(id) {
  const device = store.getWithSecret(id);
  if (!device) {
    cache.delete(id);
    return null;
  }
  return pollDevice(device);
}

module.exports = { start, stop, getCached, getAllCached, subscribe, refreshDevice, pollAll };
