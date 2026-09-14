const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

function readList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

const state = {
  items: [],
  settings: {},
  category: "全部",
  favoritesOnly: false,
  recent: readList("sln_recent"),
  favorites: readList("sln_favorites"),
};

let searchFrame = 0;
function scheduleRender() {
  cancelAnimationFrame(searchFrame);
  searchFrame = requestAnimationFrame(render);
}

function iconUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname
      ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`
      : "";
  } catch {
    return "";
  }
}

function iconFallbackHtml(item) {
  return `<span class="site-icon site-icon-fallback">${esc(fallbackIcon(item))}</span>`;
}

function handleIconError(img) {
  const item = state.items.find((entry) => String(entry.id) === String(img.dataset.itemId));
  if (!item) {
    img.outerHTML = '<span class="site-icon site-icon-fallback">🌐</span>';
    return;
  }
  const stage = Number(img.dataset.iconStage || "0");
  const hostname = (() => {
    try { return new URL(item.url).hostname.toLowerCase(); } catch { return ""; }
  })();

  if (stage === 0 && hostname) {
    img.dataset.iconStage = "1";
    img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`;
    return;
  }

  if (stage <= 1 && hostname) {
    img.dataset.iconStage = "2";
    img.src = `https://icons.duckduckgo.com/ip3/${encodeURIComponent(hostname)}.ico`;
    return;
  }

  img.outerHTML = iconFallbackHtml(item);
}

function fallbackIcon(item) {
  const icons = ["🌐", "🔗", "⭐", "🚀", "🧭", "💡", "🛠️", "🎯", "📌", "✨", "🪐", "⚡"];
  const text = `${item.id || ""}${item.title || ""}${item.category || ""}`;
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return icons[hash % icons.length];
}

function savePrefs() {
  localStorage.setItem("sln_recent", JSON.stringify(state.recent.slice(0, 8)));
  localStorage.setItem("sln_favorites", JSON.stringify(state.favorites));
}

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function applySettings() {
  const s = state.settings;
  const siteTitle = s.site_title || "My Navigation";
  const subtitle = s.site_subtitle || "Personal links";
  const heroTitle = s.hero_title || "Everything you need, one click away.";
  const heroDescription = s.hero_description || s.site_description || "A fast, elegant home for your frequently used websites.";
  document.title = siteTitle;
  $("#siteTitle").textContent = siteTitle;
  $("#siteSubtitle").textContent = subtitle;
  $("#heroTitle").textContent = heroTitle;
  $("#heroDesc").textContent = heroDescription;
  $("#footerText").textContent = subtitle;

  if (s.accent && /^#[0-9a-fA-F]{6}$/.test(s.accent)) {
    document.documentElement.style.setProperty("--primary", s.accent);
  }

  const root = document.documentElement;
  root.style.setProperty("--nav-columns-mobile", normalizeColumns(s.nav_columns_mobile, 2));
  root.style.setProperty("--nav-columns-tablet", normalizeColumns(s.nav_columns_tablet, 3));
  root.style.setProperty("--nav-columns-desktop", normalizeColumns(s.nav_columns_desktop, 4));
  root.style.setProperty("--nav-columns-wide", normalizeColumns(s.nav_columns_wide, 6));
  root.dataset.navTagStyle = ["pills", "tabs", "sections"].includes(s.nav_tag_style) ? s.nav_tag_style : "pills";
}

function normalizeColumns(value, fallback) {
  const n = Number(value);
  return String(Number.isFinite(n) && n >= 1 && n <= 6 ? Math.round(n) : fallback);
}

