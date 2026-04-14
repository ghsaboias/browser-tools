#!/usr/bin/env node
// Single browser daemon. Holds one CDP WebSocket, multiplexes tabs via sessionId.
// Scripts talk to it via Unix socket. Auto-exits after 20min idle.

import net from 'net';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CDPClient, detectBrowser, TIMEOUT, NAV_TIMEOUT } from './cdp.js';
import { RUNTIME_DIR, SOCK_PATH } from './paths.js';

const IDLE_TIMEOUT = 20 * 60 * 1000;

const cdp = new CDPClient();
const { wsUrl } = detectBrowser();
await cdp.connect(wsUrl);

// targetId → sessionId cache
const sessions = new Map();

async function getSession(targetId) {
  if (sessions.has(targetId)) return sessions.get(targetId);
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  sessions.set(targetId, sessionId);
  return sessionId;
}

// Clean up dead sessions
cdp.on('Target.detachedFromTarget', ({ sessionId }) => {
  for (const [tid, sid] of sessions) {
    if (sid === sessionId) { sessions.delete(tid); break; }
  }
});
cdp.on('Target.targetDestroyed', ({ targetId }) => sessions.delete(targetId));

// Lifecycle
let alive = true;
function shutdown() {
  if (!alive) return;
  alive = false;
  server.close();
  try { unlinkSync(SOCK_PATH); } catch {}
  cdp.close();
  process.exit(0);
}
cdp.onClose(shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

let idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
}

// --- Commands ---

async function cmdList() {
  cdp.sessionId = null;  // browser-level command
  const { targetInfos } = await cdp.send('Target.getTargets');
  return targetInfos.filter(t =>
    t.type === 'page' &&
    !t.url.startsWith('chrome://') &&
    !t.url.startsWith('brave://') &&
    !t.url.startsWith('edge://') &&
    !t.url.startsWith('chrome-extension://') &&
    !t.url.startsWith('devtools://')
  );
}

async function cmdEval(sid, args) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression: args[0], returnByValue: true, awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value !== undefined ? result.value : result;
}

async function cmdShot(sid, args) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filepath = args[0] || join(tmpdir(), `screenshot-${ts}.png`);
  writeFileSync(filepath, Buffer.from(data, 'base64'));
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: 'window.devicePixelRatio', returnByValue: true,
  });
  return { file: filepath, dpr: result.value || 1 };
}

async function cmdSnap(sid) {
  const { nodes } = await cdp.send('Accessibility.getFullAXTree', {});
  const byId = new Map();
  const kids = new Map();
  for (const n of nodes) {
    byId.set(n.nodeId, n);
    if (n.parentId != null) {
      if (!kids.has(n.parentId)) kids.set(n.parentId, []);
      kids.get(n.parentId).push(n.nodeId);
    }
  }
  const lines = [];
  function walk(id, d) {
    const n = byId.get(id);
    if (!n) return;
    const role = n.role?.value || '';
    const name = n.name?.value ?? '';
    const value = n.value?.value;
    const skip = role === 'none' || role === 'generic' || role === 'InlineTextBox';
    if (!skip && (name || (value != null && value !== ''))) {
      const indent = '  '.repeat(Math.min(d, 12));
      let line = `${indent}[${role}]`;
      if (name) line += ` ${name}`;
      if (value != null && value !== '') line += ` = ${JSON.stringify(value)}`;
      lines.push(line);
    }
    for (const kid of kids.get(id) || []) walk(kid, d + 1);
  }
  if (nodes.length) walk(nodes[0].nodeId, 0);
  return lines.join('\n');
}

async function cmdHtml(sid, args) {
  if (args[0]) {
    const { root } = await cdp.send('DOM.getDocument', {});
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: args[0] });
    if (!nodeId) throw new Error(`No element: ${args[0]}`);
    const { outerHTML } = await cdp.send('DOM.getOuterHTML', { nodeId });
    return outerHTML;
  }
  return cmdEval(sid, ['document.documentElement.outerHTML']);
}

async function cmdNav(sid, args) {
  if (!args[0]) throw new Error('Usage: nav <url>');
  await cdp.send('Page.enable');
  const loadP = cdp.waitFor('Page.loadEventFired', NAV_TIMEOUT);
  await cdp.send('Page.navigate', { url: args[0] });
  await loadP;
  return `Navigated to: ${args[0]}`;
}

async function cmdCookies(sid) {
  const { cookies } = await cdp.send('Network.getCookies', {});
  return cookies;
}

