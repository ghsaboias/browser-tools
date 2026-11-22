// Clicks an element the way a person does, for scripts that locate it with a JS expression (lib/tiktok.js): a pause
// before acting, then the daemon's click (lib/tab.js), which wheels the element into view, moves the pointer there on a
// curved path and presses at a random point inside it, with real input events (isTrusted). The window must be visible.
import { run } from './client.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const between = (a, b) => a + Math.random() * (b - a);

// locate: a JS expression that evaluates to the element (DOM only), or to null when it is absent.
// Returns false when the element is absent, hidden or covered, true once clicked.
export async function clickElement(tab, locate) {
  await sleep(between(700, 1600));
  try {
    await run(tab, 'click', [`js:${locate}`, JSON.stringify({ settle: false })]);
    return true;
  } catch (e) {
    if (/No element matches|not visible|has no layout|is covered by/.test(e.message)) return false;
    throw e;
  }
}
