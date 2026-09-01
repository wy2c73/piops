const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { sendWebhook } = require('../lib/alertNotifier');

let lastCall;
let mockResponse;
const realFetch = global.fetch;

beforeEach(() => {
  lastCall = null;
  mockResponse = { ok: true, status: 200 };
  global.fetch = async (url, options) => {
    lastCall = { url, options };
    return mockResponse;
  };
});

afterEach(() => {
  global.fetch = realFetch;
});

test('throws immediately if no webhook URL is configured', async () => {
  await assert.rejects(() => sendWebhook({ webhookUrl: '' }, { title: 't', message: 'm' }), /webhook url/i);
});

test('discord format: bold title + message in a single "content" field', async () => {
  await sendWebhook({ webhookUrl: 'https://discord.example/hook', format: 'discord' }, { title: 'Pi is down', message: 'stopped responding' });
  const body = JSON.parse(lastCall.options.body);
  assert.equal(body.content, '**Pi is down**\nstopped responding');
  assert.equal(lastCall.options.headers['Content-Type'], 'application/json');
});

test('slack format: italic title + message in a "text" field', async () => {
  await sendWebhook({ webhookUrl: 'https://slack.example/hook', format: 'slack' }, { title: 'Pi is down', message: 'stopped responding' });
  const body = JSON.parse(lastCall.options.body);
  assert.equal(body.text, '*Pi is down*\nstopped responding');
});

test('ntfy format: plain-text body, title in a header instead of the body', async () => {
  await sendWebhook({ webhookUrl: 'https://ntfy.example/topic', format: 'ntfy' }, { title: 'Pi is down', message: 'stopped responding' });
  assert.equal(lastCall.options.body, 'stopped responding');
  assert.equal(lastCall.options.headers.Title, 'Pi is down');
  assert.match(lastCall.options.headers['Content-Type'], /text\/plain/);
});

test('generic format (default, and any unrecognized value): plain {title, message} JSON', async () => {
  await sendWebhook({ webhookUrl: 'https://example.com/hook', format: 'generic' }, { title: 'Pi is down', message: 'stopped responding' });
  assert.deepEqual(JSON.parse(lastCall.options.body), { title: 'Pi is down', message: 'stopped responding' });

  await sendWebhook({ webhookUrl: 'https://example.com/hook', format: 'something-unrecognized' }, { title: 'x', message: 'y' });
  assert.deepEqual(JSON.parse(lastCall.options.body), { title: 'x', message: 'y' });
});

test('every format actually posts to the configured URL', async () => {
  await sendWebhook({ webhookUrl: 'https://example.com/my-hook', format: 'generic' }, { title: 't', message: 'm' });
  assert.equal(lastCall.url, 'https://example.com/my-hook');
  assert.equal(lastCall.options.method, 'POST');
});

test('throws when the endpoint responds with a non-OK status', async () => {
  mockResponse = { ok: false, status: 503 };
  await assert.rejects(
    () => sendWebhook({ webhookUrl: 'https://example.com/hook', format: 'generic' }, { title: 't', message: 'm' }),
    /503/
  );
});
