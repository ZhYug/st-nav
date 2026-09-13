# Changelog

## 4.2.0 — One-click Cloudflare deployment

- Migrated from Cloudflare Pages to Workers Static Assets.
- Added Deploy to Cloudflare compatible `wrangler.toml`.
- D1 is automatically provisioned from the Worker binding configuration.
- `ADMIN_PASSWORD` is the only required secret.
- Database initialization is idempotent and performed by the Worker on first database use.
- Removed the CLI-first setup/migration workflow.
- Removed `SESSION_SECRET`; session HMAC uses the administrator secret.
- Added `/api/health`.
- Kept the v4 database model stable; no migration chain is required for future code releases.
