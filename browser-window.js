#!/usr/bin/env node
// Places the window of a tab, without bringing it to the front (keyboard focus stays where it is).
//
// Usage:
//   browser-window.js -t=<id> --tile <k>/<n>   tile k (0-based) of n in the right half of the rightmost display
//   browser-window.js -t=<id> --minimize
//   browser-window.js --displays               the displays, in the browser's coordinates (macOS)
//
// A tab in a visible, uncovered window receives wheel events and keeps loading feeds while the user works in another
// application; a minimized or fully covered one does not. browser-open.js --tile opens a window directly in its tile.
import { run } from './lib/client.js';
import { displays, tileBounds } from './lib/window.js';

const args = process.argv.slice(2);
const target = args.find(a => a.startsWith('-t='))?.slice(3) || null;
const tile = args[args.indexOf('--tile') + 1];

async function windowOf() {
  const w = await run(target, 'raw', ['Browser.getWindowForTarget', '{}']);
  return typeof w === 'string' ? JSON.parse(w) : w;
}

async function setBounds(bounds) {
  let { windowId, bounds: now } = await windowOf();
  // Bounds apply only to a window in the normal state. A minimized window comes back in the state it had before
  // (maximized, for a window Brave opened maximized), so restore until it reports normal.
  for (let i = 0; i < 3 && bounds.windowState !== 'minimized' && now.windowState !== 'normal'; i++) {
    await run(target, 'raw', ['Browser.setWindowBounds', JSON.stringify({ windowId, bounds: { windowState: 'normal' } })]);
    await new Promise(r => setTimeout(r, 300));
    ({ bounds: now } = await windowOf());
  }
  await run(target, 'raw', ['Browser.setWindowBounds', JSON.stringify({ windowId, bounds })]);
}

if (args.includes('--displays')) {
  console.log(JSON.stringify(displays()));
} else if (target && args.includes('--minimize')) {
  await setBounds({ windowState: 'minimized' });
  console.log(`minimized [${target}]`);
} else if (target && tile) {
  const bounds = tileBounds(tile);
  await setBounds(bounds);
  console.log(`tile ${tile} [${target}] ${JSON.stringify(bounds)}`);
} else {
  console.log('Usage: browser-window.js -t=<id> --tile <k>/<n> | -t=<id> --minimize | --displays');
  process.exit(1);
}
process.exit(0);