function categoryList() {
  const available = [...new Set(state.items.map((item) => item.category).filter(Boolean))];
  const order = String(state.settings.nav_category_order || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const hidden = new Set(String(state.settings.nav_hidden_categories || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean));
  const ordered = [
    ...order.filter((name) => available.includes(name)),
    ...available.filter((name) => !order.includes(name)),
  ];
  return ordered.filter((name) => !hidden.has(name));
}

async function init() {
  try {
    const bootstrap = await api("/api/public/bootstrap");
    state.items = bootstrap.items || [];
    state.settings = bootstrap.settings || {};
    applySettings();
    renderCats();
    render();
    renderRecent();
  } catch (error) {
    $("#navGrid").innerHTML = `<div class="empty-state"><h3>加载失败</h3><p>${esc(error.message)}</p></div>`;
  }
}

function renderCats() {
  const cats = ["全部", ...categoryList()];
  if (!cats.includes(state.category)) state.category = "全部";
  $("#categoryChips").innerHTML = cats.map((category) => `
    <button class="chip ${state.category === category ? "active" : ""}" data-cat="${esc(category)}">${esc(category)}</button>
  `).join("");

  document.querySelectorAll("[data-cat]").forEach((button) => {
    button.onclick = () => {
      state.category = button.dataset.cat;
      renderCats();
      render();
    };
  });
}

function filtered() {
  const query = $("#searchInput").value.trim().toLowerCase();
  return state.items.filter((item) =>
    (state.category === "全部" || item.category === state.category) &&
    (!state.favoritesOnly || state.favorites.includes(item.id)) &&
    (!query || [item.title, item.description, item.category, item.url].join(" ").toLowerCase().includes(query))
  );
}

function cardHtml(item, index) {
  const displayUrl = item.code ? location.origin + "/" + item.code : item.url;
  const favorite = state.favorites.includes(item.id);
  const icon = item.icon || iconUrl(item.url);
  let fallback = fallbackIcon(item);
  try { fallback = fallbackIcon(item) || (item.title || new URL(item.url).hostname || "?")[0].toUpperCase(); } catch {}
  return `<article class="nav-card" style="animation:fadeUp .28s ease ${Math.min(index, 10) * 0.035}s both" data-id="${item.id}">
    <div class="nav-top">
      <a class="nav-card-open" href="${esc(displayUrl)}" aria-label="打开 ${esc(item.title)}">
        <img class="site-icon" src="${esc(icon)}" data-item-id="${esc(item.id)}" alt="" loading="${index < 8 ? "eager" : "lazy"}" decoding="async" fetchpriority="${index < 4 ? "high" : "low"}" onerror="handleIconError(this)">
      </a>
      <div class="nav-card-actions">
        <button class="copy-btn" data-copy="${item.id}" title="复制链接" aria-label="复制链接">⧉</button>
        <button class="favorite ${favorite ? "active" : ""}" data-fav="${item.id}" title="收藏" aria-label="收藏">${favorite ? "★" : "☆"}</button>
      </div>
    </div>
    <a class="nav-card-content" href="${esc(displayUrl)}">
      <h3>${esc(item.title)}</h3>
      <p>${esc(item.description || (() => { try { return new URL(item.url).hostname; } catch { return item.url; } })())}</p>
    </a>
    <div class="nav-meta">
      ${item.category ? `<span class="tag">${esc(item.category)}</span>` : ""}
      ${item.link_id ? `<span class="tag link-tag">短链接</span>` : ""}
    </div>
  </article>`;
}

function render() {
  const list = filtered();
  const style = document.documentElement.dataset.navTagStyle || "pills";

  if (style === "sections" && state.category === "全部") {
    const groups = categoryList();
    const grouped = groups.map((category) => ({
      category,
      items: list.filter((item) => item.category === category),
    })).filter((group) => group.items.length);
    const uncategorized = list.filter((item) => !item.category);
    $("#navGrid").innerHTML = grouped.map((group) => `
      <section class="nav-category-section">
        <div class="nav-category-heading"><span>${esc(group.category)}</span><b>${group.items.length}</b></div>
        <div class="nav-grid-section">${group.items.map((item, index) => cardHtml(item, index)).join("")}</div>
      </section>
    `).join("") + (uncategorized.length ? `
      <section class="nav-category-section"><div class="nav-category-heading"><span>未分类</span><b>${uncategorized.length}</b></div><div class="nav-grid-section">${uncategorized.map((item, index) => cardHtml(item, index)).join("")}</div></section>
    ` : "");
  } else {
    $("#navGrid").innerHTML = list.map(cardHtml).join("");
  }

  $("#emptyState").classList.toggle("hidden", list.length > 0);

  bindGridEvents();
}

function bindGridEvents() {
  const grid = $("#navGrid");
  grid.onclick = async (event) => {
    const favoriteButton = event.target.closest("[data-fav]");
    if (favoriteButton) {
      event.preventDefault();
      event.stopPropagation();
      const id = Number(favoriteButton.dataset.fav);
      state.favorites = state.favorites.includes(id)
        ? state.favorites.filter((value) => value !== id)
        : [...state.favorites, id];
      savePrefs();
      render();
      renderRecent();
      return;
    }

    const copyButton = event.target.closest("[data-copy]");
    if (copyButton) {
      event.preventDefault();
      event.stopPropagation();
      const item = state.items.find((value) => value.id === Number(copyButton.dataset.copy));
      if (!item) return;
      const ok = await copyText(item.code ? location.origin + "/" + item.code : item.url);
      copyButton.textContent = ok ? "✓" : "×";
      setTimeout(() => { copyButton.textContent = "⧉"; }, 1200);
      return;
    }

    const card = event.target.closest(".nav-card");
    if (card) {
      const id = Number(card.dataset.id);
      state.recent = [id, ...state.recent.filter((value) => value !== id)];
      savePrefs();
    }
  };
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

function renderRecent() {
  const items = state.recent.map((id) => state.items.find((item) => item.id === id)).filter(Boolean);
  $("#recentGrid").innerHTML = items.length
    ? items.map((item) => `<a class="recent-item" href="${esc(item.code ? location.origin + "/" + item.code : item.url)}"><img src="${esc(item.icon || iconUrl(item.url))}" data-item-id="${esc(item.id)}" alt="" loading="lazy" decoding="async" onerror="handleIconError(this)"><span>${esc(item.title)}</span></a>`).join("")
    : '<span style="color:var(--faint);font-size:13px">还没有访问记录</span>';
}

$("#searchInput").oninput = scheduleRender;
$("#favoritesOnly").onclick = () => {
  state.favoritesOnly = !state.favoritesOnly;
  $("#favoritesOnly").textContent = state.favoritesOnly ? "★ 已收藏" : "☆ 收藏";
  render();
};

$("#clearFilters").onclick = () => {
  $("#searchInput").value = "";
  state.category = "全部";
  state.favoritesOnly = false;
  $("#favoritesOnly").textContent = "☆ 收藏";
  renderCats();
  render();
};

$("#clearRecent").onclick = () => {
  state.recent = [];
  savePrefs();
  renderRecent();
};

function setMobileNav(action) {
  document.querySelectorAll(".mobile-nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.mobileAction === action);
  });
}

function initMobileAppUI() {
  const nav = $("#mobileBottomNav");
  if (!nav) return;
  nav.addEventListener("click", (event) => {
    const item = event.target.closest("[data-mobile-action]");
    if (!item) return;
    const action = item.dataset.mobileAction;
    event.preventDefault();
    if (action === "home") {
      state.category = "全部";
      state.favoritesOnly = false;
      $("#searchInput").value = "";
      $("#favoritesOnly").textContent = "☆ 收藏";
      renderCats();
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      setMobileNav("home");
    } else if (action === "favorites") {
      state.favoritesOnly = true;
      $("#favoritesOnly").textContent = "★ 已收藏";
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
      setMobileNav("favorites");
    } else if (action === "recent") {
      $(".recent-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      setMobileNav("recent");
    } else if (action === "search") {
      const input = $("#searchInput");
      input?.focus({ preventScroll: true });
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
      setMobileNav("search");
    }
  });
}

function applyTheme() {
  const saved = localStorage.getItem("sln_theme");
  if (saved === "light") document.documentElement.setAttribute("data-theme", "light");
  $("#themeBtn").textContent = saved === "light" ? "☀" : "☾";
}

$("#themeBtn").onclick = () => {
  const light = document.documentElement.getAttribute("data-theme") === "light";
  if (light) {
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("sln_theme", "dark");
  } else {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem("sln_theme", "light");
  }
  $("#themeBtn").textContent = light ? "☾" : "☀";
};

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    $("#searchInput").focus();
  }
});

applyTheme();
initMobileAppUI();

// Keep keyboard shortcut behavior, but make the public page feel like an installed app on mobile.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
init();
