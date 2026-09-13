# v4.2 部署方式

## 推荐：Deploy to Cloudflare

本项目现在是 Cloudflare Workers 应用，使用 Workers Static Assets，不再依赖 Pages。

将仓库 URL 放进：

```text
https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_GITHUB_OWNER/shortlink-nav
```

Cloudflare 会读取 `wrangler.toml`：

- Worker entrypoint：`public/_worker.js`
- Static Assets：`public/`
- D1 binding：`DB`
- D1 默认名称：`shortlink-nav`

D1 会由 Deploy to Cloudflare 自动 provision。

### Secret

部署页面会根据 `.dev.vars.example` / `package.json` 中的 binding 描述要求填写：

```text
ADMIN_PASSWORD
```

设置强密码即可。

## 首次访问

首次访问 API、后台或短链接时，Worker 自动执行幂等数据库初始化。

不会删除现有数据。

## 后续升级

GitHub push → Workers Builds 自动部署。

不需要：

- migration
- schema.sql 手动执行
- D1 重建
- database_id 修改
- Pages 重新绑定

## 注意

Deploy to Cloudflare 按钮要求源 GitHub/GitLab 仓库公开；Cloudflare 会为部署者复制仓库并创建自己的资源。 
