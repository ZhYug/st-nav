# ShortLink Nav v4.2

一个基于 **Cloudflare Workers + D1 + Static Assets** 的个人导航与短链接服务。

> **推荐部署方式：Deploy to Cloudflare。**
>
> 这版已经从 Cloudflare Pages 改成 Workers Static Assets。Cloudflare 官方目前推荐新项目使用 Workers Static Assets；Deploy to Cloudflare 按钮支持自动创建 Worker、D1 等资源，并启用 Workers Builds。

## 🚀 真正的一键部署

将下面的 `YOUR_GITHUB_OWNER/shortlink-nav` 替换成你的公开 GitHub 仓库地址：

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_GITHUB_OWNER/shortlink-nav)
```

用户点击按钮后，Cloudflare 会：

1. 将仓库复制到用户自己的 GitHub。
2. 根据 `wrangler.toml` 自动创建并绑定 D1。
3. 根据 `.dev.vars.example` / `package.json` 的定义要求输入 `ADMIN_PASSWORD`。
4. 使用 Workers Builds 完成首次部署。
5. 后续 push 到生产分支后自动部署。

Cloudflare 官方说明 Deploy to Cloudflare 支持自动 provision D1 等资源，并支持部署时配置 Worker secrets。

### 首次部署后

直接打开：

```text
https://你的-worker.workers.dev/
```

后台：

```text
https://你的-worker.workers.dev/admin
```

管理员密码就是部署时填写的 `ADMIN_PASSWORD`。

**不需要：**

- Node.js
- npm
- Wrangler
- 手动创建 D1
- 复制 database_id
- 修改 `wrangler.toml`
- 手动执行 `schema.sql`
- 手动配置 SESSION_SECRET
- Pages Dashboard 绑定 D1

## 🗄️ 数据库策略

数据库采用稳定的 v4 Schema。

第一次请求 API/后台/短链接时，Worker 会自动执行幂等初始化：

```text
CREATE TABLE IF NOT EXISTS
CREATE INDEX IF NOT EXISTS
INSERT OR IGNORE
```

因此：

> **数据库初始化不再是部署步骤。**

以后版本升级也不需要 migration。

代码升级：

```text
GitHub push
   ↓
Workers Builds
   ↓
Worker 新版本
   ↓
D1 保持原样
```

数据库只在缺失表结构时自动补齐，不会删除数据，也不会执行 `DROP TABLE`。

## 🔐 安全

生产环境只需要一个 Secret：

```text
ADMIN_PASSWORD
```

会话签名使用管理员密码作为 HMAC 密钥，因此不再需要单独维护 `SESSION_SECRET`。

建议设置至少 16 位随机强密码。

不要把真实密码提交到 GitHub。

## 🧪 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars
```

修改 `.dev.vars`：

```env
ADMIN_PASSWORD="你的本地开发密码"
```

然后：

```bash
npm run dev
```

本地 D1 会由 Wrangler 模拟。

## 📦 CLI 部署（可选）

如果你不想使用 Deploy to Cloudflare，也可以：

```bash
npm install
npx wrangler login
npm run deploy
```

但 CLI 部署需要你自己准备 Cloudflare 资源/认证，因此普通用户优先使用上面的 Deploy to Cloudflare。

## 🔄 后续升级

以后只需要：

```bash
git pull
git push
```

Workers Builds 会自动部署。

或者本地：

```bash
npm run update
```

`npm run update` 等价于 `wrangler deploy`，**不会执行数据库 migration，也不会删除或重建 D1。**

## 🩺 检查

```bash
npm run doctor
```

## ❤️ 健康检查

部署后：

```text
/api/health
```

返回类似：

```json
{"ok":true,"version":"4.2.0","database":true}
```

## 数据模型

```text
links
navigation
settings
link_daily_stats
link_visits
```

核心原则：

- `links.url` 永远是真实目标地址。
- `links.code` 永远是短码。
- `short_url` 动态生成。
- `navigation.link_id` 不为空时，由短链接作为数据源。
- `link_daily_stats` 是主要统计数据源。
- `settings` 使用 key/value，方便未来增加配置。
- 不再使用版本 Migration 文件。

## Cloudflare 官方资料

- Deploy to Cloudflare： https://developers.cloudflare.com/workers/platform/deploy-buttons/
- Workers Static Assets： https://developers.cloudflare.com/workers/static-assets/
- D1： https://developers.cloudflare.com/d1/
