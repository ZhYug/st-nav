
const VERSION = "1.1.7";
const SESSION_COOKIE = "__Host-stnav_session";
const SESSION_TTL = 86400;
const PUBLIC_CACHE_CONTROL = "public, max-age=0, s-maxage=30, stale-while-revalidate=60";
const databaseReady = new WeakMap();
const REQUIRED_TABLES = ["links", "link_daily_stats", "navigation", "settings"];

async function ensureDatabase(env) {
  if (!env.DB) {
    throw new Error("D1 数据库绑定 DB 不存在，请检查 Cloudflare 部署配置。");
  }

  let promise = databaseReady.get(env);
  if (!promise) {
    promise = (async () => {
      const result = await env.DB
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name IN (?, ?, ?, ?)
        `)
        .bind(...REQUIRED_TABLES)
        .all();

      const existing = new Set((result.results ?? []).map((row) => row.name));
      const missing = REQUIRED_TABLES.filter((name) => !existing.has(name));

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

function faviconUrl(value) {
  try {
    const hostname = new URL(String(value)).hostname.toLowerCase();
    if (!hostname) return "";
    // DuckDuckGo favicon endpoint should be kept in its canonical form.
    // Do not append cache-busting query parameters such as ?v=timestamp.
    return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(hostname)}.ico`;
  } catch {
    return "";
  }
}

function clean(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
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

async function sessionToken(secret) {
  const iat = Date.now();
  const payload = base64urlEncode(JSON.stringify({ exp: iat + SESSION_TTL * 1000, iat }));
  return `${payload}.${await hmac(secret, payload)}`;
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

async function isAuthed(request, env) {
  const secret = sessionSecret(env);
  if (!secret) return false;
  const token = getCookie(request, SESSION_COOKIE);
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  try {
    const data = JSON.parse(base64urlDecode(payload));
    if (!data.exp || data.exp < Date.now()) return false;
    const signatureBytes = Uint8Array.from(
      base64urlDecode(signature),
      (char) => char.charCodeAt(0)
    );
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    return await crypto.subtle.verify(
      { name: "HMAC" }, key, signatureBytes, new TextEncoder().encode(payload)
    );
  } catch {
    return false;
  }
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

async function body(request) {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_JSON_BODY_BYTES) {
    throw new RequestError("请求体过大", 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
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

function cacheAvailable() {
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
  if (!code || !cacheAvailable()) return;
  waitUntil(ctx, caches.default.delete(redirectCacheKey(request, code)));
}

function invalidatePublicCache(request, ctx) {
  if (!cacheAvailable()) return;
  const key = publicCacheKey(request);
  waitUntil(ctx, caches.default.delete(key));
}

async function getPublicBootstrap(env) {
  const results = await env.DB.batch([
    env.DB.prepare(`SELECT navigation.id,navigation.title,navigation.description,navigation.url,
                           navigation.icon,navigation.category,navigation.sort_order,navigation.enabled,
                           navigation.link_id,links.code,links.url AS link_url
                    FROM navigation
                    LEFT JOIN links ON navigation.link_id=links.id
                    WHERE navigation.enabled=1 AND (navigation.link_id IS NULL OR links.enabled=1)
                    ORDER BY navigation.sort_order,navigation.id`),
    env.DB.prepare("SELECT key,value FROM settings"),
  ]);
  return { items: results[0].results, settings: Object.fromEntries(results[1].results.map((row) => [row.key, row.value])) };
}

function publicPayload(data, request) {
  const origin = new URL(request.url).origin;
  return {
    items: data.items.map((item) => ({
      ...item,
      target_url: item.link_url || item.url,
      ...(item.code ? { short_url: `${origin}/${item.code}` } : {}),
    })),
    settings: data.settings,
  };
}

function cachePut(cache, key, response, ctx) {
  try {
    const put = cache.put(key, response.clone());
    if (ctx?.waitUntil) ctx.waitUntil(put);
    else put.catch((error) => console.error("Cache write failed", error));
  } catch (error) {
    console.error("Cache write failed", error);
  }
}

async function cachedPublicBootstrap(request, env, ctx) {
  if (!cacheAvailable()) return json(publicPayload(await getPublicBootstrap(env), request));

  const cache = caches.default;
  const key = publicCacheKey(request);
  const cached = await cache.match(key);
  if (cached) return cached;

  const response = json(publicPayload(await getPublicBootstrap(env), request), 200, {
    "cache-control": PUBLIC_CACHE_CONTROL,
  });
  cachePut(cache, key, response, ctx);
  return response;
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

async function handleApi(request, env, ctx, parts) {
  const method = request.method.toUpperCase();
  const path = "/" + parts.join("/");

  const noDatabase = new Set(["/api/auth/login", "/api/auth/logout", "/api/auth/me", "/api/health"]);
  if (!noDatabase.has(path)) await ensureDatabase(env);

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
    const token = await sessionToken(sessionSecret(env));
    return json({ ok: true }, 200, { "Set-Cookie": cookie(SESSION_COOKIE, token) });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    if (!sameOrigin(request)) return json({ error: "非法来源" }, 403);
    return json(
      { ok: true },
      200,
      { "Set-Cookie": cookie(SESSION_COOKIE, "", 0) }
    );
  }

  if (path === "/api/auth/me" && method === "GET") {
    return json({ authenticated: await isAuthed(request, env) });
  }

  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, version: VERSION, database: Boolean(env.DB), session_secret: Boolean(env.SESSION_SECRET) });
  }

  if (path === "/api/public/bootstrap" && method === "GET") {
    return cachedPublicBootstrap(request, env, ctx);
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
      env.DB.prepare("SELECT * FROM links ORDER BY created_at DESC,id DESC"),
      env.DB.prepare(`SELECT
        navigation.id,navigation.title,navigation.description,navigation.url,navigation.icon,
        navigation.category,navigation.sort_order,navigation.enabled,navigation.created_at,
        navigation.updated_at,navigation.link_id,links.code,links.url AS link_url,links.title AS link_title,
        links.description AS link_description,links.category AS link_category,
        links.enabled AS link_enabled
       FROM navigation
       LEFT JOIN links ON navigation.link_id = links.id
       ORDER BY navigation.sort_order,navigation.id`),
      env.DB.prepare("SELECT key,value FROM settings"),
    ]);

    const origin = new URL(request.url).origin;
    const links = results[3].results.map((item) => ({
      ...item,
      short_url: item.code ? `${origin}/${item.code}` : "",
    }));
    const nav = results[4].results.map((item) => ({
      ...item,
      short_url: item.code ? `${origin}/${item.code}` : "",
      url: item.code ? `${origin}/${item.code}` : item.url,
    }));
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
      links,
      navigation: nav,
      settings: Object.fromEntries(results[5].results.map((x) => [x.key, x.value])),
    });
  }

  
  if (path === "/api/admin/links/bulk" && method === "POST") {
    const data = await body(request);
    const allowedActions = new Set(["add_navigation", "enable", "disable", "delete"]);
    const action = String(data.action || "");
    if (!allowedActions.has(action)) {
      return json({ error: "批量操作类型无效" }, 400);
    }

    if (!Array.isArray(data.ids) || !data.ids.length) {
      return json({ error: "请至少选择一个短链接" }, 400);
    }

    const ids = [...new Set(data.ids.map(Number))];
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      return json({ error: "短链接 ID 无效" }, 400);
    }
    if (ids.length > 2000) {
      return json({ error: "单次最多处理 2000 个短链接，请分批操作" }, 400);
    }

    const placeholders = (count) => Array.from({ length: count }, () => "?").join(",");
    const chunks = (list, size) => {
      const result = [];
      for (let i = 0; i < list.length; i += size) result.push(list.slice(i, i + size));
      return result;
    };

    if (action === "add_navigation") {
      // One INSERT...SELECT keeps the operation efficient for large selections and
      // the UNIQUE(link_id) index makes repeated "add to navigation" idempotent.
      let affected = 0;
      for (const chunk of chunks(ids, 90)) {
        const marks = placeholders(chunk.length);
        const origin = new URL(request.url).origin;
        // Fetch selected links once, then insert them in bounded D1 batches.
        const selected = await env.DB.prepare(
          `SELECT id,code,title,description,url,category,enabled
           FROM links WHERE id IN (${marks})`
        ).bind(...chunk).all();

        if (!selected.results.length) continue;
        const existing = await env.DB.prepare(
          `SELECT link_id FROM navigation WHERE link_id IN (${marks})`
        ).bind(...chunk).all();
        const existingIds = new Set(existing.results.map((row) => Number(row.link_id)));
        const pending = selected.results.filter((row) => !existingIds.has(Number(row.id)));
        if (!pending.length) continue;

        for (const pendingBatch of chunks(pending, 90)) {
          const maxResult = await env.DB.prepare(
            "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM navigation"
          ).first();
          const baseOrder = Number(maxResult?.max_order ?? -1);
          const statements = pendingBatch.map((link, index) =>
            env.DB.prepare(
              `INSERT INTO navigation
               (link_id,title,description,url,icon,category,sort_order,enabled,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?)`
            ).bind(
              Number(link.id),
              clean(link.title, 120) || clean(link.code, 120),
              clean(link.description, 500),
              `${origin}/${link.code}`,
              faviconUrl(link.url),
              clean(link.category, 80),
              baseOrder + index + 1,
              Number(link.enabled) ? 1 : 0,
              now()
            )
          );
          const results = await env.DB.batch(statements);
          affected += results.filter((result) => Number(result.meta?.changes || 0) > 0).length;
        }
      }
      invalidatePublicCache(request, ctx);
      return json({ ok: true, affected, failed: ids.length - affected });
    }

    let affected = 0;
    const deletedCodes = [];
    for (const chunk of chunks(ids, 90)) {
      const marks = placeholders(chunk.length);
      const timestamp = now();

      if (action === "delete") {
        const rows = await env.DB.prepare(
          `SELECT code FROM links WHERE id IN (${marks})`
        ).bind(...chunk).all();
        deletedCodes.push(...rows.results.map((row) => row.code));
        const result = await env.DB.prepare(
          `DELETE FROM links WHERE id IN (${marks})`
        ).bind(...chunk).run();
        affected += Number(result.meta?.changes || 0);
        continue;
      }

      const enabled = action === "enable" ? 1 : 0;
      const results = await env.DB.batch([
        env.DB.prepare(
          `UPDATE links SET enabled=?,updated_at=? WHERE id IN (${marks})`
        ).bind(enabled, timestamp, ...chunk),
        env.DB.prepare(
          `UPDATE navigation SET enabled=?,updated_at=? WHERE link_id IN (${marks})`
        ).bind(enabled, timestamp, ...chunk),
      ]);
      affected += Number(results[0]?.meta?.changes || 0);
    }

    invalidatePublicCache(request, ctx);
    if (action === "delete") {
      for (const code of deletedCodes) invalidateRedirectCache(request, ctx, code);
    }
    return json({ ok: true, affected, failed: ids.length - affected });
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
             SET title=?,description=?,category=?,icon=?,enabled=?,updated_at=?
             WHERE link_id=?`
          ).bind(
            clean(data.title, 200),
            clean(data.description, 500),
            clean(data.category, 80),
            faviconUrl(url),
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

  if (path === "/api/admin/navigation" && method === "POST") {
    const data = await body(request);

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

      const icon = faviconUrl(link.url);

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

    const title = clean(data.title, 120);
    const url = clean(data.url, 2000);

    if (!title || !validUrl(url)) {
      return json({ error: "标题和有效 URL 必填" }, 400);
    }

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
        clean(data.icon, 1000),
        clean(data.category, 80),
        data.enabled === false ? 0 : 1,
        now()
      )
      .run();

    invalidatePublicCache(request, ctx);
    return json({ ok: true });
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

      if (current.link_id) {
        return json({ error: "此导航已关联短链接，请在「短链接」中编辑内容" }, 409);
      }

      const title = clean(data.title, 120);
      const url = clean(data.url, 2000);
      if (!title || !validUrl(url)) return json({ error: "标题和有效 URL 必填" }, 400);

      const result = await env.DB.prepare(
        `UPDATE navigation SET title=?,description=?,url=?,icon=?,category=?,enabled=?,updated_at=?
         WHERE id=?`
      )
        .bind(
          title,
          clean(data.description, 500),
          url,
          clean(data.icon, 1000),
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

  if (path === "/api/admin/settings" && method === "PUT") {
    const data = await body(request);
    const statements = ALLOWED_SETTINGS
      .filter((key) => key in data)
      .map((key) =>
        env.DB.prepare(
          `INSERT INTO settings(key,value) VALUES(?,?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value`
        ).bind(key, clean(data[key], 500))
      );

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

  if (cacheAvailable()) {
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

    if (cacheAvailable()) {
      try {
        const response = json(link, 200, { "cache-control": PUBLIC_CACHE_CONTROL });
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
