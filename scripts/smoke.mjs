#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../public/_worker.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const health = await worker.fetch(new Request('https://example.com/api/health'), {
  ST_NAV_VERSION: pkg.version,
});
assert.equal(health.status, 200);
assert.equal((await health.json()).version, pkg.version);

const favicon = await worker.fetch(new Request('https://example.com/api/favicon?url=https%3A%2F%2Flocalhost'), {});
assert.equal(favicon.status, 400);

const source = readFileSync(new URL('../public/_worker.js', import.meta.url), 'utf8');
assert.match(source, /admin_sessions/);
assert.match(source, /\/api\/admin\/links\/import/);
assert.match(source, /\/api\/admin\/navigation\/move/);
assert.match(source, /content-security-policy/i);
assert.match(source, /MAX_IMPORT_ROWS/);

console.log(`✓ smoke tests passed (v${pkg.version})`);
