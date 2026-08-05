const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isNewer } = require('../lib/updateCheck');

test('isNewer: basic version comparisons', () => {
  assert.equal(isNewer('1.7.0', '1.6.0'), true);
  assert.equal(isNewer('1.6.0', '1.7.0'), false);
  assert.equal(isNewer('1.7.0', '1.7.0'), false);
  assert.equal(isNewer('2.0.0', '1.9.9'), true);
});

test('isNewer: numeric comparison, not string comparison', () => {
  // A naive string compare would get this backwards ("1.7.10" < "1.7.9"
  // alphabetically, since '1' < '9'), which is exactly the kind of bug
  // this test exists to catch.
  assert.equal(isNewer('1.7.10', '1.7.9'), true);
  assert.equal(isNewer('1.7.9', '1.7.10'), false);
  assert.equal(isNewer('1.10.0', '1.9.0'), true);
});

test('isNewer: missing version parts default to 0', () => {
  assert.equal(isNewer('2', '1.9.9'), true);
  assert.equal(isNewer('1.2', '1.2.0'), false);
});
