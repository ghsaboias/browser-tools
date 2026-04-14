#!/usr/bin/env node
import { listTargets, formatTarget } from './lib/client.js';

const targets = await listTargets();
if (targets.length === 0) { console.error('✗ No tabs found'); process.exit(1); }

console.log(`${targets.length} tab${targets.length === 1 ? '' : 's'} — target with -t=<ID> (stable across navs) or -t=<url/title substring>\n`);
for (const t of targets) console.log(formatTarget(t) + '\n');
process.exit(0);
