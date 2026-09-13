-- Shortlink Nav v4 - clean database schema
-- Stable v4 schema. Idempotent: safe to execute repeatedly.
-- The Worker embeds this schema and initializes missing objects automatically.

PRAGMA foreign_keys = ON;

-- Short links: the canonical destination is always stored in url.
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE BINARY,
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  category TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  last_clicked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The UNIQUE constraint on code already provides the lookup index.
CREATE INDEX IF NOT EXISTS idx_links_enabled ON links(enabled);
CREATE INDEX IF NOT EXISTS idx_links_clicks ON links(clicks DESC);
CREATE INDEX IF NOT EXISTS idx_links_created_at ON links(created_at DESC, id DESC);

-- Optional raw visit history. Keep this table small in high-traffic deployments;
-- daily analytics below is the primary reporting table.
CREATE TABLE IF NOT EXISTS link_visits (
  id INTEGER PRIMARY KEY,
  link_id INTEGER NOT NULL,
  visited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_link_visits_link_date ON link_visits(link_id, visited_at);
CREATE INDEX IF NOT EXISTS idx_link_visits_date ON link_visits(visited_at);

-- One row per link/day. This is the preferred analytics source.
CREATE TABLE IF NOT EXISTS link_daily_stats (
  link_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  PRIMARY KEY (link_id, day),
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_link_daily_stats_day ON link_daily_stats(day);

-- Navigation entries can either be normal URLs or a projection of a short link.
-- When link_id is set, the Worker treats the short link as the source of truth.
CREATE TABLE IF NOT EXISTS navigation (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  icon TEXT,
  category TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  link_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_navigation_enabled_order ON navigation(enabled, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_navigation_link_id ON navigation(link_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_navigation_link_unique
  ON navigation(link_id)
  WHERE link_id IS NOT NULL;

-- Site configuration. Key/value keeps deployment and future additions simple.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Safe defaults for a brand-new deployment.
INSERT OR IGNORE INTO settings(key, value) VALUES
  ('site_title', 'My Navigation'),
  ('site_subtitle', 'Personal navigation & short links'),
  ('site_description', 'Everything you need, one click away.'),
  ('hero_title', 'Everything you need, one click away.'),
  ('hero_description', 'A fast, elegant home for your frequently used websites.'),
  ('accent', '#8b6cff'),
  ('nav_tag_style', 'pills'),
  ('nav_columns_mobile', '2'),
  ('nav_columns_tablet', '3'),
  ('nav_columns_desktop', '4'),
  ('nav_columns_wide', '6'),
  ('nav_category_order', ''),
  ('nav_hidden_categories', '');

-- Starter navigation. Delete these rows from the admin panel if not needed.
INSERT INTO navigation(title, description, url, icon, category, sort_order, enabled)
SELECT 'GitHub', '代码仓库与开源项目', 'https://github.com', '', '开发', 0, 1
WHERE NOT EXISTS (SELECT 1 FROM navigation);

INSERT INTO navigation(title, description, url, icon, category, sort_order, enabled)
SELECT 'Google', '搜索与常用服务', 'https://www.google.com', '', '工具', 1, 1
WHERE (SELECT COUNT(*) FROM navigation) = 1;

INSERT INTO navigation(title, description, url, icon, category, sort_order, enabled)
SELECT 'Cloudflare', '网络与边缘服务', 'https://dash.cloudflare.com', '', '开发', 2, 1
WHERE (SELECT COUNT(*) FROM navigation) = 2;

INSERT INTO navigation(title, description, url, icon, category, sort_order, enabled)
SELECT 'ChatGPT', 'AI 助手', 'https://chatgpt.com', '', 'AI', 3, 1
WHERE (SELECT COUNT(*) FROM navigation) = 3;
