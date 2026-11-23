// Scrolls a feed by mouse-wheel events, the way a hand on a wheel does: the distance varies 15% either side of the one
// asked (same mean), it arrives in 2 to 4 ticks 25 to 70 ms apart, and the pointer sits at a random point in the middle
// of the viewport instead of its exact centre. Brave delivers wheel events only to a tab whose window is visible: tiled
// on a monitor (browser-window.js --tile) it scrolls while the user works elsewhere, and keyboard focus is never taken.
// A minimized or fully covered window times out; then this restores the window, brings the tab to the front (which
// does take focus) and tries again; only repeated failures end the capture.
import { run } from './client.js';
import { HUMAN, between, sleep } from './human.js';

const ATTEMPTS = 4;

async function wheel(tab, event) {
  for (let attempt = 1; ; attempt++) {
    try {
      await run(tab, 'raw', ['Input.dispatchMouseEvent', JSON.stringify(event)]);
      return;
    } catch (e) {
      if (attempt === ATTEMPTS) throw new Error(`${e.message} (${ATTEMPTS} tentativas, com a janela restaurada e a aba trazida para a frente a cada uma)`);
      try {
        const w = await run(tab, 'raw', ['Browser.getWindowForTarget', '{}']);
        const { windowId } = typeof w === 'string' ? JSON.parse(w) : w;
        await run(tab, 'raw', ['Browser.setWindowBounds', JSON.stringify({ windowId, bounds: { windowState: 'normal' } })]);
      } catch {}
      await run(tab, 'raw', ['Page.bringToFront', '{}']).catch(() => {});
      await sleep(3000);
    }
  }
}

export async function scrollFeed(tab, deltaY) {
  const [w, h] = JSON.parse(await run(tab, 'eval', ['JSON.stringify([innerWidth, innerHeight])']));
  const x = Math.round(w * (HUMAN ? between(0.35, 0.65) : 0.5)), y = Math.round(h * (HUMAN ? between(0.35, 0.65) : 0.5));
  const total = HUMAN ? deltaY * between(0.85, 1.15) : deltaY;
  const ticks = HUMAN ? 2 + Math.floor(Math.random() * 3) : 1;
  for (let i = 0; i < ticks; i++) {
    if (i) await sleep(between(25, 70));
    await wheel(tab, { type: 'mouseWheel', x, y, deltaX: 0, deltaY: Math.round(total / ticks) });
  }
}
