#!/usr/bin/env node
import { openTab, run, shortId } from './lib/client.js';
import { tileBounds } from './lib/window.js';

const USAGE = 'Usage: browser-open.js [url] [--window | --tile <k>/<n>] [--no-wait] [--id]\n' +
  '  --window   open the tab in a new window\n' +
  '  --tile     open it in a new window placed in tile k of n (browser-window.js; k/n@left for the left half), in the background: it never covers\n' +
  '             the user\'s windows or takes keyboard focus\n' +
  '  --no-wait  return as soon as the tab exists, without waiting for the load\n' +
  '  --id       print only the tab id (for T=$(browser-open.js --id ...))';
const FLAGS = ['--no-wait', '--window', '--tile', '--id'];
const args = process.argv.slice(2);
const tile = args.includes('--tile') ? args[args.indexOf('--tile') + 1] : null;
const unknown = args.filter(a => a.startsWith('-') && !FLAGS.includes(a));
if (unknown.length) {
  // Any other flag, --help included, opens nothing: an agent probing the usage left stray blank tabs behind.
  const help = unknown.every(a => a === '--help' || a === '-h');
  (help ? console.log : console.error)(help ? USAGE : `Unknown option ${unknown.join(' ')}\n${USAGE}`);
  process.exit(help ? 0 : 1);
}
const noWait = args.includes('--no-wait');
const window = args.includes('--window') || !!tile;
const idOnly = args.includes('--id');
const url = args.find(a => !a.startsWith('-') && a !== tile) || null;

// Open about:blank first so we can navigate with a load-wait (matching
// browser-nav's behavior); with --no-wait, hand the URL straight to
// Target.createTarget and return as soon as the tab exists.
const { targetId } = await openTab(noWait && url ? url : undefined, { window, bounds: tile ? tileBounds(tile) : null });
if (url && !noWait) {
  await run(targetId, 'nav', [url]);
}

console.log(idOnly ? shortId({ targetId }) : `[${shortId({ targetId })}]  ${url || 'about:blank'}`);
process.exit(0);
