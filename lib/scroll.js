// Scrolls a feed by a mouse-wheel event. Brave delivers wheel events only to the tab in front, and with
// several capture windows open at once another window regularly takes the front: the dispatch then times out.
// Each failure brings this tab back to the front and tries again; only repeated failures end the capture.
import { run } from './client.js';

const ATTEMPTS = 4;

export async function scrollFeed(tab, deltaY) {
  const event = JSON.stringify({ type: 'mouseWheel', x: 700, y: 500, deltaX: 0, deltaY });
  for (let attempt = 1; ; attempt++) {
    try {
      await run(tab, 'raw', ['Input.dispatchMouseEvent', event]);
      return;
    } catch (e) {
      if (attempt === ATTEMPTS) throw new Error(`${e.message} (${ATTEMPTS} tentativas, com a aba trazida para a frente a cada uma)`);
      await run(tab, 'raw', ['Page.bringToFront', '{}']).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}
