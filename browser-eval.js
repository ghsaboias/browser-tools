#!/usr/bin/env node
// Evaluate JavaScript in the tab (awaits promises, returns by value), in the page's own
// world: its globals are visible and a hook on fetch/XHR catches the page's requests.
// --isolated runs in an isolated world: same DOM, but the page cannot see the call or
// trap the DOM methods it uses. Prefer it for plain DOM reads on sites that fight bots.
//
//   browser-eval.js [-t=<tab>] [--isolated] "document.title"
import { run } from './lib/client.js';
import { parseArgs } from './lib/cli.js';

const { tab, flags, rest } = parseArgs();
const code = rest.join(' ');
if (!code) {
  console.log('Usage: browser-eval.js [-t=<tab>] [--isolated] <code>');
  process.exit(1);
}
try {
  const result = await run(tab, 'eval', [code, JSON.stringify({ isolated: !!flags.isolated })]);
  console.log(typeof result === 'object' && result !== null ? JSON.stringify(result, null, 2) : result);
  process.exit(0);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
