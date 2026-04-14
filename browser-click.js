#!/usr/bin/env node
import { run } from './lib/client.js';

const args = process.argv.slice(2);
const target = args.find(a => a.startsWith('-t='))?.slice(3) || null;
const rest = args.filter(a => !a.startsWith('-t='));

if (rest.length === 0) {
  console.log('Usage: browser-click.js [-t=<tab>] <selector>');
  console.log('       browser-click.js [-t=<tab>] <x> <y>');
  process.exit(1);
}

const cmd = rest.length >= 2 && !isNaN(rest[0]) ? 'clickxy' : 'click';
console.log(await run(target, cmd, rest));
process.exit(0);
