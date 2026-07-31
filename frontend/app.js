const API = '/api/devices';

// If a session expires (or was never established) mid-use, any API call
// will start returning 401 -- catch that globally rather than at every
// individual call site, and bounce to the login page.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await nativeFetch(...args);
  const url = String(args[0] || '');
  if (res.status === 401 && url.startsWith('/api/') && !url.startsWith('/api/auth/')) {
    window.location.href = '/login.html';
  }
  return res;
};

let devices = [];       // last known device list (without secrets)
let statsCache = {};    // deviceId -> stats, kept fresh via websocket
let activeDeviceId = null;
let selectedIds = new Set(); // devices checked for bulk actions
let term = null, fitAddon = null, termSocket = null;

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// ---------------------------------------------------------------- settings
const SETTINGS_KEY = 'piFleetDashboardSettings';
const ORDER_KEY = 'piFleetDashboardOrder';
const defaultSettings = { unitSystem: 'metric', tempUnit: 'C', localApp: 'system', viewMode: 'grid' };

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : { ...defaultSettings };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable; setting stays in-memory for this session */ }
}

let settings = loadSettings();

// Manual card order, kept separate from settings since it's purely a local
// display preference tied to device IDs on this install (not worth bundling
// into a portable backup file).
let orderIds = loadOrder();

function loadOrder() {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY)) || []; } catch { return []; }
}

function saveOrder() {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(orderIds)); } catch { /* non-essential */ }
}

// Applies the saved manual order to a device list; anything not yet in the
// saved order (e.g. newly added devices) falls to the end, in list order.
function applyOrder(list) {
  const rank = new Map(orderIds.map((id, i) => [id, i]));
  return [...list].sort((a, b) => {
    const ai = rank.has(a.id) ? rank.get(a.id) : Infinity;
    const bi = rank.has(b.id) ? rank.get(b.id) : Infinity;
    return ai - bi;
  });
}

function reorderDevices(draggedId, targetId) {
  if (draggedId === targetId) return;
  const current = applyOrder(devices).map((d) => d.id);
  const from = current.indexOf(draggedId);
  const to = current.indexOf(targetId);
  if (from === -1 || to === -1) return;
  current.splice(from, 1);
  current.splice(to, 0, draggedId);
  orderIds = current;
  saveOrder();
  render();
}

function formatTemp(tempC) {
  if (tempC === null || tempC === undefined) return '--';
  const value = settings.tempUnit === 'F' ? (tempC * 9) / 5 + 32 : tempC;
  const unit = settings.tempUnit === 'F' ? '\u00b0F' : '\u00b0C';
  return `${value.toFixed(1)}${unit}`;
}

// A plain "⚡" character renders as a fixed-color emoji glyph in many
// browsers/fonts -- CSS `color` has no effect on it at all, which is why
// the list-view icon always looked yellow regardless of actual status.
// An inline SVG with fill="currentColor" is a real vector shape that
// properly inherits whatever color the surrounding .throttle-* class sets.
const BOLT_SVG = '<svg class="throttle-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>';

// Renders a small badge for the classic Raspberry Pi lightning-bolt
// under-voltage/throttling indicator. Red if something's actively wrong
// right now, amber if it happened at some point since boot but has since
// cleared, nothing at all if the device is fine or isn't a Pi.
function throttleBadge(t) {
  if (!t || !t.available) {
    return `<span class="throttle-badge throttle-na" title="${escapeHtml(describeThrottled(t))}">${BOLT_SVG} N/A</span>`;
  }
  const now = t.underVoltageNow || t.throttledNow || t.freqCappedNow || t.tempLimitNow;
  const occurred = t.underVoltageOccurred || t.throttledOccurred || t.freqCappedOccurred || t.tempLimitOccurred;
  if (now) return `<span class="throttle-badge throttle-now" title="${escapeHtml(describeThrottled(t))}">${BOLT_SVG} Power issue</span>`;
  if (occurred) return `<span class="throttle-badge throttle-past" title="${escapeHtml(describeThrottled(t))}">${BOLT_SVG} Past issue</span>`;
  return `<span class="throttle-badge throttle-ok" title="${escapeHtml(describeThrottled(t))}">${BOLT_SVG} OK</span>`;
}

// Compact icon-only variant for the dense list view (the card view uses the
// fuller throttleBadge() with a text label instead).
function throttleIcon(t) {
  if (!t || !t.available) {
    return `<span class="throttle-icon throttle-na" title="${escapeHtml(describeThrottled(t))}">${BOLT_SVG}</span>`;
  }
  const now = t.underVoltageNow || t.throttledNow || t.freqCappedNow || t.tempLimitNow;
  const occurred = t.underVoltageOccurred || t.throttledOccurred || t.freqCappedOccurred || t.tempLimitOccurred;
  if (now) return `<span class="throttle-icon throttle-now" title="${escapeHtml(describeThrottled(t))}">${BOLT_SVG}</span>`;
  if (occurred) return `<span class="throttle-icon throttle-past" title="${escapeHtml(describeThrottled(t))}">${BOLT_SVG}</span>`;
  return `<span class="throttle-icon throttle-ok" title="${escapeHtml(describeThrottled(t))}">${BOLT_SVG}</span>`;
}

function describeThrottled(t) {
  if (!t || !t.available) return 'Not available (not a Pi, or vcgencmd is missing)';
  const now = [];
  if (t.underVoltageNow) now.push('under-voltage');
  if (t.throttledNow) now.push('throttled');
  if (t.freqCappedNow) now.push('frequency capped');
  if (t.tempLimitNow) now.push('temperature limited');
  if (now.length) return `Right now: ${now.join(', ')}`;
  const occurred = [];
  if (t.underVoltageOccurred) occurred.push('under-voltage');
  if (t.throttledOccurred) occurred.push('throttling');
  if (t.freqCappedOccurred) occurred.push('frequency capping');
  if (t.tempLimitOccurred) occurred.push('temperature limiting');
  if (occurred.length) return `OK right now, but ${occurred.join(' / ')} occurred since the last boot`;
  return 'OK -- no under-voltage or throttling detected';
}

// Short form for the compact stat-box grid; describeThrottled() (the full
// sentence) is used as that box's tooltip instead.
function describeThrottledShort(t) {
  if (!t || !t.available) return 'N/A';
  if (t.underVoltageNow || t.throttledNow || t.freqCappedNow || t.tempLimitNow) return 'Issue now';
  if (t.underVoltageOccurred || t.throttledOccurred || t.freqCappedOccurred || t.tempLimitOccurred) return 'Since boot';
  return 'OK';
}

function applySettingsUI() {
  document.querySelectorAll('#unitSystemSegmented .segmented-opt').forEach((b) => b.classList.toggle('active', b.dataset.value === settings.unitSystem));
  document.querySelectorAll('#tempUnitSegmented .segmented-opt').forEach((b) => b.classList.toggle('active', b.dataset.value === settings.tempUnit));
  document.querySelectorAll('#localAppSegmented .segmented-opt').forEach((b) => b.classList.toggle('active', b.dataset.value === settings.localApp));
  document.querySelectorAll('#viewModeSegmented .segmented-opt').forEach((b) => b.classList.toggle('active', b.dataset.value === settings.viewMode));
}

function refreshVisibleUnits() {
  render();
  if (activeDeviceId) renderDetailStats(activeDeviceId);
}

$('#settingsBtn').addEventListener('click', () => {
  applySettingsUI();
  applyAlertConfigUI();
  renderCommandList();
  applyAuthUI();
  $('#settingsModalBackdrop').hidden = false;
});
$('#settingsModalClose').addEventListener('click', () => ($('#settingsModalBackdrop').hidden = true));

// ---------------------------------------------------------------- security (password gate)
let authStatus = { enabled: false, authenticated: true };

