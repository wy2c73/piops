const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestServer } = require('./helpers');

let baseUrl, close, token;

before(async () => {
  ({ baseUrl, close } = await setupTestServer());
  const res = await fetch(`${baseUrl}/api/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'Prometheus' }),
  });
  ({ token } = await res.json());
});

after(async () => {
  await close();
});

test('rejects a request with no token', async () => {
  const res = await fetch(`${baseUrl}/metrics`);
  assert.equal(res.status, 401);
});

test('rejects an invalid token', async () => {
  const res = await fetch(`${baseUrl}/metrics`, { headers: { Authorization: 'Bearer garbage' } });
  assert.equal(res.status, 401);
});

test('returns Prometheus text-exposition format with a valid token', async () => {
  const res = await fetch(`${baseUrl}/metrics`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);

  const body = await res.text();
  assert.match(body, /# HELP piops_device_up/);
  assert.match(body, /# TYPE piops_device_up gauge/);
  assert.match(body, /# HELP piops_build_info/);
  assert.match(body, /piops_build_info\{version="[\d.]+"\} 1/);
});

test('includes a real device with correctly formatted labels and values', async () => {
  await fetch(`${baseUrl}/api/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Metrics Test Pi', host: '127.0.0.1', port: 54370, username: 'pi', authType: 'password', secret: 'x', group: 'Home Lab' }),
  });

  const res = await fetch(`${baseUrl}/metrics`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.text();

  assert.match(body, /piops_device_up\{device_id="[^"]+",name="Metrics Test Pi",host="127\.0\.0\.1",group="Home Lab"\} 0/, 'unreachable test device should report as down (0)');
});

test('escapes label values containing quotes and backslashes', async () => {
  await fetch(`${baseUrl}/api/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Weird "Name" \\ Here', host: '127.0.0.1', port: 54371, username: 'pi', authType: 'password', secret: 'x' }),
  });

  const res = await fetch(`${baseUrl}/metrics`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.text();

  assert.match(body, /name="Weird \\"Name\\" \\\\ Here"/);
});

test('omits a metric line entirely rather than emitting an invalid value when data is missing', async () => {
  // A device that's never been polled (status "unknown") has no cpuUsedPct
  // etc. -- the metric line for it should be skipped, not emitted as
  // e.g. "piops_cpu_used_percent{...} null" or "NaN", either of which
  // Prometheus would reject as invalid.
  const res = await fetch(`${baseUrl}/metrics`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.text();
  assert.equal(body.includes('null'), false);
  assert.equal(body.includes('NaN'), false);
  assert.equal(body.includes('undefined'), false);
});

test('a valid token works even when the dashboard password gate is enabled', async () => {
  await fetch(`${baseUrl}/api/auth/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'setPassword', newPassword: 'correct-horse-battery' }),
  });

  try {
    const dashboardRes = await fetch(`${baseUrl}/api/devices`);
    assert.equal(dashboardRes.status, 401, 'sanity check: the password gate should actually be active now');

    const metricsRes = await fetch(`${baseUrl}/metrics`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(metricsRes.status, 200);
  } finally {
    await fetch(`${baseUrl}/api/auth/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disable', currentPassword: 'correct-horse-battery' }),
    });
  }
});
