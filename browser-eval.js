#!/usr/bin/env node
// Evaluate JavaScript in the tab (awaits promises, returns by value).
// Runs in an isolated world by default: same DOM, but the page cannot see the call or
// hook what it touches. --main runs in the page's own world, for its JS globals.
//
//   browser-eval.js [-t=<tab>] [--main] "document.title"
import { run } from './lib/client.js';
import { parseArgs } from './lib/cli.js';

const { tab, flags, rest } = parseArgs();
const code = rest.join(' ');
if (!code) {
  console.log('Usage: browser-eval.js [-t=<tab>] [--main] <code>');
  process.exit(1);
}
try {
  const result = await run(tab, 'eval', [code, JSON.stringify({ main: !!flags.main })]);
  console.log(typeof result === 'object' && result !== null ? JSON.stringify(result, null, 2) : result);
  process.exit(0);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
