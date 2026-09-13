# ST Nav

一个基于 **Cloudflare Pages Advanced Mode + D1** 的轻量级个人导航与短链接服务。

> **当前版本：1.0.3**
>
> 这一版本专门整理为 Cloudflare Pages Advanced Mode 部署形态：使用 `public/_worker.js` 接管请求，D1 作为数据库，静态页面与 Worker 同源部署，并保留 v1.1 优化中的安全与性能改进。

## ✨ 项目特点

- 🔗 短链接：创建、编辑、删除、跳转
- 🧭 导航站：分类、收藏、排序、图标、描述
- 🔀 导航项可直接关联短链接，避免重复维护目标地址
- 📊 点击统计：总点击量与按日统计
- 🔐 管理后台：密码登录、签名会话与登录限流
- 📥 CSV 导入 / 📤 CSV 导出
- ⚡ Bootstrap 与 Redirect 使用 Cache API 降低 D1 读取压力
- 🚀 Cloudflare Pages Advanced Mode，Worker 与静态资源同源部署
- 🗄️ D1 migrations + 一次性运行时 bootstrap 兼容旧版数据库
- 🛡️ 基础安全响应头与 `__Host-` Session Cookie

## 🏗️ 部署架构

```text
GitHub
  │
  ▼
Cloudflare Pages
  │
  ├── Build: npm run build
  │       └── src/worker.js → public/_worker.js
  │
  ├── Pages Advanced Mode
  │       └── _worker.js 接管所有请求
  │
  └── D1
        └── DB binding
```

Cloudflare Pages Advanced Mode 要求 `_worker.js` 位于 Pages 的输出目录，并由 Worker 自己通过 `env.ASSETS.fetch(request)` 处理静态资源。本项目的 `npm run build` 会自动把 `src/worker.js` 复制成 `public/_worker.js`；`public/.assetsignore` 则确保 `_worker.js` 不会被当作普通静态文件上传。

## 🚀 推荐部署：GitHub → Cloudflare Pages

### 1. 把项目上传到 GitHub

将整个项目提交到 GitHub，例如：

```text
st-nav/
├── src/
│   └── worker.js
├── public/
│   ├── index.html
│   ├── admin.html
│   ├── .assetsignore
│   └── assets/
├── migrations/
│   └── 0001_initial.sql
├── scripts/
│   ├── doctor.mjs
│   └── pages-build.mjs
├── .dev.vars.example
├── .nvmrc
├── package.json
└── wrangler.toml
```

### 2. 创建 Cloudflare Pages 项目

在 Cloudflare Dashboard 中进入 **Workers & Pages → Create application → Pages → Connect to Git**，选择 GitHub 仓库。

推荐填写：

```text
Production branch: main
Root directory: /
Build command: npm run build
Build output directory: public
Node.js version: 22
```

本项目没有前端框架，不需要 Vite、Next.js 或其他额外构建工具。Build 的唯一任务就是生成 `public/_worker.js`。

### 3. 配置 D1

Pages 项目需要绑定 D1：

```text
Workers & Pages
  → 你的 Pages 项目
  → Settings
  → Bindings
  → Add
  → D1 database bindings
```

绑定名称必须是：

```text
DB
```

并选择你的 `st-nav` D1 数据库。

生产环境和 Preview 环境建议分别使用不同 D1 数据库，避免 Preview 测试数据写入生产库。

### 4. 配置 Secrets

在 Pages 项目的生产环境 Variables / Secrets 中设置：

```text
ADMIN_PASSWORD = 至少 16 位的随机强密码
SESSION_SECRET = 至少 32 个字符的随机高熵 Secret
```

`SESSION_SECRET` 是推荐配置；如果不设置，代码会为了兼容旧部署回退使用 `ADMIN_PASSWORD` 作为 Session 签名密钥。

不要把真实密码或 Secret 写入 GitHub，也不要提交 `.dev.vars`。

### 5. 首次部署数据库 Migration

GitHub → Pages 的自动构建只负责发布代码，不建议把生产 D1 migration 偷塞进每次构建。

第一次部署或数据库结构升级时，在本地执行：

```bash
npm install
npm run db:migrate:remote
```

然后让 GitHub push 触发 Pages 部署。

如果是已经存在的 v1.0.x 数据库，`0001_initial.sql` 使用 `IF NOT EXISTS`，Worker 也保留运行时 bootstrap 兼容逻辑；不会主动删除现有业务数据。旧版遗留的 `link_visits` 表不会被删除。

以后新增数据库结构时继续创建：

```text
migrations/0002_xxx.sql
migrations/0003_xxx.sql
```

不要修改已经发布的 migration。

## 🧪 本地开发

安装依赖：

```bash
npm install
```

准备开发变量：

```bash
cp .dev.vars.example .dev.vars
```

至少设置：

```env
ADMIN_PASSWORD="change-this-to-a-strong-password"
```

生产环境建议额外设置：

```env
SESSION_SECRET="random-high-entropy-secret"
```

初始化本地 D1：

```bash
npm run db:migrate:local
```

启动 Pages 本地环境：

```bash
npm run dev
```

也可以先检查项目结构：

