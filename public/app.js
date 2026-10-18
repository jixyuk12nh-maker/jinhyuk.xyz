const $ = (id) => document.getElementById(id);
const state = { view: "library", editingId: null, scripts: [], resultUrl: "" };

function showNotice(message, error = false) {
  const box = $("notice");
  box.textContent = message;
  box.classList.toggle("error", error);
  box.classList.remove("hidden");
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => box.classList.add("hidden"), 4500);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `request_failed_${response.status}`);
  return data;
}

function switchView(view) {
  state.view = view;
  $("library-view").classList.toggle("hidden", view !== "library");
  $("editor-view").classList.toggle("hidden", view !== "new");
  $("page-title").textContent = view === "library" ? "스크립트 라이브러리" : state.editingId ? "스크립트 수정" : "스크립트 업로드";
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  if (view === "new") $("script-name").focus();
}

function startNew() {
  state.editingId = null;
  $("script-name").value = "";
  $("script-source").value = "";
  $("char-count").textContent = "0 characters";
  $("save-button").textContent = "저장하고 URL 발급";
  $("url-result").classList.add("hidden");
  switchView("new");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function renderScripts() {
  const list = $("script-list");
  list.innerHTML = "";
  $("empty-state").classList.toggle("hidden", state.scripts.length > 0);
  for (const script of state.scripts) {
    const card = document.createElement("article");
    card.className = "script-card";
    const rawUrl = `${location.origin}/raw/${script.id}`;
    card.innerHTML = `<div class="card-top"><div class="file-icon">⌘</div><div><div class="card-name">${escapeHtml(script.name)}</div><div class="card-date">${new Date(script.updated_at || script.created_at).toLocaleString()}</div></div></div>
      <div class="card-size">${Number(script.size || 0).toLocaleString()} bytes · 원본 소스</div>
      <div class="card-url" title="${escapeHtml(rawUrl)}">${escapeHtml(rawUrl)}</div>
      <div class="card-actions"><button class="secondary" data-action="copy">URL 복사</button><button class="secondary" data-action="edit">수정</button><button class="secondary" data-action="delete">삭제</button></div>`;
    card.querySelector('[data-action="copy"]').addEventListener("click", () => copyText(rawUrl));
    card.querySelector('[data-action="edit"]').addEventListener("click", () => editScript(script.id));
    card.querySelector('[data-action="delete"]').addEventListener("click", () => deleteScript(script.id, script.name));
    list.append(card);
  }
}

async function loadScripts() {
  try {
    const data = await api("/api/scripts");
    state.scripts = data.scripts || [];
    renderScripts();
    document.querySelector(".sidebar-bottom").innerHTML = '<span class="status-dot" style="background:#72dfac"></span> API 연결됨';
  } catch (error) {
    showNotice("목록을 불러오지 못했습니다. D1 설정과 마이그레이션을 확인하세요: " + error.message, true);
    document.querySelector(".sidebar-bottom").innerHTML = '<span class="status-dot"></span> API 연결 실패';
  }
}

async function editScript(id) {
  try {
    const data = await api(`/api/scripts/${id}`);
    state.editingId = id;
    $("script-name").value = data.script.name;
    $("script-source").value = data.script.source;
    $("char-count").textContent = `${data.script.source.length.toLocaleString()} characters`;
    $("save-button").textContent = "변경 사항 저장";
    $("url-result").classList.add("hidden");
    switchView("new");
  } catch (error) { showNotice("스크립트를 불러오지 못했습니다: " + error.message, true); }
}

async function deleteScript(id, name) {
  if (!confirm(`"${name}" 스크립트를 삭제할까요? 발급된 URL도 더 이상 작동하지 않습니다.`)) return;
  try {
    await api(`/api/scripts/${id}`, { method: "DELETE" });
    showNotice("스크립트를 삭제했습니다.");
    await loadScripts();
  } catch (error) { showNotice("삭제 실패: " + error.message, true); }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showNotice("클립보드에 복사했습니다.");
  } catch {
    const area = document.createElement("textarea");
    area.value = text; document.body.append(area); area.select();
    const ok = document.execCommand("copy"); area.remove();
    showNotice(ok ? "클립보드에 복사했습니다." : "복사에 실패했습니다. 텍스트를 직접 선택해 주세요.", !ok);
  }
}

$("save-button").addEventListener("click", async () => {
  const name = $("script-name").value.trim();
  const source = $("script-source").value;
  if (!name || !source.trim()) return showNotice("이름과 스크립트 코드를 입력하세요.", true);
  if (new TextEncoder().encode(source).byteLength > 256 * 1024) return showNotice("스크립트는 256 KB 이하여야 합니다.", true);
  const button = $("save-button");
  button.disabled = true; button.textContent = "저장 중…";
  try {
    const data = state.editingId
      ? await api(`/api/scripts/${state.editingId}`, { method: "PUT", body: JSON.stringify({ name, source }) })
      : await api("/api/scripts", { method: "POST", body: JSON.stringify({ name, source }) });
    const url = data.script.url || `${location.origin}/raw/${data.script.id}`;
    $("result-url").textContent = url;
    $("loader-code").textContent = `loadstring(game:HttpGet("${url}"))()`;
    $("url-result").classList.remove("hidden");
    state.editingId = data.script.id;
    $("save-button").textContent = "변경 사항 저장";
    showNotice("저장 완료. URL이 발급되었습니다.");
    await loadScripts();
  } catch (error) { showNotice("저장 실패: " + error.message, true); }
  finally { button.disabled = false; button.textContent = state.editingId ? "변경 사항 저장" : "저장하고 URL 발급"; }
});

$("script-source").addEventListener("input", () => $("char-count").textContent = `${$("script-source").value.length.toLocaleString()} characters`);
$("new-button").addEventListener("click", startNew);
$("empty-new").addEventListener("click", startNew);
$("cancel-button").addEventListener("click", () => switchView("library"));
$("refresh-button").addEventListener("click", loadScripts);
$("copy-url").addEventListener("click", () => copyText($("result-url").textContent));
$("copy-loader").addEventListener("click", () => copyText($("loader-code").textContent));
document.querySelectorAll(".nav-item").forEach(el => el.addEventListener("click", () => el.dataset.view === "new" ? startNew() : switchView("library")));
loadScripts();
