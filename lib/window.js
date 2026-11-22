// Display geometry and window tiles, in the browser's window coordinates (top-left origin on the primary display).
import { execFileSync } from 'child_process';

// NSScreen frames have a bottom-left origin on the primary display (macOS).
export function displays() {
  const jxa = `ObjC.import('AppKit'); const s = $.NSScreen.screens; const r = [];
    for (let i = 0; i < s.count; i++) { const v = s.objectAtIndex(i).visibleFrame, f = s.objectAtIndex(i).frame;
      r.push({ x: v.origin.x, y: v.origin.y, w: v.size.width, h: v.size.height, fh: f.size.height }) }
    JSON.stringify(r)`;
  const screens = JSON.parse(execFileSync('osascript', ['-l', 'JavaScript', '-e', jxa], { encoding: 'utf8' }));
  const primaryHeight = screens[0].fh;
  return screens.map(s => ({ left: Math.round(s.x), top: Math.round(primaryHeight - (s.y + s.h)), width: Math.round(s.w), height: Math.round(s.h) }));
}

// Tile k (0-based) of n: a grid of ceil(sqrt(n)) columns over the right half of the rightmost display (the external
// monitor when one is connected, the built-in screen otherwise). Accepts "k/n", or "k/n@left" for the left half.
export function tileBounds(spec) {
  const m = /^(\d+)\/(\d+)(@left|@right)?$/.exec(spec || '');
  if (!m) throw new Error(`tile must be k/n or k/n@left, got ${spec}`);
  const [k, n, left] = [Number(m[1]), Number(m[2]), m[3] === '@left'];
  const d = displays().sort((a, b) => b.left - a.left)[0];
  const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
  const half = { left: d.left + (left ? 0 : Math.floor(d.width / 2)), top: d.top, width: Math.ceil(d.width / 2), height: d.height };
  const width = Math.floor(half.width / cols), height = Math.floor(half.height / rows);
  return { left: half.left + (k % cols) * width, top: half.top + (Math.floor(k / cols) % rows) * height, width, height };
}
