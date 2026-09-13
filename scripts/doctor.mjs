#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';

const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
};

console.log('🔎 ST Nav v1.0.3 Pages Advanced Mode 环境检查\n');

const requiredFiles = [
  'wrangler.toml',
  'package.json',
  'src/worker.js',
  'scripts/pages-build.mjs',
  'public/index.html',
  'public/admin.html',
  'public/.assetsignore',
  'migrations/0001_initial.sql',
  '.dev.vars.example',
];

for (const file of requiredFiles) {
  if (!existsSync(file)) fail(`缺少 ${file}`);
}

if (existsSync('wrangler.toml')) {
  const config = readFileSync('wrangler.toml', 'utf8');
  if (!/pages_build_output_dir\s*=\s*["']\.\/public["']/.test(config)) {
    fail('Pages build output directory 未指向 ./public');
  }
  if (/^\s*main\s*=\s*/m.test(config)) {
    fail('Pages 配置不应再使用 main = ... Workers 入口');
  }
  if (/^\s*\[assets\]/m.test(config)) {
    fail('Pages 配置不应再使用 [assets] Workers Static Assets 配置');
  }
  if (!/binding\s*=\s*["']DB["']/.test(config) || !/database_name\s*=/.test(config)) {
    fail('缺少 D1 DB binding');
  }
  if (!/migrations_dir\s*=\s*["']\.\/migrations["']/.test(config)) {
    fail('缺少 migrations_dir 配置');
  }
  if (!/ST_NAV_VERSION\s*=\s*["']1\.0\.3["']/.test(config)) {
    fail('wrangler.toml 版本号不是 1.0.3');
  }
  console.log('✓ Cloudflare Pages Advanced Mode 配置存在');
  console.log('✓ D1 migrations 配置存在');
}

if (existsSync('package.json')) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  if (pkg.version !== '1.0.3') fail('package.json 版本号不是 1.0.3');
  if (pkg.scripts?.build !== 'node scripts/pages-build.mjs') fail('缺少 Pages build 脚本');
  if (pkg.scripts?.dev !== 'wrangler pages dev public') fail('本地 dev 脚本未使用 Pages 模式');
  console.log('✓ package.json Pages 构建/部署脚本存在');
}

if (existsSync('scripts/pages-build.mjs')) {
  const build = readFileSync('scripts/pages-build.mjs', 'utf8');
  if (!build.includes("copyFileSync('src/worker.js', 'public/_worker.js')")) {
    fail('Pages build 未将 Worker 生成到 public/_worker.js');
  }
}

if (existsSync('public/.assetsignore')) {
  const ignore = readFileSync('public/.assetsignore', 'utf8');
  if (!/(^|\n)_worker\.js(\n|$)/.test(ignore)) fail('public/.assetsignore 未排除 _worker.js');
  console.log('✓ Advanced Mode _worker.js 资产排除配置存在');
}

if (existsSync('src/worker.js')) {
  const worker = readFileSync('src/worker.js', 'utf8');
  if (!worker.includes('const VERSION = "1.0.3"')) fail('Worker 版本号不是 1.0.3');
  if (!worker.includes('export default')) fail('Worker 未使用 Module Worker 语法');
  if (!worker.includes('env.ASSETS.fetch')) fail('Worker 未处理 Pages 静态资产请求');
  if (!worker.includes('__Host-stnav_session')) fail('Session Cookie 未启用 __Host- 前缀');
  if (!worker.includes('SESSION_SECRET')) fail('缺少独立 SESSION_SECRET 支持');
  if (!worker.includes('checkLoginRateLimit')) fail('缺少登录限流保护');
  console.log('✓ Worker / Pages Advanced Mode / 安全代码检查通过');
}

if (existsSync('public/_worker.js')) {
  const generated = readFileSync('public/_worker.js', 'utf8');
  if (!generated.includes('const VERSION = "1.0.3"')) fail('public/_worker.js 不是 v1.0.3');
}

if (process.exitCode) process.exit(process.exitCode);

console.log('\n✓ 本地项目结构检查完成');
console.log('ℹ️ Cloudflare Pages 的生产/Preview D1 与 Secret 绑定请在 Dashboard 中确认。');
