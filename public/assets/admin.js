const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

const A = { links: [], nav: [], settings: {}, navSelected: new Set(), navDirty: false, linksMeta: { page: 1, pageSize: 50, total: 0, totalPages: 1 }, navMeta: { page: 1, pageSize: 50, total: 0, totalPages: 1 }, navCategories: [] };
let searchTimer = null;

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  $("#toastRoot").appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

async function boot() {
  try {
    const me = await api("/api/auth/me");
    if (me.authenticated) showAdmin(); else showLogin();
  } catch {
    showLogin();
  }
}

function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#adminView").classList.add("hidden");
}

function showAdmin() {
  $("#loginView").classList.add("hidden");
  $("#adminView").classList.remove("hidden");
  loadAll();
}

$("#loginForm").onsubmit = async (event) => {
  event.preventDefault();
  $("#loginError").textContent = "";
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: $("#password").value }),
    });
    $("#password").value = "";
    showAdmin();
  } catch (error) {
    $("#loginError").textContent = error.message;
  }
};

$("#logoutBtn").onclick = async () => {
  try { await api("/api/auth/logout", { method: "POST" }); } finally { location.reload(); }
};

document.querySelectorAll(".side-item").forEach((button) => {
  button.onclick = () => switchSection(button.dataset.section);
});

function switchSection(section) {
  document.querySelectorAll(".side-item").forEach((button) => button.classList.toggle("active", button.dataset.section === section));
  document.querySelectorAll(".admin-section").forEach((node) => node.classList.add("hidden"));
  $("#section-" + section).classList.remove("hidden");
  const map = {
    overview: ["OVERVIEW", "控制台"],
    links: ["SHORT LINKS", "短链接"],
    navigation: ["NAVIGATION", "导航管理"],
    settings: ["SETTINGS", "系统设置"],
  };
  $("#sectionEyebrow").textContent = map[section][0];
  $("#sectionTitle").textContent = map[section][1];
}

async function loadAll() {
  try {
    const data = await api("/api/admin/bootstrap");
    A.settings = data.settings || {};
    A.navSelected = new Set();
    A.navDirty = false;
    renderDashboard(data.dashboard || {});
    fillSettings();
    await Promise.all([loadLinkPage(1), loadNavPage(1)]);
  } catch (error) {
    toast(error.message);
    if (error.message === "未登录") showLogin();
  }
}

async function loadLinkPage(page = A.linksMeta.page || 1) {
  const q = encodeURIComponent(($("#linkSearch")?.value || "").trim());
  const data = await api(`/api/admin/links?page=${page}&pageSize=${A.linksMeta.pageSize || 50}&q=${q}`);
  A.links = data.items || [];
  A.linksMeta = data;
  if (!A.links.length && data.page > 1 && data.page > data.totalPages) return loadLinkPage(data.totalPages);
  renderLinks();
}

async function loadNavPage(page = A.navMeta.page || 1) {
  const q = encodeURIComponent(($("#navSearch")?.value || "").trim());
  const category = encodeURIComponent($("#navCategoryFilter")?.value || "");
  const data = await api(`/api/admin/navigation?page=${page}&pageSize=${A.navMeta.pageSize || 50}&q=${q}&category=${category}`);
  A.nav = data.items || [];
  A.navMeta = data;
  A.navCategories = data.categories || A.navCategories;
  if (!A.nav.length && data.page > 1 && data.page > data.totalPages) return loadNavPage(data.totalPages);
  A.navSelected = new Set([...A.navSelected].filter((id) => A.nav.some((item) => Number(item.id) === Number(id))));
  renderNav();
}

function renderDashboard(data) {
  const stats = data.stats || {};
  $("#statsGrid").innerHTML = [
    ["总短链接", stats.links || 0],
    ["总点击", stats.clicks || 0],
    ["导航项目", stats.navigation || 0],
    ["近14天点击", stats.recentClicks || 0],
  ].map(([label, value]) => `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${Number(value).toLocaleString()}</div></div>`).join("");

  $("#topLinks").innerHTML = (data.topLinks || []).slice(0, 7).map((item) => `
    <div class="mini-row"><div><strong>${esc(item.code)}</strong><small>${esc(item.title || item.url)}</small></div><b>${item.clicks || 0}</b></div>
  `).join("") || '<p style="color:var(--faint)">暂无数据</p>';
  drawChart(data.trend || []);
}

