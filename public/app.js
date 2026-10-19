const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'tm-api-key';
const TOKEN_RE = /^tmk_[A-Za-z0-9_-]{20,}$/;
const KEY_PLACEHOLDER = '여기에_스크립트_키';
const VIEW_TITLES = { scripts: 'Scripts', users: 'Users', keys: 'Script Keys' };

const state = {
  token: readToken(),
  me: null,
  setupNeeded: false,
  scripts: [],
  scriptKeys: [],
  users: [],
  apiKeys: [],
  view: 'scripts',
  modal: null,
  editId: null,
  keyScriptId: null
};

let toastTimer = 0;
let dragDepth = 0;

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function writeToken(value) {
  state.token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isManager = () => state.me?.role === 'owner' || state.me?.role === 'admin';
const isOwner = () => state.me?.role === 'owner';
const isExpired = (iso) => !!iso && Date.parse(iso) <= Date.now();
const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const byteSize = (text) => new TextEncoder().encode(text).byteLength;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString() : '-');
const maskKey = (key) => (key.length > 12 ? `${key.slice(0, 8)}••••${key.slice(-4)}` : '••••');
const loaderFor = (slug, token) => `${token ? `script_key = "${token}"\n` : ''}loadstring(game:HttpGet("${location.origin}/${slug}"))()`;
const scriptById = (id) => state.scripts.find((s) => s.id === id) || null;

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (state.token) headers.set('authorization', `Bearer ${state.token}`);
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function banner(id, text = '', kind = 'ok') {
  const el = $(id);
  el.hidden = !text;
  el.className = `banner ${kind}`;
  el.textContent = text;
}

async function withBusy(button, task) {
  button.disabled = true;
  try {
    return await task();
  } finally {
    button.disabled = false;
  }
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    window.prompt('Copy this text', text);
  }
}

function setModal(id, open) {
  const el = $(id);
  el.classList.toggle('open', open);
  el.setAttribute('aria-hidden', String(!open));
}

function openModal(id, focusSelector) {
  if (state.modal && state.modal !== id) setModal(state.modal, false);
  state.modal = id;
  setModal(id, true);
  document.body.style.overflow = 'hidden';
  const target = focusSelector ? $(id).querySelector(focusSelector) : null;
  if (target && matchMedia('(pointer: fine)').matches) target.focus();
}

function closeModal() {
  if (!state.modal) return;
  setModal(state.modal, false);
  state.modal = null;
  document.body.style.overflow = '';
}

function setMenu(open) {
  $('drawer').classList.toggle('open', open);
  $('menuBackdrop').classList.toggle('open', open);
  $('drawer').setAttribute('aria-hidden', String(!open));
  $('menuBtn').setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open || state.modal ? 'hidden' : '';
}

function showSecret(title, items) {
  $('secretTitle').textContent = title;
  $('secretBody').innerHTML = items.map(([label, value]) => `
    <div class="block">
      <p class="hint">${esc(label)}</p>
      <pre class="secret"><code>${esc(value)}</code></pre>
      <button class="btn sm" data-copy="${esc(value)}">COPY</button>
    </div>`).join('');
  openModal('secretModal');
}

