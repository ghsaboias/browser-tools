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

const KEYS = {
  enter:     { vk: 13, code: 'Enter',      key: 'Enter',      text: '\r' },
  tab:       { vk: 9,  code: 'Tab',        key: 'Tab',        text: '\t' },
  escape:    { vk: 27, code: 'Escape',     key: 'Escape' },
  esc:       { vk: 27, code: 'Escape',     key: 'Escape' },
  backspace: { vk: 8,  code: 'Backspace',  key: 'Backspace' },
  delete:    { vk: 46, code: 'Delete',     key: 'Delete' },
  del:       { vk: 46, code: 'Delete',     key: 'Delete' },
  space:     { vk: 32, code: 'Space',      key: ' ',          text: ' ' },
  arrowup:   { vk: 38, code: 'ArrowUp',    key: 'ArrowUp' },
  arrowdown: { vk: 40, code: 'ArrowDown',  key: 'ArrowDown' },
  arrowleft: { vk: 37, code: 'ArrowLeft',  key: 'ArrowLeft' },
  arrowright:{ vk: 39, code: 'ArrowRight', key: 'ArrowRight' },
  up:        { vk: 38, code: 'ArrowUp',    key: 'ArrowUp' },
  down:      { vk: 40, code: 'ArrowDown',  key: 'ArrowDown' },
  left:      { vk: 37, code: 'ArrowLeft',  key: 'ArrowLeft' },
  right:     { vk: 39, code: 'ArrowRight', key: 'ArrowRight' },
  home:      { vk: 36, code: 'Home',       key: 'Home' },
  end:       { vk: 35, code: 'End',        key: 'End' },
  pageup:    { vk: 33, code: 'PageUp',     key: 'PageUp' },
  pagedown:  { vk: 34, code: 'PageDown',   key: 'PageDown' },
};
const MODS = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 };

function resolveKey(name) {
  if (KEYS[name.toLowerCase()]) return KEYS[name.toLowerCase()];
  if (/^f([1-9]|1[0-2])$/i.test(name)) {
    const n = parseInt(name.slice(1), 10);
    return { vk: 111 + n, code: 'F' + n, key: 'F' + n };
  }
  if (name.length === 1) {
    const ch = name;
    const vk = ch.toUpperCase().charCodeAt(0);
    const isLetter = /[a-z]/i.test(ch);
    return { vk, code: isLetter ? 'Key' + ch.toUpperCase() : 'Digit' + ch, key: ch, text: ch };
  }
  return null;
}

const args = process.argv.slice(2);
const target = args.find(a => a.startsWith('-t='))?.slice(3) || null;
const keys = args.filter(a => !a.startsWith('-t='));

if (!keys.length) {
  console.log('Usage: browser-key.js [-t=<tab>] <key> [<key> ...]   e.g. Enter | Tab | "Cmd+a"');
  console.log('Keys: ' + Object.keys(KEYS).join(' ') + ' F1..F12 <char>');
  process.exit(1);
}

for (const token of keys) {
  const parts = token.split('+');
  const keyName = parts.pop();
  let modifiers = 0;
  for (const p of parts) {
    const m = MODS[p.toLowerCase()];
    if (m == null) { console.error(`Unknown modifier: ${p}`); process.exit(1); }
    modifiers |= m;
  }
  const k = resolveKey(keyName);
  if (!k) { console.error(`Unknown key: ${keyName}`); process.exit(1); }

  const base = {
    windowsVirtualKeyCode: k.vk,
    nativeVirtualKeyCode: k.vk,
    code: k.code,
    key: k.key,
    modifiers,
  };
  // text only flows on keyDown when there are no non-shift modifiers
  const sendText = k.text != null && (modifiers & ~8) === 0;
  await run(target, 'raw', ['Input.dispatchKeyEvent', JSON.stringify({
    type: sendText ? 'keyDown' : 'rawKeyDown',
    ...base,
    ...(sendText ? { text: k.text, unmodifiedText: k.text } : {}),
  })]);
  await run(target, 'raw', ['Input.dispatchKeyEvent', JSON.stringify({ type: 'keyUp', ...base })]);
}

console.log(`Sent: ${keys.join(' ')}`);
process.exit(0);
