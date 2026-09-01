// Tests the settings sync/migration logic in a real jsdom browser
// environment (real localStorage, real fetch against a real running
// test server) -- not a reimplementation. Each piece is extracted
// directly from frontend/app.js by name (brace-balanced, so nested
// braces in a function body don't truncate it early), so this can't
// silently drift from what actually ships. Deliberately narrower than
// just grabbing the whole "settings" section: that section also has
// $('#...').addEventListener(...) UI wiring interleaved with the sync
// logic, which would need a full set of real DOM elements this isolated
// test has no reason to provide -- this test is about the sync/
// migration logic, not rendering.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { setupTestServer } = require('./helpers');

const APP_JS = path.join(__dirname, '..', '..', 'frontend', 'app.js');
const appJsSource = fs.readFileSync(APP_JS, 'utf8');

function extractFunction(name) {
  const startMatch = appJsSource.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\)\\s*\\{`));
  if (!startMatch) throw new Error(`Could not find function ${name}() in app.js -- has it been renamed or restructured?`);
  // Start counting braces from the body's own opening brace (the last
  // character startMatch captured), not the function name -- a
  // destructured parameter list can contain a {...} that closes before
  // the body even begins, which would otherwise be mistaken for it.
  // Doesn't currently affect any function extracted here (none take a
  // destructured parameter today), but fixed proactively rather than
  // leaving a brace-counter that only works by accident.
  const bodyStart = startMatch.index + startMatch[0].length - 1;
  let depth = 0;
  let i = bodyStart;
  for (; i < appJsSource.length; i++) {
    if (appJsSource[i] === '{') depth++;
    if (appJsSource[i] === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return appJsSource.slice(startMatch.index, i);
}

function extractLine(pattern) {
  const match = appJsSource.match(pattern);
  if (!match) throw new Error(`Could not find a line matching ${pattern} in app.js`);
  return match[0];
}

// Assembled from named pieces rather than a text range, specifically to
// exclude the UI event-listener wiring interleaved in the same source
// section (see file header comment).
const settingsLogic = [
  extractLine(/const SETTINGS_KEY = .+;/),
  extractLine(/const ORDER_KEY = .+;/),
  extractLine(/const LEGACY_SETTINGS_KEY = .+;/),
  extractLine(/const LEGACY_ORDER_KEY = .+;/),
  extractLine(/const defaultSettings = .+;/),
  extractFunction('loadSettings'),
  extractFunction('cacheSettingsLocally'),
  extractFunction('saveSettings'),
  extractLine(/let settings = loadSettings\(\);/),
  extractFunction('loadOrder'),
  extractFunction('cacheOrderLocally'),
  extractFunction('saveOrder'),
  extractLine(/let orderIds = loadOrder\(\);/),
  extractFunction('syncSettingsWithServer'),
]
  .join('\n\n')
  // `let x = ...` at script top-level does NOT become window.x in real
  // browser semantics (unlike `var`), so this test's outside-the-script
  // access (window.settings, window.orderIds) wouldn't see it otherwise.
  // A scoping bridge for the test harness, not a change to the logic.
  .replace(/^let settings = /m, 'window.settings = ')
  .replace(/^let orderIds = /m, 'window.orderIds = ');

let baseUrl, close, CLIENT_SETTINGS_PATH;

before(async () => {
  ({ baseUrl, close } = await setupTestServer());
  CLIENT_SETTINGS_PATH = path.join(process.env.PIOPS_DATA_DIR, 'clientSettings.json');
});

after(async () => {
  await close();
});

// Every test in this file shares one server instance (efficient, and
// setupTestServer() is designed for one per file) -- several tests need
// to start from a genuinely fresh "never saved before" server state, so
// reset that between tests rather than assuming test order/isolation.
function resetServerSettings() {
  fs.rmSync(CLIENT_SETTINGS_PATH, { force: true });
}

function makeWindow() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: baseUrl, runScripts: 'dangerously' });
  dom.window.fetch = fetch; // real fetch (Node global), pointed at the real test server via absolute URLs below
  dom.window.applyTheme = () => { dom.window.__applyThemeCalls = (dom.window.__applyThemeCalls || 0) + 1; };
  dom.window.applySettingsUI = () => {};
  dom.window.refreshVisibleUnits = () => {};
  const script = dom.window.document.createElement('script');
  // app.js uses relative URLs ('/api/settings'); rewrite to absolute so
  // they actually reach the test server regardless of jsdom's own
  // same-origin handling.
  script.textContent = settingsLogic.replace(/'\/api\/settings'/g, `'${baseUrl}/api/settings'`);
  dom.window.document.body.appendChild(script);
  return dom.window;
}

test('fresh browser, fresh server: migrates this browser\'s (default) values up', async () => {
  resetServerSettings();
  const win = makeWindow();
  await win.syncSettingsWithServer();

  const res = await fetch(`${baseUrl}/api/settings`);
  const body = await res.json();
  assert.equal(body.everSaved, true);
  assert.equal(body.settings.theme, 'dark');
});

test('existing browser customization migrates up on first sync', async () => {
  resetServerSettings();
  // Simulate a browser that already had a custom theme cached locally
  // from before this feature existed (e.g. set directly via the old,
  // localStorage-only mechanism).
  const win = makeWindow();
  win.localStorage.setItem('piOpsSettings', JSON.stringify({ theme: 'light', unitSystem: 'imperial', tempUnit: 'F', localApp: 'system', viewMode: 'list' }));
  win.settings = JSON.parse(win.localStorage.getItem('piOpsSettings'));

  await win.syncSettingsWithServer();

  const res = await fetch(`${baseUrl}/api/settings`);
  const body = await res.json();
  assert.equal(body.settings.theme, 'light');
  assert.equal(body.settings.unitSystem, 'imperial');
});

test('a second browser picks up settings already saved on the server', async () => {
  resetServerSettings();
  // First browser saves a preference.
  const firstBrowser = makeWindow();
  firstBrowser.settings.theme = 'light';
  await firstBrowser.saveSettings();

  // A second, fresh browser (its own empty localStorage) should pick up
  // that value from the server instead of resetting to its own defaults.
  const secondBrowser = makeWindow();
  assert.equal(secondBrowser.settings.theme, 'dark', 'sanity check: starts at the default before syncing');
  await secondBrowser.syncSettingsWithServer();
  assert.equal(secondBrowser.settings.theme, 'light', 'should have picked up the first browser\'s saved value');
  assert.equal(secondBrowser.localStorage.getItem('piOpsSettings') && JSON.parse(secondBrowser.localStorage.getItem('piOpsSettings')).theme, 'light', 'local cache should be updated to match');
});

test('applyTheme etc. are re-invoked only when the synced value actually differs from cache', async () => {
  resetServerSettings();
  const firstBrowser = makeWindow();
  firstBrowser.settings.theme = 'light';
  await firstBrowser.saveSettings();

  // A browser whose cache already happens to match the server value --
  // syncing shouldn't need to re-apply anything.
  const alreadyMatching = makeWindow();
  alreadyMatching.localStorage.setItem('piOpsSettings', JSON.stringify({ ...alreadyMatching.settings, theme: 'light' }));
  alreadyMatching.settings.theme = 'light';
  await alreadyMatching.syncSettingsWithServer();
  assert.equal(alreadyMatching.__applyThemeCalls || 0, 0, 'should not re-apply when nothing actually changed');

  // A browser with a stale cache (still default) should get corrected
  // and re-applied.
  const stale = makeWindow();
  await stale.syncSettingsWithServer();
  assert.equal(stale.__applyThemeCalls, 1, 'should re-apply once when the server value differs from the stale cache');
});

test('order syncs the same way settings does', async () => {
  resetServerSettings();
  const firstBrowser = makeWindow();
  firstBrowser.orderIds = ['device-x', 'device-y'];
  await firstBrowser.saveOrder();

  const secondBrowser = makeWindow();
  await secondBrowser.syncSettingsWithServer();
  assert.deepEqual(secondBrowser.orderIds, ['device-x', 'device-y']);
});
