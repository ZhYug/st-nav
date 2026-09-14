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

function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function iconUrl(url) {
  const hostname = hostnameOf(url);
  return hostname
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`
    : "";
}

function ddgIconUrl(url) {
  const hostname = hostnameOf(url);
  return hostname
    ? `https://icons.duckduckgo.com/ip3/${encodeURIComponent(hostname)}.ico`
    : "";
}

function fallbackIcon(item) {
  const icons = ["🌐", "🔗", "⭐", "🚀", "🧭", "💡", "🛠️", "🎯", "📌", "✨", "🪐", "⚡"];
  const text = `${item.id || ""}${item.title || ""}${item.category || ""}`;
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return icons[hash % icons.length];
}

async function copyText(text) {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.focus();
  input.select();
  let copied = false;
  try { copied = document.execCommand("copy"); } catch {}
  input.remove();
  return copied;
}

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
