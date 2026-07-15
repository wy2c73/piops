const API = '/api/devices';

let devices = [];       // last known device list (without secrets)
let statsCache = {};    // deviceId -> stats, kept fresh via websocket
let activeDeviceId = null;
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
  $('#settingsModalBackdrop').hidden = false;
});
$('#settingsModalClose').addEventListener('click', () => ($('#settingsModalBackdrop').hidden = true));
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
      body: JSON.stringify({ passphrase, clientSettings: settings }),
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

    fileInput.value = '';
    $('#importPassphrase').value = '';
    await loadDevices();
    refreshVisibleUnits();
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
        <th></th><th>Name</th><th>Host</th><th>CPU</th><th>Mem</th><th>Disk</th>
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
      <td><span class="led ${ledClass}" title="${stats.status}"></span></td>
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
      <div>
        <p class="card-title">${escapeHtml(device.name)}</p>
        <p class="card-sub">${escapeHtml(device.username)}@${escapeHtml(device.host)}:${device.port}</p>
        <span class="card-group">${escapeHtml(device.group || 'Unsorted')}</span>
      </div>
      <span class="led ${ledClass}" title="${stats.status}"></span>
    </div>
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

function statBox(label, value) {
  return `<div class="stat-box"><div class="label">${label}</div><div class="value">${value}</div></div>`;
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
  ].join('');
}

async function openDetail(deviceId) {
  activeDeviceId = deviceId;
  const device = devices.find((d) => d.id === deviceId);
  renderDetailStats(deviceId);
  detailModal.hidden = false;
  switchTab('services');
  loadServices(deviceId);
}

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('#tabServices').hidden = name !== 'services';
  $('#tabPorts').hidden = name !== 'ports';
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
function renderServices(services) {
  currentServices = services;
  applyServiceFilter();
}

function applyServiceFilter() {
  const q = $('#serviceFilter').value.trim().toLowerCase();
  const filtered = currentServices.filter((s) => !q || s.name.toLowerCase().includes(q));
  const listEl = $('#servicesList');
  if (!filtered.length) {
    listEl.innerHTML = '<p class="muted">No matching services.</p>';
    return;
  }
  listEl.innerHTML = filtered
    .map(
      (s) => `
    <div class="service-row">
      <div>
        <div class="service-name">${escapeHtml(s.name)}</div>
        <div class="service-desc">${escapeHtml(s.description || '')}</div>
      </div>
      <span class="service-state ${escapeHtml(s.active)}">${escapeHtml(s.sub)}</span>
    </div>`
    )
    .join('');
}
$('#serviceFilter').addEventListener('input', applyServiceFilter);
$('#refreshServicesBtn').addEventListener('click', () => activeDeviceId && loadServices(activeDeviceId));

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

loadVersion();
loadGroups();
loadDevices();
connectStatsSocket();
