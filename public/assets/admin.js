const A = {
  links: [], nav: [], settings: {}, navSelected: new Set(), navDirty: false,
  linkPage: 1, navPage: 1, linkPageSize: 10, navPageSize: 12,
};

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
    A.links = data.links || [];
    A.nav = data.navigation || [];
    A.settings = data.settings || {};
    A.navSelected = new Set();
    A.navDirty = false;
    A.linkPage = 1;
    A.navPage = 1;
    renderDashboard(data.dashboard || {});
    renderLinks();
    renderNav();
    fillSettings();
  } catch (error) {
    toast(error.message);
    if (error.message === "未登录") showLogin();
  }
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
  return A.nav.find((nav) => Number(nav.link_id) === Number(item.id));
}

function renderPagination(container, page, total, pageSize, onChange) {
  const node = $(container);
  if (!node) return;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  if (total <= pageSize) {
    node.innerHTML = "";
    return;
  }
  const start = Math.max(1, current - 2);
  const end = Math.min(pages, start + 4);
  const pageButtons = [];
  for (let p = start; p <= end; p++) {
    pageButtons.push(`<button class="page-btn ${p === current ? "active" : ""}" data-page="${p}">${p}</button>`);
  }
  node.innerHTML = `
    <span class="pagination-info">共 ${total} 项，第 ${current}/${pages} 页</span>
    <div class="pagination-actions">
      <button class="page-btn" data-page="${current - 1}" ${current <= 1 ? "disabled" : ""}>上一页</button>
      ${pageButtons.join("")}
      <button class="page-btn" data-page="${current + 1}" ${current >= pages ? "disabled" : ""}>下一页</button>
    </div>`;
  node.querySelectorAll("[data-page]").forEach((button) => {
    button.onclick = () => {
      const target = Number(button.dataset.page);
      if (target >= 1 && target <= pages && target !== current) onChange(target);
    };
  });
}

function renderLinks() {
  const query = ($("#linkSearch")?.value || "").trim().toLowerCase();
  const rows = A.links.filter((item) =>
    [item.code, item.url, item.title, item.category]
      .join(" ").toLowerCase().includes(query)
  );
  const pages = Math.max(1, Math.ceil(rows.length / A.linkPageSize));
  A.linkPage = Math.min(Math.max(1, A.linkPage), pages);
  const offset = (A.linkPage - 1) * A.linkPageSize;
  const pageRows = rows.slice(offset, offset + A.linkPageSize);

  $("#linksTable").innerHTML = pageRows.map((item) => {
    const linked = linkedNav(item);
    return `
      <tr class="link-dense-row">
        <td data-label="短码"><strong>/${esc(item.code)}</strong></td>
        <td data-label="目标"><div class="link-dense-title" title="${esc(item.title || item.url)}">${esc(item.title || item.url)}</div></td>
        <td data-label="分类"><span class="link-category">${esc(item.category || "未分类")}</span></td>
        <td data-label="点击"><span class="click-count">${Number(item.clicks || 0).toLocaleString()}</span></td>
        <td data-label="状态"><span class="status ${item.enabled ? "on" : "off"}">${item.enabled ? "启用" : "停用"}</span></td>
        <td data-label="操作"><div class="row-actions compact-actions">
          <button class="small-btn" data-act="nav" data-id="${item.id}" aria-label="${linked ? "已在导航" : "添加到导航"}" title="${linked ? "已在导航" : "添加到导航"}">${linked ? "✓" : "+"}</button>
          <button class="small-btn edit-btn" data-act="edit" data-id="${item.id}" aria-label="编辑" title="编辑">✎</button>
          <button class="small-btn danger-btn del-btn" data-act="del" data-id="${item.id}" aria-label="删除" title="删除">×</button>
        </div></td>
      </tr>`;
  }).join("") || '<tr><td colspan="6" style="text-align:center;padding:30px">暂无短链接</td></tr>';

  renderPagination("#linksPagination", A.linkPage, rows.length, A.linkPageSize, (page) => {
    A.linkPage = page;
    renderLinks();
  });
}

