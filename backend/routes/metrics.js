// Prometheus text-exposition-format metrics -- for a Prometheus server
// to scrape directly and store as proper time-series data (the more
// idiomatic path if you already run Prometheus + Grafana, vs. pointing
// a generic JSON datasource plugin at routes/apiV1.js instead).
//
// Token-authenticated the same way as the rest of the read API (see
// lib/apiTokens.js's requireToken) -- Prometheus's scrape_configs
// support a bearer token natively, so this doesn't need a different
// auth mechanism just because the consumer is a scraper instead of a
// browser. Read-only, same as everywhere else this token type reaches.

const express = require('express');
const router = express.Router();
const store = require('../lib/store');
const poller = require('../poller');
const apiTokens = require('../lib/apiTokens');
const packageJson = require('../package.json');

router.use(apiTokens.requireToken);

// Prometheus label values must escape backslashes, double quotes, and
// newlines -- see https://prometheus.io/docs/instrumenting/exposition_formats/
function escapeLabel(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function labels(device) {
  return `device_id="${escapeLabel(device.id)}",name="${escapeLabel(device.name)}",host="${escapeLabel(device.host)}",group="${escapeLabel(device.group || '')}"`;
}

// One gauge per metric (not one line per device crammed into a single
// metric with a "field" label) -- this is the conventional Prometheus
// shape, and the one Grafana panels expect without extra transforms.
function buildMetricBlock(name, help, devices, cache, extract) {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`];
  for (const device of devices) {
    const value = extract(cache[device.id]);
    if (value !== null && value !== undefined) {
      lines.push(`${name}{${labels(device)}} ${value}`);
    }
  }
  return lines.join('\n');
}

router.get('/', (req, res) => {
  const devices = store.list();
  const cache = poller.getAllCached();

  const blocks = [
    buildMetricBlock('piops_device_up', 'Whether PiOps most recently reached this device (1) or not (0)', devices, cache, (s) => (s?.status === 'online' ? 1 : 0)),
    buildMetricBlock('piops_cpu_used_percent', 'CPU usage percent', devices, cache, (s) => s?.cpuUsedPct),
    buildMetricBlock('piops_memory_used_percent', 'Memory usage percent', devices, cache, (s) => s?.memory?.usedPct),
    buildMetricBlock('piops_disk_used_percent', 'Disk usage percent', devices, cache, (s) => s?.disk?.usedPct),
    buildMetricBlock('piops_temperature_celsius', 'CPU temperature in Celsius, regardless of the dashboard\'s display unit preference', devices, cache, (s) => s?.tempC),
    buildMetricBlock('piops_services_running', 'Number of running services detected', devices, cache, (s) => s?.servicesRunning),
    buildMetricBlock('piops_undervoltage', 'Raspberry Pi under-voltage currently detected (1) or not (0) -- absent for hardware that doesn\'t report this', devices, cache, (s) => (s?.throttled?.available ? (s.throttled.underVoltageNow ? 1 : 0) : null)),
    buildMetricBlock('piops_throttled', 'Raspberry Pi CPU throttling currently active (1) or not (0) -- absent for hardware that doesn\'t report this', devices, cache, (s) => (s?.throttled?.available ? (s.throttled.throttledNow ? 1 : 0) : null)),
    [
      '# HELP piops_build_info Which PiOps version generated these metrics',
      '# TYPE piops_build_info gauge',
      `piops_build_info{version="${escapeLabel(packageJson.version)}"} 1`,
    ].join('\n'),
  ];

  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(blocks.join('\n\n') + '\n');
});

module.exports = router;
