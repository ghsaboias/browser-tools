#!/usr/bin/env node
import { run } from './lib/client.js';

const target = process.argv[2]?.startsWith('-t=') ? process.argv[2].slice(3) : null;
const cookies = JSON.parse(await run(target, 'cookies'));

for (const c of cookies) {
  console.log(`${c.name}: ${c.value}`);
  console.log(`  domain: ${c.domain}  path: ${c.path}  httpOnly: ${c.httpOnly}  secure: ${c.secure}`);
  console.log();
}
process.exit(0);