function showView(name) {
  state.view = name === 'users' && !isManager() ? 'scripts' : name;
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${state.view}`));
  document.querySelectorAll('.nav-item[data-nav]').forEach((el) => el.classList.toggle('is-active', el.dataset.nav === state.view));
  const title = VIEW_TITLES[state.view];
  $('crumb').textContent = title;
  $('pageTitle').textContent = title;
  document.title = `Luarmor — ${title}`;
}

function applyRole() {
  const manager = isManager();
  document.querySelectorAll('[data-manager]').forEach((el) => { el.hidden = !manager; });
  if (state.view === 'users' && !manager) showView('scripts');
}

function setBar(id, pct) {
  $(id).style.width = `${Math.min(Math.max(pct, 0), 100)}%`;
}

function renderMetrics() {
  const scripts = state.scripts.length;
  const keyScripts = state.scripts.filter((s) => s.mode === 'key').length;
  $('scriptCount').textContent = scripts;
  $('scriptMeta').textContent = `${scripts - keyScripts} keyless · ${keyScripts} key`;
  setBar('scriptBar', scripts ? (keyScripts / scripts) * 100 : 0);

  const activeKeys = state.scriptKeys.filter((k) => k.status === 'active' && !isExpired(k.expires_at)).length;
  $('keyCount').textContent = activeKeys;
  $('keyMeta').textContent = `${activeKeys} of ${state.scriptKeys.length} keys`;
  setBar('keyBar', state.scriptKeys.length ? (activeKeys / state.scriptKeys.length) * 100 : 0);

  const users = state.users.length;
  const blocked = state.users.filter((u) => u.status !== 'active').length;
  const active = users - blocked;
  $('userCount').textContent = users;
  $('userMeta').textContent = `${active} active`;
  setBar('userBar', users ? (active / users) * 100 : 0);
  $('blockedCount').textContent = blocked;
}

function renderScripts() {
  const body = $('scriptRows');
  if (!state.scripts.length) {
    body.innerHTML = `<tr><td colspan="4"><div class="empty">${state.me ? 'No scripts yet. Use ADD SCRIPT to create one.' : 'Sign in to load scripts.'}</div></td></tr>`;
    return;
  }
  body.innerHTML = state.scripts.map((s) => {
    const id = esc(s.id);
    const modePill = s.mode === 'key' ? '<span class="pill draft">KEY</span>' : '<span class="pill active">KEYLESS</span>';
    const hwid = s.hwid_lock ? ' <span class="pill draft">HWID</span>' : '';
    const keyButton = s.mode === 'key' ? `<button class="btn sm" data-action="issue-key" data-id="${id}">KEY</button>` : '';
    const manage = isManager()
      ? `<button class="btn sm" data-action="edit-script" data-id="${id}">EDIT</button><button class="btn sm danger" data-action="delete-script" data-id="${id}">DELETE</button>`
      : '';
    return `<tr>
      <td><div class="script"><span class="file" aria-hidden="true">&lt;/&gt;</span><div class="script-text"><span class="name">${esc(s.name)}</span><small>${esc(s.slug)} · ${esc(bytes(s.byte_size))}</small></div></div></td>
      <td data-label="MODE">${modePill}${hwid}</td>
      <td class="ver" data-label="UPDATED">${esc(fmtDate(s.updated_at || s.created_at))}</td>
      <td data-label="ACTIONS"><div class="row-actions"><button class="btn sm" data-action="loader" data-id="${id}">LOADER</button>${keyButton}${manage}</div></td>
    </tr>`;
  }).join('');
}

function renderUsers() {
  const list = $('userRows');
  if (!state.users.length) {
    list.innerHTML = '<div class="empty">No users yet.</div>';
    return;
  }
  list.innerHTML = state.users.map((u) => {
    const id = esc(u.id);
    const self = u.id === state.me?.id;
    const role = isOwner() && !self
      ? `<select data-action="set-role" data-id="${id}" aria-label="Role for ${esc(u.username)}">${['user', 'admin', 'owner'].map((r) => `<option value="${r}"${r === u.role ? ' selected' : ''}>${r}</option>`).join('')}</select>`
      : `<span class="pill draft">${esc(u.role)}</span>`;
    const block = self
      ? ''
      : `<button class="btn sm" data-action="toggle-user" data-id="${id}" data-status="${esc(u.status)}">${u.status === 'active' ? 'BLOCK' : 'UNBLOCK'}</button>`;
    return `<article class="item">
      <div class="item-info"><strong>${esc(u.username)}${self ? ' (you)' : ''}</strong><small>${esc(u.status)} · joined ${esc(fmtDate(u.created_at))}</small></div>
      <div class="row-actions">${role}<button class="btn sm" data-action="issue-api-key" data-id="${id}">ISSUE KEY</button>${block}</div>
    </article>`;
  }).join('');
}

function renderApiKeys() {
  const list = $('apiKeyRows');
  if (!state.apiKeys.length) {
    list.innerHTML = '<div class="empty">No API keys yet.</div>';
    return;
  }
  list.innerHTML = state.apiKeys.map((k) => {
    const status = k.revoked_at ? 'revoked' : isExpired(k.expires_at) ? 'expired' : 'active';
    const used = k.last_used_at ? `last used ${fmtDate(k.last_used_at)}` : 'never used';
    const expiry = k.expires_at ? `expires ${fmtDate(k.expires_at)}` : 'no expiry';
    const revoke = status === 'active'
      ? `<button class="btn sm danger" data-action="revoke-api-key" data-id="${esc(k.id)}">REVOKE</button>`
      : '';
    return `<article class="item">
      <div class="item-info"><strong>${esc(k.username)}</strong><small>${esc(k.user_role)} · ${esc(k.key_prefix)}… · ${status} · ${esc(used)} · ${esc(expiry)}</small></div>
      <div class="row-actions">${revoke}</div>
    </article>`;
  }).join('');
}

function renderScriptKeys() {
  const q = $('keySearch').value.trim().toLowerCase();
  const keys = state.scriptKeys.filter((k) => !q || [k.slug, k.username, k.key_prefix].some((v) => String(v).toLowerCase().includes(q)));
  const list = $('keyRows');
  if (!keys.length) {
    let message = 'Sign in to see script keys.';
    if (state.me) message = state.scriptKeys.length ? 'No keys match your search.' : 'No script keys yet. Issue one from a key-mode script.';
    list.innerHTML = `<div class="empty">${message}</div>`;
    return;
  }
  list.innerHTML = keys.map((k) => {
    const id = esc(k.id);
    const status = k.status === 'active' && isExpired(k.expires_at) ? 'expired' : k.status;
    const actions = [];
    if (k.status !== 'revoked') {
      if (isManager() && k.status === 'active') actions.push(`<button class="btn sm" data-action="suspend-key" data-id="${id}">SUSPEND</button>`);
      if (isManager() && k.status === 'suspended') actions.push(`<button class="btn sm" data-action="activate-key" data-id="${id}">ACTIVATE</button>`);
      if (isManager() && k.hwid_bound) actions.push(`<button class="btn sm" data-action="reset-hwid" data-id="${id}">RESET HWID</button>`);
      actions.push(`<button class="btn sm danger" data-action="revoke-key" data-id="${id}">REVOKE</button>`);
    }
    const hwid = k.hwid_bound ? 'HWID bound' : 'HWID unbound';
    const expiry = k.expires_at ? `expires ${fmtDate(k.expires_at)}` : 'no expiry';
    return `<article class="item">
      <div class="item-info"><strong>${esc(k.slug)} · ${esc(k.username)}</strong><small>${esc(k.key_prefix)}… · ${esc(status)} · ${hwid} · ${esc(expiry)}</small></div>
      <div class="row-actions">${actions.join('')}</div>
    </article>`;
  }).join('');
}

function renderAll() {
  applyRole();
  renderMetrics();
  renderScripts();
  renderScriptKeys();
  renderUsers();
  renderApiKeys();
}

async function loadScripts() {
  state.scripts = (await api('/api/scripts')).scripts || [];
}

async function loadScriptKeys() {
  state.scriptKeys = (await api('/api/script-keys')).keys || [];
}

async function loadUsers() {
  const [users, keys] = await Promise.all([api('/api/users'), api('/api/keys')]);
  state.users = users.users || [];
  state.apiKeys = keys.keys || [];
}

function resetData() {
  state.scripts = [];
  state.scriptKeys = [];
  state.users = [];
  state.apiKeys = [];
}

async function reloadData() {
  const tasks = [loadScripts(), loadScriptKeys()];
  if (isManager()) tasks.push(loadUsers());
  const results = await Promise.allSettled(tasks);
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) toast(failed.reason.message);
  renderAll();
}

async function refreshAll() {
  if (!state.token) {
    state.me = null;
    resetData();
    renderAll();
    return;
  }
  try {
    state.me = (await api('/api/auth/me')).user;
  } catch (error) {
    state.me = null;
    resetData();
    renderAll();
    throw error;
  }
  await reloadData();
}

async function mutate(task, message) {
  try {
    await task();
    toast(message);
    await reloadData();
  } catch (error) {
    toast(error.message);
  }
}

function openAccountModal() {
  $('apiKeyInput').value = state.token;
  $('apiKeyInput').type = 'password';
  $('apiToggle').textContent = 'SHOW';
  $('accountStatus').textContent = state.token ? `Saved key: ${maskKey(state.token)}` : 'No API key saved.';
  $('signupBlock').hidden = !state.setupNeeded;
  banner('accountBanner');
  openModal('accountModal', '#apiKeyInput');
}

function toggleApiKeyVisibility() {
  const input = $('apiKeyInput');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('apiToggle').textContent = show ? 'HIDE' : 'SHOW';
}

async function saveApiKey(button) {
  const value = $('apiKeyInput').value.trim();
  if (!TOKEN_RE.test(value)) {
    banner('accountBanner', 'API key format is invalid.', 'error');
    return;
  }
  const previous = state.token;
  writeToken(value);
  try {
    await withBusy(button, refreshAll);
    closeModal();
    toast('Signed in.');
  } catch (error) {
    writeToken(previous);
    banner('accountBanner', error.message, 'error');
  }
}

function signOut() {
  writeToken('');
  state.me = null;
  resetData();
  renderAll();
  closeModal();
  toast('Signed out.');
}

async function createOwner(button) {
  const username = $('signupName').value.trim();
  if (!username) {
    banner('accountBanner', 'Enter a username.', 'error');
    return;
  }
  try {
    const data = await withBusy(button, () => api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ username }) }));
    writeToken(data.key.token);
    state.setupNeeded = false;
    closeModal();
    showSecret('Owner API key', [['API key', data.key.token]]);
    await refreshAll().catch((error) => toast(error.message));
  } catch (error) {
    banner('accountBanner', error.message, 'error');
  }
}

function updateSize() {
  $('scriptSize').textContent = bytes(byteSize($('scriptCode').value));
}

async function loadFile(file) {
  $('scriptCode').value = await file.text();
  if (!$('scriptName').value.trim()) $('scriptName').value = file.name.replace(/\.(lua|luau|txt)$/i, '');
  $('uploadName').textContent = file.name;
  updateSize();
}

async function openScriptModal(id) {
  const script = id ? scriptById(id) : null;
  if (id && !script) return;
  state.editId = script ? script.id : null;
  $('scriptModalTitle').textContent = script ? 'Edit Script' : 'Add Script';
  $('scriptName').value = script ? script.name : '';
  $('scriptSlug').value = script ? script.slug : '';
  $('scriptFree').checked = script ? script.mode === 'keyless' : true;
  $('scriptHwid').checked = !!script?.hwid_lock;
  $('scriptCode').value = '';
  $('uploadName').textContent = 'Drop a .lua file here or click to browse';
  banner('scriptBanner');
  updateSize();
  openModal('scriptModal', '#scriptName');
  if (!script) return;
  if (script.mode === 'key') {
    banner('scriptBanner', 'Key-mode code cannot be read back. Paste the new code to save changes.');
    return;
  }
  try {
    const data = await api('/api/execute', { method: 'POST', body: JSON.stringify({ id: script.id }) });
    if (state.editId === script.id) {
      $('scriptCode').value = data.code;
      updateSize();
    }
  } catch (error) {
    banner('scriptBanner', error.message, 'error');
  }
}

async function saveScript(button) {
  const name = $('scriptName').value.trim();
  const code = $('scriptCode').value;
  if (!name) {
    banner('scriptBanner', 'Script name is required.', 'error');
    return;
  }
  if (!code.trim()) {
    banner('scriptBanner', 'Code is required.', 'error');
    return;
  }
  const body = {
    name,
    slug: $('scriptSlug').value.trim() || name,
    code,
    mode: $('scriptFree').checked ? 'keyless' : 'key',
    hwid_lock: $('scriptHwid').checked
  };
  try {
    await withBusy(button, () => (state.editId
      ? api(`/api/scripts/${state.editId}`, { method: 'PATCH', body: JSON.stringify(body) })
      : api('/api/scripts', { method: 'POST', body: JSON.stringify(body) })));
    closeModal();
    toast('Script saved.');
    await reloadData();
  } catch (error) {
    banner('scriptBanner', error.message, 'error');
  }
}

async function deleteScript(id) {
  const script = scriptById(id);
  if (!script || !confirm(`Delete "${script.name}"? This cannot be undone.`)) return;
  await mutate(() => api(`/api/scripts/${id}`, { method: 'DELETE' }), 'Script deleted.');
}

function openKeyModal(id) {
  const script = scriptById(id);
  if (!script) return;
  state.keyScriptId = id;
  $('keyModalTitle').textContent = `Issue Key · ${script.name}`;
  const holders = state.users.filter((u) => u.status === 'active');
  $('keyUser').innerHTML = holders.map((u) => `<option value="${esc(u.id)}">${esc(u.username)} (${esc(u.role)})</option>`).join('');
  $('keyDays').value = '';
  banner('keyBanner');
  openModal('keyModal', isManager() ? '#keyUser' : '#keyDays');
}

async function issueScriptKey(button) {
  const script = scriptById(state.keyScriptId);
  if (!script) return;
  const body = {};
  if (isManager() && $('keyUser').value) body.user_id = $('keyUser').value;
  const days = $('keyDays').value.trim();
  if (days) body.expires_in_days = Number(days);
  try {
    const data = await withBusy(button, () => api(`/api/scripts/${script.id}/keys`, { method: 'POST', body: JSON.stringify(body) }));
    closeModal();
    showSecret('Script key', [['Script key', data.key.token], ['Loader', loaderFor(script.slug, data.key.token)]]);
    await reloadData();
  } catch (error) {
    banner('keyBanner', error.message, 'error');
  }
}

function openUserModal() {
  $('userName').value = '';
  $('userDays').value = '';
  $('userRole').innerHTML = (isOwner() ? ['user', 'admin', 'owner'] : ['user']).map((r) => `<option value="${r}">${r}</option>`).join('');
  banner('userBanner');
  openModal('userModal', '#userName');
}

async function createUser(button) {
  const username = $('userName').value.trim();
  if (!username) {
    banner('userBanner', 'Enter a username.', 'error');
    return;
  }
  const body = { username, role: $('userRole').value };
  const days = $('userDays').value.trim();
  if (days) body.expires_in_days = Number(days);
  try {
    const data = await withBusy(button, () => api('/api/keys', { method: 'POST', body: JSON.stringify(body) }));
    closeModal();
    showSecret(`API key for ${data.key.username}`, [['API key', data.key.token]]);
    await reloadData();
  } catch (error) {
    banner('userBanner', error.message, 'error');
  }
}

async function issueApiKeyFor(id) {
  const user = state.users.find((u) => u.id === id);
  if (!user || !confirm(`Issue a new API key for ${user.username}?`)) return;
  try {
    const data = await api('/api/keys', { method: 'POST', body: JSON.stringify({ user_id: id }) });
    showSecret(`API key for ${user.username}`, [['API key', data.key.token]]);
    await reloadData();
  } catch (error) {
    toast(error.message);
  }
}

async function handleAction(action, el) {
  const id = el.dataset.id;
  switch (action) {
    case 'open-menu': setMenu(true); break;
    case 'close-menu': setMenu(false); break;
    case 'open-account': openAccountModal(); break;
    case 'refresh': await reloadData(); break;
    case 'add-script': openScriptModal(null); break;
    case 'edit-script': openScriptModal(id); break;
    case 'delete-script': deleteScript(id); break;
    case 'issue-key': openKeyModal(id); break;
    case 'loader': {
      const script = scriptById(id);
      if (script) copyText(loaderFor(script.slug, script.mode === 'key' ? KEY_PLACEHOLDER : ''), 'Loadstring copied.');
      break;
    }
    case 'add-user': openUserModal(); break;
    case 'issue-api-key': issueApiKeyFor(id); break;
    case 'toggle-user':
      mutate(() => api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ status: el.dataset.status === 'active' ? 'blocked' : 'active' }) }), 'User updated.');
      break;
    case 'revoke-api-key':
      if (confirm('Revoke this API key? It can no longer sign in.')) mutate(() => api(`/api/keys/${id}`, { method: 'DELETE' }), 'API key revoked.');
      break;
    case 'suspend-key':
      mutate(() => api(`/api/script-keys/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'suspended' }) }), 'Key suspended.');
      break;
    case 'activate-key':
      mutate(() => api(`/api/script-keys/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }), 'Key activated.');
      break;
    case 'reset-hwid':
      mutate(() => api(`/api/script-keys/${id}`, { method: 'PATCH', body: JSON.stringify({ reset_hwid: true }) }), 'HWID reset.');
      break;
    case 'revoke-key':
      if (confirm('Revoke this script key? A revoked key cannot be used again.')) mutate(() => api(`/api/script-keys/${id}`, { method: 'DELETE' }), 'Key revoked.');
      break;
  }
}

document.addEventListener('click', (event) => {
  const copy = event.target.closest('[data-copy]');
  if (copy) {
    copyText(copy.dataset.copy, 'Copied.');
    return;
  }
  if (event.target.closest('[data-close]')) {
    closeModal();
    return;
  }
  const nav = event.target.closest('[data-nav]');
  if (nav) {
    setMenu(false);
    if (nav.dataset.nav === 'account') openAccountModal();
    else showView(nav.dataset.nav);
    return;
  }
  const button = event.target.closest('[data-action]');
  if (button) handleAction(button.dataset.action, button);
});

document.addEventListener('change', async (event) => {
  const target = event.target;
  if (target.matches('select[data-action="set-role"]')) {
    try {
      await api(`/api/users/${target.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ role: target.value }) });
      toast('Role updated.');
    } catch (error) {
      toast(error.message);
    }
    await reloadData();
    return;
  }
  if (target.id === 'scriptFile' && target.files[0]) {
    const file = target.files[0];
    target.value = '';
    await loadFile(file);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (state.modal) closeModal();
  else setMenu(false);
});

