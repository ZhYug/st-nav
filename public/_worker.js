
const DATABASE_SCHEMA = "-- Shortlink Nav v4 - clean database schema\n-- Stable v4 schema. Idempotent: safe to execute repeatedly.\n-- The Worker embeds this schema and initializes missing objects automatically.\n\nPRAGMA foreign_keys = ON;\n\n-- Short links: the canonical destination is always stored in url.\nCREATE TABLE IF NOT EXISTS links (\n  id INTEGER PRIMARY KEY,\n  code TEXT NOT NULL UNIQUE COLLATE BINARY,\n  url TEXT NOT NULL,\n  title TEXT,\n  description TEXT,\n  category TEXT,\n  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),\n  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),\n  last_clicked_at TEXT,\n  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n);\n\n-- The UNIQUE constraint on code already provides the lookup index.\nCREATE INDEX IF NOT EXISTS idx_links_enabled ON links(enabled);\nCREATE INDEX IF NOT EXISTS idx_links_clicks ON links(clicks DESC);\nCREATE INDEX IF NOT EXISTS idx_links_created_at ON links(created_at DESC, id DESC);\n\n-- Optional raw visit history. Keep this table small in high-traffic deployments;\n-- daily analytics below is the primary reporting table.\nCREATE TABLE IF NOT EXISTS link_visits (\n  id INTEGER PRIMARY KEY,\n  link_id INTEGER NOT NULL,\n  visited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE\n);\nCREATE INDEX IF NOT EXISTS idx_link_visits_link_date ON link_visits(link_id, visited_at);\nCREATE INDEX IF NOT EXISTS idx_link_visits_date ON link_visits(visited_at);\n\n-- One row per link/day. This is the preferred analytics source.\nCREATE TABLE IF NOT EXISTS link_daily_stats (\n  link_id INTEGER NOT NULL,\n  day TEXT NOT NULL,\n  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),\n  PRIMARY KEY (link_id, day),\n  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE\n);\nCREATE INDEX IF NOT EXISTS idx_link_daily_stats_day ON link_daily_stats(day);\n\n-- Navigation entries can either be normal URLs or a projection of a short link.\n-- When link_id is set, the Worker treats the short link as the source of truth.\nCREATE TABLE IF NOT EXISTS navigation (\n  id INTEGER PRIMARY KEY,\n  title TEXT NOT NULL,\n  description TEXT,\n  url TEXT NOT NULL,\n  icon TEXT,\n  category TEXT,\n  sort_order INTEGER NOT NULL DEFAULT 0,\n  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),\n  link_id INTEGER,\n  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE\n);\nCREATE INDEX IF NOT EXISTS idx_navigation_enabled_order ON navigation(enabled, sort_order, id);\nCREATE INDEX IF NOT EXISTS idx_navigation_link_id ON navigation(link_id);\nCREATE UNIQUE INDEX IF NOT EXISTS idx_navigation_link_unique\n  ON navigation(link_id)\n  WHERE link_id IS NOT NULL;\n\n-- Site configuration. Key/value keeps deployment and future additions simple.\nCREATE TABLE IF NOT EXISTS settings (\n  key TEXT PRIMARY KEY,\n  value TEXT NOT NULL\n);\n\n-- Safe defaults for a brand-new deployment.\nINSERT OR IGNORE INTO settings(key, value) VALUES\n  ('site_title', 'My Navigation'),\n  ('site_subtitle', 'Personal navigation & short links'),\n  ('site_description', 'Everything you need, one click away.'),\n  ('hero_title', 'Everything you need, one click away.'),\n  ('hero_description', 'A fast, elegant home for your frequently used websites.'),\n  ('accent', '#8b6cff'),\n  ('nav_tag_style', 'pills'),\n  ('nav_columns_mobile', '2'),\n  ('nav_columns_tablet', '3'),\n  ('nav_columns_desktop', '4'),\n  ('nav_columns_wide', '6'),\n  ('nav_category_order', ''),\n  ('nav_hidden_categories', '');\n\n-- Starter navigation. Delete these rows from the admin panel if not needed.\nINSERT INTO navigation(title, description, url, icon, category, sort_order, enabled)\nSELECT 'GitHub', '代码仓库与开源项目', 'https://github.com', '', '开发', 0, 1\nWHERE NOT EXISTS (SELECT 1 FROM navigation);\n\nINSERT INTO navigation(title, description, url, icon, category, sort_order, enabled)\nSELECT 'Google', '搜索与常用服务', 'https://www.google.com', '', '工具', 1, 1\nWHERE (SELECT COUNT(*) FROM navigation) = 1;\n\nINSERT INTO navigation(title, description, url, icon, category, sort_order, enabled)\nSELECT 'Cloudflare', '网络与边缘服务', 'https://dash.cloudflare.com', '', '开发', 2, 1\nWHERE (SELECT COUNT(*) FROM navigation) = 2;\n\nINSERT INTO navigation(title, description, url, icon, category, sort_order, enabled)\nSELECT 'ChatGPT', 'AI 助手', 'https://chatgpt.com', '', 'AI', 3, 1\nWHERE (SELECT COUNT(*) FROM navigation) = 3;\n";

