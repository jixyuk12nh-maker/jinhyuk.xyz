const $ = (id) => document.getElementById(id);
const tokenEl = $('token'), nameEl = $('name'), slugEl = $('slug'), codeEl = $('code'), fileEl = $('file'), listEl = $('scripts'), noticeEl = $('notice'), modeEl = $('mode'), hwidEl = $('hwid'), keysEl = $('my-keys'), issuedEl = $('key-issued');
const signupEl = $('signup'), signupResultEl = $('signup-result');
const adminEl = $('admin'), newUserEl = $('new-user'), newRoleEl = $('new-role'), newDaysEl = $('new-days'), apiIssuedEl = $('api-issued'), usersEl = $('users-list'), apiKeysEl = $('api-keys-list');
const scripts = new Map();
let me = null;
let issued = null;
const bytes = (n) => n < 1024 ? `${n} bytes` : `${(n / 1024).toFixed(1)} KB`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isManager = () => !!me && (me.role === 'owner' || me.role === 'admin');
const loaderFor = (slug, token) => `${token ? `script_key = "${token}"\n` : ''}loadstring(game:HttpGet("${location.origin}/${slug}"))()`;
const tokenBox = (title, token) => `<div class="key-issued-box"><strong>${esc(title)}</strong><pre><code>${esc(token)}</code></pre><button class="secondary" data-copy="${esc(token)}">키 복사</button></div>`;
function notify(message, error = false) { noticeEl.textContent = message; noticeEl.classList.toggle('error', error); }
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); notify('복사했습니다.'); }
  catch { notify(text); }
}
async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set('content-type', 'application/json');
  if (tokenEl.value.trim()) headers.set('authorization', `Bearer ${tokenEl.value.trim()}`);
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function checkSetup() {
  try {
    const health = await (await fetch('/api/health')).json();
    signupEl.hidden = health.needs_setup !== true;
  } catch { signupEl.hidden = true; }
}
async function loadMe() {
  me = null;
  if (!tokenEl.value.trim()) return;
  me = (await api('/api/auth/me')).user;
}

function render(list) {
  scripts.clear();
  list.forEach((s) => scripts.set(s.id, s));
  if (!list.length) { listEl.innerHTML = '<div class="empty">아직 등록된 스크립트가 없습니다.</div>'; return; }
  listEl.innerHTML = list.map((s) => `<article class="script-row"><div class="script-icon">{ }</div><div class="script-info"><strong>${esc(s.name)}</strong><small>${esc(s.slug)} · ${s.mode === 'key' ? '키 모드' : '키리스'}${s.hwid_lock ? ' · HWID 잠금' : ''} · ${bytes(s.byte_size)} · ${new Date(s.updated_at || s.created_at).toLocaleString()}</small></div><div class="row-actions"><button class="secondary" data-action="copy" data-id="${esc(s.id)}">Loadstring 복사</button>${s.mode === 'key' ? `<button class="secondary" data-action="issue" data-id="${esc(s.id)}">키 발급</button>` : ''}<button class="secondary" data-action="edit" data-id="${esc(s.id)}">편집</button><button class="danger" data-action="delete" data-id="${esc(s.id)}">삭제</button></div></article>`).join('');
}
async function refresh() {
  listEl.innerHTML = '<div class="empty">목록을 불러오는 중...</div>';
  try { const data = await api('/api/scripts'); render(data.scripts || []); }
  catch (error) { listEl.innerHTML = `<div class="empty">${esc(error.message)}<br>API 키와 D1 마이그레이션을 확인하세요.</div>`; }
}

