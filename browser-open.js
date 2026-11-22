#!/usr/bin/env node
// Open a tab in a window of its own (default about:blank), wait for the load, print its [ID].
import { openTab, run, shortId } from './lib/client.js';
import { parseArgs } from './lib/cli.js';

const USAGE = 'Usage: browser-open.js [url] [--name=<name>] [--tile=<k>/<n>] [--no-wait] [--id]\n' +
  '  --name     open the tab once: the same --name again returns it without navigating, and -t=<name> targets it\n' +
  '  --tile     place the window in tile k of n (browser-window.js; k/n@left for the left half; macOS), in the\n' +
  '             background: it never covers the user\'s windows or takes keyboard focus\n' +
  '  --no-wait  return as soon as the tab exists, without waiting for the load\n' +
  '  --id       print only the tab id (for T=$(browser-open.js --id ...))\n' +
  'Every tab gets its own window (--window is accepted and changes nothing): a tab behind another in the same\n' +
  'window is hidden and input sent to it hangs.';
const FLAGS = ['name', 'tile', 'no-wait', 'id', 'window'];

// --tile also comes as two words (--tile 0/3), as browser-window.js takes it.
const argv = process.argv.slice(2);
const ti = argv.indexOf('--tile');
if (ti >= 0 && argv[ti + 1]) argv.splice(ti, 2, `--tile=${argv[ti + 1]}`);
const { flags, rest } = parseArgs(argv);
const unknown = Object.keys(flags).filter(f => !FLAGS.includes(f));
if (unknown.length || argv.includes('-h')) {
  // Any other flag, --help included, opens nothing: an agent probing the usage left stray blank tabs behind.
  const help = unknown.every(f => f === 'help');
  (help ? console.log : console.error)(help ? USAGE : `Unknown option --${unknown.join(' --')}\n${USAGE}`);
  process.exit(help ? 0 : 1);
}
const url = rest[0] || null;
const name = typeof flags.name === 'string' ? flags.name : null;

try {
  let bounds = null;
  if (typeof flags.tile === 'string') bounds = (await import('./lib/window.js')).tileBounds(flags.tile);
  // Open about:blank first so we can navigate with a load-wait (matching browser-nav);
  // with --no-wait, hand the URL straight to Target.createTarget.
  const { targetId, existed } = await openTab(flags['no-wait'] && url ? url : undefined, { name, bounds });
  if (url && !flags['no-wait'] && !existed) await run(targetId, 'nav', [url]);
  if (flags.id) {
    console.log(shortId({ targetId }));
  } else {
    const current = existed ? await run(targetId, 'url') : (url || 'about:blank');
    console.log(`[${shortId({ targetId })}]${name ? ` "${name}"` : ''}  ${current}${existed ? '  (already open)' : ''}`);
  }
  process.exit(0);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
