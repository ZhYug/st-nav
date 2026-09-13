#!/usr/bin/env node
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('public', { recursive: true });
copyFileSync('src/worker.js', 'public/_worker.js');
console.log('✓ Pages Advanced Mode: public/_worker.js 已生成');