function renderIssued() {
  if (!issued) { issuedEl.innerHTML = ''; return; }
  issuedEl.innerHTML = `<div class="key-issued-box"><strong>발급된 스크립트 키 (한 번만 표시됩니다)</strong><pre><code>${esc(issued.token)}</code></pre><pre><code>${esc(loaderFor(issued.slug, issued.token))}</code></pre><button class="secondary" data-action="copy-issued">로더 복사</button> <button class="secondary" data-action="clear-issued">닫기</button></div>`;
}
function renderKeys(list) {
  if (!list.length) { keysEl.innerHTML = '<div class="empty">발급받은 스크립트 키가 없습니다.</div>'; return; }
  keysEl.innerHTML = list.map((k) => {
    const buttons = [];
    if (k.status !== 'revoked') {
      if (isManager() && k.status === 'active') buttons.push(`<button class="secondary" data-action="suspend-key" data-id="${esc(k.id)}">정지</button>`);
      if (isManager() && k.status === 'suspended') buttons.push(`<button class="secondary" data-action="activate-key" data-id="${esc(k.id)}">재개</button>`);
      if (isManager() && k.hwid_bound) buttons.push(`<button class="secondary" data-action="reset-hwid" data-id="${esc(k.id)}">HWID 초기화</button>`);
      buttons.push(`<button class="danger" data-action="revoke-key" data-id="${esc(k.id)}">폐기</button>`);
    }
    return `<article class="script-row"><div class="script-icon">KEY</div><div class="script-info"><strong>${esc(k.slug)}</strong><small>${esc(k.key_prefix)}… · ${esc(k.status)} · ${k.hwid_bound ? 'HWID 연결됨' : 'HWID 미연결'}${isManager() ? ` · ${esc(k.username)}` : ''} · ${k.expires_at ? `${new Date(k.expires_at).toLocaleDateString()} 만료` : '무기한'}</small></div><div class="row-actions">${buttons.join('')}</div></article>`;
  }).join('');
}
async function refreshKeys() {
  if (!tokenEl.value.trim()) { keysEl.innerHTML = '<div class="empty">API 키를 입력하면 내 스크립트 키가 표시됩니다.</div>'; return; }
  keysEl.innerHTML = '<div class="empty">불러오는 중...</div>';
  try { const data = await api('/api/script-keys'); renderKeys(data.keys || []); }
  catch (error) { keysEl.innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
}

function renderUsers(list) {
  if (!list.length) { usersEl.innerHTML = '<div class="empty">사용자가 없습니다.</div>'; return; }
  usersEl.innerHTML = list.map((u) => {
    const roleControl = me.role === 'owner' && u.id !== me.id
      ? `<select data-action="set-role" data-id="${esc(u.id)}">${['user', 'admin', 'owner'].map((r) => `<option value="${r}"${r === u.role ? ' selected' : ''}>${r}</option>`).join('')}</select>`
      : `<small>${esc(u.role)}</small>`;
    const toggle = u.id === me.id ? '' : `<button class="secondary" data-action="toggle-user" data-id="${esc(u.id)}" data-status="${esc(u.status)}">${u.status === 'active' ? '차단' : '차단 해제'}</button>`;
    return `<article class="script-row"><div class="script-icon">ID</div><div class="script-info"><strong>${esc(u.username)}</strong><small>${esc(u.status)} · ${new Date(u.created_at).toLocaleDateString()}</small></div><div class="row-actions">${roleControl}${toggle}</div></article>`;
  }).join('');
}
function renderApiKeys(list) {
  if (!list.length) { apiKeysEl.innerHTML = '<div class="empty">API 키가 없습니다.</div>'; return; }
  apiKeysEl.innerHTML = list.map((k) => {
    const revoked = !!k.revoked_at;
    const button = revoked ? '' : `<button class="danger" data-action="revoke-api-key" data-id="${esc(k.id)}">폐기</button>`;
    const used = k.last_used_at ? `마지막 사용 ${new Date(k.last_used_at).toLocaleString()}` : '사용 기록 없음';
    return `<article class="script-row"><div class="script-icon">KEY</div><div class="script-info"><strong>${esc(k.username)}</strong><small>${esc(k.key_prefix)}… · ${revoked ? '폐기됨' : '활성'} · ${esc(k.user_role)} · ${used} · ${k.expires_at ? `${new Date(k.expires_at).toLocaleDateString()} 만료` : '무기한'}</small></div><div class="row-actions">${button}</div></article>`;
  }).join('');
}
async function refreshAdmin() {
  adminEl.hidden = !isManager();
  if (!isManager()) return;
  newRoleEl.innerHTML = (me.role === 'owner' ? ['user', 'admin', 'owner'] : ['user']).map((r) => `<option value="${r}">${r}</option>`).join('');
  try {
    const [users, keys] = await Promise.all([api('/api/users'), api('/api/keys')]);
    renderUsers(users.users || []);
    renderApiKeys(keys.keys || []);
  } catch (error) {
    usersEl.innerHTML = `<div class="empty">${esc(error.message)}</div>`;
    apiKeysEl.innerHTML = '';
  }
}
async function refreshAll() {
  try { await loadMe(); } catch (error) { notify(error.message, true); }
  await Promise.all([refresh(), refreshKeys(), refreshAdmin()]);
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-copy]');
  if (button) copyText(button.dataset.copy);
});
$('signup-btn').addEventListener('click', async () => {
  const button = $('signup-btn'); button.disabled = true;
  try {
    const data = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ username: $('signup-name').value.trim() }) });
    tokenEl.value = data.key.token;
    signupResultEl.innerHTML = tokenBox(`${data.user.username} 소유자 API 키 (한 번만 표시됩니다)`, data.key.token);
    notify('소유자 계정을 만들었습니다. 키를 안전한 곳에 보관하세요.');
    await refreshAll();
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
});
$('admin-refresh').addEventListener('click', refreshAdmin);
$('issue-key').addEventListener('click', async () => {
  const username = newUserEl.value.trim();
  if (!username) { notify('사용자 이름을 입력하세요.', true); return; }
  const body = { username, role: newRoleEl.value };
  if (newDaysEl.value.trim()) body.expires_in_days = Number(newDaysEl.value);
  try {
    const data = await api('/api/keys', { method: 'POST', body: JSON.stringify(body) });
    apiIssuedEl.innerHTML = tokenBox(`${data.key.username} API 키 (한 번만 표시됩니다)`, data.key.token);
    newUserEl.value = ''; newDaysEl.value = '';
    notify('API 키를 발급했습니다.');
    await refreshAdmin();
  } catch (error) { notify(error.message, true); }
});
adminEl.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]'); if (!button) return;
  const { action, id, status } = button.dataset;
  try {
    if (action === 'toggle-user') {
      await api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ status: status === 'active' ? 'blocked' : 'active' }) });
    } else if (action === 'revoke-api-key') {
      if (!confirm('이 API 키를 폐기할까요? 이 키로는 더 이상 로그인할 수 없습니다.')) return;
      await api(`/api/keys/${id}`, { method: 'DELETE' });
    } else return;
    notify('처리했습니다.');
    await refreshAdmin();
  } catch (error) { notify(error.message, true); }
});
adminEl.addEventListener('change', async (event) => {
  const select = event.target.closest('select[data-action="set-role"]'); if (!select) return;
  try {
    await api(`/api/users/${select.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ role: select.value }) });
    notify('역할을 바꿨습니다.');
  } catch (error) { notify(error.message, true); }
  await refreshAdmin();
});

codeEl.addEventListener('input', () => $('size').textContent = bytes(new TextEncoder().encode(codeEl.value).length));
fileEl.addEventListener('change', async () => {
  const file = fileEl.files?.[0]; if (!file) return;
  codeEl.value = await file.text();
  if (!nameEl.value) nameEl.value = file.name.replace(/\.(lua|luau|txt)$/i, '');
  $('size').textContent = bytes(new TextEncoder().encode(codeEl.value).length);
});
$('publish').addEventListener('click', async () => {
  const button = $('publish'); button.disabled = true;
  const id = button.dataset.editId;
  try {
    const path = id ? `/api/scripts/${id}` : '/api/scripts';
    const method = id ? 'PATCH' : 'POST';
    const data = await api(path, { method, body: JSON.stringify({ name: nameEl.value, slug: slugEl.value, code: codeEl.value, mode: modeEl.value, hwid_lock: hwidEl.checked }) });
    notify(`${id ? '수정' : '등록'} 완료: ${location.origin}/${data.script.slug}`);
    delete button.dataset.editId; button.textContent = '스크립트 등록 ↗';
    nameEl.value = ''; slugEl.value = ''; codeEl.value = ''; fileEl.value = ''; $('size').textContent = '0 bytes';
    modeEl.value = 'keyless'; hwidEl.checked = false;
    await refresh();
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
});
$('refresh').addEventListener('click', refresh);
$('keys-refresh').addEventListener('click', refreshKeys);
tokenEl.addEventListener('change', refreshAll);
listEl.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]'); if (!button) return;
  const { action, id } = button.dataset;
  const script = scripts.get(id);
  if (!script) return;
  if (action === 'copy') {
    const loader = loaderFor(script.slug, script.mode === 'key' ? '여기에_스크립트_키' : null);
    try { await navigator.clipboard.writeText(loader); notify('Loadstring 복사 완료'); } catch { notify(loader); }
    return;
  }
  if (action === 'issue') {
    try {
      const data = await api(`/api/scripts/${id}/keys`, { method: 'POST', body: JSON.stringify({}) });
      issued = { slug: script.slug, token: data.key.token };
      renderIssued();
      notify('스크립트 키를 발급했습니다. 키는 지금 한 번만 표시됩니다.');
      refreshKeys();
    } catch (error) { notify(error.message, true); }
    return;
  }
  if (action === 'delete') {
    if (!confirm(`스크립트 "${script.name}"을(를) 삭제할까요? 원본 파일도 삭제됩니다.`)) return;
    try { await api(`/api/scripts/${id}`, { method: 'DELETE' }); notify('삭제했습니다.'); await refresh(); }
    catch (error) { notify(error.message, true); }
    return;
  }
  if (action === 'edit') {
    if (script.mode === 'key') { notify('키 모드 스크립트의 원문 읽기는 서버 연결 후 지원됩니다.', true); return; }
    try {
      const data = await api('/api/execute', { method: 'POST', body: JSON.stringify({ id }) });
      nameEl.value = script.name; slugEl.value = script.slug; codeEl.value = data.code;
      modeEl.value = script.mode; hwidEl.checked = !!script.hwid_lock;
      $('size').textContent = bytes(new TextEncoder().encode(data.code).length);
      const publish = $('publish'); publish.textContent = '편집 저장'; publish.dataset.editId = id;
      notify('코드를 수정한 뒤 편집 저장을 누르세요.'); codeEl.focus(); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) { notify(error.message, true); }
  }
});
issuedEl.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]'); if (!button) return;
  if (button.dataset.action === 'clear-issued') { issued = null; renderIssued(); return; }
  if (button.dataset.action === 'copy-issued' && issued) await copyText(loaderFor(issued.slug, issued.token));
});
keysEl.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]'); if (!button) return;
  const { action, id } = button.dataset;
  const patch = { 'suspend-key': { status: 'suspended' }, 'activate-key': { status: 'active' }, 'reset-hwid': { reset_hwid: true } };
  try {
    if (action === 'revoke-key') {
      if (!confirm('이 스크립트 키를 폐기할까요? 폐기된 키는 다시 쓸 수 없습니다.')) return;
      await api(`/api/script-keys/${id}`, { method: 'DELETE' });
    } else if (patch[action]) {
      await api(`/api/script-keys/${id}`, { method: 'PATCH', body: JSON.stringify(patch[action]) });
    } else return;
    notify('처리했습니다.');
    await refreshKeys();
  } catch (error) { notify(error.message, true); }
});

renderIssued();
checkSetup();
refreshAll();
