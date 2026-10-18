const $ = (id) => document.getElementById(id);
const nameEl = $('name'), codeEl = $('code'), fileEl = $('file'), listEl = $('scripts'), noticeEl = $('notice');
const bytes = (n) => n < 1024 ? `${n} bytes` : `${(n / 1024).toFixed(1)} KB`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notify(message, error = false) { noticeEl.textContent = message; noticeEl.classList.toggle('error', error); }
async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function render(scripts) {
  if (!scripts.length) { listEl.innerHTML = '<div class="empty">아직 등록된 스크립트가 없습니다.</div>'; return; }
  listEl.innerHTML = scripts.map(s => `<article class="script-row"><div class="script-icon">{ }</div><div class="script-info"><strong>${esc(s.name)}</strong><small>${esc(s.id)} · ${bytes(s.byte_size)} · ${new Date(s.updated_at || s.created_at).toLocaleString()}</small></div><div class="row-actions"><button class="secondary" data-action="copy" data-id="${esc(s.id)}">Raw URL 복사</button><button class="secondary" data-action="edit" data-id="${esc(s.id)}">편집</button><button class="danger" data-action="delete" data-id="${esc(s.id)}">삭제</button></div></article>`).join('');
}
async function refresh() {
  listEl.innerHTML = '<div class="empty">목록을 불러오는 중...</div>';
  try { const data = await api('/api/scripts'); render(data.scripts || []); }
  catch (error) { listEl.innerHTML = `<div class="empty">${esc(error.message)}<br>API 상태와 D1 마이그레이션을 확인하세요.</div>`; }
}
codeEl.addEventListener('input', () => $('size').textContent = bytes(new TextEncoder().encode(codeEl.value).length));
fileEl.addEventListener('change', async () => { const file = fileEl.files?.[0]; if (!file) return; codeEl.value = await file.text(); if (!nameEl.value) nameEl.value = file.name.replace(/\.(lua|luau|txt)$/i, ''); $('size').textContent = bytes(new TextEncoder().encode(codeEl.value).length); });
$('publish').addEventListener('click', async () => {
  const button = $('publish'); button.disabled = true;
  const id = button.dataset.editId;
  try {
    const path = id ? `/api/scripts/${id}` : '/api/scripts';
    const method = id ? 'PATCH' : 'POST';
    const data = await api(path, { method, body: JSON.stringify({ name: nameEl.value, code: codeEl.value }) });
    notify(`${id ? '수정' : '등록'} 완료: ${location.origin}/raw/${data.script.id}`);
    delete button.dataset.editId; button.textContent = '스크립트 등록 ↗';
    nameEl.value = ''; codeEl.value = ''; fileEl.value = ''; $('size').textContent = '0 bytes';
    await refresh();
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
});
$('refresh').addEventListener('click', refresh);
listEl.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]'); if (!button) return;
  const { action, id } = button.dataset;
  if (action === 'copy') { const raw = `${location.origin}/raw/${id}`; try { await navigator.clipboard.writeText(raw); notify(`복사 완료: ${raw}`); } catch { notify(raw); } return; }
  if (action === 'delete') { if (!confirm(`스크립트 ${id} 를 삭제할까요? 원본 파일도 삭제됩니다.`)) return; try { await api(`/api/scripts/${id}`, { method: 'DELETE' }); notify('삭제했습니다.'); await refresh(); } catch (error) { notify(error.message, true); } return; }
  if (action === 'edit') {
    try {
      const response = await fetch(`/raw/${id}`, { cache: 'no-store' }); if (!response.ok) throw new Error('원본을 읽지 못했습니다.');
      const source = await response.text(); const title = button.closest('.script-row').querySelector('strong').textContent;
      nameEl.value = title; codeEl.value = source; $('size').textContent = bytes(new TextEncoder().encode(source).length);
      const publish = $('publish'); publish.textContent = '편집 저장'; publish.dataset.editId = id;
      notify('코드를 수정한 뒤 편집 저장을 누르세요.'); codeEl.focus(); window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) { notify(error.message, true); }
  }
});
refresh();
