(() => {
  const $ = (id) => document.getElementById(id);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;
  const root = document.documentElement;
  const clamp = (v) => Math.min(Math.max(v, 0), 1);
  const KEY_PLACEHOLDER = '여기에_스크립트_키';
  const DEFAULT_OPTS = { free: true, silent: false, heartbeat: true, light: false, secure: true };
  const SCRIPT_LIMIT = 18;
  const OBF_LIMIT = 3000;
  const KEY_LIMIT = 10000;
  const TOKEN_KEY = 'luarmor-api-key';
  const TOKEN_RE = /^tmk_[A-Za-z0-9_-]{20,}$/;
  const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="currentColor"><path d="m19.42 13.1 1.11.86-1.93 3.34-1.3-.52c-.47.35-.99.65-1.55.87l-.19 1.38h-3.85l-.19-1.38c-.56-.22-1.08-.52-1.55-.87l-1.3.52-1.93-3.34 1.11-.86a6.96 6.96 0 0 1 0-1.8l-1.11-.86L8.67 7.1l1.3.52c.47-.35.99-.65 1.55-.87l.19-1.38h3.85l.19 1.38c.56.22 1.08.52 1.55.87l1.3-.52 1.93 3.34-1.11.86c.08.59.08 1.21 0 1.8ZM13.64 14.3a2.95 2.95 0 1 0 0-5.9 2.95 2.95 0 0 0 0 5.9Z"/></svg>';

  const db = { projects: [], scripts: [], banned: [], keys: [], usage: { obfuscations: 0, limit: OBF_LIMIT }, selectedId: null, apiKey: '', role: '' };
  let view = 'projects';
  let editScriptId = null;
  let ctxId = null;
  let projectEditId = null;
  let pending = [];
  let openDialogId = null;
  let dialogFocus = null;
  let menuOpen = false;
  let toastTimer = 0;
  let dragDepth = 0;
  let busy = false;

  const dialogIds = {
    project: 'projectModal',
    script: 'scriptModal',
    addUser: 'addUserModal',
    keys: 'keysModal',
    account: 'accountModal'
  };

  const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  const maskKey = (k) => (k.length > 8 ? k.slice(0, 4) + '••••••••' + k.slice(-4) : '••••••••');
  const project = (id) => db.projects.find((p) => p.id === id) || null;
  const selected = () => project(db.selectedId);
  const projectScripts = (id) => db.scripts.filter((s) => s.project_id === id);
  const scriptById = (id) => db.scripts.find((s) => s.id === id) || null;
  const activeKeys = () => db.keys.filter((k) => !k.revoked_at);
  const countLabel = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const loaderFor = (slug, keyMode) => `${keyMode ? `script_key = "${KEY_PLACEHOLDER}"\n` : ''}loadstring(game:HttpGet("${location.origin}/${slug}"))()`;
  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  const day = (iso) => (iso ? iso.slice(0, 10) : '');

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    if (db.apiKey) headers.set('authorization', `Bearer ${db.apiKey}`);
    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function readKey() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }

  function writeKey(value) {
    db.apiKey = value;
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {}
  }

  async function loadDashboard() {
    const data = await api('/api/dashboard');
    db.projects = data.projects || [];
    db.scripts = data.scripts || [];
    db.banned = data.banned_ips || [];
    db.usage = data.usage || { obfuscations: 0, limit: OBF_LIMIT };
    if (!project(db.selectedId)) db.selectedId = db.projects[0] ? db.projects[0].id : null;
  }

  async function loadKeys() {
    try {
      const data = await api('/api/keys');
      db.keys = data.keys || [];
    } catch {
      db.keys = [];
    }
  }

  async function refresh() {
    if (!db.apiKey) {
      db.projects = [];
      db.scripts = [];
      db.keys = [];
      renderAll();
      return;
    }
    try {
      await loadRole();
      if (db.role === 'user') {
        clearData();
      } else {
        await loadDashboard();
        await loadKeys();
      }
    } catch (error) {
      toast(error.message);
    }
    renderAll();
  }

  async function loadRole() {
    const me = await api('/api/auth/me');
    db.role = me.user.role;
  }

  function clearData() {
    db.projects = [];
    db.scripts = [];
    db.keys = [];
  }

  function renderAll() {
    renderChrome();
    renderTabs();
    renderProjects();
    renderUsers();
    renderMetrics();
    if (openDialogId === 'keys') renderKeys();
  }

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function banner(id, text, kind) {
    const el = $(id);
    if (!text) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.className = 'banner ' + (kind || 'ok');
    el.textContent = text;
  }

  function setBusy(btn, on, label) {
    btn.disabled = on;
    btn.innerHTML = on ? '<span class="spin" aria-hidden="true"></span>' : label;
  }

  function setBar(el, pct) {
    el.style.width = pct > 0 ? Math.min(Math.max(pct, 1.2), 100) + '%' : '0%';
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
  }

  function openDialog(name, focusSel) {
    if (openDialogId) return;
    dialogFocus = document.activeElement;
    openDialogId = name;
    const el = $(dialogIds[name]);
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    const target = focusSel && el.querySelector(focusSel);
    if (target && fine) target.focus();
  }

  function closeDialog() {
    if (!openDialogId || busy) return;
    const el = $(dialogIds[openDialogId]);
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    openDialogId = null;
    document.body.style.overflow = '';
    if (dialogFocus && dialogFocus.isConnected) dialogFocus.focus();
    dialogFocus = null;
  }

  function openMenu() {
    if (menuOpen) return;
    menuOpen = true;
    $('drawer').classList.add('open');
    $('menuBackdrop').classList.add('open');
    $('drawer').setAttribute('aria-hidden', 'false');
    $('menuBtn').setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    const first = $('drawer').querySelector('.nav-item.is-active') || $('drawer').querySelector('.nav-item');
    if (first && fine) first.focus();
  }

  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    $('drawer').classList.remove('open');
    $('menuBackdrop').classList.remove('open');
    $('drawer').setAttribute('aria-hidden', 'true');
    $('menuBtn').setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    $('menuBtn').focus();
  }

  function flash(el) {
    const box = el.closest('.card, .panel') || el;
    box.classList.remove('flash');
    void box.offsetWidth;
    box.classList.add('flash');
    box.addEventListener('animationend', () => box.classList.remove('flash'), { once: true });
  }

  function renderChrome() {
    const users = view === 'users';
    $('viewProjects').classList.toggle('active', !users);
    $('viewUsers').classList.toggle('active', users);
    $('metrics').className = 'metrics ' + (users ? 'is-users' : 'is-projects');
    const label = users ? 'API Keys' : 'Projects';
    $('crumb').textContent = label;
    $('pageTitle').textContent = label;
    document.title = 'Luarmor — ' + label;
    $('drawer').querySelectorAll('.nav-item[data-nav]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.nav === view);
    });
  }

  function renderTabs() {
    const wrap = $('tabs');
    wrap.textContent = '';
    wrap.hidden = !db.projects.length;
    db.projects.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab' + (p.id === db.selectedId ? ' active' : '');
      b.dataset.project = p.id;
      b.textContent = p.name;
      b.setAttribute('aria-pressed', String(p.id === db.selectedId));
      wrap.appendChild(b);
    });
  }

  function scriptRow(s) {
    const tr = document.createElement('tr');
    tr.dataset.id = s.id;
    tr.innerHTML =
      '<td><div class="script"><span class="file" aria-hidden="true">&lt;/&gt;</span><div class="script-text"><span class="name"></span><small></small></div></div></td>' +
      '<td data-label="STATUS"><span class="pill"></span></td>' +
      '<td class="ver" data-label="VERSION"></td>' +
      '<td data-label="ACTIONS"><div class="row-actions">' +
        '<button class="btn sm" data-action="loader">LOADER</button>' +
        '<button class="btn sm" data-action="edit-script">EDIT</button>' +
        '<button class="btn sm danger" data-action="delete-script">DELETE</button>' +
      '</div></td>';
    tr.querySelector('.name').textContent = s.name;
    tr.querySelector('small').textContent = s.slug;
    const pill = tr.querySelector('.pill');
    pill.textContent = s.status;
    pill.className = 'pill ' + (s.status === 'ACTIVE' ? 'active' : 'draft');
    tr.querySelector('.ver').textContent = s.version;
    return tr;
  }

  function renderProjects() {
    const p = selected();
    $('projectEmpty').hidden = db.projects.length > 0;
    $('projectPanel').hidden = !p;
    if (!p) return;
    $('projectName').textContent = p.name;
    $('projectId').textContent = p.id;
    const tbody = $('rows');
    tbody.textContent = '';
    const list = projectScripts(p.id);
    if (!list.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="4"><div class="empty">No scripts yet. Use ADD SCRIPT to create one.</div></td></tr>';
      return;
    }
    list.forEach((s) => tbody.appendChild(scriptRow(s)));
  }

  function projectKeys(id) {
    return db.keys.filter((k) => k.project_id === id);
  }

  function renderUsers() {
    const list = $('userList');
    list.textContent = '';
    $('usersEmpty').hidden = db.projects.length > 0;
    db.projects.forEach((p) => {
      const keys = projectKeys(p.id);
      const active = keys.filter((k) => !k.revoked_at).length;
      const row = document.createElement('article');
      row.className = 'user-row';

      const info = document.createElement('div');
      info.className = 'project';
      info.dataset.action = 'add-user';
      info.dataset.project = p.id;
      info.setAttribute('role', 'button');
      info.tabIndex = 0;
      info.innerHTML = '<div class="project-mark" aria-hidden="true"><span></span><span></span><span></span></div>';
      const text = document.createElement('div');
      text.className = 'project-text';
      const h = document.createElement('h3');
      h.textContent = p.name;
      const sub = document.createElement('p');
      sub.textContent = countLabel(active, 'API key') + ' · ' + countLabel(p.script_count, 'script');
      text.append(h, sub);
      info.appendChild(text);

      const actions = document.createElement('div');
      actions.className = 'panel-actions';
      actions.innerHTML =
        '<button class="btn primary" data-action="add-user" data-project="' + p.id + '">+ ADD USER</button>' +
        '<button class="btn" data-action="edit-users" data-project="' + p.id + '">EDIT USERS</button>' +
        '<button class="btn icon" aria-label="Manage API keys" data-action="manage-users" data-project="' + p.id + '">' + GEAR + '</button>';

      row.append(info, actions);
      list.appendChild(row);
    });
  }

  function renderMetrics() {
    const p = selected();
    if (view === 'users') {
      const total = db.scripts.length;
      $('scriptCount').textContent = total;
      $('scriptMeta').textContent = countLabel(db.projects.length, 'project');
      setBar($('scriptBar'), total / (SCRIPT_LIMIT * Math.max(1, db.projects.length)) * 100);
    } else {
      const n = p ? projectScripts(p.id).length : 0;
      $('scriptCount').textContent = n;
      $('scriptMeta').textContent = n + '/' + SCRIPT_LIMIT;
      setBar($('scriptBar'), n / SCRIPT_LIMIT * 100);
    }
    const obf = db.usage.obfuscations || 0;
    $('obfCount').textContent = obf;
    $('obfMeta').textContent = obf + '/' + OBF_LIMIT;
    setBar($('obfBar'), obf / OBF_LIMIT * 100);
    const active = activeKeys().length;
    $('userCount').textContent = active;
    $('userMeta').textContent = active + '/' + KEY_LIMIT;
    setBar($('userBar'), active / KEY_LIMIT * 100);
    const banned = $('bannedCard');
    banned.querySelector('.metric-copy strong').textContent = db.banned.length;
    banned.querySelector('.blacklist').innerHTML = 'There are <strong>' + db.banned.length + '</strong> blacklisted IPs';
  }

  function renderKeys() {
    const list = $('keyList');
    list.textContent = '';
    const p = project(ctxId);
    const keys = p ? projectKeys(p.id) : [];
    const q = $('keySearch').value.trim().toLowerCase();
    const matches = keys.filter((k) => !q || [k.label, k.key_prefix].some((v) => (v || '').toLowerCase().includes(q)));
    $('keyListCount').textContent = keys.length ? '(' + matches.length + ' / ' + keys.length + ')' : '';
    if (!keys.length) {
      list.innerHTML = '<div class="key-empty">No API keys yet. Use + ADD USER to create one.</div>';
      return;
    }
    if (!matches.length) {
      list.innerHTML = '<div class="key-empty">No keys match your search.</div>';
      return;
    }
    matches.forEach((k) => {
      const row = document.createElement('div');
      row.className = 'key-row';

      const info = document.createElement('div');
      info.className = 'key-info';
      const title = document.createElement('div');
      title.className = 'key-title';
      title.textContent = k.label || 'Untitled key';
      const meta = document.createElement('div');
      meta.className = 'key-meta';
      meta.textContent = 'Created ' + day(k.created_at) + ' · ' + (k.last_used_at ? 'Last used ' + day(k.last_used_at) : 'Never used') + ' · ' + (k.expires_at ? 'Expires ' + day(k.expires_at) : 'Never expires');
      const code = document.createElement('code');
      code.textContent = k.key_prefix + '…';
      info.append(title, meta, code);

      const actions = document.createElement('div');
      actions.className = 'key-actions';
      const status = document.createElement('span');
      status.className = 'pill ' + (k.revoked_at ? 'draft' : 'active');
      status.textContent = k.revoked_at ? 'REVOKED' : 'ACTIVE';
      actions.appendChild(status);
      if (!k.revoked_at) {
        const b = document.createElement('button');
        b.className = 'btn sm danger';
        b.type = 'button';
        b.textContent = 'REVOKE';
        b.dataset.keyAction = 'revoke';
        b.dataset.id = k.id;
        actions.appendChild(b);
      }

      row.append(info, actions);
      list.appendChild(row);
    });
  }

  function showView(name) {
    view = name;
    renderAll();
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }

  function openProjectModal(id) {
    projectEditId = id || null;
    const p = project(id);
    $('projectModalTitle').textContent = p ? 'Project Settings' : 'Create Project';
    $('pName').value = p ? p.name : '';
    $('projectDelete').hidden = !p;
    banner('projectBanner', '');
    openDialog('project', '#pName');
  }

  async function saveProject(button) {
    if (busy) return;
    const name = $('pName').value.trim();
    if (!name) {
      banner('projectBanner', 'Project name is required.', 'error');
      $('pName').focus();
      return;
    }
    busy = true;
    setBusy(button, true, '✓');
    try {
      if (projectEditId) {
        await api(`/api/projects/${projectEditId}`, { method: 'PATCH', body: JSON.stringify({ name }) });
        toast('Project renamed.');
      } else {
        const data = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
        db.selectedId = data.project.id;
        view = 'projects';
        toast('Project "' + name + '" created.');
      }
      busy = false;
      setBusy(button, false, '✓');
      closeDialog();
      await refresh();
    } catch (error) {
      busy = false;
      setBusy(button, false, '✓');
      banner('projectBanner', error.message, 'error');
    }
  }

  async function deleteProject() {
    const p = project(projectEditId);
    if (!p) return;
    if (!confirm('Delete "' + p.name + '" with all its scripts? This cannot be undone.')) return;
    try {
      await api(`/api/projects/${p.id}`, { method: 'DELETE' });
      if (db.selectedId === p.id) db.selectedId = null;
      closeDialog();
      toast('Project deleted.');
      await refresh();
    } catch (error) {
      banner('projectBanner', error.message, 'error');
    }
  }

  function addScript() {
    const p = selected();
    if (!p) return;
    if (projectScripts(p.id).length >= SCRIPT_LIMIT) {
      toast('Script limit reached (' + SCRIPT_LIMIT + ').');
      return;
    }
    openScript(null);
  }

  async function openScript(id) {
    const p = selected();
    editScriptId = id;
    const s = id ? scriptById(id) : null;
    pending = [];
    banner('scriptBanner', '');
    $('scriptTitle').textContent = s ? s.name : 'New Script';
    $('scriptName').value = s ? s.name : '';
    $('scriptCode').value = '';
    const opts = s
      ? { free: s.mode === 'keyless', silent: !!s.silent, heartbeat: !!s.heartbeat, light: !!s.lightweight, secure: !!s.secure_loader }
      : { ...DEFAULT_OPTS };
    $('scriptModal').querySelectorAll('[data-opt]').forEach((b) => { b.checked = !!opts[b.dataset.opt]; });
    renderFiles();
    if (!p) return;
    openDialog('script', '#scriptName');
    if (!s) return;
    try {
      const [code, files] = await Promise.all([
        api('/api/execute', { method: 'POST', body: JSON.stringify({ id }) }),
        api(`/api/scripts/${id}/files`)
      ]);
      if (editScriptId !== id) return;
      $('scriptCode').value = code.code;
      pending = (files.files || []).map((f) => ({ id: f.id, name: f.name, size: f.byte_size, file: null }));
      renderFiles();
    } catch (error) {
      banner('scriptBanner', error.message, 'error');
    }
  }

  async function saveScript(button) {
    const p = selected();
    if (!p || busy) return;
    const name = $('scriptName').value.trim() || 'Untitled script';
    const code = $('scriptCode').value;
    if (!code.trim()) {
      banner('scriptBanner', 'Code is required.', 'error');
      return;
    }
    const opts = Object.fromEntries([...$('scriptModal').querySelectorAll('[data-opt]')].map((b) => [b.dataset.opt, b.checked]));
    const body = {
      name,
      code,
      mode: opts.free ? 'keyless' : 'key',
      silent: opts.silent,
      heartbeat: opts.heartbeat,
      lightweight: opts.light,
      secure_loader: opts.secure
    };
    busy = true;
    setBusy(button, true, 'SAVE SCRIPT');
    try {
      let scriptId = editScriptId;
      if (scriptId) {
        await api(`/api/scripts/${scriptId}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        const data = await api('/api/scripts', { method: 'POST', body: JSON.stringify({ ...body, project_id: p.id }) });
        scriptId = data.script.id;
      }
      const keptIds = new Set(pending.filter((f) => f.id).map((f) => f.id));
      const existing = editScriptId ? (await api(`/api/scripts/${scriptId}/files`)).files || [] : [];
      for (const file of existing) {
        if (!keptIds.has(file.id)) await api(`/api/script-files/${file.id}`, { method: 'DELETE' });
      }
      for (const item of pending.filter((f) => f.file)) {
        await api(`/api/scripts/${scriptId}/files`, { method: 'POST', body: JSON.stringify({ name: item.name, content: await item.file.text() }) });
      }
      editScriptId = null;
      pending = [];
      busy = false;
      setBusy(button, false, 'SAVE SCRIPT');
      closeDialog();
      toast('Script saved.');
      await refresh();
    } catch (error) {
      busy = false;
      setBusy(button, false, 'SAVE SCRIPT');
      banner('scriptBanner', error.message, 'error');
    }
  }

  async function deleteScript(id) {
    const s = scriptById(id);
    if (!s) return;
    if (!confirm(`Delete "${s.name}"? Its uploaded files are removed too.`)) return;
    try {
      await api(`/api/scripts/${id}`, { method: 'DELETE' });
      toast('Script deleted.');
      await refresh();
    } catch (error) {
      toast(error.message);
    }
  }

  async function copyLoader(id) {
    const s = scriptById(id);
    if (!s) return;
    const ok = await copyText(loaderFor(s.slug, s.mode === 'key'));
    toast(ok ? 'Loader copied to clipboard.' : 'Copy failed. Please copy the loader manually.');
  }

  function addFiles(list) {
    [...list].forEach((f) => pending.push({ id: null, name: f.name, size: f.size, file: f }));
    renderFiles();
  }

  function renderFiles() {
    const ul = $('uploadList');
    ul.textContent = '';
    pending.forEach((f, i) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = f.name;
      const size = document.createElement('small');
      size.textContent = fmtSize(f.size);
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '×';
      rm.dataset.index = i;
      rm.setAttribute('aria-label', 'Remove ' + f.name);
      li.append(name, size, rm);
      ul.appendChild(li);
    });
  }

  function openCreateKey(projectId) {
    const p = project(projectId);
    if (!p) return;
    ctxId = p.id;
    $('addUserTitle').textContent = 'Create API Key For ' + p.name;
    $('uLabel').value = '';
    $('uReset').value = '';
    banner('addUserBanner', '');
    openDialog('addUser', '#uLabel');
  }

  async function saveKey(button) {
    if (busy) return;
    const label = $('uLabel').value.trim();
    const raw = $('uReset').value.trim();
    const days = raw === '' ? undefined : Number(raw);
    if (label.length > 60) {
      banner('addUserBanner', 'Label must be 60 characters or less.', 'error');
      return;
    }
    if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 3650)) {
      banner('addUserBanner', 'Expiry must be 1 to 3650 days, or empty for no expiry.', 'error');
      $('uReset').focus();
      return;
    }
    const p = project(ctxId);
    if (!p) {
      banner('addUserBanner', 'Select a project first.', 'error');
      return;
    }
    if (activeKeys().length >= KEY_LIMIT) {
      banner('addUserBanner', 'Key limit reached (' + KEY_LIMIT + ').', 'error');
      return;
    }
    busy = true;
    setBusy(button, true, '✓');
    try {
      const body = { label, expires_in_days: days, project_id: p.id };
      const data = await api('/api/keys', { method: 'POST', body: JSON.stringify(body) });
      const token = data.key.token;
      const copied = await copyText(token);
      banner('addUserBanner', (copied ? 'Copied. ' : '') + 'Save this key now. It will not be shown again: ' + token, 'ok');
      toast('API key created.');
      await loadKeys();
      renderAll();
    } catch (error) {
      banner('addUserBanner', error.message, 'error');
    } finally {
      busy = false;
      setBusy(button, false, '✓');
    }
  }

  function openKeys(projectId) {
    const p = project(projectId);
    if (!p) return;
    ctxId = p.id;
    $('keysModalTitle').textContent = 'API Keys Of ' + p.name;
    $('keySearch').value = '';
    renderKeys();
    openDialog('keys', '#keySearch');
  }

  async function revokeKey(id) {
    const k = db.keys.find((x) => x.id === id);
    if (!k) return;
    if (!confirm('Revoke this API key? Apps using it will stop working.')) return;
    try {
      await api(`/api/keys/${id}`, { method: 'DELETE' });
      toast('API key revoked.');
      await loadKeys();
      renderAll();
    } catch (error) {
      toast(error.message);
    }
  }

  function openAccount() {
    const hasKey = !!db.apiKey;
    $('apiKey').value = db.apiKey;
    $('apiKey').type = hasKey ? 'text' : 'password';
    $('apiToggle').textContent = hasKey ? 'HIDE' : 'SHOW';
    banner('accountBanner', '');
    renderApiStatus();
    openDialog('account', '#apiKey');
  }

  function renderApiStatus() {
    $('apiStatus').textContent = db.apiKey ? 'Saved key: ' + maskKey(db.apiKey) : 'No API key saved.';
  }

  function toggleApiVisibility() {
    const input = $('apiKey');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('apiToggle').textContent = show ? 'HIDE' : 'SHOW';
  }

  async function checkSetup() {
    try {
      const response = await fetch('/api/health');
      const data = await response.json();
      const needed = !!data.needs_setup;
      $('setupBlock').hidden = !needed;
      return needed;
    } catch {
      return false;
    }
  }

  async function createOwner(button) {
    const name = $('setupName').value.trim();
    if (!name) {
      banner('accountBanner', 'Enter a username.', 'error');
      $('setupName').focus();
      return;
    }
    setBusy(button, true, 'CREATE OWNER');
    try {
      const data = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ username: name }) });
      const token = data.key.token;
      writeKey(token);
      $('apiKey').value = token;
      $('setupBlock').hidden = true;
      setBusy(button, false, 'CREATE OWNER');
      renderApiStatus();
      banner('accountBanner', 'Owner created. The API key is shown once: ' + token + ' (copy it now)', 'ok');
      await refresh();
    } catch (error) {
      setBusy(button, false, 'CREATE OWNER');
      banner('accountBanner', error.message, 'error');
    }
  }

  async function saveApiKey(button) {
    const v = $('apiKey').value.trim();
    if (!TOKEN_RE.test(v)) {
      banner('accountBanner', 'API key must start with tmk_ and be at least 20 characters after it.', 'error');
      $('apiKey').focus();
      return;
    }
    const previous = db.apiKey;
    writeKey(v);
    setBusy(button, true, 'SAVE KEY');
    try {
      await loadRole();
      if (db.role === 'user') {
        clearData();
      } else {
        await loadDashboard();
        await loadKeys();
      }
      setBusy(button, false, 'SAVE KEY');
      renderApiStatus();
      banner('accountBanner', 'API key saved on this device.', 'ok');
      toast('API key saved.');
      renderAll();
    } catch (error) {
      writeKey(previous);
      setBusy(button, false, 'SAVE KEY');
      banner('accountBanner', error.message, 'error');
    }
  }

  function removeApiKey() {
    if (!db.apiKey) {
      banner('accountBanner', 'No API key to remove.', 'error');
      return;
    }
    if (!confirm('Remove the saved API key from this browser?')) return;
    writeKey('');
    $('apiKey').value = '';
    db.projects = [];
    db.scripts = [];
    db.keys = [];
    renderAll();
    renderApiStatus();
    banner('accountBanner', 'API key removed.', 'ok');
  }

  function goBanned() {
    if (view !== 'users') showView('users');
    setTimeout(() => {
      $('bannedCard').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      flash($('bannedCard'));
    }, 250);
  }

  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-project]');
    if (b) {
      db.selectedId = b.dataset.project;
      renderAll();
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-dialog-close]')) { closeDialog(); return; }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('tr[data-id]');
    switch (btn.dataset.action) {
      case 'loader': if (row) copyLoader(row.dataset.id); break;
      case 'edit-script': if (row) openScript(row.dataset.id); break;
      case 'delete-script': if (row) deleteScript(row.dataset.id); break;
      case 'add-script': addScript(); break;
      case 'project-edit': openProjectModal(db.selectedId); break;
      case 'open-create': openProjectModal(null); break;
      case 'add-user': openCreateKey(btn.dataset.project || ctxId || db.selectedId); break;
      case 'edit-users': openKeys(btn.dataset.project); break;
      case 'manage-users': openKeys(btn.dataset.project); break;
      case 'open-account': openAccount(); break;
      case 'open-menu': openMenu(); break;
      case 'close-menu': closeMenu(); break;
      case 'notify': toast('No notifications yet.'); break;
      case 'toast': toast(btn.dataset.msg); break;
    }
  });

  $('drawer').addEventListener('click', (e) => {
    const item = e.target.closest('[data-nav]');
    if (!item) return;
    const target = item.dataset.nav;
    closeMenu();
    if (target === 'projects' || target === 'users') {
      showView(target);
    } else if (target === 'banned') {
      goBanned();
    } else if (target === 'settings') {
      openAccount();
    }
  });
  $('menuBackdrop').addEventListener('click', closeMenu);

  $('projectSave').addEventListener('click', (e) => saveProject(e.currentTarget));
  $('projectDelete').addEventListener('click', deleteProject);
  $('scriptSave').addEventListener('click', (e) => saveScript(e.currentTarget));
  $('scriptSaveBottom').addEventListener('click', (e) => saveScript(e.currentTarget));
  $('addUserSave').addEventListener('click', (e) => saveKey(e.currentTarget));
  $('apiToggle').addEventListener('click', toggleApiVisibility);
  $('apiSave').addEventListener('click', (e) => saveApiKey(e.currentTarget));
  $('apiRemove').addEventListener('click', removeApiKey);
  $('setupCreate').addEventListener('click', (e) => createOwner(e.currentTarget));
  $('clearAll').addEventListener('click', removeApiKey);
  $('keySearch').addEventListener('input', renderKeys);

  $('keyList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-key-action]');
    if (b && b.dataset.keyAction === 'revoke') revokeKey(b.dataset.id);
  });

  $('uploadList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-index]');
    if (!b) return;
    pending.splice(Number(b.dataset.index), 1);
    renderFiles();
  });

  const zone = $('uploadZone');
  $('fileInput').addEventListener('change', (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  });
  zone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    zone.classList.add('drag');
  });
  zone.addEventListener('dragover', (e) => e.preventDefault());
  zone.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) zone.classList.remove('drag');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    zone.classList.remove('drag');
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
  ['dragover', 'drop'].forEach((type) => {
    window.addEventListener(type, (e) => {
      if (!zone.contains(e.target)) e.preventDefault();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && openDialogId && !e.isComposing && e.target.tagName === 'INPUT') {
      const submit = { pName: () => saveProject($('projectSave')), uLabel: () => saveKey($('addUserSave')), uReset: () => saveKey($('addUserSave')), apiKey: () => saveApiKey($('apiSave')) }[e.target.id];
      if (submit) { e.preventDefault(); submit(); }
      return;
    }
    if (e.key !== 'Escape') return;
    if (openDialogId) closeDialog();
    else if (menuOpen) closeMenu();
  });

  document.querySelectorAll('.backdrop').forEach((bd) => {
    let down = false;
    bd.addEventListener('pointerdown', (e) => { down = e.target === bd; });
    bd.addEventListener('click', (e) => {
      if (down && e.target === bd) closeDialog();
      down = false;
    });
  });

  if (!reduce) {
    document.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const r = b.getBoundingClientRect();
      const d = Math.max(r.width, r.height);
      const s = document.createElement('span');
      s.className = 'ripple';
      s.style.width = s.style.height = d + 'px';
      s.style.left = (e.clientX - r.left - d / 2) + 'px';
      s.style.top = (e.clientY - r.top - d / 2) + 'px';
      b.appendChild(s);
      s.addEventListener('animationend', () => s.remove());
    });
  }

  if (fine && !reduce) {
    addEventListener('pointermove', (e) => {
      root.style.setProperty('--px', (e.clientX / innerWidth - 0.5).toFixed(3));
      root.style.setProperty('--py', (e.clientY / innerHeight - 0.5).toFixed(3));
    }, { passive: true });
  }

  document.querySelectorAll('.card').forEach((card) => {
    const place = (e) => {
      const r = card.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / r.width);
      const y = clamp((e.clientY - r.top) / r.height);
      card.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
      card.style.setProperty('--my', (y * 100).toFixed(1) + '%');
      if (fine && e.pointerType === 'mouse' && !reduce) {
        card.style.setProperty('--rx', (x - 0.5).toFixed(3));
        card.style.setProperty('--ry', (y - 0.5).toFixed(3));
      }
    };
    card.addEventListener('pointermove', place);
    card.addEventListener('pointerdown', place);
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--rx', 0);
      card.style.setProperty('--ry', 0);
    });
  });

  async function init() {
    db.apiKey = readKey();
    renderAll();
    const needed = await checkSetup();
    await refresh();
    if (needed || !db.apiKey) openAccount();
  }

  init();
})();
