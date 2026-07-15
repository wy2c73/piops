// All the "agentless" logic lives here: open an SSH connection, run a
// small shell script that prints system info in a delimited format,
// parse it, close the connection. No software to install on the Pis.

const { Client } = require('ssh2');

const CONNECT_TIMEOUT_MS = 8000;
const EXEC_TIMEOUT_MS = 10000;

function connect(device) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const opts = {
      host: device.host,
      port: device.port || 22,
      username: device.username,
      readyTimeout: CONNECT_TIMEOUT_MS,
    };
    if (device.authType === 'key') {
      opts.privateKey = device.secret;
      if (device.passphrase) opts.passphrase = device.passphrase;
    } else {
      opts.password = device.secret;
    }

    const timer = setTimeout(() => {
      conn.end();
      reject(new Error('Connection timed out'));
    }, CONNECT_TIMEOUT_MS + 2000);

    conn
      .on('ready', () => {
        clearTimeout(timer);
        resolve(conn);
      })
      .on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      })
      .connect(opts);
  });
}

function exec(conn, command) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('Command timed out')), EXEC_TIMEOUT_MS);
    conn.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        return reject(err);
      }
      stream
        .on('close', (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        })
        .on('data', (data) => {
          stdout += data.toString();
        })
        .stderr.on('data', (data) => {
          stderr += data.toString();
        });
    });
  });
}

// Runs a (potentially multi-line, heavily-quoted) shell script over SSH by
// base64-encoding it client-side and decoding it on the remote end, so what
// actually goes over the exec channel is one compact, quote-free line.
// This sidesteps an entire class of issues where multi-line or heavily
// escaped commands get mangled somewhere between here and the remote shell.
function execScript(conn, script) {
  const encoded = Buffer.from(script, 'utf8').toString('base64');
  return exec(conn, `echo '${encoded}' | base64 -d | sh`);
}

// One round trip: gather hostname, uptime, load, memory, disk, temp and a
// running-service count. Delimited with markers so parsing is trivial and
// resilient to any single command failing (e.g. vcgencmd on non-Pi hosts).
const STATS_SCRIPT = `
echo "__HOSTNAME__"; hostname
echo "__UPTIME__"; uptime -p 2>/dev/null || uptime
echo "__LOAD__"; cat /proc/loadavg
echo "__MEM__"; free -m | awk '/Mem:/ {print $2, $3, $7}'
echo "__DISK__"; df -h / | awk 'NR==2 {print $2, $3, $5}'
echo "__TEMP__"; (vcgencmd measure_temp 2>/dev/null || awk '{printf "temp=%.1f'"'"'C\\n", $1/1000}' /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo "temp=N/A")
echo "__CPU__"; top -bn1 | grep -i "Cpu(s)" || grep 'cpu ' /proc/stat
echo "__SERVICES_RUNNING__"; systemctl list-units --type=service --state=running --no-legend 2>/dev/null | wc -l
echo "__OS__"; (grep PRETTY_NAME /etc/os-release | cut -d= -f2 | tr -d '"') 2>/dev/null
echo "__KERNEL__"; uname -r
echo "__MODEL__"
if [ -f /proc/device-tree/model ]; then
  tr -d '\0' < /proc/device-tree/model; echo
elif grep -q '^Model' /proc/cpuinfo 2>/dev/null; then
  grep -m1 '^Model' /proc/cpuinfo | cut -d: -f2 | sed 's/^ *//'
else
  echo "Unknown"
fi
echo "__DONE__"
`;

function parseSection(raw, marker) {
  const re = new RegExp(`__${marker}__\\n([\\s\\S]*?)(?=\\n__|$)`);
  const m = raw.match(re);
  return m ? m[1].trim() : '';
}

