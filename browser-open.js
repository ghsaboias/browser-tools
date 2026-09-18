#!/usr/bin/env node
import { openTab, run, shortId } from './lib/client.js';

const args = process.argv.slice(2);
const noWait = args.includes('--no-wait');
const url = args.find(a => !a.startsWith('-')) || null;

// Open about:blank first so we can navigate with a load-wait (matching
// browser-nav's behavior); with --no-wait, hand the URL straight to
// Target.createTarget and return as soon as the tab exists.
const { targetId } = await openTab(noWait && url ? url : undefined);
if (url && !noWait) {
  await run(targetId, 'nav', [url]);
}

console.log(`[${shortId({ targetId })}]  ${url || 'about:blank'}`);
process.exit(0);
