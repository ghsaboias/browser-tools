#!/usr/bin/env node
// Send real keyboard key events via CDP Input.dispatchKeyEvent (keyDown + keyUp).
// Built on the daemon's generic `raw` command — synthetic JS KeyboardEvents are
// ignored by apps like Google Sheets, this dispatches genuine browser key events.
//
// Usage:
//   browser-key.js [-t=<tab>] <key> [<key> ...]
//   browser-key.js Enter
//   browser-key.js -t=43CA44CE Tab Tab Enter
//   browser-key.js "Cmd+a" Delete           # modifiers via +  (Cmd/Ctrl/Alt/Shift/Meta)
//
// Keys: Enter Tab Escape Backspace Delete Space
//       ArrowUp ArrowDown ArrowLeft ArrowRight Home End PageUp PageDown
//       F1..F12  and single printable chars (a, 1, etc.)
import { run } from './lib/client.js';
import { KEYS, chordEvents } from './lib/keys.js';

const args = process.argv.slice(2);
const target = args.find(a => a.startsWith('-t='))?.slice(3) || null;
const keys = args.filter(a => !a.startsWith('-t='));

if (!keys.length) {
  console.log('Usage: browser-key.js [-t=<tab>] <key> [<key> ...]   e.g. Enter | Tab | "Cmd+a"');
  console.log('Keys: ' + Object.keys(KEYS).join(' ') + ' F1..F12 <char>');
  process.exit(1);
}

try {
  console.log(await run(target, 'press', keys));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
process.exit(0);