let databaseReadyPromise;

async function ensureDatabase(env) {
  if (!env.DB) throw new Error("D1 数据库绑定 DB 不存在，请检查 Cloudflare 部署配置。");
  if (!databaseReadyPromise) {
    databaseReadyPromise = env.DB.exec(DATABASE_SCHEMA).catch((error) => {
      databaseReadyPromise = undefined;
      throw error;
    });
  }
  await databaseReadyPromise;
}

const JSON_HEADERS = {
  "content-type": "application/json;charset=UTF-8",
  "cache-control": "no-store",
};

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
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
  const values = new Uint32Array(n);
  crypto.getRandomValues(values);
  for (let i = 0; i < n; i++) s += b62[values[i] % b62.length];
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

function cookie(name, value, maxAge = 86400) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
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
  const payload = base64urlEncode(
    JSON.stringify({ exp: Date.now() + 86400000, iat: Date.now() })
  );
  return `${payload}.${await hmac(secret, payload)}`;
}

function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] || "";
}

async function isAuthed(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const token = getCookie(request, "sln_session");
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  try {
    const data = JSON.parse(base64urlDecode(payload));
    if (!data.exp || data.exp < Date.now()) return false;
    const expected = await hmac(env.ADMIN_PASSWORD, payload);
    return expected === signature;
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

async function body(request) {
  return await request.json().catch(() => ({}));
}

function routeParts(path) {
  return path.split("/").filter(Boolean);
}

const PUBLIC_CACHE_PATH = "/api/public/bootstrap";
const PUBLIC_CACHE_CONTROL = "public, max-age=0, s-maxage=30, stale-while-revalidate=60";

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

function invalidateRedirectCache(request, ctx, code) {
  if (!code || !ctx?.waitUntil || !redirectCacheAvailable()) return;
  ctx.waitUntil(caches.default.delete(redirectCacheKey(request, code)));
}

async function invalidatePublicCache(request, ctx) {
  if (!ctx?.waitUntil || typeof caches === "undefined" || !caches.default) return;
  const key = publicCacheKey(request);
  ctx.waitUntil(caches.default.delete(key));
}

async function getPublicBootstrap(env) {
  const results = await env.DB.batch([
    env.DB.prepare(
      `SELECT navigation.id,navigation.title,navigation.description,navigation.url,
              navigation.icon,navigation.category,navigation.sort_order,navigation.enabled,
              navigation.link_id,links.code
       FROM navigation
       LEFT JOIN links ON navigation.link_id = links.id
       WHERE navigation.enabled=1
       ORDER BY navigation.sort_order,navigation.id`
    ),
    env.DB.prepare("SELECT key,value FROM settings"),
  ]);

  return {
    items: results[0].results,
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

async function handleApi(request, env, ctx, parts) {
  await ensureDatabase(env);
  const method = request.method.toUpperCase();
  const path = "/" + parts.join("/");

  if (path === "/api/auth/login" && method === "POST") {
    if (!sameOrigin(request)) return json({ error: "非法来源" }, 403);
    if (!env.ADMIN_PASSWORD || String(env.ADMIN_PASSWORD).length < 10) {
      return json({ error: "服务器尚未配置有效的管理员密码（至少 10 位）" }, 500);
    }
    const data = await body(request);
    if (String(data.password ?? "") !== String(env.ADMIN_PASSWORD)) {
      return json({ error: "密码错误" }, 401);
    }
    const token = await sessionToken(env.ADMIN_PASSWORD);
    return json(
      { ok: true },
      200,
      { "Set-Cookie": cookie("sln_session", token) }
    );
  }

  if (path === "/api/auth/logout" && method === "POST") {
    if (!sameOrigin(request)) return json({ error: "非法来源" }, 403);
    return json(
      { ok: true },
      200,
      { "Set-Cookie": cookie("sln_session", "", 0) }
    );
  }

  if (path === "/api/auth/me" && method === "GET") {
    return json({ authenticated: await isAuthed(request, env) });
  }

  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, version: "1.0.0", database: true });
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
      env.DB.prepare("SELECT * FROM links ORDER BY created_at DESC,id DESC"),
      env.DB.prepare(`SELECT
        navigation.id,navigation.title,navigation.description,navigation.url,navigation.icon,
        navigation.category,navigation.sort_order,navigation.enabled,navigation.created_at,
        navigation.updated_at,navigation.link_id,links.code,links.title AS link_title,
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

  if (path === "/api/admin/links" && method === "GET") {
    const result = await env.DB.prepare(
      "SELECT * FROM links ORDER BY created_at DESC,id DESC"
    ).all();
    const origin = new URL(request.url).origin;
    const items = result.results.map((item) => ({
      ...item,
      short_url: item.code ? `${origin}/${item.code}` : "",
    }));

    return json({ items });
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
    const result = await env.DB.prepare(
      `SELECT
        navigation.id,navigation.title,navigation.description,navigation.url,navigation.icon,
        navigation.category,navigation.sort_order,navigation.enabled,navigation.created_at,
        navigation.updated_at,navigation.link_id,
        links.code,
        links.title AS link_title,
        links.description AS link_description,
        links.category AS link_category,
        links.enabled AS link_enabled
       FROM navigation
       LEFT JOIN links ON navigation.link_id = links.id
       ORDER BY navigation.sort_order,navigation.id`
    ).all();
    const origin = new URL(request.url).origin;
    const items = result.results.map((item) => ({
      ...item,
      short_url: item.code ? `${origin}/${item.code}` : "",
      // 对关联短链接的导航，url 是实际可点击的短链接地址；
      // 手动导航则保留数据库中的目标 URL。
      url: item.code ? `${origin}/${item.code}` : item.url,
    }));

    return json({ items });
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

      const icon =
        "https://icons.duckduckgo.com/ip3/" +
        encodeURIComponent(new URL(link.url).hostname) +
        ".ico";

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

      // 关联短链接的导航是短链接的只读投影，避免把短链接 URL 当成真实目标 URL 写回 links。
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

  if (path === "/api/admin/settings" && method === "GET") {
    const result = await env.DB.prepare("SELECT key,value FROM settings").all();
    return json({
      settings: Object.fromEntries(result.results.map((x) => [x.key, x.value])),
    });
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
        const response = json(link, 200, { "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" });
        const put = caches.default.put(redirectCacheKey(request, code), response);
        if (ctx?.waitUntil) ctx.waitUntil(put);
      } catch (error) {
        console.error("Redirect cache write failed", error);
      }
    }
  }

  const timestamp = now();
  const day = timestamp.slice(0, 10);
  ctx.waitUntil(
    env.DB.batch([
      env.DB.prepare("UPDATE links SET clicks=clicks+1,last_clicked_at=? WHERE id=?").bind(timestamp, link.id),
      env.DB.prepare(`INSERT INTO link_daily_stats(link_id,day,clicks) VALUES(?,?,1)
        ON CONFLICT(link_id,day) DO UPDATE SET clicks=link_daily_stats.clicks+1`).bind(link.id, day),
    ]).catch((error) => console.error("Click analytics write failed", error))
  );
  return Response.redirect(link.url, 302);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const parts = routeParts(url.pathname);

    try {
      if (parts[0] === "api") return await handleApi(request, env, ctx, parts);

      // 显式将 /admin 映射到管理后台页面，这里显式映射到 admin.html。
      if (
  url.pathname === "/admin" ||
  url.pathname === "/admin/"
) {
  const adminUrl = new URL("/admin.html", url);
  const adminRequest = new Request(adminUrl.toString(), {
    method: "GET",
    headers: request.headers,
  });

  return env.ASSETS.fetch(adminRequest);
}

      if (
  parts.length === 1 &&
  parts[0] &&
  parts[0] !== "admin.html"
) {
  const redirect =
    await handleRedirect(
      request,
      env,
      ctx,
      parts[0]
    );

  if (redirect) return redirect;
}

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: error?.message || "Server error" }, 500);
    }
  },
};
