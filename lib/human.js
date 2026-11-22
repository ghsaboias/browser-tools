// lib/human.js — input timing and paths that look like a person at the controls.
// BROWSER_TOOLS_HUMAN=0 turns the pacing off (straight moves, no delays).

export const HUMAN = process.env.BROWSER_TOOLS_HUMAN !== '0';

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

/** Pause between two input events, in ms; zero when pacing is off. */
export function pause(min, max) {
  return HUMAN ? sleep(rand(min, max)) : Promise.resolve();
}

/**
 * Points of a mouse path from `from` to `to`: a cubic Bézier with two control points
 * pulled off the straight line, eased so the pointer accelerates and settles.
 */
export function mousePath(from, to) {
  if (!HUMAN) return [to];
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return [to];
  const steps = Math.max(6, Math.min(28, Math.round(dist / 30)));
  const bend = Math.min(80, dist * 0.25);
  const nx = -dy / dist, ny = dx / dist;   // unit normal to the line
  const c1 = { x: from.x + dx * 0.3 + nx * rand(-bend, bend), y: from.y + dy * 0.3 + ny * rand(-bend, bend) };
  const c2 = { x: from.x + dx * 0.7 + nx * rand(-bend, bend), y: from.y + dy * 0.7 + ny * rand(-bend, bend) };
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const l = i / steps;
    const t = l < 0.5 ? 2 * l * l : 1 - Math.pow(-2 * l + 2, 2) / 2;   // ease in-out
    const u = 1 - t;
    pts.push({
      x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
      y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
    });
  }
  pts[pts.length - 1] = to;
  return pts;
}

/** A click point inside a box: near the centre, never on the edge. */
export function pointIn(box) {
  if (!HUMAN) return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return {
    x: box.x + box.width * rand(0.35, 0.65),
    y: box.y + box.height * rand(0.35, 0.65),
  };
}

/** Delay before the next typed character. */
export function keyDelay(ch) {
  if (!HUMAN) return Promise.resolve();
  if (ch === ' ') return sleep(rand(60, 160));
  if (/[.,;:!?]/.test(ch)) return sleep(rand(90, 220));
  return sleep(rand(30, 95));
}

/** Text longer than this is inserted at once after the first characters are typed. */
export const TYPE_LIMIT = 120;
