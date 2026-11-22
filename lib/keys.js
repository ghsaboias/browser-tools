// lib/keys.js — key names → CDP Input.dispatchKeyEvent parameters.
// Shared by browser-key.js and the daemon's `press` and human typing.

export const KEYS = {
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
export const MODS = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, command: 4, shift: 8 };

export function resolveKey(name) {
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


/** Parse "Cmd+a" style chords into the two dispatchKeyEvent payloads (down, up). */
export function chordEvents(token) {
  const parts = token.split('+');
  const keyName = parts.pop();
  let modifiers = 0;
  for (const p of parts) {
    const m = MODS[p.toLowerCase()];
    if (m == null) throw new Error(`Unknown modifier: ${p}`);
    modifiers |= m;
  }
  const k = resolveKey(keyName);
  if (!k) throw new Error(`Unknown key: ${keyName}`);
  const base = { windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, code: k.code, key: k.key, modifiers };
  // text only flows on keyDown when there are no non-shift modifiers
  const sendText = k.text != null && (modifiers & ~8) === 0;
  const down = { type: sendText ? 'keyDown' : 'rawKeyDown', ...base, ...(sendText ? { text: k.text, unmodifiedText: k.text } : {}) };
  return [down, { type: 'keyUp', ...base }];
}

/** Payloads that type one character the way a keyboard would. */
export function charEvents(ch) {
  if (ch === '\n') return chordEvents('Enter');
  if (ch === ' ') return chordEvents('Space');
  const k = /^[a-z0-9]$/i.test(ch) ? resolveKey(ch) : null;
  if (k) {
    const upper = /[A-Z]/.test(ch);
    const base = { windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, code: k.code, key: ch, modifiers: upper ? 8 : 0 };
    return [{ type: 'keyDown', ...base, text: ch, unmodifiedText: ch }, { type: 'keyUp', ...base }];
  }
  // Punctuation, accented and other characters: a keyDown carrying the text, without a
  // virtual key code that a page could read as another key ('.' is 46, Delete).
  return [{ type: 'keyDown', key: ch, text: ch, unmodifiedText: ch }, { type: 'keyUp', key: ch }];
}
