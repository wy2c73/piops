// Tests buildLineChartSvg() by extracting it directly from app.js (not
// a reimplementation), the same brace-balanced extraction approach used
// for the settings-sync tests, so this can't silently drift from what
// actually ships.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const APP_JS = path.join(__dirname, '..', '..', 'frontend', 'app.js');
const source = fs.readFileSync(APP_JS, 'utf8');

const startMatch = source.match(/function buildLineChartSvg\([^)]*\)\s*\{/);
if (!startMatch) throw new Error('Could not find buildLineChartSvg() in app.js -- has it been renamed?');
// Start counting braces from the body's own opening brace (the last
// character startMatch captured), not from the function name -- the
// destructured parameter list itself contains a {...} that closes
// before the body even begins, which would otherwise be mistaken for it.
const bodyStart = startMatch.index + startMatch[0].length - 1;
let depth = 0;
let end = bodyStart;
for (; end < source.length; end++) {
  if (source[end] === '{') depth++;
  if (source[end] === '}') {
    depth--;
    if (depth === 0) { end++; break; }
  }
}
const functionSource = source.slice(startMatch.index, end);

const context = {};
vm.createContext(context);
vm.runInContext(functionSource, context);
const { buildLineChartSvg } = context;

test('returns null with fewer than 2 usable points', () => {
  assert.equal(buildLineChartSvg([]), null);
  assert.equal(buildLineChartSvg([5]), null);
  assert.equal(buildLineChartSvg([null, null, null]), null);
  assert.equal(buildLineChartSvg([null, 5, null]), null, 'only one real value among nulls is still not enough to draw a line');
});

test('produces a valid SVG string for two or more points', () => {
  const svg = buildLineChartSvg([10, 20, 15]);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<polyline /);
  assert.match(svg, /<\/svg>$/);
});

test('filters out null/undefined/NaN values before plotting', () => {
  const withNulls = buildLineChartSvg([10, null, 20, undefined, 15, NaN]);
  const withoutNulls = buildLineChartSvg([10, 20, 15]);
  // Same real values either way -- should produce the identical chart.
  assert.equal(withNulls, withoutNulls);
});

test('does not divide by zero when every value is identical (a flat line)', () => {
  const svg = buildLineChartSvg([50, 50, 50, 50]);
  assert.match(svg, /<polyline /);
  assert.equal(svg.includes('NaN'), false, 'a flat line should not produce NaN coordinates');
  assert.equal(svg.includes('Infinity'), false);
});

test('respects custom width/height options', () => {
  const svg = buildLineChartSvg([1, 2, 3], { width: 300, height: 80 });
  assert.match(svg, /viewBox="0 0 300 80"/);
  assert.match(svg, /width="300" height="80"/);
});

test('showArea adds a filled polygon in addition to the line', () => {
  const withArea = buildLineChartSvg([1, 5, 2], { showArea: true });
  const withoutArea = buildLineChartSvg([1, 5, 2], { showArea: false });
  assert.match(withArea, /<polygon /);
  assert.equal(withoutArea.includes('<polygon'), false);
});

test('coordinates stay within the declared viewBox bounds', () => {
  const width = 120;
  const height = 32;
  const svg = buildLineChartSvg([5, 95, 10, 80, 3, 99], { width, height, strokeWidth: 1.5 });
  const coords = [...svg.matchAll(/([\d.]+),([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(coords.length > 0);
  for (const [x, y] of coords) {
    assert.ok(x >= -0.01 && x <= width + 0.01, `x=${x} should be within [0, ${width}]`);
    assert.ok(y >= -0.01 && y <= height + 0.01, `y=${y} should be within [0, ${height}]`);
  }
});
