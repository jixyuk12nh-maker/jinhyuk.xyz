(() => {
  const $ = (id) => document.getElementById(id);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;
  const root = document.documentElement;
  const clamp = (v) => Math.min(Math.max(v, 0), 1);
  const KEY_PLACEHOLDER = '여기에_스크립트_키';
  const DEFAULT_OPTS = { free: true, silent: false, heartbeat: true, light: false, secure: true, hwid: false };
  const SCRIPT_LIMIT = 18;
  const KEY_LIMIT = 10000;
  const TOKEN_KEY = 'jinhyuk-api-key';
  const SELECTED_KEY = 'jinhyuk-selected-project';
  const ORPHAN_ID = '__no_project__';
  const BUSY_MSG = '저장 중입니다. 잠시만 기다려 주세요.';
  const TOKEN_RE = /^tmk_[A-Za-z0-9_-]{20,}$/;
  const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="currentColor"><path d="m19.42 13.1 1.11.86-1.93 3.34-1.3-.52c-.47.35-.99.65-1.55.87l-.19 1.38h-3.85l-.19-1.38c-.56-.22-1.08-.52-1.55-.87l-1.3.52-1.93-3.34 1.11-.86a6.96 6.96 0 0 1 0-1.8l-1.11-.86L8.67 7.1l1.3.52c.47-.35.99-.65 1.55-.87l.19-1.38h3.85l.19 1.38c.56.22 1.08.52 1.55.87l1.3-.52 1.93 3.34-1.11.86c.08.59.08 1.21 0 1.8ZM13.64 14.3a2.95 2.95 0 1 0 0-5.9 2.95 2.95 0 0 0 0 5.9Z"/></svg>';

  const db = { projects: [], scripts: [], banned: [], keys: [], users: [], scriptKeys: [], usage: { obfuscations: 0, limit: null }, selectedId: null, apiKey: '', role: '', me: null };
  let view = 'projects';
  let editScriptId = null;
  let loadedCode = null;
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
    source: 'sourceModal',
    project: 'projectModal',
    script: 'scriptModal',
    addUser: 'addUserModal',
    keys: 'keysModal',
    account: 'accountModal',
    issueKey: 'issueKeyModal',
    scriptKeys: 'scriptKeysModal',
    manageKeys: 'manageKeysModal'
  };

  const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  const MIN_EXPIRY_MINUTES = 30;
  const MAX_EXPIRY_MINUTES = 3650 * 1440;
  function expiryMinutes(text) {
    const t = String(text || '').trim();
    if (!t) return undefined;
    return /^-?\d+$/.test(t) ? Number(t) : NaN;
  }
  function expiryError(minutes) {
    if (minutes === undefined) return '';
    if (!Number.isInteger(minutes) || minutes < MIN_EXPIRY_MINUTES || minutes > MAX_EXPIRY_MINUTES) {
      return 'Expiry must be 30 to 5256000 minutes, or empty for a permanent key.';
    }
    return '';
  }
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
    if (!response.ok) {
      const error = new Error(data.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function readSelected() {
    try {
      return localStorage.getItem(SELECTED_KEY) || null;
    } catch {
      return null;
    }
  }

  function selectProject(id) {
    db.selectedId = id || null;
    try {
      if (id) localStorage.setItem(SELECTED_KEY, id);
      else localStorage.removeItem(SELECTED_KEY);
    } catch {}
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
    db.usage = data.usage || { obfuscations: 0, limit: null };
    if (!project(db.selectedId)) db.selectedId = db.projects[0] ? db.projects[0].id : null;
  }

  async function loadKeys() {
    try {
      if (db.role === 'user') throw new Error('not allowed');
      const data = await api('/api/keys');
      db.keys = data.keys || [];
    } catch {
      db.keys = [];
    }
    try {
      const data = await api('/api/users');
      db.users = data.users || [];
    } catch {
      db.users = [];
    }
    try {
      const data = await api('/api/script-keys');
      db.scriptKeys = data.keys || [];
    } catch {
      db.scriptKeys = [];
    }
  }

  async function refresh() {
    if (!db.apiKey) {
      db.projects = [];
      db.scripts = [];
      db.keys = []; db.users = []; db.scriptKeys = [];
      renderAll();
      return;
    }
    try {
      await loadRole();
      if (db.role === 'user') {
        await loadUserWorkspace();
      } else {
        await loadDashboard();
        await loadKeys();
      }
    } catch (error) {
      if (error.status === 401) {
        clearData();
        openAccount();
        banner('accountBanner', '저장된 API 키가 만료되었거나 차단되었습니다. 새 키를 입력하고 저장하세요.', 'error');
      } else {
        toast(error.message);
      }
    }
    renderAll();
  }

  async function loadRole() {
    const me = await api('/api/auth/me');
    db.role = me.user.role;
    db.me = me.user;
  }

  function clearData() {
    db.projects = [];
    db.scripts = [];
    db.keys = []; db.users = []; db.scriptKeys = [];
  }

  async function loadUserWorkspace() {
    const [projects, scripts] = await Promise.all([api('/api/projects'), api('/api/scripts')]);
    db.projects = projects.projects || [];
    db.scripts = scripts.scripts || [];
    db.banned = [];
    db.usage = { obfuscations: 0, limit: null };
    if (!project(db.selectedId)) db.selectedId = db.projects[0] ? db.projects[0].id : null;
    await loadKeys();
  }

  function renderAll() {
    renderChrome();
    renderTabs();
    renderProjects();
    renderProfile();
    renderUsers();
    renderScriptKeyView();
    renderMetrics();
    if (openDialogId === 'keys') renderKeys();
    if (openDialogId === 'scriptKeys') renderScriptKeys();
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
    if (!el) return;
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
    if (!openDialogId) return;
    if (busy) return toast(BUSY_MSG);
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
    const isUser = db.role === 'user';
    $('drawer').querySelectorAll('.nav-item[data-nav="users"]').forEach((b) => { b.hidden = isUser; });
    document.querySelectorAll('[data-action="open-create"]').forEach((b) => { b.hidden = isUser; });
    if (isUser && view === 'users') view = 'projects';
    const keys = view === 'script-keys';
    const users = view === 'users';
    const profile = view === 'profile';
    $('viewProfile').classList.toggle('active', profile);
    $('viewProjects').classList.toggle('active', view === 'projects');
    $('viewUsers').classList.toggle('active', users);
    $('viewScriptKeys').classList.toggle('active', keys);
    $('metrics').className = 'metrics ' + (profile ? 'is-profile' : users ? 'is-users' : keys ? 'is-keys' : 'is-projects');
    const label = profile ? 'Profile' : users ? 'API Keys' : keys ? 'Script Keys' : 'Projects';
    $('crumb').textContent = label;
    $('pageTitle').textContent = label;
    document.title = 'jinhyuk.xyz — ' + label;
    $('drawer').querySelectorAll('.nav-item[data-nav]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.nav === view);
    });
    try {
      if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
    } catch {}
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
    tr.dataset.mode = s.mode || 'keyless';
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

  const canManage = (a) => !!db.me && a.id !== db.me.id && (db.role === 'owner' || (db.role === 'admin' && a.role === 'user'));

  function renderUsers() {
    const list = $('userList');
    list.textContent = '';
    const rank = { owner: 0, admin: 1, user: 2 };
    const accounts = new Map();
    db.users.forEach((u) => accounts.set(u.id, { id: u.id, username: u.username, role: u.role, status: u.status || 'active', keys: [] }));
    db.keys.forEach((k) => {
      if (!accounts.has(k.user_id)) accounts.set(k.user_id, { id: k.user_id, username: k.username, role: k.user_role, status: 'active', keys: [] });
      accounts.get(k.user_id).keys.push(k);
    });
    const rows = [...accounts.values()].sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9) || a.username.localeCompare(b.username));
    $('usersEmpty').hidden = rows.length > 0;
    rows.forEach((a) => {
      const active = a.keys.filter((k) => !k.revoked_at).length;
      const manage = canManage(a);

      const row = document.createElement('article');
      row.className = 'user-row';

      const info = document.createElement('div');
      info.className = 'project';
      const pill = document.createElement('span');
      pill.className = 'role-pill role-' + (a.role || 'user');
      pill.textContent = String(a.role || 'user').toUpperCase();
      const text = document.createElement('div');
      text.className = 'project-text';
      const h = document.createElement('h3');
      h.textContent = a.username + (a.status === 'blocked' ? '  · 차단됨' : '');
      const sub = document.createElement('p');
      sub.textContent = countLabel(active, 'API key');
      text.append(h, sub);
      info.append(pill, text);

      const actions = document.createElement('div');
      actions.className = 'panel-actions account-actions';
      a.keys.filter((k) => !k.revoked_at).slice(0, 3).forEach((k) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'key-chip';
        chip.dataset.action = 'key-revoke';
        chip.dataset.id = k.id;
        chip.title = '이 키 해지';
        chip.textContent = (k.key_prefix || 'tmk_') + '… ✕';
        if (!manage) chip.disabled = true;
        actions.appendChild(chip);
      });
      if (manage && db.role === 'owner') {
        const sel = document.createElement('select');
        sel.className = 'role-select';
        sel.dataset.roleFor = a.id;
        ['user', 'admin', 'owner'].forEach((r) => {
          const o = document.createElement('option');
          o.value = r;
          o.textContent = r.toUpperCase();
          o.selected = r === a.role;
          sel.appendChild(o);
        });
        actions.appendChild(sel);
      }
      if (manage) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn sm ' + (a.status === 'blocked' ? '' : 'danger');
        b.dataset.action = 'acct-status';
        b.dataset.id = a.id;
        b.dataset.status = a.status === 'blocked' ? 'active' : 'blocked';
        b.textContent = a.status === 'blocked' ? '차단 해제' : '차단';
        actions.appendChild(b);
      }

      row.append(info, actions);
      list.appendChild(row);
    });
  }

  async function setUserStatus(id, status) {
    try {
      await api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      toast(status === 'blocked' ? '계정을 차단했습니다.' : '차단을 해제했습니다.');
      await refresh();
    } catch (error) {
      toast(error.message);
    }
  }

  async function setUserRole(id, role) {
    try {
      await api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) });
      toast('역할을 ' + role.toUpperCase() + '(으)로 바꿨습니다.');
      await refresh();
    } catch (error) {
      toast(error.message);
      renderAll();
    }
  }

  async function revokeKeyById(id) {
    if (!confirm('이 API 키를 해지할까요? 이 키로 로그인하던 기기는 바로 막힙니다.')) return;
    try {
      await api(`/api/keys/${id}`, { method: 'DELETE' });
      toast('API 키를 해지했습니다.');
      await refresh();
    } catch (error) {
      toast(error.message);
    }
  }

  function renderProfile() {
    const list = $('profileList');
    list.textContent = '';
    const mine = db.scripts.filter((s) => db.role === 'owner' || (db.me && s.created_by === db.me.id));
    $('profileEmpty').hidden = mine.length > 0;
    mine.forEach((s) => {
      const row = document.createElement('article');
      row.className = 'user-row';
      const text = document.createElement('div');
      text.className = 'project-text';
      const h = document.createElement('h3');
      h.textContent = s.name;
      const sub = document.createElement('p');
      sub.textContent = s.slug + ' · ' + (s.mode === 'key' ? 'KEY MODE' : 'KEYLESS');
      text.append(h, sub);
      const actions = document.createElement('div');
      actions.className = 'panel-actions';
      const b = document.createElement('button');
      b.className = 'btn';
      b.type = 'button';
      b.textContent = 'VIEW SOURCE';
      b.dataset.action = 'view-source';
      b.dataset.id = s.id;
      actions.appendChild(b);
      row.append(text, actions);
      list.appendChild(row);
    });
  }

  async function openSource(id) {
    const s = scriptById(id);
    if (!s) return;
    $('sourceTitle').textContent = s.name;
    $('sourceCode').value = '';
    banner('sourceBanner', '');
    openDialog('source', '#sourceCode');
    try {
      const data = await api('/api/execute', { method: 'POST', body: JSON.stringify({ id }) });
      $('sourceCode').value = data.code;
    } catch (error) {
      banner('sourceBanner', error.message, 'error');
    }
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
    $('obfMeta').textContent = obf + ' / ∞';
    setBar($('obfBar'), 0);
    if (view === 'script-keys') {
      const list = p ? projectScriptKeys(p.id) : [];
      const live = list.filter((k) => k.status === 'active').length;
      $('userLabel').textContent = 'Active Script Keys';
      $('userCount').textContent = live;
      $('userMeta').textContent = live + '/' + list.length + ' issued';
      setBar($('userBar'), list.length ? live / list.length * 100 : 0);
    } else {
      const accounts = db.users.length;
      $('userLabel').textContent = 'Total Users';
      $('userCount').textContent = accounts;
      $('userMeta').textContent = accounts + '/' + KEY_LIMIT;
      setBar($('userBar'), accounts / KEY_LIMIT * 100);
    }
    const banned = $('bannedCard');
    banned.querySelector('.metric-copy strong').textContent = db.banned.length;
    banned.querySelector('.blacklist').innerHTML = 'There are <strong>' + db.banned.length + '</strong> blacklisted IPs';
  }

  function renderKeys() {
    const list = $('keyList');
    list.textContent = '';
    const p = project(ctxId);
    const keys = ctxId === ORPHAN_ID ? db.keys.filter((k) => !k.project_id) : p ? projectKeys(p.id) : [];
    const q = $('keySearch').value.trim().toLowerCase();
    const matches = keys.filter((k) => !q || [k.username, k.label, k.key_prefix].some((v) => (v || '').toLowerCase().includes(q)));
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
      title.textContent = (k.username || 'Unknown') + ' · ' + (k.user_role || 'user') + (k.label ? ' · ' + k.label : '');
      const meta = document.createElement('div');
      meta.className = 'key-meta';
      meta.textContent = 'Created ' + day(k.created_at) + ' · ' + (k.last_used_at ? 'Last used ' + day(k.last_used_at) : 'Never used') + ' · ' + (k.expires_at ? 'Expires ' + day(k.expires_at) : 'Never expires');
      const code = document.createElement('code');
      code.textContent = k.token || (k.key_prefix + '… (full key not stored)');
      info.append(title, meta, code);

      const actions = document.createElement('div');
      actions.className = 'key-actions';
      const status = document.createElement('span');
      status.className = 'pill ' + (k.revoked_at ? 'draft' : 'active');
      status.textContent = k.revoked_at ? 'REVOKED' : 'ACTIVE';
      actions.appendChild(status);
      if (k.token) {
        const c = document.createElement('button');
        c.className = 'btn sm';
        c.type = 'button';
        c.textContent = 'COPY';
        c.dataset.keyAction = 'copy';
        c.dataset.id = k.id;
        actions.appendChild(c);
      }
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
    if (busy) return toast(BUSY_MSG);
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
        selectProject(data.project.id);
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
    if (!confirm('Delete "' + p.name + '" with all its scripts? API keys will be kept under "프로젝트 없음". This cannot be undone.')) return;
    try {
      await api(`/api/projects/${p.id}`, { method: 'DELETE' });
      if (db.selectedId === p.id) selectProject(null);
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
    loadedCode = null;
    const opts = s
      ? { free: s.mode === 'keyless', silent: !!s.silent, heartbeat: !!s.heartbeat, light: !!s.lightweight, secure: !!s.secure_loader, hwid: !!s.hwid_lock }
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
      loadedCode = code.code;
      const added = pending.filter((f) => !f.id);
      pending = [...(files.files || []).map((f) => ({ id: f.id, name: f.name, size: f.byte_size, file: null })), ...added];
      renderFiles();
    } catch (error) {
      banner('scriptBanner', error.message, 'error');
    }
  }

  async function saveScript(button) {
    const p = selected();
    if (!p) return;
    if (busy) return toast(BUSY_MSG);
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
      secure_loader: opts.secure,
      hwid_lock: opts.hwid
    };
    busy = true;
    setBusy(button, true, 'SAVE SCRIPT');
    try {
      let scriptId = editScriptId;
      if (scriptId) {
        const patch = code === loadedCode ? (({ code: _same, ...rest }) => rest)(body) : body;
        await api(`/api/scripts/${scriptId}`, { method: 'PATCH', body: JSON.stringify(patch) });
      } else {
        const data = await api('/api/scripts', { method: 'POST', body: JSON.stringify({ ...body, project_id: p.id }) });
        scriptId = data.script.id;
        editScriptId = scriptId;
        loadedCode = code;
      }
      const keptIds = new Set(pending.filter((f) => f.id).map((f) => f.id));
      const existing = (await api(`/api/scripts/${scriptId}/files`)).files || [];
      for (const file of existing) {
        if (!keptIds.has(file.id)) await api(`/api/script-files/${file.id}`, { method: 'DELETE' });
      }
      for (const item of pending.filter((f) => f.file)) {
        const result = await api(`/api/scripts/${scriptId}/files`, { method: 'POST', body: JSON.stringify({ name: item.name, content: await item.file.text() }) });
        item.id = result.file.id;
        item.file = null;
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

  const ICON_USER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.2 0-7.5 2.1-7.5 4.7V21h15v-2.3c0-2.6-3.3-4.7-7.5-4.7Z"/></svg>';
  const ICON_KEY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 2a6.5 6.5 0 0 0-6.2 8.4L2.3 17.4V22h4.6v-2.3h2.3v-2.3h2.3l2.6-2.6A6.5 6.5 0 1 0 15.5 2Zm1.2 5.2a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2Z"/></svg>';

  async function copyKey(id) {
    const k = db.keys.find((x) => x.id === id);
    if (!k || !k.token) {
      toast('This key was created before full keys were stored.');
      return;
    }
    toast((await copyText(k.token)) ? 'Key copied.' : 'Copy failed. Select the key and copy it manually.');
  }

  function openCreateKey(projectId) {
    const p = project(projectId);
    if (!p) return;
    ctxId = p.id;
    $('addUserTitle').textContent = 'Create API Key For ' + p.name;
    $('uUser').value = '';
    $('uLabel').value = '';
    $('uReset').value = '';
    $('uRole').value = 'user';
    $('uRole').querySelector('option[value="owner"]').hidden = db.role !== 'owner';
    $('uRole').querySelector('option[value="admin"]').hidden = db.role !== 'owner';
    banner('addUserBanner', '');
    openDialog('addUser', '#uUser');
  }

  async function saveKey(button) {
    if (busy) return toast(BUSY_MSG);
    const username = $('uUser').value.trim();
    const role = $('uRole').value;
    const label = $('uLabel').value.trim();
    const raw = $('uReset').value.trim();
    if (!/^[A-Za-z0-9_.-]{2,40}$/.test(username)) {
      banner('addUserBanner', 'Username must be 2 to 40 letters, numbers, _ . or -.', 'error');
      $('uUser').focus();
      return;
    }
    if (db.role !== 'owner' && role !== 'user') {
      banner('addUserBanner', 'Admins can only create user keys.', 'error');
      return;
    }
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
      const body = { username, role, label, expires_in_days: days, project_id: p.id };
      const data = await api('/api/keys', { method: 'POST', body: JSON.stringify(body) });
      const token = data.key.token;
      const copied = await copyText(token);
      banner('addUserBanner', (copied ? 'Copied. ' : '') + username + ' (' + data.key.role + ') key: ' + token, 'ok');
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
    if (projectId === ORPHAN_ID) {
      ctxId = ORPHAN_ID;
      $('keysModalTitle').textContent = 'API Keys Without Project';
      $('keySearch').value = '';
      renderKeys();
      openDialog('keys', '#keySearch');
      return;
    }
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
      const copied = await copyText(token);
      closeDialog();
      toast(copied ? 'Owner 생성 완료. API 키를 복사했습니다.' : 'Owner 생성 완료. 계정 설정에서 API 키를 확인하세요.');
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
        await loadUserWorkspace();
      } else {
        await loadDashboard();
        await loadKeys();
      }
      setBusy(button, false, 'SAVE KEY');
      renderApiStatus();
      renderAll();
      closeDialog();
      toast('API key saved.');
    } catch (error) {
      writeKey(previous);
      setBusy(button, false, 'SAVE KEY');
      banner('accountBanner', error.message, 'error');
    }
  }

  async function removeApiKey() {
    if (!db.apiKey) {
      banner('accountBanner', 'No API key to remove.', 'error');
      return;
    }
    if (!confirm('Remove the saved API key from this browser?')) return;
    writeKey('');
    $('apiKey').value = '';
    db.projects = [];
    db.scripts = [];
    db.keys = []; db.users = []; db.scriptKeys = [];
    renderAll();
    renderApiStatus();
    banner('accountBanner', 'API key removed.', 'ok');
  }

  const VIEWS = ['projects', 'profile', 'users', 'script-keys'];
  const viewFromHash = () => {
    const h = location.hash.slice(1);
    return VIEWS.includes(h) ? h : 'projects';
  };
  const projectScriptKeys = (id) => {
    const ids = new Set(projectScripts(id).map((s) => s.id));
    return db.scriptKeys.filter((k) => ids.has(k.script_id));
  };
  const projectKeyScripts = (id) => projectScripts(id).filter((s) => s.mode === 'key');

  function renderScriptKeyView() {
    const list = $('scriptKeyProjectList');
    list.textContent = '';
    const loaders = db.projects.flatMap((p) => projectKeyScripts(p.id).map((s) => ({ p, s })));
    $('scriptKeysEmpty').hidden = loaders.length > 0;
    loaders.forEach(({ p, s }) => {
      const live = db.scriptKeys.filter((k) => k.script_id === s.id && k.status === 'active').length;
      const row = document.createElement('article');
      row.className = 'user-row';

      const info = document.createElement('div');
      info.className = 'project';
      info.innerHTML = '<span class="side-icon user">' + ICON_USER + '</span><div class="project-mark" aria-hidden="true"><span></span><span></span><span></span></div>';
      const text = document.createElement('div');
      text.className = 'project-text';
      const h = document.createElement('h3');
      h.textContent = s.name;
      const sub = document.createElement('p');
      sub.textContent = p.name + ' · ' + countLabel(live, 'active key');
      text.append(h, sub);
      info.appendChild(text);

      const actions = document.createElement('div');
      actions.className = 'panel-actions';
      actions.innerHTML =
        '<button class="btn primary" data-action="add-script-key" data-project="' + p.id + '" data-script="' + s.id + '">+ ADD KEY</button>' +
        '<button class="btn" data-action="edit-script-keys" data-project="' + p.id + '" data-script="' + s.id + '">EDIT KEYS</button>' +
        '<button class="btn icon" aria-label="Manage script keys" data-action="manage-script-keys" data-project="' + p.id + '" data-script="' + s.id + '">' + GEAR + '</button>';

      row.append(info, actions);
      list.appendChild(row);
    });
  }

  function openIssueKey(projectId, scriptId) {
    const p = project(projectId);
    if (!p) return;
    const scripts = projectKeyScripts(p.id);
    let script = scriptId ? scripts.find((s) => s.id === scriptId) : null;
    if (!script && scripts.length === 1) script = scripts[0];
    if (!script) {
      toast('Use ADD KEY on the loader you want to issue keys for.');
      return;
    }
    ctxId = p.id;
    skEditId = null;
    skLastToken = null;
    skScriptId = script.id;
    $('issueKeyTitle').textContent = 'Add Key To ' + script.name;
    $('skDiscord').value = '';
    $('skMemo').value = '';
    $('skExpire').value = '';
    $('skExpireRow').hidden = false;
    $('skDownload').hidden = true;
    banner('issueKeyBanner', '');
    openDialog('issueKey', '#skDiscord');
  }

  function openEditKey(id) {
    const k = db.scriptKeys.find((x) => x.id === id);
    if (!k) return;
    skEditId = id;
    skScriptId = k.script_id;
    $('issueKeyTitle').textContent = 'Edit Key · ' + k.slug;
    $('skDiscord').value = k.discord_id || '';
    $('skMemo').value = k.memo || '';
    $('skExpireRow').hidden = true;
    $('skDownload').hidden = true;
    banner('issueKeyBanner', '');
    openDialog('issueKey', '#skDiscord');
  }

  async function saveScriptKey(button) {
    if (busy) return toast(BUSY_MSG);
    if (skEditId) return saveKeyMeta(button);
    const scriptId = skScriptId;
    if (!scriptId) {
      banner('issueKeyBanner', 'Open Add Key from a loader.', 'error');
      return;
    }
    const minutes = expiryMinutes($('skExpire').value);
    const err = expiryError(minutes);
    if (err) {
      banner('issueKeyBanner', err, 'error');
      $('skExpire').focus();
      return;
    }
    const body = { memo: $('skMemo').value, discord_id: $('skDiscord').value };
    if (minutes !== undefined) body.expires_in_minutes = minutes;
    busy = true;
    setBusy(button, true, '✓');
    try {
      const data = await api(`/api/scripts/${scriptId}/keys`, { method: 'POST', body: JSON.stringify(body) });
      skLastToken = data.key.token;
      skLastSlug = data.key.slug;
      const copied = await copyText(skLastToken);
      banner('issueKeyBanner', (copied ? 'Copied. ' : '') + 'Save this key now. It will not be shown again: ' + skLastToken, 'ok');
      $('skDownload').hidden = false;
      toast('Script key created.');
      await loadKeys();
      renderAll();
      } catch (error) {
      banner('issueKeyBanner', error.message, 'error');
    } finally {
      busy = false;
      setBusy(button, false, '✓');
    }
  }

  async function saveKeyMeta(button) {
    busy = true;
    setBusy(button, true, '✓');
    let ok = false;
    try {
      await api(`/api/script-keys/${skEditId}`, { method: 'PATCH', body: JSON.stringify({ memo: $('skMemo').value, discord_id: $('skDiscord').value }) });
      toast('Key updated.');
      await loadKeys();
      renderAll();
      ok = true;
    } catch (error) {
      banner('issueKeyBanner', error.message, 'error');
    } finally {
      busy = false;
      setBusy(button, false, '✓');
    }
    if (ok) closeDialog();
  }

  function downloadLastKey() {
    if (!skLastToken) return;
    saveBlob((skLastSlug || 'script') + '-key.txt', skLastToken + '\n', 'text/plain');
  }

  async function exportProjectKeys(format, button) {
    if (busy) return toast(BUSY_MSG);
    const p = project(ctxId);
    if (!p) return;
    const label = button.textContent;
    busy = true;
    setBusy(button, true, label);
    try {
      const rows = [];
      for (const s of projectKeyScripts(p.id)) {
        const data = await api(`/api/scripts/${s.id}/keys/export`);
        (data.keys || []).forEach((k) => rows.push({ script: data.slug, key: k.token, status: k.status, expires_at: k.expires_at }));
      }
      if (!rows.length) {
        toast('No downloadable keys in this project.');
        return;
      }
      if (format === 'txt') saveBlob(p.name + '-keys.txt', rows.map((r) => r.key).join('\n') + '\n', 'text/plain');
      else saveBlob(p.name + '-keys.json', JSON.stringify(rows, null, 2), 'application/json');
    } catch (error) {
      toast(error.message);
    } finally {
      busy = false;
      setBusy(button, false, label);
    }
  }

  let mkFile = null;

  let mkScriptId = null;

  function openManageKeys(projectId, scriptId) {
    const p = project(projectId);
    if (!p) return;
    const scripts = projectKeyScripts(p.id);
    const script = scriptId ? scripts.find((s) => s.id === scriptId) : scripts.length === 1 ? scripts[0] : null;
    if (!script) {
      toast(scripts.length ? 'Open the gear from the loader you want to manage.' : 'This project has no key-mode scripts. Set a script to key mode first.');
      return;
    }
    ctxId = p.id;
    mkScriptId = script.id;
    mkFile = null;
    $('mkImportFile').value = '';
    $('mkImportName').textContent = 'No file selected.';
    banner('manageKeysBanner', '');
    renderManageKeys();
    openDialog('manageKeys', '#mkAmount');
  }

  function renderManageKeys() {
    const scriptId = mkScriptId;
    const count = db.scriptKeys.filter((k) => k.script_id === scriptId).length;
    $('mkKeyCount').textContent = count + ' keys in this script';
  }

  function saveBlob(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function generateManageKeys(button) {
    if (busy) return toast(BUSY_MSG);
    const scriptId = mkScriptId;
    const amount = Number($('mkAmount').value);
    if (!Number.isInteger(amount) || amount < 1 || amount > 2500) {
      banner('manageKeysBanner', 'Amount must be 1 to 2500.', 'error');
      return;
    }
    const minutes = expiryMinutes($('mkExpire').value);
    const err = expiryError(minutes);
    if (err) {
      banner('manageKeysBanner', err, 'error');
      return;
    }
    busy = true;
    setBusy(button, true, 'GENERATE');
    let made = 0;
    let failure = null;
    try {
      while (made < amount) {
        const body = { count: Math.min(300, amount - made) };
        if (minutes !== undefined) body.expires_in_minutes = minutes;
        const data = await api(`/api/scripts/${scriptId}/keys/bulk`, { method: 'POST', body: JSON.stringify(body) });
        made += data.count;
      }
    } catch (error) {
      failure = error.message;
    } finally {
      busy = false;
      setBusy(button, false, 'GENERATE');
    }
    if (made) {
      banner('manageKeysBanner', made + ' keys generated. Use DOWNLOAD to save them.', 'ok');
      toast(made + ' script keys created.');
      await loadKeys();
      renderAll();
      renderManageKeys();
    }
    if (failure) banner('manageKeysBanner', failure, 'error');
  }

  async function downloadManageKeys(format, button) {
    if (busy) return toast(BUSY_MSG);
    const label = button.textContent;
    busy = true;
    setBusy(button, true, label);
    try {
      const data = await api(`/api/scripts/${mkScriptId}/keys/export`);
      const list = data.keys || [];
      if (!list.length) {
        banner('manageKeysBanner', 'No downloadable keys in this script.', 'error');
        return;
      }
      if (format === 'txt') {
        saveBlob(data.slug + '-keys.txt', list.map((k) => k.token).join('\n') + '\n', 'text/plain');
      } else {
        saveBlob(data.slug + '-keys.json', JSON.stringify(list.map((k) => ({ key: k.token, status: k.status, expires_at: k.expires_at })), null, 2), 'application/json');
      }
    } catch (error) {
      banner('manageKeysBanner', error.message, 'error');
    } finally {
      busy = false;
      setBusy(button, false, label);
    }
  }

  async function deleteUnusedManageKeys(button) {
    if (busy) return toast(BUSY_MSG);
    if (!window.confirm('Delete every key in this script that has never been used?')) return;
    const label = button.textContent;
    busy = true;
    setBusy(button, true, label);
    try {
      const data = await api(`/api/scripts/${mkScriptId}/keys/unused`, { method: 'DELETE' });
      banner('manageKeysBanner', data.removed + ' unused keys deleted.', 'ok');
      await loadKeys();
      renderAll();
      renderManageKeys();
    } catch (error) {
      banner('manageKeysBanner', error.message, 'error');
    } finally {
      busy = false;
      setBusy(button, false, label);
    }
  }

  function parseJsonKeys(text) {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : Array.isArray(data.keys) ? data.keys : [];
    return arr
      .map((item) => (typeof item === 'string' ? item : item && (item.key || item.token)))
      .filter((v) => typeof v === 'string' && v.trim())
      .map((v) => v.trim());
  }

  async function importManageKeys(button) {
    if (busy) return toast(BUSY_MSG);
    if (!mkFile) {
      banner('manageKeysBanner', 'Choose a file first.', 'error');
      return;
    }
    let keys;
    try {
      const text = await mkFile.text();
      keys = mkFile.name.toLowerCase().endsWith('.json')
        ? parseJsonKeys(text)
        : text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    } catch {
      banner('manageKeysBanner', 'Could not read this file.', 'error');
      return;
    }
    if (!keys.length) {
      banner('manageKeysBanner', 'No keys found in this file.', 'error');
      return;
    }
    const scriptId = mkScriptId;
    const label = button.textContent;
    busy = true;
    setBusy(button, true, label);
    let added = 0;
    let duplicates = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < keys.length; i += 300) {
        const entries = keys.slice(i, i + 300).map((key) => ({ key }));
        const data = await api(`/api/scripts/${scriptId}/keys/import`, { method: 'POST', body: JSON.stringify({ entries }) });
        added += data.added;
        duplicates += data.duplicates;
        skipped += data.skipped;
      }
      banner('manageKeysBanner', `Imported ${added}. Duplicates ${duplicates}, skipped ${skipped}.`, 'ok');
      await loadKeys();
      renderAll();
      renderManageKeys();
    } catch (error) {
      banner('manageKeysBanner', error.message, 'error');
    } finally {
      busy = false;
      setBusy(button, false, label);
    }
  }

  let ctxScript = null;

  function openScriptKeys(projectId, scriptId) {
    const p = project(projectId);
    if (!p) return;
    ctxId = p.id;
    ctxScript = scriptId || null;
    const s = scriptId ? db.scripts.find((x) => x.id === scriptId) : null;
    $('scriptKeysModalTitle').textContent = 'Users Of ' + (s ? s.name : p.name);
    $('scriptKeySearch').value = '';
    renderScriptKeys();
    openDialog('scriptKeys', '#scriptKeySearch');
  }

  function renderScriptKeys() {
    const list = $('scriptKeyList');
    list.textContent = '';
    const p = project(ctxId);
    const keys = p ? projectScriptKeys(p.id).filter((k) => !ctxScript || k.script_id === ctxScript) : [];
    const q = $('scriptKeySearch').value.trim().toLowerCase();
    const matches = keys.filter((k) => !q || [k.slug, k.key_prefix, k.username, k.discord_id, k.memo].some((v) => (v || '').toLowerCase().includes(q)));
    $('scriptKeyCount').textContent = keys.length ? '(' + matches.length + ' / ' + keys.length + ')' : '';
    if (!keys.length) {
      list.innerHTML = '<div class="key-empty">No script keys yet. Use + ADD KEY to create one.</div>';
      return;
    }
    if (!matches.length) {
      list.innerHTML = '<div class="key-empty">No keys match your search.</div>';
      return;
    }
    const mk = (text, action, id) => {
      const b = document.createElement('button');
      b.className = 'btn sm' + (action === 'revoke-script' ? ' danger' : '');
      b.type = 'button';
      b.textContent = text;
      b.dataset.keyAction = action;
      b.dataset.id = id;
      return b;
    };
    matches.forEach((k) => {
      const row = document.createElement('div');
      row.className = 'key-row';

      const info = document.createElement('div');
      info.className = 'key-info';
      const title = document.createElement('div');
      title.className = 'key-title';
      title.textContent = k.slug;
      const meta = document.createElement('div');
      meta.className = 'key-meta';
      meta.textContent = 'User ' + k.username + ' · Created ' + day(k.created_at) + ' · ' + (k.last_used_at ? 'Last used ' + day(k.last_used_at) : 'Never used') + ' · ' + (k.expires_at ? 'Expires ' + day(k.expires_at) : 'Never expires') + (k.hwid_bound ? ' · HWID bound' : '');
      const code = document.createElement('code');
      code.textContent = k.key_prefix + '…';
      info.append(title, meta, code);
      if (k.discord_id || k.memo) {
        const note = document.createElement('div');
        note.className = 'key-meta';
        note.textContent = [k.discord_id ? 'Discord ' + k.discord_id : '', k.memo].filter(Boolean).join(' · ');
        info.appendChild(note);
      }

      const actions = document.createElement('div');
      actions.className = 'key-actions';
      const status = document.createElement('span');
      status.className = 'pill ' + (k.status === 'active' ? 'active' : 'draft');
      status.textContent = String(k.status).toUpperCase();
      actions.appendChild(status);
      if (k.status === 'active') actions.appendChild(mk('SUSPEND', 'suspend', k.id));
      if (k.status === 'suspended') actions.appendChild(mk('RESUME', 'resume', k.id));
      if (k.hwid_bound) actions.appendChild(mk('RESET HWID', 'reset-hwid', k.id));
      if (db.role !== 'user') actions.appendChild(mk('EDIT', 'edit-script', k.id));
      if (k.status !== 'revoked') actions.appendChild(mk('REVOKE', 'revoke-script', k.id));

      row.append(info, actions);
      list.appendChild(row);
    });
  }

  async function scriptKeyAction(action, id) {
    const k = db.scriptKeys.find((x) => x.id === id);
    if (!k) return;
    if (action === 'edit-script') {
      openEditKey(id);
      return;
    }
    try {
      if (action === 'suspend' || action === 'resume') {
        await api(`/api/script-keys/${id}`, { method: 'PATCH', body: JSON.stringify({ status: action === 'suspend' ? 'suspended' : 'active' }) });
        toast(action === 'suspend' ? 'Script key suspended.' : 'Script key resumed.');
      } else if (action === 'reset-hwid') {
        await api(`/api/script-keys/${id}`, { method: 'PATCH', body: JSON.stringify({ reset_hwid: true }) });
        toast('HWID reset.');
      } else if (action === 'revoke-script') {
        if (!confirm('Revoke this script key? It cannot be restored.')) return;
        await api(`/api/script-keys/${id}`, { method: 'DELETE' });
        toast('Script key revoked.');
      }
      await loadKeys();
      renderAll();
    } catch (error) {
      toast(error.message);
    }
  }

  $('userList').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.project[data-action="add-user"]');
    if (row && e.target === row) {
      e.preventDefault();
      openCreateKey(row.dataset.project);
    }
  });

  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-project]');
    if (b) {
      selectProject(b.dataset.project);
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
      case 'add-script-key': openIssueKey(btn.dataset.project, btn.dataset.script); break;
      case 'edit-script-keys': openScriptKeys(btn.dataset.project, btn.dataset.script); break;
      case 'manage-script-keys': openManageKeys(btn.dataset.project, btn.dataset.script); break;
      case 'open-account': openAccount(); break;
      case 'view-source': openSource(btn.dataset.id); break;
      case 'open-menu':
        document.body.classList.toggle('show-icons');
        openMenu();
        break;
      case 'close-menu': closeMenu(); break;
      case 'notify': toast('No notifications yet.'); break;
      case 'toast': toast(btn.dataset.msg); break;
      case 'acct-status': setUserStatus(btn.dataset.id, btn.dataset.status); break;
      case 'key-revoke': revokeKeyById(btn.dataset.id); break;
    }
  });

  $('drawer').addEventListener('click', (e) => {
    const item = e.target.closest('[data-nav]');
    if (!item) return;
    const target = item.dataset.nav;
    closeMenu();
    if (target === 'projects' || target === 'profile' || target === 'users' || target === 'script-keys') {
      showView(target);
    } else if (target === 'settings') {
      openAccount();
    }
  });
  $('menuBackdrop').addEventListener('click', closeMenu);

  $('projectSave').addEventListener('click', (e) => saveProject(e.currentTarget));
  $('projectDelete').addEventListener('click', deleteProject);
  $('scriptSave').addEventListener('click', (e) => saveScript(e.currentTarget));
  $('sourceCopy').addEventListener('click', async () => {
    toast((await copyText($('sourceCode').value)) ? 'Source copied.' : 'Copy failed. Select the text and copy it manually.');
  });
  $('scriptSaveBottom').addEventListener('click', (e) => saveScript(e.currentTarget));
  $('addUserSave').addEventListener('click', (e) => saveKey(e.currentTarget));
  $('apiToggle').addEventListener('click', toggleApiVisibility);
  $('apiSave').addEventListener('click', (e) => saveApiKey(e.currentTarget));
  $('apiRemove').addEventListener('click', removeApiKey);
  $('userList').addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-role-for]');
    if (sel) setUserRole(sel.dataset.roleFor, sel.value);
  });
  $('setupCreate').addEventListener('click', (e) => createOwner(e.currentTarget));
  $('clearAll').addEventListener('click', removeApiKey);
  $('keySearch').addEventListener('input', renderKeys);
  $('issueKeySave').addEventListener('click', (e) => saveScriptKey(e.currentTarget));
  $('skDownload').addEventListener('click', downloadLastKey);
  $('skListDownloadTxt').addEventListener('click', (e) => exportProjectKeys('txt', e.currentTarget));
  $('skListExportJson').addEventListener('click', (e) => exportProjectKeys('json', e.currentTarget));
  $('mkGenerate').addEventListener('click', (e) => generateManageKeys(e.currentTarget));
  $('mkDownloadTxt').addEventListener('click', (e) => downloadManageKeys('txt', e.currentTarget));
  $('mkExportJson').addEventListener('click', (e) => downloadManageKeys('json', e.currentTarget));
  $('mkDeleteUnused').addEventListener('click', (e) => deleteUnusedManageKeys(e.currentTarget));
  $('mkImportFile').addEventListener('change', (e) => {
    mkFile = e.target.files[0] || null;
    $('mkImportName').textContent = mkFile ? mkFile.name : 'No file selected.';
  });
  $('mkImportConfirm').addEventListener('click', (e) => importManageKeys(e.currentTarget));
  $('scriptKeySearch').addEventListener('input', renderScriptKeys);
  $('scriptKeyList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-key-action]');
    if (b) scriptKeyAction(b.dataset.keyAction, b.dataset.id);
  });

  $('keyList').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-key-action]');
    if (b && b.dataset.keyAction === 'revoke') revokeKey(b.dataset.id);
    if (b && b.dataset.keyAction === 'copy') copyKey(b.dataset.id);
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
      const submit = { pName: () => saveProject($('projectSave')), uLabel: () => saveKey($('addUserSave')), uReset: () => saveKey($('addUserSave')), apiKey: () => saveApiKey($('apiSave')), setupName: () => createOwner($('setupCreate')), skExpire: () => saveScriptKey($('issueKeySave')) }[e.target.id];
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
    db.selectedId = readSelected();
    view = viewFromHash();
    renderAll();
    const needed = await checkSetup();
    await refresh();
    if (needed || !db.apiKey) openAccount();
  }

  init();
})();