async function loadAuthStatus() {
  try {
    const res = await fetch('/api/auth/status');
    authStatus = await res.json();
  } catch {
    authStatus = { enabled: false, authenticated: true };
  }
  applyAuthUI();
}

function applyAuthUI() {
  document.querySelectorAll('#authEnabledSegmented .segmented-opt').forEach((b) => {
    b.classList.toggle('active', (b.dataset.value === 'on') === authStatus.enabled);
  });
  $('#logoutBtn').hidden = !authStatus.enabled;
  $('#authCurrentPasswordLabel').hidden = !authStatus.enabled;
  $('#authCurrentPassword').hidden = !authStatus.enabled;
  $('#authNewPasswordLabel').textContent = authStatus.enabled ? 'New password (leave blank to keep current)' : 'Password';
}

$('#authEnabledSegmented').addEventListener('click', (e) => {
  const btn = e.target.closest('.segmented-opt');
  if (!btn) return;
  document.querySelectorAll('#authEnabledSegmented .segmented-opt').forEach((b) => b.classList.toggle('active', b === btn));
});

$('#authSaveBtn').addEventListener('click', async () => {
  const resultEl = $('#authResult');
  const wantsOn = $('#authEnabledSegmented .segmented-opt.active')?.dataset.value === 'on';
  const currentPassword = $('#authCurrentPassword').value;
  const newPassword = $('#authNewPassword').value;

  resultEl.textContent = 'Saving\u2026';
  resultEl.className = 'test-result';
  try {
    let body;
    if (!wantsOn) {
      body = { action: 'disable', currentPassword };
    } else {
      if (!authStatus.enabled && !newPassword) {
        throw new Error('Enter a password to turn Security on');
      }
      if (!newPassword && authStatus.enabled) {
        // Turning it "on" while already on with no new password typed is a no-op save.
        resultEl.textContent = 'Nothing to change';
        resultEl.classList.add('ok');
        return;
      }
      body = { action: 'setPassword', currentPassword, newPassword };
    }
    const res = await fetch('/api/auth/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Save failed');
    resultEl.textContent = 'Saved';
    resultEl.classList.add('ok');
    $('#authCurrentPassword').value = '';
    $('#authNewPassword').value = '';
    await loadAuthStatus();
  } catch (err) {
    resultEl.textContent = err.message;
    resultEl.classList.add('fail');
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});
$('#settingsModalBackdrop').addEventListener('click', (e) => {
  if (e.target === $('#settingsModalBackdrop')) $('#settingsModalBackdrop').hidden = true;
});

$('#unitSystemSegmented').addEventListener('click', (e) => {
  const btn = e.target.closest('.segmented-opt');
  if (!btn) return;
  settings.unitSystem = btn.dataset.value;
  settings.tempUnit = settings.unitSystem === 'imperial' ? 'F' : 'C';
  saveSettings();
  applySettingsUI();
  refreshVisibleUnits();
});

$('#tempUnitSegmented').addEventListener('click', (e) => {
  const btn = e.target.closest('.segmented-opt');
  if (!btn) return;
  settings.tempUnit = btn.dataset.value;
  saveSettings();
  applySettingsUI();
  refreshVisibleUnits();
});

$('#localAppSegmented').addEventListener('click', (e) => {
  const btn = e.target.closest('.segmented-opt');
  if (!btn) return;
  settings.localApp = btn.dataset.value;
  saveSettings();
  applySettingsUI();
});

// Builds the href + label for the "open in local terminal" link based on
// which app the user picked in Settings. PuTTY and WinSCP don't understand
// ssh:// out of the box on most systems -- see the README for the one-time
// setup each needs.
function buildLocalLink(device) {
  const user = encodeURIComponent(device.username);
  switch (settings.localApp) {
    case 'putty':
      return { href: `putty:${user}@${device.host}:${device.port}`, label: 'Open in PuTTY' };
    case 'winscp':
      return { href: `sftp://${user}@${device.host}:${device.port}/`, label: 'Open in WinSCP' };
    default:
      return { href: `ssh://${user}@${device.host}:${device.port}`, label: 'Open in local terminal' };
  }
}

$('#viewModeSegmented').addEventListener('click', (e) => {
  const btn = e.target.closest('.segmented-opt');
  if (!btn) return;
  settings.viewMode = btn.dataset.value;
  saveSettings();
  applySettingsUI();
  render();
});

// ---------------------------------------------------------------- backup / restore
$('#exportBtn').addEventListener('click', async () => {
  const passphrase = $('#exportPassphrase').value;
  const resultEl = $('#exportResult');
  if (!passphrase || passphrase.length < 8) {
    resultEl.textContent = 'Use a passphrase of at least 8 characters';
    resultEl.className = 'test-result fail';
    return;
  }
  resultEl.textContent = 'Encrypting\u2026';
  resultEl.className = 'test-result';
  try {
    const res = await fetch('/api/backup/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase, clientSettings: settings, order: orderIds }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Export failed');

    const filename = `pi-fleet-dashboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);

    resultEl.textContent = `Downloaded (${body.deviceCount} device${body.deviceCount === 1 ? '' : 's'})`;
    resultEl.classList.add('ok');
    $('#exportPassphrase').value = '';
  } catch (err) {
    resultEl.textContent = err.message;
    resultEl.classList.add('fail');
  }
});

$('#importBtn').addEventListener('click', async () => {
  const fileInput = $('#importFile');
  const passphrase = $('#importPassphrase').value;
  const resultEl = $('#importResult');

  if (!fileInput.files[0]) {
    resultEl.textContent = 'Choose a backup file first';
    resultEl.className = 'test-result fail';
    return;
  }
  if (!passphrase) {
    resultEl.textContent = 'Enter the backup passphrase';
    resultEl.className = 'test-result fail';
    return;
  }

  resultEl.textContent = 'Restoring\u2026';
  resultEl.className = 'test-result';
  try {
    const text = await fileInput.files[0].text();
    const file = JSON.parse(text);
    const res = await fetch('/api/backup/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase, file }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Import failed');

    resultEl.textContent = `Restored ${body.imported} device${body.imported === 1 ? '' : 's'}` + (body.skipped ? `, skipped ${body.skipped} already present` : '');
    resultEl.classList.add('ok');

    if (body.settings) {
      settings = { ...defaultSettings, ...body.settings };
      saveSettings();
      applySettingsUI();
    }

    if (body.order) {
      orderIds = body.order;
      saveOrder();
    }

    fileInput.value = '';
    $('#importPassphrase').value = '';
    await loadDevices();
    await loadGroups();
    await loadAlertConfig();
    await loadCustomCommands();
    renderCommandList();
    refreshVisibleUnits();
  } catch (err) {
    resultEl.textContent = err.message;
    resultEl.classList.add('fail');
  }
});

// ---------------------------------------------------------------- alerts
let alertConfig = null;

async function loadAlertConfig() {
  try {
    const res = await fetch('/api/alerts');
    alertConfig = await res.json();
  } catch {
    alertConfig = null;
  }
  applyAlertConfigUI();
}

function applyAlertConfigUI() {
  if (!alertConfig) return;
  document.querySelectorAll('#alertsEnabledSegmented .segmented-opt').forEach((b) => {
    b.classList.toggle('active', (b.dataset.value === 'on') === !!alertConfig.enabled);
  });
  $('#alertWebhookUrl').value = alertConfig.webhookUrl || '';
  $('#alertFormat').value = alertConfig.format || 'generic';
  $('#alertOffline').checked = !!alertConfig.notify.offline;
  $('#alertRecovery').checked = !!alertConfig.notify.recovery;
  $('#alertUndervoltage').checked = !!alertConfig.notify.undervoltage;
  $('#alertThrottled').checked = !!alertConfig.notify.throttled;
  $('#alertCpuEnabled').checked = !!alertConfig.notify.cpu;
  $('#alertCpuThreshold').value = alertConfig.thresholds.cpuPct;
  $('#alertMemEnabled').checked = !!alertConfig.notify.memory;
  $('#alertMemThreshold').value = alertConfig.thresholds.memPct;
  $('#alertDiskEnabled').checked = !!alertConfig.notify.disk;
  $('#alertDiskThreshold').value = alertConfig.thresholds.diskPct;
  $('#alertTempEnabled').checked = !!alertConfig.notify.temp;
  $('#alertTempThreshold').value = alertConfig.thresholds.tempC;
}

$('#alertsEnabledSegmented').addEventListener('click', (e) => {
  const btn = e.target.closest('.segmented-opt');
  if (!btn) return;
  document.querySelectorAll('#alertsEnabledSegmented .segmented-opt').forEach((b) => b.classList.toggle('active', b === btn));
});

function collectAlertPayload() {
  return {
    enabled: $('#alertsEnabledSegmented .segmented-opt.active')?.dataset.value === 'on',
    webhookUrl: $('#alertWebhookUrl').value.trim(),
    format: $('#alertFormat').value,
    notify: {
      offline: $('#alertOffline').checked,
      recovery: $('#alertRecovery').checked,
      undervoltage: $('#alertUndervoltage').checked,
      throttled: $('#alertThrottled').checked,
      cpu: $('#alertCpuEnabled').checked,
      memory: $('#alertMemEnabled').checked,
      disk: $('#alertDiskEnabled').checked,
      temp: $('#alertTempEnabled').checked,
    },
    thresholds: {
      cpuPct: Number($('#alertCpuThreshold').value) || 90,
      memPct: Number($('#alertMemThreshold').value) || 90,
      diskPct: Number($('#alertDiskThreshold').value) || 90,
      tempC: Number($('#alertTempThreshold').value) || 75,
    },
  };
}

async function saveAlertConfigToServer() {
  const res = await fetch('/api/alerts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collectAlertPayload()),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
  alertConfig = await res.json();
  return alertConfig;
}

$('#alertSaveBtn').addEventListener('click', async () => {
  const resultEl = $('#alertResult');
  resultEl.textContent = 'Saving\u2026';
  resultEl.className = 'test-result';
  try {
    await saveAlertConfigToServer();
    resultEl.textContent = 'Saved';
    resultEl.classList.add('ok');
  } catch (err) {
    resultEl.textContent = err.message;
    resultEl.classList.add('fail');
  }
});

$('#alertTestBtn').addEventListener('click', async () => {
  const resultEl = $('#alertResult');
  resultEl.textContent = 'Sending test alert\u2026';
  resultEl.className = 'test-result';
  try {
    await saveAlertConfigToServer(); // save current (possibly unsaved) fields first, so the test matches what's on screen
    const res = await fetch('/api/alerts/test', { method: 'POST' });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Test failed');
    resultEl.textContent = 'Test alert sent \u2014 check your webhook destination';
    resultEl.classList.add('ok');
  } catch (err) {
    resultEl.textContent = err.message;
    resultEl.classList.add('fail');
  }
});

// ---------------------------------------------------------------- CSV import
$('#csvTemplateBtn').addEventListener('click', () => {
  const csv = 'name,host,port,username,group,authType,secret,passphrase\n' +
    'pi-example,192.168.1.50,22,pi,Home Lab,password,changeme,\n';
  const blobUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = 'pi-fleet-dashboard-devices-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
});

$('#csvImportBtn').addEventListener('click', async () => {
  const fileInput = $('#csvFile');
  const resultEl = $('#csvImportResult');

  if (!fileInput.files[0]) {
    resultEl.textContent = 'Choose a CSV file first';
    resultEl.className = 'test-result fail';
    return;
  }

  resultEl.textContent = 'Importing\u2026';
  resultEl.className = 'test-result';
  try {
    const text = await fileInput.files[0].text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (parsed.errors.length) throw new Error(parsed.errors[0].message);

    const requiredCols = ['name', 'host', 'username', 'secret'];
    const missingCols = requiredCols.filter((c) => !(parsed.meta.fields || []).includes(c));
    if (missingCols.length) {
      throw new Error(
        `This file's header row doesn't match what's expected (missing: ${missingCols.join(', ')}). ` +
        `The first line must be exactly: name,host,port,username,group,authType,secret,passphrase`
      );
    }

    const existingKeys = new Set(devices.map((d) => `${d.host}:${d.port}:${d.username}`.toLowerCase()));
    let created = 0, skipped = 0, failed = 0;

    for (const row of parsed.data) {
      const name = (row.name || '').trim();
      const host = (row.host || '').trim();
      const username = (row.username || '').trim();
      const secret = (row.secret || '').trim();
      if (!name || !host || !username || !secret) { failed++; continue; }

      const port = Number(row.port) || 22;
      const key = `${host}:${port}:${username}`.toLowerCase();
      if (existingKeys.has(key)) { skipped++; continue; }

      const payload = {
        name, host, port, username,
        group: (row.group || '').trim() || 'Unsorted',
        authType: (row.authType || '').trim().toLowerCase() === 'key' ? 'key' : 'password',
        secret,
        passphrase: (row.passphrase || '').trim(),
      };
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) { created++; existingKeys.add(key); } else { failed++; }
    }

    resultEl.textContent = `Imported ${created}` +
      (skipped ? `, skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}` : '') +
      (failed ? `, ${failed} row${failed === 1 ? '' : 's'} invalid` : '');
    resultEl.classList.add(failed && !created ? 'fail' : 'ok');

    fileInput.value = '';
    await loadDevices();
  } catch (err) {
    resultEl.textContent = err.message;
    resultEl.classList.add('fail');
  }
});

