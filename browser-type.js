#!/usr/bin/env node
import { run } from './lib/client.js';

const args = process.argv.slice(2);
const target = args.find(a => a.startsWith('-t='))?.slice(3) || null;
const text = args.filter(a => !a.startsWith('-t=')).join(' ');

if (!text) {
  console.log('Usage: browser-type.js [-t=<tab>] <text>');
  process.exit(1);
}

console.log(await run(target, 'type', [text]));
process.exit(0);
