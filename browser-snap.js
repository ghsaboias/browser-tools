#!/usr/bin/env node
import { run } from './lib/client.js';

const target = process.argv[2]?.startsWith('-t=') ? process.argv[2].slice(3) : null;
console.log(await run(target, 'snap'));
process.exit(0);
