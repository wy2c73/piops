// Discovers candidate devices by TCP-connect-scanning a subnet for an open
// port (22 by default). Deliberately a plain TCP connect scan, not
// ICMP/SYN -- those need raw sockets and root; this needs neither and
// works identically on any OS Node runs on.

const net = require('net');
const dns = require('dns').promises;
const os = require('os');

const SCAN_TIMEOUT_MS = 400;
const SCAN_CONCURRENCY = 40;
const MAX_ADDRESSES = 1022; // caps it at /22 so a scan can't accidentally take minutes

function detectLocalCidr() {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const info of iface || []) {
      if (info.family === 'IPv4' && !info.internal) {
        const parts = info.address.split('.');
        return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
      }
    }
  }
  return '192.168.1.0/24';
}

function parseCidr(cidr) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec((cidr || '').trim());
  if (!match) throw new Error('Enter a CIDR range like 192.168.1.0/24');
  const octets = match.slice(1, 5).map(Number);
  const maskBits = Number(match[5]);
  if (octets.some((o) => o < 0 || o > 255)) throw new Error('Invalid IP address in CIDR');
  if (maskBits < 20 || maskBits > 30) throw new Error('Only /20 through /30 subnets are supported (max 1022 addresses)');

  const baseInt = (octets[0] << 24) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
  const hostBits = 32 - maskBits;
  const total = 2 ** hostBits;
  if (total - 2 > MAX_ADDRESSES) throw new Error(`That range has too many addresses (max ${MAX_ADDRESSES})`);
  const network = baseInt & (~0 << hostBits);

  const addresses = [];
  for (let i = 1; i < total - 1; i++) { // skip network (.0) and broadcast addresses
    const n = network + i;
    addresses.push([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
  }
  return addresses;
}

function compareIps(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 4; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function checkPort(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, ip);
  });
}

async function reverseLookup(ip) {
  try {
    const names = await dns.reverse(ip);
    return names[0] ? names[0].replace(/\.$/, '') : null;
  } catch {
    return null;
  }
}

async function scanSubnet(cidr, port) {
  const addresses = parseCidr(cidr);
  const targetPort = Number(port) || 22;
  const found = [];
  const queue = [...addresses];

  async function worker() {
    while (queue.length) {
      const ip = queue.shift();
      const isOpen = await checkPort(ip, targetPort, SCAN_TIMEOUT_MS);
      if (isOpen) {
        const hostname = await reverseLookup(ip);
        found.push({ ip, hostname });
      }
    }
  }

  await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, () => worker()));
  found.sort((a, b) => compareIps(a.ip, b.ip));
  return found;
}

module.exports = { detectLocalCidr, parseCidr, scanSubnet, compareIps };
