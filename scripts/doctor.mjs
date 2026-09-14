#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';

const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
};

console.log('🔎 ST Nav v1.1.7 Pages Advanced Mode 检查\n');

const requiredFiles = [
  'wrangler.toml',
  'package.json',
  'public/_worker.js',
  'public/index.html',
  'public/admin.html',
  'public/.assetsignore',
  'migrations/0001_initial.sql',
  '.dev.vars.example',
];

for (const file of requiredFiles) {
  if (!existsSync(file)) fail(`缺少 ${file}`);
}

for (const file of ['src/worker.js', 'scripts/pages-build.mjs']) {
  if (existsSync(file)) fail(`存在不需要的冗余文件 ${file}`);
}

if (existsSync('wrangler.toml')) {
  const config = readFileSync('wrangler.toml', 'utf8');
  if (!/pages_build_output_dir\s*=\s*["']\.\/public["']/.test(config)) fail('Pages build output directory 未指向 ./public');
  if (/^\s*main\s*=\s*/m.test(config)) fail('Pages 配置不应使用 main = ... Workers 入口');
  if (/^\s*\[assets\]/m.test(config)) fail('Pages 配置不应使用 [assets] Workers Static Assets 配置');
  if (!/binding\s*=\s*["']DB["']/.test(config) || !/database_name\s*=/.test(config)) fail('缺少 D1 DB binding');
  if (!/migrations_dir\s*=\s*["']\.\/migrations["']/.test(config)) fail('缺少 migrations_dir 配置');
  if (!/ST_NAV_VERSION\s*=\s*["']1\.1\.7["']/.test(config)) fail('wrangler.toml 版本号不是 1.1.7');
  console.log('✓ Pages + D1 配置正确');
}

if (existsSync('package.json')) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  if (pkg.version !== '1.1.7') fail('package.json 版本号不是 1.1.7');
  if (pkg.scripts?.dev !== 'wrangler pages dev public') fail('本地 dev 脚本未使用 Pages 模式');
  if (pkg.scripts?.deploy !== 'wrangler pages deploy public') fail('deploy 脚本未使用 Pages 部署');
  if (pkg.scripts?.build) fail('不应存在多余的 build 脚本');
  console.log('✓ package.json 配置正确');
}

if (existsSync('public/.assetsignore')) {
  const ignore = readFileSync('public/.assetsignore', 'utf8');
  if (!/(^|\n)_worker\.js(\n|$)/.test(ignore)) fail('public/.assetsignore 未排除 _worker.js');
  console.log('✓ _worker.js 已从静态资产上传中排除');
}

if (existsSync('public/_worker.js')) {
  const worker = readFileSync('public/_worker.js', 'utf8');
  if (!worker.includes('const VERSION = "1.1.7"')) fail('Worker 版本号不是 1.1.7');
  if (!worker.includes('export default')) fail('Worker 未使用 Module Worker 语法');
  if (!worker.includes('env.ASSETS.fetch')) fail('Worker 未处理 Pages 静态资产请求');
  if (!worker.includes('__Host-stnav_session')) fail('Session Cookie 未启用 __Host- 前缀');
  if (!worker.includes('SESSION_SECRET')) fail('缺少独立 SESSION_SECRET 支持');
  if (!worker.includes('checkLoginRateLimit')) fail('缺少登录限流保护');
  if (!worker.includes('safePasswordMatch')) fail('管理员密码未使用固定长度摘要比较');
  if (!worker.includes('MAX_JSON_BODY_BYTES')) fail('缺少请求体大小限制');
  if (!worker.includes('new WeakMap')) fail('D1 初始化缓存未按环境隔离');
  if (/length\s*<\s*10/.test(worker) || /length\s*<\s*16/.test(worker)) fail('ADMIN_PASSWORD 仍存在最小长度限制');
  if (!worker.includes('if (!env.ADMIN_PASSWORD)')) fail('ADMIN_PASSWORD 空值检查缺失');
  if (worker.includes('databaseReadyPromise')) fail('仍存在全局 D1 初始化 Promise');
  console.log('✓ Pages Worker / 安全代码检查通过');
}

if (process.exitCode) process.exit(process.exitCode);

console.log('\n✓ v1.1.7 项目结构检查完成');
console.log('ℹ️ 生产环境的 DB / ADMIN_PASSWORD / SESSION_SECRET 请在 Cloudflare Pages Dashboard 中绑定。');