// ---------------------------------------------------------------- device groups
let groups = [];

async function loadGroups() {
  try {
    const res = await fetch('/api/groups');
    groups = await res.json();
  } catch {
    groups = [];
  }
  renderGroupList();
  populateGroupOptions();
  populateGroupFilter();
}

function renderGroupList() {
  const container = $('#groupList');
  if (!groups.length) {
    container.innerHTML = '<p class="muted">No custom groups yet &mdash; devices default to "Unsorted".</p>';
    return;
  }
  container.innerHTML = groups
    .map((g) => `
      <span class="group-chip">
        ${escapeHtml(g)}
        <button type="button" class="group-chip-remove" title="Remove group" data-group="${escapeHtml(g)}">&times;</button>
      </span>`)
    .join('');
}

$('#addGroupBtn').addEventListener('click', async () => {
  const input = $('#newGroupName');
  const name = input.value.trim();
  if (!name) return;
  try {
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Could not add group');
    input.value = '';
    await loadGroups();
    populateGroupFilter();
  } catch (err) {
    toast(err.message, true);
  }
});

$('#groupList').addEventListener('click', async (e) => {
  const btn = e.target.closest('.group-chip-remove');
  if (!btn) return;
  const name = btn.dataset.group;
  await fetch(`/api/groups/${encodeURIComponent(name)}`, { method: 'DELETE' });
  await loadGroups();
  populateGroupFilter();
});

// ---------------------------------------------------------------- custom commands (Settings management)
function renderCommandList() {
  const container = $('#commandList');
  if (!customCommands.length) {
    container.innerHTML = '<p class="muted">No custom commands yet.</p>';
    return;
  }
  container.innerHTML = customCommands
    .map(
      (c) => `
    <div class="command-row">
      <div>
        <div class="command-label">${escapeHtml(c.label)} <span class="command-timeout">${c.timeoutSec || 120}s timeout</span></div>
        <div class="command-text">${escapeHtml(c.command)}</div>
      </div>
      <button type="button" class="command-remove" title="Remove command" data-id="${escapeHtml(c.id)}">&times;</button>
    </div>`
    )
    .join('');
}