function drawChart(rows) {
  const canvas = $("#clickChart");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(300, Math.floor(rect.width));
  const height = Math.max(220, Math.floor(rect.height));
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const W = width, H = height, padding = 22;
  const max = Math.max(1, ...rows.map((row) => Number(row.clicks) || 0));
  const styles = getComputedStyle(document.documentElement);
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = styles.getPropertyValue("--border2");
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = padding + (H - padding * 2) * i / 3;
    ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(W - padding, y); ctx.stroke();
  }
  if (!rows.length) return;
  ctx.strokeStyle = styles.getPropertyValue("--primary");
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  rows.forEach((row, index) => {
    const x = padding + (W - padding * 2) * index / Math.max(1, rows.length - 1);
    const y = H - padding - (H - padding * 2) * ((Number(row.clicks) || 0) / max);
    index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
}

function linkedNav(item) {
  if (item?.navigation_id) return { id: item.navigation_id };
  return A.nav.find((nav) => Number(nav.link_id) === Number(item?.id));
}

function renderLinks() {
  const rows = A.links;

  $("#linksTable").innerHTML = rows.map((item) => {
    const linked = linkedNav(item);

    return `
      <tr class="link-dense-row">
        <td data-label="短码"><strong>/${esc(item.code)}</strong></td>
        <td data-label="目标">
          <div class="link-dense-title" title="${esc(item.title || item.url)}">${esc(item.title || item.url)}</div>
        </td>
        <td data-label="分类"><span class="link-category">${esc(item.category || "未分类")}</span></td>
        <td data-label="点击"><span class="click-count">${Number(item.clicks || 0).toLocaleString()}</span></td>
        <td data-label="状态"><span class="status ${item.enabled ? "on" : "off"}">${item.enabled ? "启用" : "停用"}</span></td>
        <td data-label="操作">
          <div class="row-actions compact-actions">
            <button class="small-btn" data-act="nav" data-id="${item.id}" aria-label="${linked ? "已在导航" : "添加到导航"}" title="${linked ? "已在导航" : "添加到导航"}">${linked ? "✓" : "+"}</button>
            <button class="small-btn qr-btn" data-act="qr" data-id="${item.id}" aria-label="二维码" title="二维码">QR</button>
            <button class="small-btn edit-btn" data-act="edit" data-id="${item.id}" aria-label="编辑" title="编辑">✎</button>
            <button class="small-btn danger-btn del-btn" data-act="del" data-id="${item.id}" aria-label="删除" title="删除">×</button>
          </div>
        </td>
      </tr>`;
  }).join("") ||
  '<tr><td colspan="5" style="text-align:center;padding:30px">暂无短链接</td></tr>';
  renderPagination("linksPagination", A.linksMeta, loadLinkPage);
}

$("#linkSearch").oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadLinkPage(1).catch((e) => toast(e.message)), 180); };
$("#linksTable").onclick = (event) => {
  const button = event.target.closest("[data-act]");
  if (!button) return;
  const item = A.links.find((value) => value.id == button.dataset.id);
  if (!item) return;
  if (button.dataset.act === "edit") linkModal(item);
  if (button.dataset.act === "del") deleteLink(item);
  if (button.dataset.act === "qr") qrModal(item);
  if (button.dataset.act === "nav") addLinkToNavigation(item);
};

function linkModal(item = null) {
  openModal(item ? "编辑短链接" : "新建短链接", `
    <form class="modal-form" id="linkForm">
      <div class="two"><label>短码（留空自动生成）<input name="code" value="${esc(item?.code || "")}" placeholder="例如 docs"></label><label>分类<input name="category" value="${esc(item?.category || "")}" placeholder="工作"></label></div>
      <label>目标 URL<input name="url" required value="${esc(item?.url || "")}" placeholder="https://example.com"></label>
      <label>标题<input name="title" value="${esc(item?.title || "")}"></label>
      <label>描述<textarea name="description" rows="3">${esc(item?.description || "")}</textarea></label>
      <label class="checkbox"><input name="enabled" type="checkbox" ${item?.enabled !== false ? "checked" : ""}> 启用</label>
      <button class="btn primary">保存</button>
    </form>
  `);
  $("#linkForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const data = Object.fromEntries(form.entries());
    data.enabled = form.get("enabled") === "on";
    try {
      await api(item ? `/api/admin/links/${item.id}` : "/api/admin/links", {
        method: item ? "PUT" : "POST",
        body: JSON.stringify(data),
      });
      closeModal(); toast(item ? "已保存，关联导航已同步" : "已保存"); await loadAll();
    } catch (error) { toast(error.message); }
  };
}