```bash
npm run doctor
```

## 📦 CLI 部署（可选）

如果你不想使用 GitHub 自动部署，也可以直接使用 Wrangler：

```bash
npm install
npm run build
npm run db:migrate:remote
npm run deploy
```

`npm run deploy` 实际执行的是：

```bash
wrangler pages deploy public
```

这种方式仍然是 **Cloudflare Pages**，不是 `wrangler deploy` 的普通 Workers 部署。

## 🔐 认证与安全

### Secret

```env
ADMIN_PASSWORD="your-strong-admin-password"
SESSION_SECRET="random-high-entropy-secret"
```

- `ADMIN_PASSWORD` 只用于管理员密码验证。
- `SESSION_SECRET` 用于签名 Session。
- Session Cookie 使用 `__Host-stnav_session`、`Secure`、`HttpOnly`、`SameSite=Strict`。
- 登录失败在单个 Worker isolate 内做 5 分钟 / 5 次的 best-effort 限流。
- 高安全要求的公网部署仍建议在 Cloudflare WAF / Rate Limiting 层对 `/api/auth/login` 增加边缘限流。

注意：Worker 内存限流不是全局一致的安全边界；真正的公网防护应交给 Cloudflare 边缘规则。

## 🗄️ D1 Migration

项目当前包含：

```text
migrations/
└── 0001_initial.sql
```

运行远程 migration：

```bash
npm run db:migrate:remote
```

运行本地 migration：

```bash
npm run db:migrate:local
```

运行时仍会检查：

```sql
PRAGMA user_version
```

只有发现数据库版本低于 1 时才执行兼容 bootstrap，因此旧版一键部署数据库仍能平滑启动。

## ⚡ 性能策略

### 首页

```text
Browser
  ↓
/api/public/bootstrap
  ↓
Cache API
  ↓ cache miss
D1 batch
```

导航与 settings 合并为一次查询，缓存 TTL 为约 30 秒，并带 `stale-while-revalidate`。

### 短链接

```text
GET /abc123
      ↓
Edge Cache
      ↓ cache miss
D1
      ↓
302 Redirect
      │
      └── waitUntil → daily analytics
```

点击统计不会阻塞用户跳转。

v1.0.3 不再写入新的 `link_visits` 原始访问记录，核心统计使用：

```text
links.clicks
link_daily_stats
```

## 🧩 数据模型

| 表 | 用途 |
|---|---|
| `links` | 短链接及目标 URL |
| `navigation` | 导航条目、排序与短链接关联 |
| `settings` | 网站配置 |
| `link_daily_stats` | 按天聚合的点击统计 |

核心规则：

- `links.url` 始终保存真实目标地址。
- `links.code` 始终保存短码。
- `short_url` 根据当前域名动态生成。
- `navigation.link_id` 存在时，以对应短链接作为数据源。
- `link_daily_stats` 是统计报表的主要来源。

## 📁 项目结构

```text
st-nav/
├── src/
│   └── worker.js
├── public/
│   ├── _worker.js          # npm run build 自动生成，Pages Advanced Mode 入口
│   ├── .assetsignore       # 排除 _worker.js，避免作为普通静态资产上传
│   ├── index.html
│   ├── admin.html
│   └── assets/
├── migrations/
│   └── 0001_initial.sql
├── scripts/
│   ├── pages-build.mjs
│   └── doctor.mjs
├── .dev.vars.example
├── .nvmrc
├── package.json
└── wrangler.toml
```

Worker 仍然保持单文件 Module Worker 运行时入口。Pages Advanced Mode 使用 `public/_worker.js` 接管请求；Worker 中通过 `env.ASSETS.fetch(request)` 返回 HTML、CSS、JS、favicon 等静态资源。

## 📦 从旧版升级到 1.0.3

如果你之前运行的是旧版 Workers / Workers Static Assets 部署，建议按下面步骤迁移：

1. 保留原来的 D1 数据库。
2. 将本项目推送到 GitHub。
3. 在 Cloudflare 创建 Pages 项目并连接 GitHub。
4. 设置 Build command：`npm run build`。
5. 设置 Build output directory：`public`。
6. 绑定原来的 D1 到 `DB`。
7. 配置 `ADMIN_PASSWORD` 和推荐的 `SESSION_SECRET`。
8. 首次切换前执行 `npm run db:migrate:remote`。
9. Push / Merge 到 `main`，让 Pages 自动部署。
10. 确认首页、`/admin`、`/api/health` 和短链接跳转均正常后，再停用旧 Worker。

不要同时让旧 Worker 和 Pages 使用同一个短链接域名，否则 DNS / 路由会造成访问入口混乱。

## 📌 生产建议

对于个人导航站、短链接以及中小规模访问量，推荐：

```text
Cloudflare Pages Advanced Mode
          +
Cloudflare D1
          +
Cache API
          +
Cloudflare WAF / Rate Limiting
```

目前没有必要引入 Docker、Nginx、Redis、Kubernetes 或独立 VPS。只有当统计需求、数据量或业务模型明显扩大时，再考虑把 Analytics 或后台数据服务拆出去。

## License

保持原项目许可证。
