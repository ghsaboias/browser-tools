#!/usr/bin/env node
// Open a new background tab (default about:blank) and wait for it to load; prints its [ID].
// --name=<name> opens the tab once: the next `--name=<name>` returns the same tab without
// navigating it, and every command takes -t=<name>. The name lasts while the tab is open.
//
//   browser-open.js [<url>] [--name=<name>] [--no-wait]
import { openTab, run, shortId } from './lib/client.js';
import { parseArgs } from './lib/cli.js';

const { flags, rest } = parseArgs();
const url = rest[0] || null;
const name = typeof flags.name === 'string' ? flags.name : null;

try {
  // Open about:blank first so we can navigate with a load-wait (matching browser-nav);
  // with --no-wait, hand the URL straight to Target.createTarget.
  const { targetId, existed } = await openTab(flags['no-wait'] && url ? url : undefined, name);
  if (url && !flags['no-wait'] && !existed) await run(targetId, 'nav', [url]);
  const current = existed ? await run(targetId, 'url') : (url || 'about:blank');
  console.log(`[${shortId({ targetId })}]${name ? ` "${name}"` : ''}  ${current}${existed ? '  (already open)' : ''}`);
  process.exit(0);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