async function collectStats(device) {
  const startedAt = Date.now();
  let conn;
  try {
    conn = await connect(device);
    const { stdout } = await execScript(conn, STATS_SCRIPT);

    const mem = parseSection(stdout, 'MEM').split(/\s+/).map(Number); // total used available (MB)
    const disk = parseSection(stdout, 'DISK').split(/\s+/); // size used pct
    const load = parseSection(stdout, 'LOAD').split(/\s+/); // 1m 5m 15m ...
    const cpuLine = parseSection(stdout, 'CPU');
    const cpuIdleMatch = cpuLine.match(/([\d.]+)\s*%?\s*id/i);
    const cpuUsedPct = cpuIdleMatch ? Math.max(0, 100 - parseFloat(cpuIdleMatch[1])) : null;
    const tempLine = parseSection(stdout, 'TEMP');
    const tempMatch = tempLine.match(/([\d.]+)\s*'?C/i);

    return {
      status: 'online',
      hostname: parseSection(stdout, 'HOSTNAME'),
      os: parseSection(stdout, 'OS'),
      kernel: parseSection(stdout, 'KERNEL'),
      model: parseSection(stdout, 'MODEL'),
      uptime: parseSection(stdout, 'UPTIME'),
      loadAvg: { '1m': Number(load[0]), '5m': Number(load[1]), '15m': Number(load[2]) },
      memory: mem.length === 3 ? { totalMb: mem[0], usedMb: mem[1], availableMb: mem[2], usedPct: Math.round((mem[1] / mem[0]) * 100) } : null,
      disk: disk.length === 3 ? { size: disk[0], used: disk[1], usedPct: parseInt(disk[2], 10) } : null,
      cpuUsedPct: cpuUsedPct !== null ? Math.round(cpuUsedPct) : null,
      tempC: tempMatch ? parseFloat(tempMatch[1]) : null,
      servicesRunning: parseInt(parseSection(stdout, 'SERVICES_RUNNING'), 10) || 0,
      latencyMs: Date.now() - startedAt,
      lastSeen: new Date().toISOString(),
      error: null,
    };
  } catch (err) {
    console.error(`[ssh] ${device.host}:${device.port} (${device.username}) stats collection failed:`, {
      message: err.message,
      level: err.level,
      code: err.code,
    });
    return {
      status: 'offline',
      hostname: null,
      os: null,
      kernel: null,
      model: null,
      uptime: null,
      loadAvg: null,
      memory: null,
      disk: null,
      cpuUsedPct: null,
      tempC: null,
      servicesRunning: null,
      latencyMs: Date.now() - startedAt,
      lastSeen: null,
      error: err.message,
    };
  } finally {
    if (conn) conn.end();
  }
}

async function listServices(device) {
  const conn = await connect(device);
  try {
    const { stdout } = await execScript(
      conn,
      "systemctl list-units --type=service --all --no-legend --no-pager | head -n 300"
    );
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        // format: unit.service loaded active running Description text...
        const match = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/);
        if (!match) return null;
        const [, name, load, active, sub, description] = match;
        return { name, load, active, sub, description };
      })
      .filter(Boolean);
  } finally {
    conn.end();
  }
}

async function testConnection(device) {
  const conn = await connect(device);
  conn.end();
  return true;
}

// Ports commonly used by self-hosted web UIs on a home-lab Pi fleet (Grafana,
// Home Assistant, Node-RED, Plex, Jellyfin, Pi-hole, etc). Recognized ports
// get rendered as a clickable link in the UI; anything else is just listed.
const COMMON_HTTP_PORTS = new Set([80, 1880, 3000, 3001, 4000, 5000, 5001, 8000, 8008, 8080, 8081, 8096, 8123, 8181, 8888, 9000, 9090, 9091, 32400]);
const COMMON_HTTPS_PORTS = new Set([443, 8443, 9443]);

async function listPorts(device) {
  const conn = await connect(device);
  try {
    const { stdout } = await execScript(
      conn,
      "(ss -tln 2>/dev/null || netstat -tln 2>/dev/null) | grep LISTEN | awk '{print $4}'"
    );
    const ports = new Set();
    stdout.split('\n').forEach((line) => {
      const match = line.trim().match(/:(\d+)$/);
      if (match) ports.add(parseInt(match[1], 10));
    });
    return [...ports].sort((a, b) => a - b).map((port) => ({
      port,
      scheme: COMMON_HTTPS_PORTS.has(port) ? 'https' : COMMON_HTTP_PORTS.has(port) ? 'http' : null,
    }));
  } finally {
    conn.end();
  }
}

module.exports = { connect, exec, execScript, collectStats, listServices, listPorts, testConnection };