$('#addCommandBtn').addEventListener('click', async () => {
  const label = $('#newCommandLabel').value.trim();
  const command = $('#newCommandText').value.trim();
  const timeoutSec = Number($('#newCommandTimeout').value) || 120;
  if (!label || !command) {
    toast('Both a label and a command are required', true);
    return;
  }
  try {
    const res = await fetch('/api/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, command, timeoutSec }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Could not add command');
    $('#newCommandLabel').value = '';
    $('#newCommandText').value = '';
    $('#newCommandTimeout').value = 120;
    await loadCustomCommands();
    renderCommandList();
  } catch (err) {
    toast(err.message, true);
  }
});

$('#commandList').addEventListener('click', async (e) => {
  const btn = e.target.closest('.command-remove');
  if (!btn) return;
  await fetch(`/api/commands/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
  await loadCustomCommands();
  renderCommandList();
});

// Populates the Add/Edit device form's group <select>. `selected` (used
// when editing) is always included even if it's not in the curated list,
// so editing a device never silently changes its group.
function populateGroupOptions(selected) {
  const select = $('#fGroup');
  const all = new Set(['Unsorted', ...groups]);
  if (selected) all.add(selected);
  const sorted = [...all].sort((a, b) => a.localeCompare(b));
  select.innerHTML = sorted.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  select.value = selected || 'Unsorted';
}

// ---------------------------------------------------------------- toast
let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

// ---------------------------------------------------------------- data loading
async function loadDevices() {
  const res = await fetch(API);
  devices = await res.json();
  devices.forEach((d) => (statsCache[d.id] = d.stats));
  populateGroupFilter();
  render();
}

function populateGroupFilter() {
  const select = $('#groupFilter');
  const current = select.value;
  const fromDevices = devices.map((d) => d.group || 'Unsorted');
  const allGroups = [...new Set([...groups, ...fromDevices])].sort();
  select.innerHTML = '<option value="">All groups</option>' + allGroups.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  select.value = current;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------- rendering
function meterBlocks(pct, count = 10) {
  const filled = pct === null || pct === undefined ? 0 : Math.round((pct / 100) * count);
  let cls = '';
  if (pct >= 90) cls = 'bad';
  else if (pct >= 70) cls = 'warn';
  const blocks = [];
  for (let i = 0; i < count; i++) {
    blocks.push(`<div class="meter-block${i < filled ? ' filled ' + cls : ''}"></div>`);
  }
  return blocks.join('');
}

function meterRow(label, pct, displayValue) {
  const pctText = pct === null || pct === undefined ? '--' : `${displayValue ?? pct + '%'}`;
  return `
    <div class="meter-row">
      <span>${label}</span>
      <div class="meter-track">${meterBlocks(pct)}</div>
      <span>${pctText}</span>
    </div>`;
}

function render() {
  const grid = $('#deviceGrid');
  const listView = $('#deviceListView');
  const query = $('#searchInput').value.trim().toLowerCase();
  const groupFilter = $('#groupFilter').value;

  // Drop selections for devices that no longer exist (e.g. deleted elsewhere).
  const currentIds = new Set(devices.map((d) => d.id));
  for (const id of selectedIds) {
    if (!currentIds.has(id)) selectedIds.delete(id);
  }
  updateBulkBar();

  const filtered = applyOrder(devices).filter((d) => {
    const matchesQuery = !query || [d.name, d.host, d.group].some((v) => (v || '').toLowerCase().includes(query));
    const matchesGroup = !groupFilter || (d.group || 'Unsorted') === groupFilter;
    return matchesQuery && matchesGroup;
  });

  $('#emptyState').hidden = devices.length !== 0;

  const onlineCount = devices.filter((d) => (statsCache[d.id] || {}).status === 'online').length;
  $('#deviceCount').textContent = `${devices.length} device${devices.length === 1 ? '' : 's'}`;
  $('#onlineCount').textContent = `${onlineCount} online`;
  $('#fleetLed').style.background = devices.length && onlineCount === 0 ? 'var(--bad)' : 'var(--good)';

  if (settings.viewMode === 'list') {
    grid.hidden = true;
    grid.innerHTML = '';
    listView.hidden = devices.length === 0;
    renderListView(listView, filtered);
  } else {
    listView.hidden = true;
    listView.innerHTML = '';
    grid.hidden = devices.length === 0;
    grid.innerHTML = '';
    filtered.forEach((d) => grid.appendChild(renderCard(d)));
  }
}

// ---------------------------------------------------------------- bulk selection & actions
function toggleSelect(id, checked) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  updateBulkBar();
}

function updateBulkBar() {
  const bar = $('#bulkBar');
  bar.hidden = selectedIds.size === 0;
  $('#bulkCount').textContent = `${selectedIds.size} selected`;
  populateBulkGroupSelect();
  const allChecked = devices.length > 0 && devices.every((d) => selectedIds.has(d.id));
  $('#selectAllCheckbox').checked = allChecked;
}

function populateBulkGroupSelect() {
  const select = $('#bulkGroupSelect');
  const all = new Set(['Unsorted', ...groups]);
  select.innerHTML = [...all].sort().map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
}

function downloadFile(content, filename, mimeType) {
  const blobUrl = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

$('#selectAllCheckbox').addEventListener('change', (e) => {
  if (e.target.checked) devices.forEach((d) => selectedIds.add(d.id));
  else selectedIds.clear();
  updateBulkBar();
  render();
});

$('#bulkAssignGroupBtn').addEventListener('click', async () => {
  const group = $('#bulkGroupSelect').value;
  if (!confirm(`Assign group "${group}" to ${selectedIds.size} device(s)?`)) return;
  const ids = [...selectedIds];
  await Promise.all(
    ids.map((id) => fetch(`${API}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group }) }))
  );
  toast(`Assigned "${group}" to ${ids.length} device(s)`);
  await loadDevices();
});

$('#bulkExportBtn').addEventListener('click', () => {
  const rows = [['name', 'host', 'port', 'username', 'group', 'authType', 'secret', 'passphrase']];
  for (const id of selectedIds) {
    const d = devices.find((x) => x.id === id);
    if (!d) continue;
    rows.push([d.name, d.host, d.port, d.username, d.group || 'Unsorted', d.authType, '', '']);
  }
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  downloadFile(csv, `pi-fleet-dashboard-export-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
  toast(`Exported ${rows.length - 1} device(s) \u2014 credentials aren't included; re-add them before importing elsewhere`);
});

$('#bulkDeleteBtn').addEventListener('click', async () => {
  const ids = [...selectedIds];
  if (!confirm(`Delete ${ids.length} device(s)? This removes their stored credentials too and can't be undone.`)) return;
  await Promise.all(ids.map((id) => fetch(`${API}/${id}`, { method: 'DELETE' })));
  toast(`Deleted ${ids.length} device(s)`);
  selectedIds.clear();
  await loadDevices();
});

$('#bulkClearBtn').addEventListener('click', () => {
  selectedIds.clear();
  updateBulkBar();
  render();
});

function attachDragHandlers(el, device) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', device.id);
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    reorderDevices(draggedId, device.id);
  });
}