$("#linkSearch").oninput = () => { A.linkPage = 1; renderLinks(); };
$("#linksTable").onclick = (event) => {
  const button = event.target.closest("[data-act]");
  if (!button) return;
  const item = A.links.find((value) => value.id == button.dataset.id);
  if (!item) return;
  if (button.dataset.act === "edit") linkModal(item);
  if (button.dataset.act === "del") deleteLink(item);
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


$("#addLinkBtn").onclick = () => linkModal();
$("#addNavBtn").onclick = () => navModal();

function navIcon(item) { return item.icon || iconUrl(item.url); }

function navFilteredItems() {
  const query = String($("#navSearch")?.value || "").trim().toLowerCase();
  const category = String($("#navCategoryFilter")?.value || "");
  return A.nav.filter((item) => {
    const haystack = [item.title, item.url, item.description, item.category].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!category || (item.category || "未分类") === category);
  });
}

function refreshNavFilters() {
  const select = $("#navCategoryFilter");
  if (!select) return;
  const current = select.value;
  const categories = [...new Set(A.nav.map((item) => item.category || "未分类"))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  select.innerHTML = '<option value="">全部分类</option>' + categories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join("");
  select.value = categories.includes(current) ? current : "";
}

function renderNav() {
  refreshNavFilters();
  const element = $("#navAdminGrid");
  const items = navFilteredItems();
  const pages = Math.max(1, Math.ceil(items.length / A.navPageSize));
  A.navPage = Math.min(Math.max(1, A.navPage), pages);
  const pageItems = items.slice((A.navPage - 1) * A.navPageSize, A.navPage * A.navPageSize);
  const filtered = items.length !== A.nav.length;
  $("#navCount").innerHTML = (filtered ? `${items.length} / ${A.nav.length} 项` : `${A.nav.length} 项`) + (A.navDirty ? '<span class="nav-dirty">未保存</span>' : '');
  $("#navFilterHint").classList.toggle("hidden", !filtered);
  element.innerHTML = pageItems.map((item) => `
    <div class="admin-nav-card ${A.navSelected.has(Number(item.id)) ? "selected" : ""}" draggable="${filtered ? "false" : "true"}" data-id="${item.id}">
      <div class="admin-nav-head">
        <div class="admin-nav-selection"><input type="checkbox" data-navact="select" data-id="${item.id}" ${A.navSelected.has(Number(item.id)) ? "checked" : ""} aria-label="选择 ${esc(item.title)}"><div class="admin-icon-wrap">
          <img class="site-icon" src="${esc(navIcon(item))}" alt="" onerror="this.outerHTML='<span class=&quot;site-icon site-icon-fallback&quot;>${esc(fallbackIcon(item))}</span>'">
        </div></div>
        <div class="admin-nav-title"><strong>${esc(item.title)}</strong><small>${esc(item.category || "未分类")}</small></div>
        <span class="drag-handle">⠿</span>
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
    </div>
  `).join("") || '<div class="panel" style="padding:30px">暂无导航</div>';
  renderPagination("#navPagination", A.navPage, items.length, A.navPageSize, (page) => {
    A.navPage = page;
    renderNav();
  });
  bindDrag();
}

function bindDrag() {
  const isFiltered = !!($("#navSearch")?.value || $("#navCategoryFilter")?.value);
  if (isFiltered) return;
  let dragging = null;
  document.querySelectorAll(".admin-nav-card").forEach((card) => {
    card.ondragstart = (event) => {
      dragging = card;
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", card.dataset.id);
    };
    card.ondragend = () => {
      card.classList.remove("dragging");
      dragging = null;
    };
    card.ondragover = (event) => {
      event.preventDefault();
      if (!dragging || dragging === card) return;
      const rect = card.getBoundingClientRect();
      card.parentNode.insertBefore(dragging, event.clientY > rect.top + rect.height / 2 ? card.nextSibling : card);
    };
    card.ondrop = (event) => {
      event.preventDefault();
      if (!dragging) return;
      const visibleIds = [...document.querySelectorAll(".admin-nav-card")].map((node) => Number(node.dataset.id));
      const visibleSet = new Set(visibleIds);
      const positions = A.nav.map((item, index) => visibleSet.has(Number(item.id)) ? index : -1).filter((index) => index >= 0);
      const reordered = visibleIds.map((id) => A.nav.find((item) => Number(item.id) === id)).filter(Boolean);
      positions.forEach((position, index) => { A.nav[position] = reordered[index]; });
      A.nav.forEach((value, index) => { value.sort_order = index; });
      A.navDirty = true;
      renderNav();
      toast("顺序已调整，点击“保存排序”后生效");
    };
  });
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
  const item = A.nav.find((value) => value.id == button.dataset.id);
  if (!item) return;
  if (button.dataset.navact === "edit") navModal(item);
  if (button.dataset.navact === "del") deleteNav(item);
  if (button.dataset.navact === "copy") toast(await copyText(item.url) ? "链接已复制" : "复制失败");
  if (button.dataset.navact === "up" || button.dataset.navact === "down") {
    const currentIndex = A.nav.findIndex((value) => Number(value.id) === Number(item.id));
    const targetIndex = currentIndex + (button.dataset.navact === "up" ? -1 : 1);
    if (currentIndex >= 0 && targetIndex >= 0 && targetIndex < A.nav.length) {
      [A.nav[currentIndex], A.nav[targetIndex]] = [A.nav[targetIndex], A.nav[currentIndex]];
      A.nav.forEach((value, index) => { value.sort_order = index; });
      A.navDirty = true;
      renderNav();
      toast("顺序已调整，点击“保存排序”后生效");
    }
  }
};

$("#navSearch").oninput = () => { A.navPage = 1; renderNav(); };
$("#navCategoryFilter").onchange = () => { A.navPage = 1; renderNav(); };
$("#clearNavFilter").onclick = () => {
  $("#navSearch").value = "";
  $("#navCategoryFilter").value = "";
  renderNav();
};

$("#saveNavOrder").onclick = async () => {
  const ids = A.nav.map((item) => Number(item.id));
  try { await api("/api/admin/navigation/reorder", { method: "POST", body: JSON.stringify({ ids }) }); A.navDirty = false; toast("排序已保存"); await loadAll(); }
  catch (error) { toast(error.message); }
};

async function updateSelectedNav(enabled) {
  const selected = A.nav.filter((item) => A.navSelected.has(Number(item.id)));
  if (!selected.length) return toast("请先选择导航项目");
  try {
    await Promise.all(selected.map((item) => api(`/api/admin/navigation/${item.id}`, { method: "PUT", body: JSON.stringify({ title: item.title, category: item.category || "", url: item.url, description: item.description || "", icon: item.icon || "", enabled }) })));
    toast(enabled ? `已启用 ${selected.length} 项` : `已停用 ${selected.length} 项`);
    await loadAll();
  } catch (error) { toast(error.message); }
}

$("#selectAllNav").onclick = () => { navFilteredItems().forEach((item) => A.navSelected.add(Number(item.id))); renderNav(); };
$("#clearSelectedNav").onclick = () => { A.navSelected.clear(); renderNav(); };
$("#enableSelectedNav").onclick = () => updateSelectedNav(true);
$("#disableSelectedNav").onclick = () => updateSelectedNav(false);
$("#deleteSelectedNav").onclick = async () => {
  const selected = A.nav.filter((item) => A.navSelected.has(Number(item.id)));
  if (!selected.length) return toast("请先选择导航项目");
  if (!confirm(`确定删除选中的 ${selected.length} 个导航项目吗？此操作不可撤销。`)) return;
  try {
    await Promise.all(selected.map((item) => api(`/api/admin/navigation/${item.id}`, { method: "DELETE" })));
    toast(`已删除 ${selected.length} 项`);
    await loadAll();
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
  const text = await file.text();
  const lines = text.replace(/^\ufeff/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) { toast("CSV 没有数据"); return; }
  const parseCsvLine = (line) => {
    const values = [];
    let current = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) { values.push(current); current = ""; }
      else current += char;
    }
    values.push(current);
    return values;
  };
  const headers = parseCsvLine(lines[0]).map((x) => x.trim());
  let success = 0;
  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line), data = {};
    headers.forEach((key, index) => data[key] = values[index] || "");
    data.enabled = data.enabled !== "false";
    try { await api("/api/admin/links", { method: "POST", body: JSON.stringify(data) }); success++; } catch {}
  }
  toast(`导入完成：${success} 条`);
  event.target.value = "";
  await loadAll();
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