document.querySelectorAll('.backdrop').forEach((backdrop) => {
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal();
  });
});

$('menuBackdrop').addEventListener('click', () => setMenu(false));
$('scriptCode').addEventListener('input', updateSize);
$('keySearch').addEventListener('input', renderScriptKeys);
$('scriptSave').addEventListener('click', (event) => saveScript(event.currentTarget));
$('keyIssue').addEventListener('click', (event) => issueScriptKey(event.currentTarget));
$('userCreate').addEventListener('click', (event) => createUser(event.currentTarget));
$('apiToggle').addEventListener('click', toggleApiKeyVisibility);
$('apiSave').addEventListener('click', (event) => saveApiKey(event.currentTarget));
$('apiRemove').addEventListener('click', signOut);
$('signupBtn').addEventListener('click', (event) => createOwner(event.currentTarget));

const zone = $('uploadZone');
zone.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  zone.classList.add('drag');
});
zone.addEventListener('dragover', (event) => event.preventDefault());
zone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) zone.classList.remove('drag');
});
zone.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  zone.classList.remove('drag');
  const file = event.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});
['dragover', 'drop'].forEach((type) => {
  window.addEventListener(type, (event) => {
    if (!zone.contains(event.target)) event.preventDefault();
  });
});

async function init() {
  $('urlHint').textContent = `URL: ${location.origin}/<url name>`;
  try {
    const health = await (await fetch('/api/health')).json();
    state.setupNeeded = health.needs_setup === true;
  } catch {}
  showView(state.view);
  renderAll();
  try {
    await refreshAll();
  } catch (error) {
    toast(error.message);
  }
  if (!state.me) openAccountModal();
}

init();