function renderListView(container, list) {
  if (!list.length) {
    container.innerHTML = '<p class="muted" style="padding: 16px;">No matching devices.</p>';
    return;
  }
  const table = el('table', 'list-table');
  table.innerHTML = `
    <thead>
      <tr>
        <th></th><th></th><th>Name</th><th>Host</th><th>CPU</th><th>Mem</th><th>Disk</th>
        <th>Temp</th><th>Uptime</th><th>OS</th><th>Hardware</th><th>Svc</th><th></th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');
  list.forEach((device) => {
    const stats = statsCache[device.id] || { status: 'unknown' };
    const ledClass = stats.status === 'online' ? 'led-online' : stats.status === 'offline' ? 'led-offline' : 'led-unknown';
    const online = stats.status === 'online';
    const row = el('tr', 'list-row');
    row.innerHTML = `
      <td><label class="card-select" title="Select for bulk actions"><input type="checkbox" class="device-select" data-id="${device.id}" ${selectedIds.has(device.id) ? 'checked' : ''} /></label></td>
      <td><span class="led ${ledClass}" title="${stats.status}"></span>${throttleIcon(stats.throttled)}</td>
      <td>
        <div class="list-name">${escapeHtml(device.name)}</div>
        <div class="list-sub">${escapeHtml(device.group || 'Unsorted')}</div>
      </td>
      <td class="mono-cell">${escapeHtml(device.username)}@${escapeHtml(device.host)}:${device.port}</td>
      <td>${online && stats.cpuUsedPct !== null ? stats.cpuUsedPct + '%' : '--'}</td>
      <td>${online && stats.memory ? stats.memory.usedPct + '%' : '--'}</td>
      <td>${online && stats.disk ? stats.disk.usedPct + '%' : '--'}</td>
      <td>${online ? formatTemp(stats.tempC) : '--'}</td>
      <td class="truncate-cell" title="${escapeHtml(stats.uptime || '')}">${escapeHtml(online ? stats.uptime || '--' : '--')}</td>
      <td class="truncate-cell" title="${escapeHtml(stats.os || '')}">${escapeHtml(online ? stats.os || '--' : '--')}</td>
      <td class="truncate-cell" title="${escapeHtml(stats.model || '')}">${escapeHtml(online ? stats.model || '--' : '--')}</td>
      <td>${online ? stats.servicesRunning ?? '--' : '--'}</td>
      <td><button class="btn btn-sm term-btn">Terminal</button></td>
    `;
    row.querySelector('.term-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openTerminal(device);
    });
    row.querySelector('.device-select').addEventListener('click', (e) => e.stopPropagation());
    row.querySelector('.device-select').addEventListener('change', (e) => toggleSelect(device.id, e.target.checked));
    row.addEventListener('click', () => openDetail(device.id));
    attachDragHandlers(row, device);
    tbody.appendChild(row);
  });
  container.innerHTML = '';
  container.appendChild(table);
}

function renderCard(device) {
  const stats = statsCache[device.id] || { status: 'unknown' };
  const card = el('div', 'card');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');

  const ledClass = stats.status === 'online' ? 'led-online' : stats.status === 'offline' ? 'led-offline' : 'led-unknown';

  card.innerHTML = `
    <div class="card-top">
      <div class="card-top-left">
        <label class="card-select" title="Select for bulk actions"><input type="checkbox" class="device-select" data-id="${device.id}" ${selectedIds.has(device.id) ? 'checked' : ''} /></label>
        <div>
          <p class="card-title">${escapeHtml(device.name)}</p>
          <p class="card-sub">${escapeHtml(device.username)}@${escapeHtml(device.host)}:${device.port}</p>
          <span class="card-group">${escapeHtml(device.group || 'Unsorted')}</span>
        </div>
      </div>
      <span class="led ${ledClass}" title="${stats.status}"></span>
    </div>
    ${throttleBadge(stats.throttled)}
    ${stats.status === 'online' ? `
      <div class="meters">
        ${meterRow('CPU', stats.cpuUsedPct, stats.cpuUsedPct !== null ? stats.cpuUsedPct + '%' : '--')}
        ${meterRow('MEM', stats.memory?.usedPct ?? null, stats.memory ? stats.memory.usedPct + '%' : '--')}
        ${meterRow('DSK', stats.disk?.usedPct ?? null, stats.disk ? stats.disk.usedPct + '%' : '--')}
      </div>
      <div class="card-meta">
        <div class="meta-row"><span>Uptime</span><span title="${escapeHtml(stats.uptime || '')}">${escapeHtml(stats.uptime || '--')}</span></div>
        <div class="meta-row"><span>OS</span><span title="${escapeHtml(stats.os || '')}">${escapeHtml(stats.os || '--')}</span></div>
        <div class="meta-row"><span>Model</span><span title="${escapeHtml(stats.model || '')}">${escapeHtml(stats.model || '--')}</span></div>
      </div>
      <div class="card-footer">
        <span>${formatTemp(stats.tempC)} &middot; ${stats.servicesRunning ?? '--'} svc</span>
        <button class="btn btn-sm term-btn">Terminal</button>
      </div>
    ` : `
      <p class="offline-note">${stats.status === 'offline' ? 'Unreachable' + (stats.error ? ': ' + escapeHtml(stats.error) : '') : 'Checking&hellip;'}</p>
      <div class="card-footer">
        <span>&nbsp;</span>
        <button class="btn btn-sm term-btn">Terminal</button>
      </div>
    `}
  `;

  card.querySelector('.term-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openTerminal(device);
  });
  card.querySelector('.device-select').addEventListener('click', (e) => e.stopPropagation());
  card.querySelector('.device-select').addEventListener('change', (e) => toggleSelect(device.id, e.target.checked));
  card.addEventListener('click', () => openDetail(device.id));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(device.id); }
  });
  attachDragHandlers(card, device);

  return card;
}

$('#searchInput').addEventListener('input', render);
$('#groupFilter').addEventListener('change', render);

// ---------------------------------------------------------------- live stats websocket
function connectStatsSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/stats`);
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === 'snapshot') {
      statsCache = { ...statsCache, ...msg.stats };
      render();
      if (activeDeviceId) renderDetailStats(activeDeviceId);
    } else if (msg.type === 'stats') {
      statsCache[msg.deviceId] = msg.stats;
      render();
      if (activeDeviceId === msg.deviceId) renderDetailStats(activeDeviceId);
    }
  };
  ws.onclose = () => setTimeout(connectStatsSocket, 3000); // auto-reconnect
}

// ---------------------------------------------------------------- Add/Edit modal
const deviceModal = $('#deviceModalBackdrop');
let authType = 'password';

function applyAlertOverridePlaceholders() {
  const g = alertConfig?.thresholds || {};
  $('#fAlertCpu').placeholder = g.cpuPct !== undefined ? `global: ${g.cpuPct}%` : 'global';
  $('#fAlertMem').placeholder = g.memPct !== undefined ? `global: ${g.memPct}%` : 'global';
  $('#fAlertDisk').placeholder = g.diskPct !== undefined ? `global: ${g.diskPct}%` : 'global';
  $('#fAlertTemp').placeholder = g.tempC !== undefined ? `global: ${g.tempC}\u00b0C` : 'global';
}

function openAddModal() {
  $('#deviceModalTitle').textContent = 'Add device';
  $('#deviceForm').reset();
  $('#deviceId').value = '';
  $('#fPort').value = 22;
  populateGroupOptions();
  setAuthType('password');
  $('#secretLabel').textContent = 'Password';
  $('#fSecret').placeholder = 'Password for SSH login';
  $('#testResult').textContent = '';
  $('#fAlertCpu').value = '';
  $('#fAlertMem').value = '';
  $('#fAlertDisk').value = '';
  $('#fAlertTemp').value = '';
  applyAlertOverridePlaceholders();
  deviceModal.hidden = false;
  $('#fName').focus();
}

function openEditModal(device) {
  $('#deviceModalTitle').textContent = 'Edit device';
  $('#deviceId').value = device.id;
  $('#fName').value = device.name;
  $('#fHost').value = device.host;
  $('#fPort').value = device.port;
  $('#fUsername').value = device.username;
  populateGroupOptions(device.group);
  setAuthType(device.authType || 'password');
  $('#fSecret').value = '';
  $('#fSecret').placeholder = 'Leave blank to keep the existing credential';
  $('#fPassphrase').value = '';
  $('#testResult').textContent = '';
  const o = device.alertOverrides || {};
  $('#fAlertCpu').value = o.cpuPct ?? '';
  $('#fAlertMem').value = o.memPct ?? '';
  $('#fAlertDisk').value = o.diskPct ?? '';
  $('#fAlertTemp').value = o.tempC ?? '';
  applyAlertOverridePlaceholders();
  deviceModal.hidden = false;
}

