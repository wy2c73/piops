const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestServer } = require('./helpers');

let baseUrl, close;

before(async () => {
  ({ baseUrl, close } = await setupTestServer());
});

after(async () => {
  await close();
});

test('GET /api/alerts returns sensible defaults (off, generic format)', async () => {
  const res = await fetch(`${baseUrl}/api/alerts`);
  const config = await res.json();
  assert.equal(config.enabled, false);
  assert.equal(config.format, 'generic');
  assert.equal(config.notify.offline, true);
});

test('PUT /api/alerts saves a partial update without clobbering the rest', async () => {
  await fetch(`${baseUrl}/api/alerts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, webhookUrl: 'https://example.com/hook' }),
  });

  // A second, unrelated partial update shouldn't wipe out the first one --
  // this is exactly the kind of thing a naive "replace the whole object"
  // implementation would get wrong.
  const res = await fetch(`${baseUrl}/api/alerts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'discord' }),
  });
  const updated = await res.json();
  assert.equal(updated.enabled, true);
  assert.equal(updated.webhookUrl, 'https://example.com/hook');
  assert.equal(updated.format, 'discord');
});

test('PUT /api/alerts merges nested notify/thresholds instead of replacing them', async () => {
  await fetch(`${baseUrl}/api/alerts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notify: { cpu: true } }),
  });
  const res = await fetch(`${baseUrl}/api/alerts`);
  const config = await res.json();
  assert.equal(config.notify.cpu, true);
  // offline/recovery/etc should still be at their defaults, not wiped out
  // by only setting cpu.
  assert.equal(config.notify.offline, true);
  assert.equal(config.notify.recovery, true);
});

test('POST /api/alerts/test fails cleanly with no webhook URL configured', async () => {
  // Fresh config for this test -- disable and clear whatever earlier tests set.
  await fetch(`${baseUrl}/api/alerts`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhookUrl: '' }),
  });
  const res = await fetch(`${baseUrl}/api/alerts/test`, { method: 'POST' });
  assert.equal(res.status, 400);
});
