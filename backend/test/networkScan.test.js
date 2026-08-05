const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCidr, compareIps, detectLocalCidr } = require('../lib/networkScan');

test('parseCidr: /24 produces 254 addresses, excluding network and broadcast', () => {
  const addrs = parseCidr('192.168.1.0/24');
  assert.equal(addrs.length, 254);
  assert.equal(addrs[0], '192.168.1.1');
  assert.equal(addrs[addrs.length - 1], '192.168.1.254');
});

test('parseCidr: /30 produces exactly 2 addresses', () => {
  assert.deepEqual(parseCidr('10.0.0.0/30'), ['10.0.0.1', '10.0.0.2']);
});

test('parseCidr: rejects a range larger than /20 (too slow to scan)', () => {
  assert.throws(() => parseCidr('10.0.0.0/16'), /supported|too many/i);
});

test('parseCidr: rejects malformed input', () => {
  assert.throws(() => parseCidr('not-a-cidr'));
  assert.throws(() => parseCidr('192.168.1.999/24'));
  assert.throws(() => parseCidr(''));
});

test('compareIps: sorts numerically, not as strings', () => {
  // A plain string sort would put "192.168.1.100" before "192.168.1.9"
  // (alphabetical: '1' < '9') -- this is exactly the bug this guards.
  const ips = ['192.168.1.100', '192.168.1.2', '192.168.1.20', '192.168.1.9'];
  assert.deepEqual(
    ips.sort(compareIps),
    ['192.168.1.2', '192.168.1.9', '192.168.1.20', '192.168.1.100']
  );
});

test('detectLocalCidr: returns a plausible /24 CIDR string', () => {
  const cidr = detectLocalCidr();
  assert.match(cidr, /^\d{1,3}\.\d{1,3}\.\d{1,3}\.0\/24$/);
});