function setAuthType(type) {
  authType = type;
  document.querySelectorAll('.segmented-opt').forEach((b) => b.classList.toggle('active', b.dataset.value === type));
  $('#secretLabel').textContent = type === 'key' ? 'Private key' : 'Password';
  $('#fSecret').placeholder = type === 'key' ? 'Paste the private key (e.g. contents of id_ed25519)' : 'Password for SSH login';
  $('#fSecret').rows = type === 'key' ? 6 : 1;
  $('#passphraseRow').hidden = type !== 'key';
}

$('#authTypeSegmented').addEventListener('click', (e) => {
  const btn = e.target.closest('.segmented-opt');
  if (btn) setAuthType(btn.dataset.value);
});

// ---------------------------------------------------------------- network scan
let scanResults = [];
let scanAuthType = 'password';

async function openScanModal() {
  $('#scanModalBackdrop').hidden = false;
  $('#scanResultsSection').hidden = true;
  $('#scanStatus').textContent = '';
  $('#scanAddResult').textContent = '';
  scanResults = [];
  populateScanGroupOptions();
  try {
    const res = await fetch('/api/scan/detect');
    const { cidr } = await res.json();
    $('#scanCidr').value = cidr;
  } catch {
    $('#scanCidr').value = '192.168.1.0/24';
  }
}

function populateScanGroupOptions() {
  const select = $('#scanGroup');
  const all = new Set(['Unsorted', ...groups]);
  select.innerHTML = [...all].sort().map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
}

$('#scanNetworkBtn').addEventListener('click', openScanModal);
$('#scanModalClose').addEventListener('click', () => ($('#scanModalBackdrop').hidden = true));
$('#scanModalBackdrop').addEventListener('click', (e) => {
  if (e.target === $('#scanModalBackdrop')) $('#scanModalBackdrop').hidden = true;
});

function setScanAuthType(type) {
  scanAuthType = type;
  document.querySelectorAll('#scanAuthTypeSegmented .segmented-opt').forEach((b) => b.classList.toggle('active', b.dataset.value === type));
  $('#scanSecretLabel').textContent = type === 'key' ? 'Private key' : 'Password';
  $('#scanSecret').placeholder = type === 'key' ? 'Paste the private key (e.g. contents of id_ed25519)' : 'Password for SSH login';
  $('#scanSecret').rows = type === 'key' ? 6 : 1;
  $('#scanPassphraseRow').hidden = type !== 'key';
}
$('#scanAuthTypeSegmented').addEventListener('click', (e) => {
  const btn = e.target.closest('.segmented-opt');
  if (btn) setScanAuthType(btn.dataset.value);
});

$('#scanStartBtn').addEventListener('click', async () => {
  const statusEl = $('#scanStatus');
  const cidr = $('#scanCidr').value.trim();
  const port = Number($('#scanPort').value) || 22;
  statusEl.textContent = 'Scanning\u2026 this can take a few seconds';
  statusEl.className = 'test-result';
  $('#scanResultsSection').hidden = true;

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cidr, port }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Scan failed');
    scanResults = body.results;
    renderScanResults();
    statusEl.textContent = `Found ${scanResults.length} host${scanResults.length === 1 ? '' : 's'} with port ${port} open`;
    statusEl.classList.add(scanResults.length ? 'ok' : '');
    $('#scanResultsSection').hidden = false;
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add('fail');
  }
});

function renderScanResults() {
  const listEl = $('#scanResultsList');
  $('#scanResultsCount').textContent = `${scanResults.length} found`;
  if (!scanResults.length) {
    listEl.innerHTML = '<p class="muted" style="padding: 12px;">No hosts responded on that port in this range.</p>';
    return;
  }
  listEl.innerHTML = scanResults
    .map(
      (r, i) => `
    <label class="scan-result-row">
      <input type="checkbox" class="scan-result-check" data-index="${i}" ${r.alreadyAdded ? 'disabled' : ''} />
      <span class="scan-result-ip">${escapeHtml(r.ip)}</span>
      ${r.hostname ? `<span class="scan-result-hostname">${escapeHtml(r.hostname)}</span>` : ''}
      ${r.alreadyAdded ? '<span class="scan-result-badge">already added</span>' : ''}
    </label>`
    )
    .join('');
}

$('#scanSelectAll').addEventListener('change', (e) => {
  document.querySelectorAll('.scan-result-check:not(:disabled)').forEach((cb) => (cb.checked = e.target.checked));
});

$('#scanAddSelectedBtn').addEventListener('click', async () => {
  const resultEl = $('#scanAddResult');
  const checked = [...document.querySelectorAll('.scan-result-check:checked')];
  if (!checked.length) {
    resultEl.textContent = 'Select at least one host first';
    resultEl.className = 'test-result fail';
    return;
  }
  const username = $('#scanUsername').value.trim();
  const secret = $('#scanSecret').value;
  if (!username || !secret) {
    resultEl.textContent = 'Username and credential are both required';
    resultEl.className = 'test-result fail';
    return;
  }

  const group = $('#scanGroup').value;
  const passphrase = $('#scanPassphrase').value;
  const port = Number($('#scanPort').value) || 22;

  resultEl.textContent = 'Adding\u2026';
  resultEl.className = 'test-result';

  let created = 0;
  let failed = 0;
  for (const cb of checked) {
    const host = scanResults[Number(cb.dataset.index)];
    const payload = {
      name: host.hostname || host.ip,
      host: host.ip,
      port,
      username,
      group,
      authType: scanAuthType,
      secret,
      passphrase,
    };
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) created++;
      else failed++;
    } catch {
      failed++;
    }
  }

  resultEl.textContent = `Added ${created} device${created === 1 ? '' : 's'}` + (failed ? `, ${failed} failed` : '');
  resultEl.classList.add(failed && !created ? 'fail' : 'ok');
  if (created) {
    await loadDevices();
    $('#scanModalBackdrop').hidden = true;
  }
});

$('#addDeviceBtn').addEventListener('click', openAddModal);
$('#emptyAddBtn').addEventListener('click', openAddModal);
$('#deviceModalClose').addEventListener('click', () => (deviceModal.hidden = true));
deviceModal.addEventListener('click', (e) => { if (e.target === deviceModal) deviceModal.hidden = true; });

function collectFormPayload() {
  return {
    name: $('#fName').value.trim(),
    host: $('#fHost').value.trim(),
    port: Number($('#fPort').value) || 22,
    username: $('#fUsername').value.trim(),
    group: $('#fGroup').value.trim() || 'Unsorted',
    authType,
    secret: $('#fSecret').value,
    passphrase: $('#fPassphrase').value,
    alertOverrides: {
      cpuPct: $('#fAlertCpu').value.trim(),
      memPct: $('#fAlertMem').value.trim(),
      diskPct: $('#fAlertDisk').value.trim(),
      tempC: $('#fAlertTemp').value.trim(),
    },
  };
}