async function addLinkToNavigation(item) {
  const exists = linkedNav(item);
  if (exists) {
    toast("这个短链接已经在导航里了");
    switchSection("navigation");
    return;
  }
  try {
    await api("/api/admin/navigation", {
      method: "POST",
      body: JSON.stringify({ link_id: item.id, enabled: item.enabled !== false }),
    });
    toast("已添加到导航");
    await loadAll();
  } catch (error) {
    if (error.message.includes("已经在导航")) switchSection("navigation");
    toast(error.message);
  }
}

async function deleteLink(item) {
  const linked = linkedNav(item);
  const message = linked
    ? `确定删除 /${item.code} 吗？\n对应的导航项目也会一起删除。`
    : `确定删除 /${item.code} 吗？`;
  if (!confirm(message)) return;
  try { await api(`/api/admin/links/${item.id}`, { method: "DELETE" }); toast("已删除"); await loadAll(); }
  catch (error) { toast(error.message); }
}

function qrModal(item) {
  const target = `${location.origin}/${item.code}`;
  openModal("短链接二维码", `
    <div style="text-align:center">
      <div class="qr-box"><div id="qrCanvas" aria-label="短链接二维码"></div></div>
      <strong>/${esc(item.code)}</strong>
      <p style="color:var(--muted);word-break:break-all">${esc(target)}</p>
      <button class="btn primary" id="downloadQr">下载二维码</button>
    </div>`);
  setTimeout(() => {
    const container = $("#qrCanvas");
    if (!container || typeof QRCode === "undefined") return toast("二维码库未加载");
    try {
      new QRCode(container, { text: target, width: 220, height: 220, colorDark: "#111111", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
      $("#downloadQr").onclick = () => {
        const image = container.querySelector("img");
        if (image?.src) { const link = document.createElement("a"); link.href = image.src; link.download = `${item.code}-qrcode.png`; link.click(); return; }
        const canvas = container.querySelector("canvas");
        if (canvas) { const link = document.createElement("a"); link.href = canvas.toDataURL("image/png"); link.download = `${item.code}-qrcode.png`; link.click(); }
      };
    } catch (error) { console.error(error); toast("二维码生成失败"); }
  }, 0);
}

$("#addLinkBtn").onclick = () => linkModal();
$("#addNavBtn").onclick = () => navModal();

function iconUrl(url) {
  try { return `/api/favicon?url=${encodeURIComponent(new URL(url).origin)}`; } catch { return ""; }
}

function fallbackIcon(item) {
  const icons = ["🌐", "🔗", "⭐", "🚀", "🧭", "💡", "🛠️", "🎯", "📌", "✨", "🪐", "⚡"];
  const text = `${item.id || ""}${item.title || ""}${item.category || ""}`;
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return icons[hash % icons.length];
}

function navIcon(item) { return item.icon || item.favicon_url || iconUrl(item.link_url || item.url); }

function navFilteredItems() { return A.nav; }

function refreshNavFilters() {
  const select = $("#navCategoryFilter");
  if (!select) return;
  const current = select.value;
  const categories = A.navCategories || [];
  select.innerHTML = '<option value="">全部分类</option>' + categories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join("");
  select.value = categories.includes(current) ? current : "";
}

function renderPagination(id, meta, loader) {
  const root = $("#" + id);
  if (!root) return;
  const page = Number(meta.page || 1), totalPages = Number(meta.totalPages || 1), total = Number(meta.total || 0);
  root.innerHTML = `<span>第 ${page} / ${totalPages} 页 · 共 ${total} 项</span><div><button class="small-btn" data-page="prev" ${page <= 1 ? "disabled" : ""}>上一页</button><button class="small-btn" data-page="next" ${page >= totalPages ? "disabled" : ""}>下一页</button></div>`;
  root.onclick = (event) => {
    const button = event.target.closest("[data-page]");
    if (!button || button.disabled) return;
    loader(button.dataset.page === "prev" ? page - 1 : page + 1).catch((error) => toast(error.message));
  };
}

function renderNav() {
  refreshNavFilters();
  const element = $("#navAdminGrid");
  const items = navFilteredItems();
  const meta = A.navMeta;
  $("#navCount").innerHTML = `${meta.total || items.length} 项`;
  $("#navFilterHint").classList.remove("hidden");
  $("#navFilterHint").textContent = "分页模式下使用 ↑ / ↓ 调整全局顺序，无需保存。";
  $("#saveNavOrder").disabled = true;
  $("#saveNavOrder").title = "分页模式使用卡片上的 ↑ / ↓ 直接保存";
  const selectedCount = A.navSelected.size;
  $("#navSelectedCount").textContent = selectedCount ? `已选择 ${selectedCount} 项` : "未选择";
  ["enableSelectedNav", "disableSelectedNav", "deleteSelectedNav", "clearSelectedNav"].forEach((id) => {
    const button = $("#" + id);
    if (button) button.disabled = selectedCount === 0;
  });
  element.innerHTML = items.map((item) => `
    <div class="admin-nav-card ${A.navSelected.has(Number(item.id)) ? "selected" : ""}" data-id="${item.id}">
      <div class="admin-nav-head">
        <div class="admin-nav-selection"><input type="checkbox" data-navact="select" data-id="${item.id}" ${A.navSelected.has(Number(item.id)) ? "checked" : ""} aria-label="选择 ${esc(item.title)}"><div class="admin-icon-wrap">
          <img class="site-icon" src="${esc(navIcon(item))}" alt="" loading="lazy" decoding="async">
        </div></div>
        <div class="admin-nav-title"><strong>${esc(item.title)}</strong><small>${esc(item.category || "未分类")}</small></div>
        <span class="drag-handle">#${Number(item.sort_order ?? 0) + 1}</span>
      </div>
      <p>${esc(item.description || item.url)}</p>
      <div class="nav-admin-meta">
        <div class="nav-admin-badges">${item.link_id ? '<span class="linked-badge">短链接</span>' : '<span class="manual-badge">手动</span>'}<span class="nav-order-badge">#${Number(item.sort_order ?? 0) + 1}</span></div>
        <span class="nav-url" title="${esc(item.url)}">${esc(item.url)}</span>
      </div>
      <div class="row-actions nav-admin-actions">
        <button class="small-btn nav-move-btn" data-navact="up" data-id="${item.id}" aria-label="上移" title="上移">↑</button>
        <button class="small-btn nav-move-btn" data-navact="down" data-id="${item.id}" aria-label="下移" title="下移">↓</button>
        <button class="small-btn" data-navact="copy" data-id="${item.id}">复制链接</button>
        <button class="small-btn" data-navact="edit" data-id="${item.id}">编辑</button>
        <button class="small-btn danger-btn" data-navact="del" data-id="${item.id}">删除</button>
      </div>
    </div>`).join("") || '<div class="panel" style="padding:30px">暂无导航</div>';
  element.querySelectorAll("img.site-icon").forEach((img) => img.addEventListener("error", () => {
    const item = A.nav.find((value) => Number(value.id) === Number(img.closest("[data-id]")?.dataset.id));
    if (!item) return;
    const span = document.createElement("span"); span.className = "site-icon site-icon-fallback"; span.textContent = fallbackIcon(item); img.replaceWith(span);
  }, { once: true }));
  renderPagination("navPagination", A.navMeta, loadNavPage);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.focus();
    input.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    input.remove();
    return ok;
  }
}

$("#navAdminGrid").onclick = async (event) => {
  const button = event.target.closest("[data-navact]");
  if (!button) return;
  if (button.dataset.navact === "select") {
    const id = Number(button.dataset.id);
    if (button.checked) A.navSelected.add(id); else A.navSelected.delete(id);
    renderNav();
    return;
  }
  const item = A.nav.find((value) => Number(value.id) === Number(button.dataset.id));
  if (!item) return;
  if (button.dataset.navact === "edit") navModal(item);
  if (button.dataset.navact === "del") deleteNav(item);
  if (button.dataset.navact === "copy") toast(await copyText(item.url) ? "链接已复制" : "复制失败");
  if (button.dataset.navact === "up" || button.dataset.navact === "down") {
    button.disabled = true;
    try { await api("/api/admin/navigation/move", { method: "POST", body: JSON.stringify({ id: Number(item.id), direction: button.dataset.navact }) }); await loadNavPage(A.navMeta.page); }
    catch (error) { toast(error.message); } finally { button.disabled = false; }
  }
};

$("#navSearch").oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadNavPage(1).catch((e) => toast(e.message)), 180); };
$("#navCategoryFilter").onchange = () => loadNavPage(1).catch((e) => toast(e.message));
$("#clearNavFilter").onclick = () => { $("#navSearch").value = ""; $("#navCategoryFilter").value = ""; loadNavPage(1).catch((e) => toast(e.message)); };

