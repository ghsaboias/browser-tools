// Clicks an element the way a person does: a pause before acting, the wheel to bring the element into view when it sits
// outside the viewport, the pointer moved there in small eased steps, and a press held for a moment at a random point
// inside the element. The events are real input (Input.dispatchMouseEvent, isTrusted), not element.click(), so the
// window must be visible, as for scrollFeed.
import { run } from './client.js';
import { scrollFeed } from './scroll.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const between = (a, b) => a + Math.random() * (b - a);

// locate: a JS expression that evaluates to the element, or to null when it is absent.
// Returns false when the element is absent or never comes into view, true once clicked.
export async function clickElement(tab, locate) {
  const rect = async () => JSON.parse(await run(tab, 'eval', [`(() => { const e = (${locate}); if (!e) return 'null';
    const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }) })()`]));
  await sleep(between(700, 1600));
  let r = await rect();
  for (let i = 0; r && (r.y < 0 || r.y + r.h > r.vh) && i < 4; i++) {
    await scrollFeed(tab, Math.round(r.y + r.h / 2 - r.vh / 2 + between(-40, 40)));
    await sleep(between(400, 900));
    r = await rect();
  }
  if (!r || r.w === 0 || r.y < 0 || r.y + r.h > r.vh) return false;
  const to = { x: r.x + r.w * between(0.3, 0.7), y: r.y + r.h * between(0.3, 0.7) };
  const from = { x: r.vw * between(0.35, 0.65), y: r.vh * between(0.35, 0.65) };
  const steps = Math.round(between(8, 15));
  const mouse = (type, x, y, extra = {}) => run(tab, 'raw', ['Input.dispatchMouseEvent', JSON.stringify({ type, x: Math.round(x), y: Math.round(y), ...extra })]);
  for (let s = 1; s <= steps; s++) {
    const t = 1 - (1 - s / steps) ** 3;
    const jitter = s < steps ? between(-2, 2) : 0;
    await mouse('mouseMoved', from.x + (to.x - from.x) * t + jitter, from.y + (to.y - from.y) * t + jitter);
    await sleep(between(12, 30));
  }
  await sleep(between(80, 250));
  await mouse('mousePressed', to.x, to.y, { button: 'left', buttons: 1, clickCount: 1 });
  await sleep(between(60, 150));
  await mouse('mouseReleased', to.x, to.y, { button: 'left', buttons: 0, clickCount: 1 });
  return true;
}
