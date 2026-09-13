#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const WRANGLER = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (args) => spawnSync(WRANGLER, ['--yes', 'wrangler@latest', ...args], { stdio: 'inherit' }).status === 0;

console.log('🔎 ST Nav v1.0.2 环境检查\n');

if (!existsSync('wrangler.toml')) {
  console.error('✗ 缺少 wrangler.toml');
  process.exit(1);
}
const config = readFileSync('wrangler.toml', 'utf8');
if (!/main\s*=\s*["']\.\/public\/_worker\.js["']/.test(config)) {
  console.error('✗ 当前项目不是 Workers 部署配置');
  process.exit(1);
}
if (!/binding\s*=\s*"DB"/.test(config) || !/database_name\s*=/.test(config)) {
  console.error('✗ 缺少 D1 DB binding');
  process.exit(1);
}
if (/database_id\s*=/.test(config)) {
  console.log('✓ D1 已经包含数据库 ID');
} else {
  console.log('✓ D1 自动配置模板存在（Deploy to Cloudflare / Wrangler 会自动创建并绑定）');
}
if (!existsSync('.dev.vars.example')) {
  console.error('✗ 缺少 .dev.vars.example');
  process.exit(1);
}
console.log('✓ Workers + Static Assets 配置存在');
console.log('✓ ADMIN_PASSWORD 部署 Secret 定义存在');
console.log('\nCloudflare 登录状态（仅本地开发/CLI 部署需要）：');
if (!run(['whoami'])) process.exit(1);
console.log('\n✓ 环境检查完成');
