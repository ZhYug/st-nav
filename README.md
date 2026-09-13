# ST Nav

一个基于 **Cloudflare Workers + D1 + Workers Static Assets** 的轻量级个人导航与短链接服务。

> **当前版本：1.0.2**
>
> 目标是：**一次部署、自动初始化数据库、以后只更新代码，不做数据库迁移。**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ZhYug/st-nav)

---

## ✨ 项目特点

- 🔗 短链接：创建、编辑、删除、跳转
- 🧭 导航站：分类、收藏、排序、图标、描述
- 🔀 导航项可直接关联短链接，避免重复维护目标地址
- 📊 点击统计：总点击量与按日统计
- 🔐 管理后台：密码登录与会话保护
- 📥 CSV 导入 / 📤 CSV 导出
- ⚡ D1 批量查询与写入优化
- 🚀 Cloudflare Workers Static Assets，前后端同源部署
- 📱 移动端性能优化
- 🗄️ 数据库自动初始化，**无需手动 migration**
- ☁️ 支持 Cloudflare 官方 **Deploy to Cloudflare** 一键部署

---

# 🚀 推荐部署：一键部署到 Cloudflare

这是最适合第一次部署的方式。

### 1. 点击按钮

直接点击本页顶部的 **Deploy to Cloudflare**。

Cloudflare 会读取仓库中的 `wrangler.toml`，创建名为 `st-nav` 的 Worker，并自动创建并绑定一个名为 `st-nav` 的独立 D1 数据库。项目不会连接或修改你账号中其他同名旧项目的数据库。

> 源仓库需要是公开的 GitHub/GitLab 仓库；部署后的 Cloudflare 资源属于部署者自己的账号。

### 2. 设置管理员密码

部署过程中设置：

```text
ADMIN_PASSWORD
```

建议使用 **至少 16 位**的随机强密码。

这是生产环境唯一需要手动设置的 Secret。

### 3. 等待首次部署完成

部署完成后访问：

```text
https://你的-worker.workers.dev/
```

管理后台：

```text
https://你的-worker.workers.dev/admin
```

管理员登录密码就是刚才设置的 `ADMIN_PASSWORD`。

### 4. 数据库无需手动创建

第一次使用 API、后台或短链接时，Worker 会自动确保 D1 数据库结构存在。

因此**不需要**：

- 手动创建 D1 表
- 手动执行 `schema.sql`
- 复制 `database_id`
- 修改 `wrangler.toml` 中的数据库 ID
- 执行 migration
- 绑定 Cloudflare Pages
- 配置 `SESSION_SECRET`

---

# 🗄️ 数据库策略

项目采用稳定的 v4 数据模型，并通过 Worker 自动进行幂等初始化。

初始化使用：

```sql
CREATE TABLE IF NOT EXISTS ...
CREATE INDEX IF NOT EXISTS ...
INSERT OR IGNORE ...
```

这意味着：

> **数据库初始化是应用启动流程的一部分，而不是部署步骤。**

后续代码版本升级时，不需要维护一串 migration 文件。

正常升级流程：

```text
GitHub push
    ↓
Workers Builds
    ↓
Worker 新版本
    ↓
继续使用原来的 D1
```

数据库初始化不会主动删除现有数据，也不会执行 `DROP TABLE`。

---

# 🔄 后续更新

如果项目已经通过 Cloudflare 的 Workers Builds 连接 GitHub，之后通常只需要：

```bash
git add .
git commit -m "Update"
git push
```

Cloudflare 会自动构建并部署新版本。

如果使用本地 Wrangler，也可以：

```bash
npm install
npx wrangler login
npm run deploy
```

项目不会因为更新代码而要求你执行数据库 migration。

---

# 💻 本地开发

需要 Node.js 与 npm。

安装依赖：

```bash
npm install
```

创建本地变量文件：

```bash
cp .dev.vars.example .dev.vars
```

然后编辑 `.dev.vars`：

```env
ADMIN_PASSWORD="你的本地开发密码"
```

启动开发环境：

```bash
npm run dev
```

本地 D1 由 Wrangler 模拟；Worker 在首次使用数据库时自动初始化结构。

---

# 🩺 项目检查

运行：

```bash
npm run doctor
```

用于检查项目的基础配置与常见问题。

健康检查接口：

```text
/api/health
```

正常情况下返回类似：

```json
{"ok":true,"version":"1.0.2","database":true}
```

---

# 🔐 安全说明

生产环境只需要：

```text
ADMIN_PASSWORD
```

会话签名使用管理员密码作为 HMAC 密钥，因此不再需要单独维护 `SESSION_SECRET`。

请注意：

- 不要把真实 `ADMIN_PASSWORD` 写进 GitHub
- 不要把 `.dev.vars` 提交到仓库
- 生产环境使用随机、足够长的管理员密码
- 如果更换管理员密码，已有登录会话需要重新登录

---

# 🧩 核心数据模型

项目使用以下主要数据表：

| 表 | 用途 |
|---|---|
| `links` | 短链接及目标 URL |
| `navigation` | 导航站条目、排序与关联关系 |
| `settings` | 网站配置 |
| `link_daily_stats` | 按天聚合的点击统计 |
| `link_visits` | 保留的访问记录结构，用于兼容既有数据模型 |

核心数据规则：

- `links.url` 始终保存真实目标地址
- `links.code` 始终保存短码
- `short_url` 根据当前域名动态生成
- `navigation.link_id` 存在时，以对应短链接作为目标数据源
- `link_daily_stats` 是新的主要统计数据来源
- 数据库 Schema 保持稳定，不依赖 migration 链

---

# 📱 移动端与性能优化

