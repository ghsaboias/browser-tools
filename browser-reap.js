#!/usr/bin/env node
// Close tabs nobody has touched for a while. Meant for the shared headed browser
// on the Pi (systemd timer); refuses to run against any other browser so it can
// never close tabs in a user's live Brave/Chrome session.
//
// Usage: browser-reap.js [--idle=<minutes>] [--dry-run] [--force]
//   --idle     threshold, default 30
//   --dry-run  print what would be closed
//   --force    run even if the connected browser is not the browser-start.js profile
//
// Idle = time since a browser-tools command last targeted the tab, or since the
// daemon first saw it. Puppeteer activity (michael-slack) is invisible to the
// daemon, so keep the threshold well above any Puppeteer script's runtime.
// The last remaining tab is parked on about:blank instead of closed.
import { listTargets, closeTab, runDirect, shortId, formatIdle } from './lib/client.js';
import { detectBrowser } from './lib/cdp.js';
import { PROFILE_PORT_FILE } from './lib/paths.js';

const args = process.argv.slice(2);
const idleMin = parseFloat(args.find(a => a.startsWith('--idle='))?.slice(7) ?? '30');
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

if (!force) {
  const { portFile } = detectBrowser();
  if (portFile !== PROFILE_PORT_FILE) {
    console.error(`refusing: connected browser is not the browser-start.js profile (${portFile}). Use --force.`);
    process.exit(2);
  }
}

const threshold = idleMin * 60_000;
const targets = await listTargets();
const stale = targets.filter(t => t.idleMs >= threshold);
if (stale.length === 0) { console.log(`nothing to reap (${targets.length} tabs, idle < ${idleMin}m)`); process.exit(0); }

let remaining = targets.length;
for (const t of stale) {
  const label = `[${shortId(t)}]  ${t.title || t.url}   (idle ${formatIdle(t.idleMs)})`;
  const isLast = remaining === 1;
  const action = isLast ? (t.url === 'about:blank' ? 'keep' : 'park') : 'close';
  if (action === 'keep') { console.log(`${dryRun ? 'would keep' : 'keep'}  ${label}`); continue; }
  console.log(`${dryRun ? 'would ' : ''}${action}  ${label}`);
  if (action === 'close') remaining--;
  if (dryRun) continue;
  if (action === 'park') await runDirect(t.targetId, 'nav', ['about:blank']);
  else await closeTab(t.targetId);
}
process.exit(0);
