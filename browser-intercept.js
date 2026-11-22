#!/usr/bin/env node
// Record a tab's network traffic: every request with its method, status, type and size,
// the response bodies of the URLs that match, the POST bodies sent, and requests to block.
// Use it for what the rendered page does not show: the JSON a private API returns to the
// page, the request that produced it, a status code, a redirect chain.
//
//   browser-intercept.js start -t=<tab> [--match=<url part | /regex/>] [--block=<url part | /regex/>]
//   browser-intercept.js read  -t=<tab> [--match=...] [--body] [--max=4000] [--wait=10000] [--clear] [--json]
//   browser-intercept.js stop  -t=<tab>
//
// start   begins recording on the tab (again: discards the old record). With --match, the
//         bodies of matching responses are kept (any type but images, media, fonts, CSS);
//         without it, the bodies of documents, XHR and fetch. --block fails matching
//         requests before they leave (ads, trackers, a heavy script).
// read    prints the record in request order; --match narrows it, --body adds each body
//         (first --max characters, 0 = all), --wait waits up to that many ms for a
//         matching response to finish, --clear empties the record after reading,
//         --json prints the entries with full bodies.
// stop    stops recording and discards the record.
//
// Typical: start --match=/api/, then click or navigate, then read --wait=10000 --body.
import { parseArgs, usage } from './lib/cli.js';
import { run } from './lib/client.js';

const USAGE = 'Usage: browser-intercept.js start|read|stop -t=<tab> [--match=<s|/re/>] [--block=<s|/re/>] [--body] [--max=N] [--wait=ms] [--clear] [--json]';
const { tab, flags, rest } = parseArgs();
const action = rest[0];
if (!['start', 'read', 'stop'].includes(action)) usage(USAGE);

const o = {};
if (typeof flags.match === 'string') o.match = flags.match;
if (action === 'start' && typeof flags.block === 'string') o.block = flags.block;
if (flags.wait) o.wait = parseInt(flags.wait, 10);
if (flags.clear) o.clear = true;

const size = (b) => (!b ? '-' : b < 1024 ? `${b}B` : b < 1048576 ? `${(b / 1024).toFixed(1)}KB` : `${(b / 1048576).toFixed(2)}MB`);

function format({ blocked, entries }) {
  const max = flags.max === undefined ? 4000 : parseInt(flags.max, 10);
  const lines = [];
  for (const e of entries) {
    const status = e.error ? `ERR ${e.error}` : e.done ? e.status || '-' : 'pending';
    lines.push(`${e.n} ${e.method} ${status} ${e.type} ${e.mime || '-'} ${size(e.size)}${e.frame === 'iframe' ? ' [iframe]' : ''} ${e.url}`);
    if (e.location) lines.push(`    → ${e.location}`);
    if (!flags.body) continue;
    if (e.postData) lines.push(`    sent: ${e.postData.length > 2000 ? e.postData.slice(0, 2000) + '…' : e.postData}`);
    if (e.bodyError) lines.push(`    body unavailable: ${e.bodyError}`);
    else if (e.body == null) continue;
    else if (e.base64) lines.push(`    body: binary, ${e.bodyLength} base64 characters (read with --json)`);
    else {
      const cut = max > 0 && e.body.length > max;
      lines.push(`    body${cut ? ` (first ${max} of ${e.body.length} characters)` : ''}: ${cut ? e.body.slice(0, max) : e.body}`);
    }
  }
  if (!entries.length) lines.push('no requests recorded' + (o.match ? ` matching ${o.match}` : ''));
  if (blocked) lines.push(`${blocked} requests blocked`);
  return lines.join('\n');
}

try {
  const raw = await run(tab, 'intercept', [action, JSON.stringify(o)]);
  const r = action === 'read' ? JSON.parse(raw) : raw;
  if (action !== 'read') console.log(r);
  else console.log(flags.json ? JSON.stringify(r.entries, null, 2) : format(r));
  process.exit(0);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