async function cmdClick(sid, args) {
  if (!args[0]) throw new Error('Usage: click <selector>');
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(args[0])}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  if (!result.value) throw new Error(`No element: ${args[0]}`);
  return cmdClickXY(sid, [result.value.x, result.value.y]);
}

async function cmdClickXY(sid, args) {
  const x = parseFloat(args[0]), y = parseFloat(args[1]);
  if (isNaN(x) || isNaN(y)) throw new Error('Usage: clickxy <x> <y>');
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  return `Clicked (${x}, ${y})`;
}

async function cmdType(sid, args) {
  if (args[0] == null) throw new Error('Usage: type <text>');
  await cdp.send('Input.insertText', { text: args[0] });
  return `Typed ${args[0].length} chars`;
}

async function cmdResize(sid, args) {
  const w = parseInt(args[0]), h = parseInt(args[1]);
  if (isNaN(w) || isNaN(h)) throw new Error('Usage: resize <w> <h>');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 0, mobile: w <= 768 });
  return `Viewport: ${w}x${h}`;
}

async function cmdNet(sid) {
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify(performance.getEntriesByType('resource').map(r=>({name:r.name,type:r.initiatorType,duration:Math.round(r.duration),size:r.transferSize,start:Math.round(r.startTime)})))`,
    returnByValue: true,
  });
  return JSON.parse(result.value);
}

async function cmdRaw(sid, args) {
  if (!args[0]) throw new Error('Usage: raw <method> [paramsJSON]');
  return cdp.send(args[0], args[1] ? JSON.parse(args[1]) : {});
}

async function cmdLoadAll(sid, args) {
  if (!args[0]) throw new Error('Usage: loadall <selector> [delay_ms]');
  const delay = parseInt(args[1]) || 1500;
  let clicks = 0;
  while (true) {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: `(()=>{const el=document.querySelector(${JSON.stringify(args[0])});if(!el)return false;el.click();return true;})()`,
      returnByValue: true,
    });
    if (!result.value) break;
    clicks++;
    await new Promise(r => setTimeout(r, delay));
  }
  return `Clicked "${args[0]}" ${clicks} times`;
}

async function cmdOpen(args) {
  const url = args[0] || 'about:blank';
  cdp.sessionId = null;  // browser-level command
  const { targetId } = await cdp.send('Target.createTarget', { url });
  return { targetId };
}

async function cmdCloseTab(args) {
  if (!args[0]) throw new Error('Usage: closetab <targetId>');
  sessions.delete(args[0]);
  cdp.sessionId = null;  // browser-level command
  await cdp.send('Target.closeTarget', { targetId: args[0] });
  return 'closed';
}

async function cmdInjectOnNav(sid, args) {
  if (!args[0]) throw new Error('Usage: injecton <script>');
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: args[0] });
  return identifier;
}

async function cmdEnableNetwork(sid) {
  await cdp.send('Network.enable', {});
  return 'enabled';
}

const CMDS = { eval: cmdEval, shot: cmdShot, snap: cmdSnap, html: cmdHtml, nav: cmdNav, cookies: cmdCookies, click: cmdClick, clickxy: cmdClickXY, type: cmdType, resize: cmdResize, net: cmdNet, raw: cmdRaw, loadall: cmdLoadAll, injecton: cmdInjectOnNav, networkenable: cmdEnableNetwork };

async function handle({ cmd, target, args = [] }) {
  resetIdle();
  if (cmd === 'list') return { ok: true, result: JSON.stringify(await cmdList()) };
  if (cmd === 'stop') return { ok: true, result: 'stopped', stop: true };
  if (cmd === 'open') {
    try { return { ok: true, result: JSON.stringify(await cmdOpen(args)) }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
  if (cmd === 'closetab') {
    try { return { ok: true, result: await cmdCloseTab(args) }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
  if (!CMDS[cmd]) return { ok: false, error: `Unknown: ${cmd}` };
  if (!target) return { ok: false, error: 'Missing target' };

  const sid = await getSession(target);
  cdp.sessionId = sid;
  try {
    const r = await CMDS[cmd](sid, args);
    return { ok: true, result: typeof r === 'string' ? r : JSON.stringify(r) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Unix socket server
const server = net.createServer((conn) => {
  let buf = '';
  conn.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let req;
      try { req = JSON.parse(line); } catch { conn.write('{"ok":false,"error":"bad json"}\n'); continue; }
      handle(req).then(res => {
        conn.write(JSON.stringify({ ...res, id: req.id }) + '\n');
        if (res.stop) setTimeout(shutdown, 100);
      });
    }
  });
});

mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 });
try { unlinkSync(SOCK_PATH); } catch {}
server.listen(SOCK_PATH);