$("#saveNavOrder").onclick = () => toast("分页模式下，使用卡片上的 ↑ / ↓ 直接保存顺序");

async function updateSelectedNav(enabled) {
  const ids = A.nav.filter((item) => A.navSelected.has(Number(item.id))).map((item) => Number(item.id));
  if (!ids.length) return toast("请先选择导航项目");
  try {
    const data = await api("/api/admin/navigation/bulk", { method: "POST", body: JSON.stringify({ ids, action: enabled ? "enable" : "disable" }) });
    toast(enabled ? `已启用 ${data.count || ids.length} 项` : `已停用 ${data.count || ids.length} 项`);
    await loadNavPage(A.navMeta.page);
  } catch (error) { toast(error.message); }
}

$("#selectAllNav").onclick = () => { navFilteredItems().forEach((item) => A.navSelected.add(Number(item.id))); renderNav(); };
$("#clearSelectedNav").onclick = () => { A.navSelected.clear(); renderNav(); };
$("#enableSelectedNav").onclick = () => updateSelectedNav(true);
$("#disableSelectedNav").onclick = () => updateSelectedNav(false);
$("#deleteSelectedNav").onclick = async () => {
  const ids = A.nav.filter((item) => A.navSelected.has(Number(item.id))).map((item) => Number(item.id));
  if (!ids.length) return toast("请先选择导航项目");
  if (!confirm(`确定删除选中的 ${ids.length} 个导航项目吗？此操作不可撤销。`)) return;
  try {
    const data = await api("/api/admin/navigation/bulk", { method: "POST", body: JSON.stringify({ ids, action: "delete" }) });
    toast(`已删除 ${data.count || ids.length} 项`);
    await loadNavPage(A.navMeta.page);
  } catch (error) { toast(error.message); }
};