$('#testConnBtn').addEventListener('click', async () => {
  const id = $('#deviceId').value;
  const payload = collectFormPayload();
  const resultEl = $('#testResult');
  resultEl.textContent = 'Testing\u2026';
  resultEl.className = 'test-result';

  try {
    let res;
    if (id) {
      // Existing device: save first (so a changed secret is tested), then test.
      res = await fetch(`${API}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      res = await fetch(`${API}/${id}/test`, { method: 'POST' });
    } else {
      if (!payload.host || !payload.username || !payload.secret) {
        resultEl.textContent = 'Fill in host, username and credential first';
        resultEl.classList.add('fail');
        return;
      }
      // No device saved yet: create a temporary one to test, then remove it either way.
      const created = await (await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).json();
      res = await fetch(`${API}/${created.id}/test`, { method: 'POST' });
      $('#deviceId').value = created.id; // now it exists; submit will PUT instead of POST
      await loadDevices();
    }
    const body = await res.json();
    resultEl.textContent = body.ok ? 'Connected successfully' : `Failed: ${body.error}`;
    resultEl.classList.add(body.ok ? 'ok' : 'fail');
  } catch (err) {
    resultEl.textContent = `Failed: ${err.message}`;
    resultEl.classList.add('fail');
  }
});

$('#deviceForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#deviceId').value;
  const payload = collectFormPayload();
  try {
    const res = await fetch(id ? `${API}/${id}` : API, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
    deviceModal.hidden = true;
    toast(id ? 'Device updated' : 'Device added');
    await loadDevices();
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------------------------------------------------------------- Detail drawer
const detailModal = $('#detailBackdrop');

function statBox(label, value, title) {
  return `<div class="stat-box"${title ? ` title="${escapeHtml(title)}"` : ''}><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function renderDetailStats(deviceId) {
  const device = devices.find((d) => d.id === deviceId);
  const stats = statsCache[deviceId] || {};
  if (!device) return;
  $('#detailTitle').textContent = `${device.name}`;
  const box = $('#detailStats');
  if (stats.status !== 'online') {
    box.innerHTML = statBox('Status', stats.status === 'offline' ? 'Offline' : 'Unknown');
    return;
  }
  box.innerHTML = [
    statBox('CPU', (stats.cpuUsedPct ?? '--') + '%'),
    statBox('Memory', stats.memory ? `${stats.memory.usedPct}%` : '--'),
    statBox('Disk', stats.disk ? `${stats.disk.usedPct}%` : '--'),
    statBox('Temp', formatTemp(stats.tempC)),
    statBox('Uptime', stats.uptime || '--'),
    statBox('Load (1m)', stats.loadAvg ? stats.loadAvg['1m'] : '--'),
    statBox('OS', stats.os || '--'),
    statBox('Kernel', stats.kernel || '--'),
    statBox('Hardware', stats.model || '--'),
    statBox('Power', describeThrottledShort(stats.throttled), describeThrottled(stats.throttled)),
  ].join('');
}

async function openDetail(deviceId) {
  activeDeviceId = deviceId;
  const device = devices.find((d) => d.id === deviceId);
  renderDetailStats(deviceId);
  detailModal.hidden = false;
  switchTab('services');
  loadServices(deviceId);
  $('#actionsOutput').hidden = true;
}

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('#tabServices').hidden = name !== 'services';
  $('#tabPorts').hidden = name !== 'ports';
  $('#tabActions').hidden = name !== 'actions';
  $('#tabDanger').hidden = name !== 'danger';
  if (name === 'ports' && activeDeviceId) loadPorts(activeDeviceId);
}
document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

async function loadServices(deviceId) {
  const listEl = $('#servicesList');
  listEl.innerHTML = '<p class="muted">Loading services\u2026</p>';
  try {
    const res = await fetch(`${API}/${deviceId}/services`);
    if (!res.ok) throw new Error((await res.json()).error || 'Could not load services');
    const services = await res.json();
    renderServices(services);
  } catch (err) {
    listEl.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

let currentServices = [];
// Sort key is 'name' or 'active' (the underlying systemd active-state
// field, e.g. active/failed/inactive) -- "Status" in the header sorts by
// that. dir 1 = ascending, -1 = descending.
let serviceSort = { key: 'name', dir: 1 };

function renderServices(services) {
  currentServices = services;
  applyServiceFilter();
}

function sortServices(list) {
  const { key, dir } = serviceSort;
  return [...list].sort((a, b) => {
    const av = (a[key] || '').toLowerCase();
    const bv = (b[key] || '').toLowerCase();
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return a.name.localeCompare(b.name); // stable tie-break so equal-status rows don't jump around
  });
}

function sortArrow(key) {
  if (serviceSort.key !== key) return '';
  return `<span class="sort-arrow">${serviceSort.dir === 1 ? '\u25B2' : '\u25BC'}</span>`;
}

function applyServiceFilter() {
  const q = $('#serviceFilter').value.trim().toLowerCase();
  const filtered = sortServices(currentServices.filter((s) => !q || s.name.toLowerCase().includes(q)));
  const listEl = $('#servicesList');

  const rows = filtered.length
    ? filtered
        .map(
          (s) => `
    <tr class="service-row">
      <td>
        <div class="service-name">${escapeHtml(s.name)}</div>
        <div class="service-desc">${escapeHtml(s.description || '')}</div>
      </td>
      <td><span class="service-state ${escapeHtml(s.active)}">${escapeHtml(s.sub)}</span></td>
      <td><button class="btn btn-ghost btn-sm service-restart-btn" data-service="${escapeHtml(s.name)}" title="Restart this service">Restart</button></td>
    </tr>`
        )
        .join('')
    : '<tr><td colspan="3"><p class="muted" style="padding: 4px 0;">No matching services.</p></td></tr>';

  listEl.innerHTML = `
    <table class="services-table">
      <thead>
        <tr>
          <th data-sort="name" class="${serviceSort.key === 'name' ? 'sorted' : ''}">Name${sortArrow('name')}</th>
          <th data-sort="active" class="${serviceSort.key === 'active' ? 'sorted' : ''}">Status${sortArrow('active')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// Event delegation: the table gets fully rebuilt on every render, so bind
// the sort-header click handler once on the stable container instead of
// re-attaching it after each render.
$('#servicesList').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (th) {
    const key = th.dataset.sort;
    if (serviceSort.key === key) serviceSort.dir *= -1;
    else serviceSort = { key, dir: 1 };
    applyServiceFilter();
    return;
  }
  const restartBtn = e.target.closest('.service-restart-btn');
  if (restartBtn && activeDeviceId) {
    restartService(activeDeviceId, restartBtn.dataset.service);
  }
});

async function restartService(deviceId, serviceName) {
  const device = devices.find((d) => d.id === deviceId);
  if (!confirm(`Restart ${serviceName} on "${device?.name || 'this device'}"?`)) return;
  toast(`Restarting ${serviceName}\u2026`);
  try {
    const res = await fetch(`${API}/${deviceId}/services/${encodeURIComponent(serviceName)}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restart' }),
    });
    const body = await res.json();
    if (body.ok) toast(`${serviceName} restarted`);
    else toast(`Failed to restart ${serviceName}: ${(body.stderr || body.error || 'unknown error').split('\n')[0]}`, true);
  } catch (err) {
    toast(err.message, true);
  }
  // Give the service a moment to settle, then refresh the list so the
  // status column reflects the change (if the drawer is still open on it).
  setTimeout(() => activeDeviceId === deviceId && loadServices(deviceId), 1500);
}

$('#serviceFilter').addEventListener('input', applyServiceFilter);
$('#refreshServicesBtn').addEventListener('click', () => activeDeviceId && loadServices(activeDeviceId));

// ---------------------------------------------------------------- device actions
let customCommands = [];

async function loadCustomCommands() {
  try {
    const res = await fetch('/api/commands');
    customCommands = await res.json();
  } catch {
    customCommands = [];
  }
  renderCustomCommandButtons();
}

function renderCustomCommandButtons() {
  const container = $('#customCommandButtons');
  $('#noCommandsNote').hidden = customCommands.length > 0;
  container.innerHTML = customCommands
    .map((c) => `<button class="btn btn-ghost btn-sm custom-command-btn" data-id="${escapeHtml(c.id)}" title="${escapeHtml(c.command)} (times out after ${c.timeoutSec || 120}s)">${escapeHtml(c.label)}</button>`)
    .join('');
}

function showActionsOutput(title, body) {
  $('#actionsOutput').hidden = false;
  $('#actionsOutputTitle').textContent = title;
  $('#actionsOutputBody').textContent = body;
}
$('#actionsOutputClose').addEventListener('click', () => ($('#actionsOutput').hidden = true));

// Shared runner for reboot/shutdown/custom commands: confirm, POST, then
// show whatever combination of note/stdout/stderr/error came back. Used
// for anything that returns {ok, code, stdout, stderr} from the backend.
async function runDeviceAction(url, { confirmMessage, title, body, runningMessage }) {
  if (confirmMessage && !confirm(confirmMessage)) return;
  showActionsOutput(title, runningMessage || 'Running\u2026');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body || '{}',
    });
    const result = await res.json();
    const lines = [];
    if (result.note) lines.push(result.note);
    if (result.stdout) lines.push(result.stdout.trim());
    if (result.stderr) lines.push('--- stderr ---\n' + result.stderr.trim());
    if (result.error && !result.note) lines.push('Error: ' + result.error);
    if (typeof result.code === 'number') lines.push(`(exit code ${result.code})`);
    if (!lines.length) lines.push(result.ok ? '(no output)' : 'Failed \u2014 no further detail returned');
    showActionsOutput(title, lines.join('\n\n'));
  } catch (err) {
    showActionsOutput(title, `Request failed: ${err.message}`);
  }
}

