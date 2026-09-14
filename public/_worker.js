
const VERSION = "1.2.1";
const getVersion = (env) => String(env.ST_NAV_VERSION || VERSION);
const SESSION_COOKIE = "__Host-stnav_session";
const SESSION_TTL = 86400;
const PUBLIC_CACHE_CONTROL = "public, max-age=0, s-maxage=30, stale-while-revalidate=60";
const REDIRECT_CACHE_CONTROL = PUBLIC_CACHE_CONTROL;
const databaseReady = new WeakMap();

async function ensureDatabase(env) {
  if (!env.DB) {
    throw new Error("D1 数据库绑定 DB 不存在，请检查 Cloudflare 部署配置。");
  }

  let promise = databaseReady.get(env);
  if (!promise) {
    promise = (async () => {
      const requiredTables = ["links", "link_daily_stats", "navigation", "settings", "admin_sessions"];
      const result = await env.DB
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name IN (?, ?, ?, ?, ?)
        `)
        .bind(...requiredTables)
        .all();

      const existing = new Set((result.results ?? []).map((row) => row.name));
      const missing = requiredTables.filter((name) => !existing.has(name));

      if (missing.length) {
        throw new Error(
          `D1 数据库尚未初始化，缺少数据表: ${missing.join(", ")}`
        );
      }
    })();

    databaseReady.set(env, promise);
    promise.catch(() => databaseReady.delete(env));
  }

  await promise;
}

const JSON_HEADERS = {
  "content-type": "application/json;charset=UTF-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self';",
};

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...SECURITY_HEADERS, ...headers },
  });

const now = () => new Date().toISOString();
const b62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CODE_RE = /^[A-Za-z0-9_-]{2,64}$/;
const RESERVED_CODES = new Set(["admin", "api"]);
const ALLOWED_SETTINGS = [
  "site_title",
  "site_subtitle",
  "site_description",
  "hero_title",
  "hero_description",
  "accent",
  "nav_tag_style",
  "nav_columns_mobile",
  "nav_columns_tablet",
  "nav_columns_desktop",
  "nav_columns_wide",
  "nav_category_order",
  "nav_hidden_categories",
];

function randomCode(n = 7) {
  let s = "";
  const size = b62.length;
  const limit = Math.floor(0x100000000 / size) * size;
  const values = new Uint32Array(n);
  while (s.length < n) {
    crypto.getRandomValues(values);
    for (let i = 0; i < values.length && s.length < n; i++) {
      if (values[i] >= limit) continue;
      s += b62[values[i] % size];
    }
  }
  return s;
}

function validUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function clean(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function validateSetting(key, value) {
  const v = clean(value, 500);
  if (["nav_columns_mobile", "nav_columns_tablet", "nav_columns_desktop", "nav_columns_wide"].includes(key)) {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 6 ? String(n) : null;
  }
  if (key === "nav_tag_style") return ["pills", "tabs", "sections"].includes(v) ? v : null;
  if (key === "accent") return /^#[0-9a-f]{6}$/i.test(v) ? v : null;
  if (["nav_category_order", "nav_hidden_categories"].includes(key)) return v.slice(0, 1000);
  return v;
}

function base64urlEncode(value) {
  return btoa(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64urlDecode(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  return atob(padded);
}

function cookie(name, value, maxAge = SESSION_TTL) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data)
  );
  return base64urlEncode(String.fromCharCode(...new Uint8Array(sig)));
}

async function sessionToken(secret, jti = crypto.randomUUID()) {
  const iat = Date.now();
  const payload = base64urlEncode(JSON.stringify({ exp: iat + SESSION_TTL * 1000, iat, jti }));
  return { token: `${payload}.${await hmac(secret, payload)}`, jti, exp: iat + SESSION_TTL * 1000 };
}

function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] || "";
}

async function safePasswordMatch(input, expected) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(input))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(expected))),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function sessionSecret(env) {
  return String(env.SESSION_SECRET || env.ADMIN_PASSWORD || "");
}

async function parseSession(request, env) {
  const secret = sessionSecret(env);
  if (!secret) return null;
  const token = getCookie(request, SESSION_COOKIE);
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  try {
    const data = JSON.parse(base64urlDecode(payload));
    if (!data.exp || data.exp < Date.now() || !data.jti || !/^[0-9a-f-]{36}$/i.test(data.jti)) return null;
    const signatureBytes = Uint8Array.from(
      atob(signature.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((signature.length + 3) % 4)),
      (char) => char.charCodeAt(0)
    );
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const valid = await crypto.subtle.verify(
      { name: "HMAC" }, key, signatureBytes, new TextEncoder().encode(payload)
    );
    if (!valid) return null;
    const session = await env.DB.prepare(
      "SELECT jti,expires_at FROM admin_sessions WHERE jti=? AND revoked_at IS NULL LIMIT 1"
    ).bind(data.jti).first();
    if (!session || Date.parse(session.expires_at) < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

async function isAuthed(request, env) {
  if (!env.DB) return false;
  return Boolean(await parseSession(request, env));
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

async function requireAuth(request, env) {
  if (!(await isAuthed(request, env))) return json({ error: "未登录" }, 401);
  if (!sameOrigin(request)) return json({ error: "非法来源" }, 403);
  return null;
}

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const MAX_JSON_BODY_BYTES = 1024 * 1024;
const MAX_IMPORT_ROWS = 1000;
const MAX_PAGE_SIZE = 100;

async function textBody(request, maxBytes = MAX_JSON_BODY_BYTES) {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new RequestError("请求体过大", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new RequestError("请求体过大", 413);
  return text;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ""; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== '\r') cell += ch;
  }
  if (quoted) throw new RequestError("CSV 引号未闭合", 400);
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
}

function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

async function body(request, maxBytes = MAX_JSON_BODY_BYTES) {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    throw new RequestError("请求体过大", 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new RequestError("请求体过大", 413);
  }
  if (!text.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RequestError("请求 JSON 格式无效", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RequestError("请求 JSON 必须是对象", 400);
  }
  return parsed;
}

function routeParts(path) {
  return path.split("/").filter(Boolean);
}

const PUBLIC_CACHE_PATH = "/api/public/bootstrap";
function publicCacheKey(request) {
  const url = new URL(request.url);
  url.pathname = PUBLIC_CACHE_PATH;
  url.search = "";
  return new Request(url.toString(), { method: "GET" });
}

function redirectCacheKey(request, code) {
  const url = new URL(request.url);
  url.pathname = `/__sln_redirect_cache/${encodeURIComponent(code)}`;
  url.search = "";
  return new Request(url.toString(), { method: "GET" });
}

function redirectCacheAvailable() {
  return typeof caches !== "undefined" && !!caches.default;
}

function waitUntil(ctx, promise) {
  if (!promise) return;
  if (ctx?.waitUntil) {
    ctx.waitUntil(Promise.resolve(promise).catch((error) => console.error(error)));
  } else if (promise?.catch) {
    promise.catch((error) => console.error(error));
  }
}

function invalidateRedirectCache(request, ctx, code) {
  if (!code || !redirectCacheAvailable()) return;
  waitUntil(ctx, caches.default.delete(redirectCacheKey(request, code)));
}

async function invalidatePublicCache(request, ctx) {
  if (typeof caches === "undefined" || !caches.default) return;
  const key = publicCacheKey(request);
  waitUntil(ctx, caches.default.delete(key));
}

async function getPublicBootstrap(env) {
  const results = await env.DB.batch([
    env.DB.prepare(
      `SELECT navigation.id,navigation.title,navigation.description,navigation.url,
              navigation.icon,navigation.category,navigation.sort_order,navigation.enabled,
              navigation.link_id,links.code,links.url AS link_url
       FROM navigation
       LEFT JOIN links ON navigation.link_id = links.id
       WHERE navigation.enabled=1
         AND (navigation.link_id IS NULL OR links.enabled=1)
       ORDER BY navigation.sort_order,navigation.id`
    ),
    env.DB.prepare("SELECT key,value FROM settings"),
  ]);

  return {
    items: results[0].results.map((item) => ({
      ...item,
      favicon_url: `/api/favicon?url=${encodeURIComponent(item.link_url || item.url)}`,
    })),
    settings: Object.fromEntries(results[1].results.map((x) => [x.key, x.value])),
  };
}

async function cachedPublicBootstrap(request, env, ctx) {
  if (typeof caches === "undefined" || !caches.default) {
    const data = await getPublicBootstrap(env);
    const origin = new URL(request.url).origin;
    return json({
      items: data.items.map((item) => ({
        ...item,
        ...(item.code ? { short_url: `${origin}/${item.code}` } : {}),
      })),
      settings: data.settings,
    });
  }
  const cache = caches.default;
  const key = publicCacheKey(request);
  const cached = await cache.match(key);
  if (cached) return cached;

  const data = await getPublicBootstrap(env);
  const origin = new URL(request.url).origin;
  const items = data.items.map((item) => ({
    ...item,
    ...(item.code ? { short_url: `${origin}/${item.code}` } : {}),
  }));
  const response = json(
    { items, settings: data.settings },
    200,
    { "cache-control": PUBLIC_CACHE_CONTROL }
  );
  // Cache API stores a clone so the response can still be returned immediately.
  ctxSafePut(cache, key, response, ctx);
  return response;
}

function ctxSafePut(cache, key, response, ctx) {
  try {
    const put = cache.put(key, response.clone());
    if (ctx?.waitUntil) ctx.waitUntil(put);
    else if (put?.catch) put.catch((error) => console.error("Public cache put failed", error));
  } catch (error) {
    console.error("Public cache put failed", error);
  }
}

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

function clientKey(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown";
}
function checkLoginRateLimit(request) {
  const nowMs = Date.now();
  const key = clientKey(request);
  const row = loginAttempts.get(key);
  if (!row || row.resetAt <= nowMs) return { ok: true, retryAfter: 0 };
  return { ok: row.failures < LOGIN_MAX_FAILURES, retryAfter: Math.max(1, Math.ceil((row.resetAt - nowMs) / 1000)) };
}
function recordLoginFailure(request) {
  const nowMs = Date.now();
  const key = clientKey(request);
  if (loginAttempts.size > 1000) {
    for (const [storedKey, stored] of loginAttempts) {
      if (stored.resetAt <= nowMs || loginAttempts.size > 900) loginAttempts.delete(storedKey);
      if (loginAttempts.size <= 900) break;
    }
  }
  const row = loginAttempts.get(key);
  if (!row || row.resetAt <= nowMs) loginAttempts.set(key, { failures: 1, resetAt: nowMs + LOGIN_WINDOW_MS });
  else row.failures += 1;
}
function clearLoginFailures(request) { loginAttempts.delete(clientKey(request)); }


function pagination(url, defaults = {}) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || defaults.page || "1", 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(10, Number.parseInt(url.searchParams.get("pageSize") || defaults.pageSize || "50", 10) || 50));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function faviconTarget(value) {
  try {
    const url = new URL(String(value));
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "127.0.0.1" || host === "::1" || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) || host === "169.254.169.254") return null;
    return new URL(`${url.protocol}//${host}/favicon.ico`);
  } catch { return null; }
}

function faviconCacheKey(request, target) {
  const url = new URL(request.url);
  url.pathname = "/__stnav_favicon_cache";
  url.search = `?url=${encodeURIComponent(target.origin)}`;
  return new Request(url.toString(), { method: "GET" });
}

async function handleFavicon(request, env, ctx) {
  const target = faviconTarget(new URL(request.url).searchParams.get("url"));
  if (!target) return new Response("", { status: 400, headers: SECURITY_HEADERS });
  if (!env.DB) return new Response("", { status: 503, headers: SECURITY_HEADERS });
  const origin = target.origin;
  const allowed = await env.DB.prepare(`SELECT EXISTS(
    SELECT 1 FROM navigation WHERE url=? OR url LIKE ?
  ) + EXISTS(
    SELECT 1 FROM links WHERE url=? OR url LIKE ?
  ) AS allowed`).bind(origin, `${origin}/%`, origin, `${origin}/%`).first();
  if (!Number(allowed?.allowed || 0)) return new Response("", { status: 404, headers: SECURITY_HEADERS });
  const key = faviconCacheKey(request, target);
  if (typeof caches !== "undefined" && caches.default) {
    const cached = await caches.default.match(key);
    if (cached) return cached;
  }
  try {
    const response = await fetch(target.toString(), { headers: { "User-Agent": "ST-Nav-Favicon/1.2.1" }, redirect: "manual" });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || (!contentType.startsWith("image/") && !contentType.includes("icon"))) {
      return new Response("", { status: 404, headers: SECURITY_HEADERS });
    }
    const headers = new Headers(SECURITY_HEADERS);
    headers.set("content-type", contentType.split(";")[0] || "image/x-icon");
    headers.set("cache-control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400");
    const result = new Response(response.body, { status: 200, headers });
    if (typeof caches !== "undefined" && caches.default) waitUntil(ctx, caches.default.put(key, result.clone()));
    return result;
  } catch {
    return new Response("", { status: 404, headers: SECURITY_HEADERS });
  }
}

async function handleApi(request, env, ctx, parts) {
  const method = request.method.toUpperCase();
  const path = "/" + parts.join("/");

  // Authentication and health checks do not require D1. This keeps failed-login
  // traffic away from the database and makes health probes cheap.
  const needsDatabase = path !== "/api/health" && path !== "/api/favicon";
  if (needsDatabase) await ensureDatabase(env);

  if (path === "/api/auth/login" && method === "POST") {
    if (!sameOrigin(request)) return json({ error: "非法来源" }, 403);
    if (!env.ADMIN_PASSWORD) {
      return json({ error: "服务器尚未配置管理员密码" }, 500);
    }
    if (env.SESSION_SECRET && String(env.SESSION_SECRET).length < 32) {
      return json({ error: "SESSION_SECRET 至少需要 32 个字符" }, 500);
    }
    const rate = checkLoginRateLimit(request);
    if (!rate.ok) return json({ error: "登录尝试过于频繁，请稍后再试" }, 429, { "retry-after": String(rate.retryAfter) });
    const data = await body(request);
    if (!(await safePasswordMatch(data.password ?? "", env.ADMIN_PASSWORD))) {
      recordLoginFailure(request);
      return json({ error: "密码错误" }, 401);
    }
    clearLoginFailures(request);
    await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ? OR revoked_at IS NOT NULL").bind(now()).run();
    const session = await sessionToken(sessionSecret(env));
    await env.DB.prepare(
      "INSERT INTO admin_sessions(jti,created_at,expires_at) VALUES(?,?,?)"
    ).bind(session.jti, now(), new Date(session.exp).toISOString()).run();
    return json({ ok: true }, 200, { "Set-Cookie": cookie(SESSION_COOKIE, session.token) });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    if (!sameOrigin(request)) return json({ error: "非法来源" }, 403);
    const session = await parseSession(request, env);
    if (session?.jti) {
      await env.DB.prepare("UPDATE admin_sessions SET revoked_at=? WHERE jti=? AND revoked_at IS NULL")
        .bind(now(), session.jti).run();
    }
    return json({ ok: true }, 200, { "Set-Cookie": cookie(SESSION_COOKIE, "", 0) });
  }

  if (path === "/api/auth/me" && method === "GET") {
    return json({ authenticated: await isAuthed(request, env) });
  }

  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, version: getVersion(env) });
  }

  if (path === "/api/favicon" && method === "GET") {
    return handleFavicon(request, env, ctx);
  }

  if (path === "/api/public/bootstrap" && method === "GET") {
    return cachedPublicBootstrap(request, env, ctx);
  }

  if (path === "/api/public/navigation" && method === "GET") {
    const data = await getPublicBootstrap(env);
    const origin = new URL(request.url).origin;
    const items = data.items.map((item) => ({
      ...item,
      ...(item.code ? { short_url: `${origin}/${item.code}` } : {}),
    }));
    return json({ items }, 200, { "cache-control": PUBLIC_CACHE_CONTROL });
  }

  if (path === "/api/public/settings" && method === "GET") {
    const data = await getPublicBootstrap(env);
    return json({ settings: data.settings }, 200, { "cache-control": PUBLIC_CACHE_CONTROL });
  }

  const auth = await requireAuth(request, env);
  if (auth) return auth;

  if (path === "/api/admin/bootstrap" && method === "GET") {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const startDay = new Date(today);
    startDay.setUTCDate(today.getUTCDate() - 13);
    const start = startDay.toISOString().slice(0, 10);

    const results = await env.DB.batch([
      env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM links) links,
        (SELECT COALESCE(SUM(clicks),0) FROM links) clicks,
        (SELECT COUNT(*) FROM navigation) navigation,
        (SELECT COALESCE(SUM(clicks),0) FROM link_daily_stats WHERE day>=?) recentClicks` ).bind(start),
      env.DB.prepare("SELECT id,code,url,title,clicks FROM links ORDER BY clicks DESC,id DESC LIMIT 8"),
      env.DB.prepare(`SELECT day, COALESCE(SUM(clicks),0) clicks
       FROM link_daily_stats
       WHERE day>=?
       GROUP BY day
       ORDER BY day`).bind(start),
      env.DB.prepare("SELECT key,value FROM settings"),
    ]);

    const origin = new URL(request.url).origin;
    const trendMap = new Map(results[2].results.map((row) => [row.day, Number(row.clicks) || 0]));
    const trend = [];
    for (let offset = 13; offset >= 0; offset--) {
      const day = new Date(today);
      day.setUTCDate(today.getUTCDate() - offset);
      const key = day.toISOString().slice(0, 10);
      trend.push({ day: key, clicks: trendMap.get(key) || 0 });
    }

    return json({
      dashboard: { stats: results[0].results[0], topLinks: results[1].results, trend },
      settings: Object.fromEntries(results[3].results.map((x) => [x.key, x.value])),
    });
  }

  if (path === "/api/admin/dashboard" && method === "GET") {
    const stats = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM links) links,
              (SELECT COALESCE(SUM(clicks),0) FROM links) clicks,
              (SELECT COUNT(*) FROM navigation) navigation,
              (SELECT COALESCE(SUM(clicks),0) FROM link_daily_stats WHERE day >= date('now','-13 day')) recentClicks`
    ).first();
    const [top, trend] = await env.DB.batch([
      env.DB.prepare("SELECT id,code,url,title,clicks FROM links ORDER BY clicks DESC,id DESC LIMIT 8"),
      env.DB.prepare("SELECT day,COALESCE(SUM(clicks),0) clicks FROM link_daily_stats WHERE day >= date('now','-13 day') GROUP BY day ORDER BY day"),
    ]);
    const trendMap = new Map(trend.results.map((row) => [row.day, Number(row.clicks) || 0]));
    const trendRows = [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let offset = 13; offset >= 0; offset--) {
      const day = new Date(today);
      day.setUTCDate(today.getUTCDate() - offset);
      const key = day.toISOString().slice(0, 10);
      trendRows.push({ day: key, clicks: trendMap.get(key) || 0 });
    }
    return json({ stats, topLinks: top.results, trend: trendRows });
  }

  if (path === "/api/admin/links/import" && method === "POST") {
    const contentType = request.headers.get("content-type") || "";
    let rows;
    if (contentType.toLowerCase().includes("text/csv")) {
      const text = (await textBody(request, 3 * 1024 * 1024)).replace(/^\ufeff/, "");
      const parsed = parseCsv(text);
      if (parsed.length < 2) return json({ error: "CSV 没有数据" }, 400);
      if (parsed.length - 1 > MAX_IMPORT_ROWS) return json({ error: `导入记录最多 ${MAX_IMPORT_ROWS} 条` }, 400);
      const headers = parsed[0].map((x) => String(x).trim().toLowerCase());
      const allowed = new Set(["code", "url", "title", "description", "category", "enabled"]);
      rows = parsed.slice(1).map((values) => {
        const data = {};
        headers.forEach((key, index) => { if (allowed.has(key)) data[key] = values[index] || ""; });
        data.enabled = String(data.enabled ?? "true").trim().toLowerCase() !== "false";
        return data;
      });
    } else {
      const data = await body(request, 3 * 1024 * 1024);
      rows = data.rows;
    }
    if (!Array.isArray(rows) || !rows.length || rows.length > MAX_IMPORT_ROWS) {
      return json({ error: `导入记录必须为 1-${MAX_IMPORT_ROWS} 条` }, 400);
    }
    let success = 0;
    const errors = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index] || {};
      const url = clean(row.url, 2000);
      if (!validUrl(url)) { errors.push({ row: index + 2, error: "URL 必须是 http/https" }); continue; }
      let code = clean(row.code, 64);
      const autoCode = !code;
      if (!autoCode && (!CODE_RE.test(code) || RESERVED_CODES.has(code.toLowerCase()))) {
        errors.push({ row: index + 2, error: "短码格式不合法或为保留字" }); continue;
      }
      const insert = () => env.DB.prepare(`INSERT INTO links(code,url,title,description,category,enabled,updated_at) VALUES(?,?,?,?,?,?,?)`)
        .bind(code, url, clean(row.title, 200), clean(row.description, 500), clean(row.category, 80), row.enabled === false || String(row.enabled).toLowerCase() === "false" ? 0 : 1, now()).run();
      let inserted = false;
      for (let attempt = 0; attempt < (autoCode ? 5 : 1); attempt++) {
        if (autoCode) code = randomCode();
        try { await insert(); inserted = true; break; }
        catch (error) {
          if (String(error?.message || "").toLowerCase().includes("unique")) { if (autoCode) continue; break; }
          throw error;
        }
      }
      if (inserted) success++; else errors.push({ row: index + 2, error: "短码已存在或无法生成唯一短码" });
    }
    invalidatePublicCache(request, ctx);
    return json({ ok: true, success, failed: errors.length, errors: errors.slice(0, 100) });
  }

  if (path === "/api/admin/links/export" && method === "GET") {
    const urlObj = new URL(request.url);
    const q = clean(urlObj.searchParams.get("q"), 120).toLowerCase();
    const where = q ? "WHERE lower(code || ' ' || url || ' ' || COALESCE(title,'') || ' ' || COALESCE(category,'')) LIKE ?" : "";
    const params = q ? [`%${q}%`] : [];
    const rows = await env.DB.prepare(`SELECT code,url,title,description,category,enabled FROM links ${where} ORDER BY created_at DESC,id DESC`).bind(...params).all();
    const headers = ["code", "url", "title", "description", "category", "enabled"];
    const csv = [headers, ...rows.results.map((item) => headers.map((key) => item[key]))]
      .map((row) => row.map(csvCell).join(",")).join("\r\n");
    const responseHeaders = new Headers(SECURITY_HEADERS);
    responseHeaders.set("content-type", "text/csv;charset=utf-8");
    responseHeaders.set("content-disposition", 'attachment; filename="shortlinks.csv"');
    responseHeaders.set("cache-control", "no-store");
    return new Response("\ufeff" + csv + "\r\n", { status: 200, headers: responseHeaders });
  }

  if (path === "/api/admin/links" && method === "GET") {
    const urlObj = new URL(request.url);
    const { page, pageSize, offset } = pagination(urlObj);
    const q = clean(urlObj.searchParams.get("q"), 120).toLowerCase();
    const like = `%${q}%`;
    const where = q ? "WHERE lower(code || ' ' || url || ' ' || COALESCE(title,'') || ' ' || COALESCE(category,'')) LIKE ?" : "";
    const params = q ? [like] : [];
    const [count, rows] = await env.DB.batch([
      env.DB.prepare(`SELECT COUNT(*) total FROM links ${where}`).bind(...params),
      env.DB.prepare(`SELECT links.*, (SELECT id FROM navigation WHERE navigation.link_id=links.id LIMIT 1) navigation_id
        FROM links ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).bind(...params, pageSize, offset),
    ]);
    const total = Number(count.results[0]?.total || 0);
    const origin = new URL(request.url).origin;
    const items = rows.results.map((item) => ({ ...item, short_url: item.code ? `${origin}/${item.code}` : "" }));
    return json({ items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  }

  if (path === "/api/admin/links" && method === "POST") {
    const data = await body(request);
    const url = clean(data.url, 2000);
    if (!validUrl(url)) return json({ error: "URL 必须是 http/https" }, 400);

    let code = clean(data.code, 64);
    const autoCode = !code;
    if (!autoCode && !CODE_RE.test(code)) {
      return json({ error: "短码格式不合法：仅允许 2-64 位字母、数字、_、-" }, 400);
    }
    if (!autoCode && RESERVED_CODES.has(code.toLowerCase())) {
      return json({ error: `短码 ${code} 为系统保留字，请换一个` }, 400);
    }

    const insert = () => env.DB.prepare(
      `INSERT INTO links(code,url,title,description,category,enabled,updated_at)
       VALUES(?,?,?,?,?,?,?)`
    ).bind(
      code,
      url,
      clean(data.title, 200),
      clean(data.description, 500),
      clean(data.category, 80),
      data.enabled === false ? 0 : 1,
      now()
    ).run();

    for (let attempt = 0; attempt < (autoCode ? 5 : 1); attempt++) {
      if (autoCode) code = randomCode();
      try {
        await insert();
        invalidatePublicCache(request, ctx);
        invalidateRedirectCache(request, ctx, code);
        return json({ ok: true, code });
      } catch (error) {
        if (String(error?.message || "").toLowerCase().includes("unique")) {
          if (autoCode) continue;
          return json({ error: "短码已存在" }, 409);
        }
        throw error;
      }
    }
    return json({ error: "无法生成唯一短码，请稍后重试" }, 503);
  }

  const linkMatch = path.match(/^\/api\/admin\/links\/(\d+)$/);
  if (linkMatch) {
    const id = Number(linkMatch[1]);

    if (method === "PUT") {
      const data = await body(request);
      const code = clean(data.code, 64);
      const url = clean(data.url, 2000);

      if (!CODE_RE.test(code)) {
        return json({ error: "短码格式不合法：仅允许 2-64 位字母、数字、_、-" }, 400);
      }
      if (RESERVED_CODES.has(code.toLowerCase())) {
        return json({ error: `短码 ${code} 为系统保留字，请换一个` }, 400);
      }
      if (!validUrl(url)) return json({ error: "URL 必须是 http/https" }, 400);

      const previous = await env.DB.prepare("SELECT code FROM links WHERE id=?").bind(id).first();
      if (!previous) return json({ error: "短链接不存在" }, 404);

      try {
        const timestamp = now();
        const results = await env.DB.batch([
          env.DB.prepare(
            `UPDATE links SET code=?,url=?,title=?,description=?,category=?,enabled=?,updated_at=?
             WHERE id=?`
          ).bind(
            code,
            url,
            clean(data.title, 200),
            clean(data.description, 500),
            clean(data.category, 80),
            data.enabled === false ? 0 : 1,
            timestamp,
            id
          ),
          env.DB.prepare(
            `UPDATE navigation
             SET title=?,description=?,category=?,enabled=?,updated_at=?
             WHERE link_id=?`
          ).bind(
            clean(data.title, 200),
            clean(data.description, 500),
            clean(data.category, 80),
            data.enabled === false ? 0 : 1,
            timestamp,
            id
          ),
        ]);

        if (!results[0].meta?.changes) return json({ error: "短链接不存在" }, 404);
      } catch (error) {
        if (String(error?.message || "").toLowerCase().includes("unique")) {
          return json({ error: "短码已存在" }, 409);
        }
        throw error;
      }
      invalidatePublicCache(request, ctx);
      invalidateRedirectCache(request, ctx, previous.code);
      invalidateRedirectCache(request, ctx, code);
      return json({ ok: true });
    }

    if (method === "DELETE") {
      const previous = await env.DB.prepare("SELECT code FROM links WHERE id=?").bind(id).first();
      const result = await env.DB.prepare("DELETE FROM links WHERE id=?")
        .bind(id)
        .run();
      if (!result.meta?.changes) return json({ error: "短链接不存在" }, 404);
      invalidatePublicCache(request, ctx);
      invalidateRedirectCache(request, ctx, previous?.code);
      return json({ ok: true });
    }
  }

  if (path === "/api/admin/navigation" && method === "GET") {
    const urlObj = new URL(request.url);
    const { page, pageSize, offset } = pagination(urlObj);
    const q = clean(urlObj.searchParams.get("q"), 120).toLowerCase();
    const category = clean(urlObj.searchParams.get("category"), 80);
    const filters = [];
    const params = [];
    if (q) { filters.push("lower(navigation.title || ' ' || COALESCE(navigation.description,'') || ' ' || COALESCE(navigation.category,'') || ' ' || navigation.url || ' ' || COALESCE(links.url,'')) LIKE ?"); params.push(`%${q}%`); }
    if (category) { filters.push("COALESCE(navigation.category,'未分类') = ?"); params.push(category); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const [count, rows, categories] = await env.DB.batch([
      env.DB.prepare(`SELECT COUNT(*) total FROM navigation LEFT JOIN links ON navigation.link_id=links.id ${where}`).bind(...params),
      env.DB.prepare(`SELECT navigation.id,navigation.title,navigation.description,navigation.url,navigation.icon,navigation.category,
        navigation.sort_order,navigation.enabled,navigation.created_at,navigation.updated_at,navigation.link_id,
        links.code,links.url AS link_url,links.title AS link_title,links.description AS link_description,links.category AS link_category,links.enabled AS link_enabled
        FROM navigation LEFT JOIN links ON navigation.link_id=links.id ${where}
        ORDER BY navigation.sort_order,navigation.id LIMIT ? OFFSET ?`).bind(...params, pageSize, offset),
      env.DB.prepare("SELECT DISTINCT COALESCE(category,'未分类') category FROM navigation ORDER BY category"),
    ]);
    const total = Number(count.results[0]?.total || 0);
    const origin = new URL(request.url).origin;
    const items = rows.results.map((item) => ({
      ...item,
      short_url: item.code ? `${origin}/${item.code}` : "",
      url: item.code ? `${origin}/${item.code}` : item.url,
      favicon_url: `/api/favicon?url=${encodeURIComponent(item.link_url || item.url)}`,
    }));
    return json({ items, categories: categories.results.map((row) => row.category).filter(Boolean), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  }

  if (path === "/api/admin/navigation" && method === "POST") {
    const data = await body(request);

    // V3.3：短链接直接加入导航
    if (data.link_id !== undefined && data.link_id !== null && data.link_id !== "") {
      const linkId = Number(data.link_id);

      if (!Number.isInteger(linkId) || linkId <= 0) {
        return json({ error: "短链接 ID 无效" }, 400);
      }

      const [linkResult, existsResult, maxResult] = await env.DB.batch([
        env.DB.prepare("SELECT id,code,url,title,description,category,enabled FROM links WHERE id=?").bind(linkId),
        env.DB.prepare("SELECT id FROM navigation WHERE link_id=? LIMIT 1").bind(linkId),
        env.DB.prepare("SELECT COALESCE(MAX(sort_order),-1) m FROM navigation"),
      ]);
      const link = linkResult.results[0] || null;

      if (!link) {
        return json({ error: "短链接不存在" }, 404);
      }

      if (existsResult.results.length) {
        return json({ error: "这个短链接已经在导航里了" }, 409);
      }

      const requestUrl = new URL(request.url);
      const shortUrl = requestUrl.origin + "/" + link.code;

      const icon = "";

      await env.DB.prepare(
        `INSERT INTO navigation
         (link_id,title,description,url,icon,category,sort_order,enabled,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)`
      )
        .bind(
          linkId,
          clean(link.title, 120),
          clean(link.description, 500),
          shortUrl,
          icon,
          clean(link.category, 80),
          Number(maxResult.results[0]?.m ?? -1) + 1,
          data.enabled === false || link.enabled === 0 ? 0 : 1,
          now()
        )
        .run();

      invalidatePublicCache(request, ctx);
      return json({ ok: true });
    }

    // 保留手动添加导航
    const title = clean(data.title, 120);
    const url = clean(data.url, 2000);

    if (!title || !validUrl(url)) {
      return json({ error: "标题和有效 URL 必填" }, 400);
    }

    const icon = clean(data.icon, 1000);
    if (icon && !validUrl(icon)) return json({ error: "图标 URL 必须是 http/https" }, 400);

    await env.DB.prepare(
      `INSERT INTO navigation
       (title,description,url,icon,category,sort_order,enabled,updated_at)
       SELECT ?,?,?,?,?,COALESCE(MAX(sort_order),-1)+1,?,?
       FROM navigation`
    )
      .bind(
        title,
        clean(data.description, 500),
        url,
        icon,
        clean(data.category, 80),
        data.enabled === false ? 0 : 1,
        now()
      )
      .run();

    invalidatePublicCache(request, ctx);
    return json({ ok: true });
  }

  if (path === "/api/admin/navigation/bulk" && method === "POST") {
    const data = await body(request);
    const action = data.action;
    if (!['enable', 'disable', 'delete'].includes(action)) return json({ error: "批量操作无效" }, 400);
    const all = data.all === true;
    let ids = [];
    if (all) {
      const q = clean(data.q, 120).toLowerCase();
      const category = clean(data.category, 80);
      const filters = [];
      const params = [];
      if (q) { filters.push("lower(navigation.title || ' ' || COALESCE(navigation.description,'') || ' ' || COALESCE(navigation.category,'') || ' ' || navigation.url || ' ' || COALESCE(links.url,'')) LIKE ?"); params.push(`%${q}%`); }
      if (category) { filters.push("COALESCE(navigation.category,'未分类') = ?"); params.push(category); }
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const rows = await env.DB.prepare(`SELECT navigation.id FROM navigation LEFT JOIN links ON navigation.link_id=links.id ${where}`).bind(...params).all();
      ids = rows.results.map((row) => Number(row.id));
      if (!ids.length) return json({ ok: true, count: 0 });
    } else {
      if (!Array.isArray(data.ids) || data.ids.length < 1 || data.ids.length > 500) return json({ error: "请选择 1-500 个导航项目" }, 400);
      ids = data.ids.map(Number);
      if (ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length) return json({ error: "导航 ID 列表无效" }, 400);
    }
    if (ids.length > 500) {
      // Avoid oversized SQL variable lists by operating in chunks.
      for (let offset = 0; offset < ids.length; offset += 500) {
        const chunk = ids.slice(offset, offset + 500), placeholders = chunk.map(() => '?').join(',');
        if (action === 'delete') await env.DB.prepare(`DELETE FROM navigation WHERE id IN (${placeholders})`).bind(...chunk).run();
        else await env.DB.prepare(`UPDATE navigation SET enabled=?,updated_at=? WHERE id IN (${placeholders})`).bind(action === 'enable' ? 1 : 0, now(), ...chunk).run();
      }
    } else {
      const placeholders = ids.map(() => '?').join(',');
      const existing = await env.DB.prepare(`SELECT id FROM navigation WHERE id IN (${placeholders})`).bind(...ids).all();
      if (existing.results.length !== ids.length) return json({ error: "部分导航项目不存在，请刷新后重试" }, 409);
      if (action === 'delete') await env.DB.prepare(`DELETE FROM navigation WHERE id IN (${placeholders})`).bind(...ids).run();
      else await env.DB.prepare(`UPDATE navigation SET enabled=?,updated_at=? WHERE id IN (${placeholders})`).bind(action === 'enable' ? 1 : 0, now(), ...ids).run();
    }
    invalidatePublicCache(request, ctx);
    return json({ ok: true, count: ids.length });
  }

  if (path === "/api/admin/navigation/normalize" && method === "POST") {
    const rows = await env.DB.prepare("SELECT id FROM navigation ORDER BY sort_order,id").all();
    const statements = rows.results.map((row, index) => env.DB.prepare("UPDATE navigation SET sort_order=?,updated_at=? WHERE id=?").bind(index, now(), row.id));
    if (statements.length) await env.DB.batch(statements);
    invalidatePublicCache(request, ctx);
    return json({ ok: true, count: statements.length });
  }

  if (path === "/api/admin/navigation/move" && method === "POST") {
    const data = await body(request);
    const id = Number(data.id);
    const direction = data.direction === "up" ? "up" : data.direction === "down" ? "down" : "";
    if (!Number.isInteger(id) || id <= 0 || !direction) return json({ error: "移动参数无效" }, 400);
    const current = await env.DB.prepare("SELECT id,sort_order FROM navigation WHERE id=?").bind(id).first();
    if (!current) return json({ error: "导航不存在" }, 404);
    const neighbor = await env.DB.prepare(
      direction === "up"
        ? "SELECT id,sort_order FROM navigation WHERE sort_order < ? ORDER BY sort_order DESC,id DESC LIMIT 1"
        : "SELECT id,sort_order FROM navigation WHERE sort_order > ? ORDER BY sort_order ASC,id ASC LIMIT 1"
    ).bind(current.sort_order).first();
    if (!neighbor) return json({ ok: true, moved: false });
    const timestamp = now();
    await env.DB.batch([
      env.DB.prepare("UPDATE navigation SET sort_order=?,updated_at=? WHERE id=?").bind(neighbor.sort_order, timestamp, current.id),
      env.DB.prepare("UPDATE navigation SET sort_order=?,updated_at=? WHERE id=?").bind(current.sort_order, timestamp, neighbor.id),
    ]);
    invalidatePublicCache(request, ctx);
    return json({ ok: true, moved: true });
  }

  if (path === "/api/admin/navigation/reorder" && method === "POST") {
    const data = await body(request);
    if (!Array.isArray(data.ids) || data.ids.some((id) => !Number.isInteger(Number(id)))) {
      return json({ error: "排序数据无效" }, 400);
    }

    const ids = data.ids.map(Number);
    if (new Set(ids).size !== ids.length) return json({ error: "排序数据存在重复项目" }, 400);

    const existing = await env.DB.prepare("SELECT id FROM navigation").all();
    const existingIds = new Set(existing.results.map((row) => Number(row.id)));
    if (ids.length !== existingIds.size || ids.some((id) => !existingIds.has(id))) {
      return json({ error: "排序数据必须包含全部且仅包含现有导航项目" }, 400);
    }

    const statements = ids.map((id, index) =>
      env.DB.prepare("UPDATE navigation SET sort_order=?,updated_at=? WHERE id=?")
        .bind(index, now(), id)
    );
    if (statements.length) await env.DB.batch(statements);
    invalidatePublicCache(request, ctx);
    return json({ ok: true });
  }

  const navMatch = path.match(/^\/api\/admin\/navigation\/(\d+)$/);
  if (navMatch) {
    const id = Number(navMatch[1]);

    if (method === "PUT") {
      const data = await body(request);
      const current = await env.DB.prepare(
        "SELECT id,link_id FROM navigation WHERE id=?"
      ).bind(id).first();
      if (!current) return json({ error: "导航不存在" }, 404);

      // 关联短链接的导航是短链接的只读投影，避免把短链接 URL 当成真实目标 URL 写回 links。
      if (current.link_id) {
        return json({ error: "此导航已关联短链接，请在「短链接」中编辑内容" }, 409);
      }

      const title = clean(data.title, 120);
      const url = clean(data.url, 2000);
      const icon = clean(data.icon, 1000);
      if (!title || !validUrl(url)) return json({ error: "标题和有效 URL 必填" }, 400);
      if (icon && !validUrl(icon)) return json({ error: "图标 URL 必须是 http/https" }, 400);

      const result = await env.DB.prepare(
        `UPDATE navigation SET title=?,description=?,url=?,icon=?,category=?,enabled=?,updated_at=?
         WHERE id=?`
      )
        .bind(
          title,
          clean(data.description, 500),
          url,
          icon,
          clean(data.category, 80),
          data.enabled === false ? 0 : 1,
          now(),
          id
        )
        .run();

      if (!result.meta?.changes) return json({ error: "导航不存在" }, 404);
      invalidatePublicCache(request, ctx);
      return json({ ok: true });
    }

    if (method === "DELETE") {
      const result = await env.DB.prepare("DELETE FROM navigation WHERE id=?")
        .bind(id)
        .run();
      if (!result.meta?.changes) return json({ error: "导航不存在" }, 404);
      invalidatePublicCache(request, ctx);
      return json({ ok: true });
    }
  }

  if (path === "/api/admin/settings" && method === "GET") {
    const result = await env.DB.prepare("SELECT key,value FROM settings").all();
    return json({
      settings: Object.fromEntries(result.results.map((x) => [x.key, x.value])),
    });
  }

  if (path === "/api/admin/settings" && method === "PUT") {
    const data = await body(request);
    const statements = [];
    for (const key of ALLOWED_SETTINGS) {
      if (!(key in data)) continue;
      const value = validateSetting(key, data[key]);
      if (value === null) return json({ error: `设置 ${key} 的值无效` }, 400);
      statements.push(env.DB.prepare(
        `INSERT INTO settings(key,value) VALUES(?,?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`
      ).bind(key, value));
    }
    if (statements.length) await env.DB.batch(statements);
    invalidatePublicCache(request, ctx);
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}

async function handleRedirect(request, env, ctx, code) {
  await ensureDatabase(env);
  if (!CODE_RE.test(code)) return null;
  let link = null;

  if (redirectCacheAvailable()) {
    try {
      const cached = await caches.default.match(redirectCacheKey(request, code));
      if (cached) link = await cached.json();
    } catch (error) {
      console.error("Redirect cache read failed", error);
    }
  }

  if (!link) {
    link = await env.DB.prepare(
      "SELECT id,code,url FROM links WHERE code=? AND enabled=1"
    ).bind(code).first();
    if (!link) return null;

    if (redirectCacheAvailable()) {
      try {
        const response = json(link, 200, { "cache-control": REDIRECT_CACHE_CONTROL });
        const put = caches.default.put(redirectCacheKey(request, code), response);
        if (ctx?.waitUntil) ctx.waitUntil(put);
      } catch (error) {
        console.error("Redirect cache write failed", error);
      }
    }
  }

  const timestamp = now();
  const day = timestamp.slice(0, 10);
  waitUntil(ctx, env.DB.batch([
    env.DB.prepare("UPDATE links SET clicks=clicks+1,last_clicked_at=? WHERE id=?").bind(timestamp, link.id),
    env.DB.prepare(`INSERT INTO link_daily_stats(link_id,day,clicks) VALUES(?,?,1)
      ON CONFLICT(link_id,day) DO UPDATE SET clicks=link_daily_stats.clicks+1`).bind(link.id, day),
  ]).catch((error) => console.error("Click analytics write failed", error)));
  return Response.redirect(link.url, 302);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const parts = routeParts(url.pathname);

    try {
      if (parts[0] === "api") return await handleApi(request, env, ctx, parts);

      // 显式将 /admin 映射到管理后台页面，这里显式映射到 admin.html。
      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        const adminUrl = new URL("/admin.html", url);
        const adminRequest = new Request(adminUrl.toString(), {
          method: "GET",
          headers: request.headers,
        });
        const adminResponse = await env.ASSETS.fetch(adminRequest);
        const adminHeaders = new Headers(adminResponse.headers);
        Object.entries(SECURITY_HEADERS).forEach(([key, value]) => adminHeaders.set(key, value));
        adminHeaders.set("cache-control", "no-store");
        return new Response(adminResponse.body, {
          status: adminResponse.status,
          statusText: adminResponse.statusText,
          headers: adminHeaders,
        });
      }

      if (parts.length === 1 && parts[0] && parts[0] !== "admin.html") {
        const redirect = await handleRedirect(request, env, ctx, parts[0]);
        if (redirect) return redirect;
      }

      const assetResponse = await env.ASSETS.fetch(request);
      const headers = new Headers(assetResponse.headers);
      Object.entries(SECURITY_HEADERS).forEach(([key, value]) => headers.set(key, value));
      if (url.pathname === "/admin.html") headers.set("cache-control", "no-store");
      return new Response(assetResponse.body, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
    } catch (error) {
      if (error instanceof RequestError) {
        return json({ error: error.message }, error.status);
      }
      console.error("Unhandled request error", error);
      return json({ error: "服务器内部错误，请稍后重试" }, 500);
    }
  },
};