function navModal(item = null) {
  openModal(item ? "编辑导航" : "添加导航", `
    <form class="modal-form" id="navForm">
      <div class="two"><label>标题<input name="title" required value="${esc(item?.title || "")}"></label><label>分类<input name="category" value="${esc(item?.category || "")}" placeholder="工具"></label></div>
      <label>目标 URL<input name="url" required value="${esc(item?.url || "")}" ${item?.link_id ? "readonly" : ""}></label>
      <label>描述<textarea name="description" rows="3">${esc(item?.description || "")}</textarea></label>
      <label>图标 URL（可选）<input name="icon" value="${esc(item?.icon || "")}" placeholder="留空自动使用网站 favicon"></label>
      ${item?.link_id ? '<div class="form-note">此导航已关联短链接。请在「短链接」中编辑；导航会自动同步，避免把短链接地址误当成真实目标 URL。</div>' : ''}
      <label class="checkbox"><input name="enabled" type="checkbox" ${item?.enabled !== false ? "checked" : ""}> 启用</label>
      ${item?.link_id ? '<button type="button" class="btn" id="linkedNavClose">关闭</button>' : '<button class="btn primary">保存</button>'}
    </form>
  `);
  $("#navForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const data = Object.fromEntries(form.entries());
    data.enabled = form.get("enabled") === "on";
    if (item?.link_id) return;
    try {
      await api(item ? `/api/admin/navigation/${item.id}` : "/api/admin/navigation", {
        method: item ? "PUT" : "POST",
        body: JSON.stringify(data),
      });
      closeModal(); toast("已保存"); await loadAll();
    } catch (error) { toast(error.message); }
  };
  if (item?.link_id) {
    $("#linkedNavClose").onclick = closeModal;
  }
}