项目针对手机访问进行了多项优化：

- CSS 使用 preload，并保留轻量 critical CSS
- `app.js` 使用 `defer`，避免阻塞 HTML 解析
- 导航图标使用 lazy loading 与异步解码
- 移动端降低 `backdrop-filter`、环境光、纹理和 hover transform 等高开销效果
- 长导航列表使用 `content-visibility: auto`
- 搜索输入使用 `requestAnimationFrame` 合帧，减少重复渲染
- 收藏、复制、卡片点击使用事件委托，减少 DOM 监听器数量
- `localStorage` 读取增加容错，避免异常数据导致首页初始化失败
- 支持 `prefers-reduced-motion`
- Bootstrap 数据接口合并请求，减少首屏请求数量
- 常用数据使用 Cache API 缓存，降低重复访问延迟

这些优化不会改变项目的数据结构，也不需要数据库迁移。

---

# 📦 项目结构

```text
st-nav/
├── public/
│   ├── index.html          # 前台导航页
│   ├── admin.html          # 管理后台
│   ├── _worker.js          # Cloudflare Worker
│   └── assets/
│       ├── app.js
│       ├── admin.js
│       ├── styles.css
│       └── favicon.svg
├── scripts/
│   └── doctor.mjs          # 项目检查
├── schema.sql              # 稳定数据库 Schema
├── wrangler.toml           # Worker / Assets / D1 配置
├── package.json
├── .dev.vars.example       # 本地 Secret 示例
├── .gitignore
└── README.md               # 项目唯一说明文档
```

> 部署说明、版本记录、移动端优化说明已经集中到本 README，不再维护多个重复 Markdown 文档。

---

# 🛠️ 常用命令

| 命令 | 用途 |
|---|---|
| `npm install` | 安装依赖 |
| `npm run dev` | 本地开发 |
| `npm run deploy` | Wrangler 部署 |
| `npm run update` | 更新部署 |
| `npm run doctor` | 检查项目 |

---

# 🧪 发布前检查

建议发布新版本前至少确认：

```bash
node --check public/_worker.js
npm run doctor
```

如果修改了前端，也建议在手机和桌面浏览器分别检查：

- 首页加载
- 搜索
- 分类筛选
- 收藏
- 短链接跳转
- 管理后台登录
- 新增 / 编辑 / 删除短链接
- 导航排序
- CSV 导入 / 导出
- 点击统计

---

# ❓ 常见问题

### Q：第一次部署需要自己创建 D1 吗？

**不需要。** 推荐使用 Deploy to Cloudflare，让 Cloudflare 根据项目配置处理 D1 资源。

### Q：以后升级需要执行 migration 吗？

**不需要。** 当前数据库设计采用幂等初始化方式，代码升级不会主动重建数据库。

### Q：需要修改 `database_id` 吗？

使用 Deploy to Cloudflare 时，不要把仓库中的占位 ID 当作自己的数据库 ID 手动修改；让 Cloudflare 的部署流程根据资源配置处理。

### Q：需要 `SESSION_SECRET` 吗？

**不需要。** 当前版本只要求 `ADMIN_PASSWORD`。

### Q：我可以继续用 Cloudflare Pages 吗？

当前项目已经迁移到 **Cloudflare Workers + Workers Static Assets**，不再以 Pages 作为部署目标。

### Q：更换 `ADMIN_PASSWORD` 会怎样？

管理员密码同时用于会话签名。修改后，旧登录会话会失效，需要重新登录。

---

# 📚 Cloudflare 官方文档

- [Deploy to Cloudflare](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [D1 Database](https://developers.cloudflare.com/d1/)
- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)

---

# 📝 Changelog

## 1.0.2

### 部署与资源隔离

- 项目正式命名为 **ST Nav**。
- Worker 名称使用 `st-nav`。
- 一键部署自动创建并绑定独立的 D1 数据库 `st-nav`。
- 不写入任何旧项目的 `database_id`，避免与已有 `shortlink-nav` 数据库冲突。
- 修正 Wrangler 配置，移除会导致 Cloudflare Deploy 页面解析失败的非法 TOML `$schema` 行。
- 使用 Cloudflare 官方支持的自动资源 provisioning：D1 配置不预先写入账号专属数据库 ID。

## 1.0.0

### 部署架构

- 从 Cloudflare Pages 迁移到 Workers Static Assets
- 增加 Deploy to Cloudflare 一键部署支持
- D1 使用 Worker binding 配置
- 移除 CLI-first 的 setup / migration 工作流

### 数据库

- 使用稳定的 v4 Schema
- Worker 首次使用数据库时自动执行幂等初始化
- 不再要求手动执行 `schema.sql`
- 不再依赖 migration 文件链
- 保留既有数据模型兼容性

### 安全

- `ADMIN_PASSWORD` 成为唯一必需 Secret
- 移除 `SESSION_SECRET`
- 使用管理员密码作为 HMAC 会话签名密钥

### API / 性能

- 增加 `/api/health`
- D1 查询与写入使用批处理优化
- 公共 Bootstrap 数据合并请求
- 短链接目标数据支持缓存
- 点击统计使用每日聚合数据
- 修正真实目标 `url` 与 `short_url` 的职责分离

### 移动端

- 优化首屏 CSS / JS 加载
- 延迟非关键图片
- 降低移动端高成本视觉效果
- 优化长列表渲染
- 搜索输入合帧
- 使用事件委托减少监听器
- 增强 localStorage 容错
- 支持减少动画偏好

---

## 📄 License

本项目当前未单独声明开源许可证。若准备公开分发，建议根据你的实际使用场景补充 LICENSE 文件。
