// Scrolls a feed by a mouse-wheel event at the centre of the viewport. Brave delivers wheel events only to a tab whose
// window is visible: tiled on a monitor (browser-window.js --tile) it scrolls while the user works elsewhere, and keyboard
// focus is never taken. A minimized or fully covered window times out; then this restores the window, brings the tab to
// the front (which does take focus) and tries again; only repeated failures end the capture.
import { run } from './client.js';

const ATTEMPTS = 4;

export async function scrollFeed(tab, deltaY) {
  const [x, y] = JSON.parse(await run(tab, 'eval', ['JSON.stringify([innerWidth >> 1, innerHeight >> 1])']));
  const event = JSON.stringify({ type: 'mouseWheel', x, y, deltaX: 0, deltaY });
  for (let attempt = 1; ; attempt++) {
    try {
      await run(tab, 'raw', ['Input.dispatchMouseEvent', event]);
      return;
    } catch (e) {
      if (attempt === ATTEMPTS) throw new Error(`${e.message} (${ATTEMPTS} tentativas, com a janela restaurada e a aba trazida para a frente a cada uma)`);
      try {
        const w = await run(tab, 'raw', ['Browser.getWindowForTarget', '{}']);
        const { windowId } = typeof w === 'string' ? JSON.parse(w) : w;
        await run(tab, 'raw', ['Browser.setWindowBounds', JSON.stringify({ windowId, bounds: { windowState: 'normal' } })]);
      } catch {}
      await run(tab, 'raw', ['Page.bringToFront', '{}']).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}