async function deleteNav(item) {
  if (!confirm(`确定删除「${item.title}」吗？`)) return;
  try { await api(`/api/admin/navigation/${item.id}`, { method: "DELETE" }); toast("已删除"); await loadAll(); }
  catch (error) { toast(error.message); }
}

function fillSettings() {
  const form = $("#settingsForm");
  ["site_title", "site_subtitle", "site_description", "hero_title", "hero_description", "accent", "nav_tag_style", "nav_columns_mobile", "nav_columns_tablet", "nav_columns_desktop", "nav_columns_wide", "nav_category_order", "nav_hidden_categories"].forEach((key) => {
    if (form.elements[key]) form.elements[key].value = A.settings[key] || ({
      accent: "#8b6cff", nav_tag_style: "pills", nav_columns_mobile: "2", nav_columns_tablet: "3", nav_columns_desktop: "4", nav_columns_wide: "6"
    }[key] || "");
  });
}

$("#settingsForm").onsubmit = async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target).entries());
  try {
    await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(data) });
    A.settings = { ...A.settings, ...data };
    $("#settingsMessage").textContent = "设置已保存";
    toast("设置已保存");
  } catch (error) { $("#settingsMessage").textContent = error.message; }
};

function openModal(title, html) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  $("#modal").classList.remove("hidden");
}
function closeModal() { $("#modal").classList.add("hidden"); }
document.querySelectorAll("[data-close-modal]").forEach((node) => node.onclick = closeModal);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });

$("#exportLinks").onclick = () => {
  const headers = ["code", "url", "title", "description", "category", "enabled"];
  const csv = [headers.join(","), ...A.links.map((item) => headers.map((key) => `"${String(item[key] ?? "").replaceAll('"', '""')}"`).join(","))].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  link.download = "shortlinks.csv";
  link.click();
  URL.revokeObjectURL(link.href);
};

$("#importLinksBtn").onclick = () => $("#csvFile").click();
$("#csvFile").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error("CSV 文件不能超过 2 MB");
    const text = await file.text();
    const lines = text.replace(/^\ufeff/, "").split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new Error("CSV 没有数据");
    if (lines.length - 1 > 1000) throw new Error("CSV 最多支持 1000 条记录");
    const parseCsvLine = (line) => {
      const values = []; let current = "", quoted = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (char === '"') quoted = !quoted;
        else if (char === "," && !quoted) { values.push(current); current = ""; }
        else current += char;
      }
      values.push(current); return values;
    };
    const headers = parseCsvLine(lines[0]).map((x) => x.trim().toLowerCase());
    const allowed = new Set(["code", "url", "title", "description", "category", "enabled"]);
    const rows = lines.slice(1).map((line) => {
      const values = parseCsvLine(line), data = {};
      headers.forEach((key, index) => { if (allowed.has(key)) data[key] = values[index] || ""; });
      data.enabled = data.enabled !== "false";
      return data;
    });
    const result = await api("/api/admin/links/import", { method: "POST", body: JSON.stringify({ rows }) });
    toast(`导入完成：成功 ${result.success}，失败 ${result.failed}`);
    if (result.failed) console.warn("CSV import errors", result.errors);
    event.target.value = "";
    await loadLinkPage(1);
  } catch (error) {
    toast(error.message);
    event.target.value = "";
  }
};

function toggleAdminTheme() {
  document.documentElement.classList.toggle("light-admin");
  localStorage.setItem("sln_admin_theme", document.documentElement.classList.contains("light-admin") ? "light" : "dark");
  $("#adminThemeBtn").textContent = document.documentElement.classList.contains("light-admin") ? "☀" : "☾";
}

if (localStorage.getItem("sln_admin_theme") === "light") document.documentElement.classList.add("light-admin");
$("#adminThemeBtn").textContent = document.documentElement.classList.contains("light-admin") ? "☀" : "☾";
$("#adminThemeBtn").onclick = toggleAdminTheme;
boot();
