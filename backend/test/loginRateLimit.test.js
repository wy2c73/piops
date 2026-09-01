const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const rateLimit = require('../lib/loginRateLimit');

function mockReq(ip) {
  return { ip, socket: { remoteAddress: ip } };
}

beforeEach(() => {
  rateLimit._resetForTests();
  rateLimit._setTimingForTests({ maxAttempts: 5, windowMs: 15 * 60 * 1000, lockoutMs: 15 * 60 * 1000 });
});

test('allows requests with no prior history', () => {
  assert.equal(rateLimit.checkRateLimit(mockReq('1.1.1.1')).allowed, true);
});

test('stays allowed for failures under the limit', () => {
  const req = mockReq('1.1.1.2');
  for (let i = 0; i < rateLimit.MAX_ATTEMPTS - 1; i++) {
    rateLimit.recordFailure(req);
    assert.equal(rateLimit.checkRateLimit(req).allowed, true, `should still be allowed after ${i + 1} failures`);
  }
});

test('locks out after reaching the failure limit', () => {
  const req = mockReq('1.1.1.3');
  for (let i = 0; i < rateLimit.MAX_ATTEMPTS; i++) rateLimit.recordFailure(req);
  const result = rateLimit.checkRateLimit(req);
  assert.equal(result.allowed, false);
  assert.ok(result.retryAfterMs > 0);
});

test('different IPs have independent buckets', () => {
  const attacker = mockReq('2.2.2.2');
  const bystander = mockReq('2.2.2.3');
  for (let i = 0; i < rateLimit.MAX_ATTEMPTS; i++) rateLimit.recordFailure(attacker);

  assert.equal(rateLimit.checkRateLimit(attacker).allowed, false, 'attacker should be locked out');
  assert.equal(rateLimit.checkRateLimit(bystander).allowed, true, 'a different IP should be unaffected');
});

test('a success resets the counter', () => {
  const req = mockReq('3.3.3.3');
  for (let i = 0; i < rateLimit.MAX_ATTEMPTS - 1; i++) rateLimit.recordFailure(req);
  rateLimit.recordSuccess(req);

  // Should now behave like a fresh IP -- not one failure away from lockout.
  for (let i = 0; i < rateLimit.MAX_ATTEMPTS - 1; i++) {
    rateLimit.recordFailure(req);
    assert.equal(rateLimit.checkRateLimit(req).allowed, true);
  }
});

test('lockout actually expires after the configured duration', async () => {
  rateLimit._setTimingForTests({ maxAttempts: 3, windowMs: 200, lockoutMs: 100 });
  const req = mockReq('4.4.4.4');
  for (let i = 0; i < 3; i++) rateLimit.recordFailure(req);
  assert.equal(rateLimit.checkRateLimit(req).allowed, false, 'should be locked out immediately after hitting the limit');

  await new Promise((r) => setTimeout(r, 150));
  assert.equal(rateLimit.checkRateLimit(req).allowed, true, 'lockout should have expired by now');
});

test('old failures outside the window do not count toward a lockout', async () => {
  rateLimit._setTimingForTests({ maxAttempts: 3, windowMs: 50, lockoutMs: 10000 });
  const req = mockReq('5.5.5.5');
  rateLimit.recordFailure(req);
  rateLimit.recordFailure(req);

  await new Promise((r) => setTimeout(r, 80)); // let the window expire

  rateLimit.recordFailure(req); // this should start a fresh window, not be the 3rd strike
  assert.equal(rateLimit.checkRateLimit(req).allowed, true, 'stale failures should not carry over into a new window');
});