$('#rebootBtn').addEventListener('click', () => {
  if (!activeDeviceId) return;
  const device = devices.find((d) => d.id === activeDeviceId);
  runDeviceAction(`${API}/${activeDeviceId}/actions/reboot`, {
    confirmMessage: `Reboot "${device?.name}" now? It will be briefly unreachable.`,
    title: 'Reboot',
  });
});

$('#shutdownBtn').addEventListener('click', () => {
  if (!activeDeviceId) return;
  const device = devices.find((d) => d.id === activeDeviceId);
  runDeviceAction(`${API}/${activeDeviceId}/actions/shutdown`, {
    confirmMessage: `Shut down "${device?.name}" now? You'll need physical or remote-power access to turn it back on.`,
    title: 'Shutdown',
  });
});

$('#customCommandButtons').addEventListener('click', (e) => {
  const btn = e.target.closest('.custom-command-btn');
  if (!btn || !activeDeviceId) return;
  const cmd = customCommands.find((c) => c.id === btn.dataset.id);
  if (!cmd) return;
  const device = devices.find((d) => d.id === activeDeviceId);
  runDeviceAction(`${API}/${activeDeviceId}/actions/run-command`, {
    confirmMessage: `Run on "${device?.name}"?\n\n${cmd.command}`,
    title: cmd.label,
    body: JSON.stringify({ commandId: cmd.id }),
    runningMessage: `Running\u2026 (this stays open until it finishes or ${cmd.timeoutSec || 120}s pass \u2014 keep this tab open)`,
  });
});

async function loadPorts(deviceId) {
  const listEl = $('#portsList');
  listEl.innerHTML = '<p class="muted">Scanning open ports\u2026</p>';
  try {
    const res = await fetch(`${API}/${deviceId}/ports`);
    if (!res.ok) throw new Error((await res.json()).error || 'Could not list open ports');
    const ports = await res.json();
    if (!ports.length) {
      listEl.innerHTML = '<p class="muted">No listening TCP ports found (or this account can\'t see them).</p>';
      return;
    }
    const device = devices.find((d) => d.id === deviceId);
    listEl.innerHTML = ports
      .map((p) => {
        if (p.scheme && device) {
          const url = `${p.scheme}://${device.host}:${p.port}/`;
          return `<a class="port-chip port-chip-link" href="${url}" target="_blank" rel="noopener">${p.port} <span class="port-scheme">${p.scheme}</span></a>`;
        }
        return `<span class="port-chip">${p.port}</span>`;
      })
      .join('');
  } catch (err) {
    listEl.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}
$('#refreshPortsBtn').addEventListener('click', () => activeDeviceId && loadPorts(activeDeviceId));

$('#detailClose').addEventListener('click', () => (detailModal.hidden = true, activeDeviceId = null));
detailModal.addEventListener('click', (e) => { if (e.target === detailModal) { detailModal.hidden = true; activeDeviceId = null; } });

$('#editFromDetailBtn').addEventListener('click', () => {
  const device = devices.find((d) => d.id === activeDeviceId);
  detailModal.hidden = true;
  openEditModal(device);
});

$('#deleteFromDetailBtn').addEventListener('click', async () => {
  const device = devices.find((d) => d.id === activeDeviceId);
  if (!device) return;
  if (!confirm(`Remove "${device.name}" from monitoring? This deletes its stored credential from the dashboard.`)) return;
  await fetch(`${API}/${device.id}`, { method: 'DELETE' });
  detailModal.hidden = true;
  activeDeviceId = null;
  toast('Device removed');
  await loadDevices();
});

// ---------------------------------------------------------------- Terminal
const terminalModal = $('#terminalBackdrop');

function openTerminal(device) {
  $('#terminalTitle').textContent = `${device.name} \u2014 ${device.username}@${device.host}`;
  const local = buildLocalLink(device);
  const localLink = $('#localSshLink');
  localLink.href = local.href;
  localLink.textContent = local.label;
  terminalModal.hidden = false;

  const container = $('#xtermContainer');
  container.innerHTML = '';

  term = new Terminal({
    theme: {
      background: '#0b0e14',
      foreground: '#e4e7ed',
      cursor: '#5eb1ef',
    },
    fontFamily: 'ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
  });
  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  termSocket = new WebSocket(`${proto}://${location.host}/ws/terminal?id=${device.id}`);

  termSocket.onopen = () => {
    term.onData((data) => termSocket.send(JSON.stringify({ type: 'input', data })));
    sendResize();
  };
  termSocket.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === 'output') term.write(msg.data);
    else if (msg.type === 'error') term.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`);
    else if (msg.type === 'closed') term.write('\r\n\x1b[90m[session closed]\x1b[0m\r\n');
  };
  termSocket.onclose = () => term && term.write('\r\n\x1b[90m[disconnected]\x1b[0m\r\n');

  window.addEventListener('resize', onTerminalResize);
}

function onTerminalResize() {
  if (!fitAddon || terminalModal.hidden) return;
  fitAddon.fit();
  sendResize();
}

function sendResize() {
  if (termSocket && termSocket.readyState === 1 && term) {
    termSocket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  }
}

$('#terminalClose').addEventListener('click', closeTerminal);
function closeTerminal() {
  terminalModal.hidden = true;
  if (termSocket) termSocket.close();
  if (term) term.dispose();
  term = null;
  window.removeEventListener('resize', onTerminalResize);
}
terminalModal.addEventListener('click', (e) => { if (e.target === terminalModal) closeTerminal(); });

// ---------------------------------------------------------------- boot
async function loadVersion() {
  try {
    const res = await fetch('/api/version');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { version } = await res.json();
    $('#brandVersion').textContent = `v${version}`;
  } catch (err) {
    console.error('Could not load version from /api/version:', err);
    $('#brandVersion').textContent = 'v?';
  }
}

// Informational only -- never applies anything. Disabled by default until
// GITHUB_REPO is set on the server (see README/DOCKER.md).
async function checkForUpdate() {
  try {
    const res = await fetch('/api/version/check');
    const info = await res.json();
    const badge = $('#updateBadge');
    if (info.updateAvailable && info.latest) {
      badge.textContent = `v${info.latest} available`;
      badge.href = info.releaseNotesUrl || '#';
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  } catch (err) {
    console.error('Update check failed:', err);
  }
}

loadVersion();
checkForUpdate();
loadAuthStatus();
loadGroups();
loadAlertConfig();
loadCustomCommands();
loadDevices();
connectStatsSocket();
