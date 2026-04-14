#!/usr/bin/env node
import { run } from './lib/client.js';

const args = process.argv.slice(2);
const target = args.find(a => a.startsWith('-t='))?.slice(3) || null;
const selector = args.find(a => !a.startsWith('-t=')) || '';

console.log(await run(target, 'html', [selector]));
process.exit(0);
