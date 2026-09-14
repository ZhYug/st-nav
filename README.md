# ST Nav v1.1.0

轻量级个人导航 + 短链接服务，运行在 **Cloudflare Pages Advanced Mode + D1**。

## 1. 项目结构

```text
st-nav/
├── public/
│   ├── _worker.js          # Pages Advanced Mode 唯一 Worker 入口
│   ├── index.html
│   ├── admin.html
│   ├── .assetsignore
│   └── assets/
├── migrations/
│   └── 0001_initial.sql    # D1 初始数据库结构
├── scripts/
│   └── doctor.mjs          # 本地结构检查
├── .dev.vars.example
├── .gitignore
├── .nvmrc
├── package.json
└── wrangler.toml
```

> **重点：`public/_worker.js` 不要删除。** Cloudflare Pages Advanced Mode 会直接使用输出目录里的 `_worker.js` 接管请求；Worker 再通过 `env.ASSETS.fetch()` 提供 HTML/CSS/JS 等静态资源。

## 2. 第一次部署：GitHub → Pages

### 第一步：上传 GitHub

把项目解压后，将整个目录上传到 GitHub 仓库，例如 `st-nav`。

推荐生产分支：`main`。

### 第二步：创建 D1

Cloudflare Dashboard：

**Workers & Pages → D1 → Create database**

数据库名称建议：

```text
st-nav
```

### 第三步：初始化 D1（第一次必须）

进入：

**D1 → st-nav → Console**

打开项目里的：

```text
migrations/0001_initial.sql
```

复制全部 SQL → 粘贴到 D1 Console → **Execute**。

检查：

```sql
SELECT name
FROM sqlite_master
WHERE type = 'table'
ORDER BY name;
```

正常应看到：

```text
link_daily_stats
links
navigation
settings
```

> 不要拆分 `0001_initial.sql` 执行，也不要重复删除生产数据库重建。

### 第四步：创建 Pages 项目

Cloudflare Dashboard：

**Workers & Pages → Create application → Pages → Connect to Git**

选择你的 GitHub 仓库。

构建设置：

```text
Production branch: main
Root directory: /
Build command: exit 0
Build output directory: public
```

本项目没有构建步骤，`public/` 本身就是最终部署目录；`exit 0` 只是告诉 Pages 构建成功。Cloudflare 对无框架项目也支持留空 Build command；使用 `exit 0` 更直观。 

### 第五步：绑定 D1

进入：

**Pages 项目 → Settings → Bindings → Add → D1 database**

设置：

```text
Variable name: DB
D1 database: st-nav
```

**变量名必须是 `DB`。**

### 第六步：设置管理员 Secret

进入：

**Pages 项目 → Settings → Variables and Secrets**

生产环境添加：

```text
ADMIN_PASSWORD=你的管理员密码
SESSION_SECRET=随机高熵字符串
```

说明：

- `ADMIN_PASSWORD` 不限制最小长度，但不能为空。
- 实际使用建议使用较强密码。
- `SESSION_SECRET` 建议至少 32 个字符，并与管理员密码分开。
- 不要把真实密码提交到 GitHub。

### 第七步：部署

点击 **Save and Deploy**。

部署完成后：

```text
https://你的项目.pages.dev/
```

管理后台：

```text
https://你的项目.pages.dev/admin.html
```

以后推送到 `main`，Cloudflare Pages 会自动重新部署。

## 3. 第一次部署最重要的 4 项

```text
1. D1 创建：st-nav
2. D1 Console：执行 migrations/0001_initial.sql
3. Pages 输出目录：public
4. Pages Binding：DB → st-nav
```

另外必须设置：

```text
ADMIN_PASSWORD
SESSION_SECRET
```

## 4. 数据库升级

第一次使用：

```text
migrations/0001_initial.sql
```

以后不要修改已经执行过的 migration，而是新增：

```text
migrations/0002_xxx.sql
migrations/0003_xxx.sql
```

生产数据库可用 Wrangler 执行：

```bash
npm install
npm run db:migrate:remote
```

不要把生产 migration 放进 Pages 的自动部署命令中。

## 5. 本地开发（可选）

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

本地访问 Wrangler 输出的地址。

检查项目：

```bash
npm run doctor
```

## 6. CLI 部署（可选）

```bash
npm install
npm run deploy
```

它使用：

```text
wrangler pages deploy public
```

## 7. 常见问题

### 页面能打开，但 API 报错

依次检查：

1. D1 是否执行过 `0001_initial.sql`；
2. Pages Binding 是否为 `DB → st-nav`；
3. `ADMIN_PASSWORD` 是否存在；
4. `SESSION_SECRET` 是否存在；
5. 最新 Pages Deployment 是否成功。

### 登录提示未配置管理员密码

检查：

**Pages → Settings → Variables and Secrets → Production**

确认存在：

```text
ADMIN_PASSWORD
```

修改 Secret 后重新部署一次。

### 不要删除 `public/_worker.js`

它就是 Pages Advanced Mode 的 Worker 入口，不是普通静态文件。

`public/.assetsignore` 中已经包含：

```text
_worker.js
```

这是为了避免 `_worker.js` 同时被当作普通静态资源上传。

## 8. 安全建议

- 管理员密码虽然不再强制最小长度，但实际建议使用强密码。
- `SESSION_SECRET` 使用独立随机 Secret，建议至少 32 个字符。
- 不要提交 `.dev.vars`。
- 正式环境建议使用 Cloudflare WAF / Rate Limiting 进一步保护登录接口。
- Preview 环境最好使用独立 D1，避免测试数据进入生产库。
