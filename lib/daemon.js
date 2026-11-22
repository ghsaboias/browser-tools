#!/usr/bin/env node
// Single browser daemon. Holds one CDP WebSocket, multiplexes tabs via sessionId
// (passed on every call, so concurrent clients never trade sessions).
// Scripts talk to it via Unix socket. Auto-exits after 20min idle.

import net from 'net';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CDPClient, detectBrowser, TIMEOUT } from './cdp.js';
import { Tab } from './tab.js';
import { RUNTIME_DIR, SOCK_PATH } from './paths.js';

// Each fresh CDP connection costs a consent prompt in the browser, so the daemon
// is long-lived by design. Override with BROWSER_TOOLS_IDLE_MINUTES; 0 = never.
const IDLE_MINUTES = process.env.BROWSER_TOOLS_IDLE_MINUTES
  ? parseInt(process.env.BROWSER_TOOLS_IDLE_MINUTES)
  : 12 * 60;
const IDLE_TIMEOUT = IDLE_MINUTES > 0 ? IDLE_MINUTES * 60 * 1000 : null;

const cdp = new CDPClient();
const { wsUrl } = await detectBrowser();
await cdp.connect(wsUrl);

// targetId → sessionId cache
const sessions = new Map();

// targetId → last time a client touched it (or we first saw it). Reported by
// `list` as idleMs so browser-reap.js can close abandoned tabs. Kept on disk:
// the reap timer's oneshot unit kills a daemon it spawned when it exits, and a
// fresh daemon that saw every tab as new never reaped anything.
const IDLE_FILE = join(RUNTIME_DIR, 'idle.json');
const lastActive = new Map();
function saveIdle() {
  try { writeFileSync(IDLE_FILE, JSON.stringify(Object.fromEntries(lastActive))); } catch {}
}
const touch = (targetId) => { lastActive.set(targetId, Date.now()); saveIdle(); };
const forget = (targetId) => { if (lastActive.delete(targetId)) saveIdle(); };
try {
  const { targetInfos } = await cdp.send('Target.getTargets', {}, TIMEOUT, null);
  const live = new Set(targetInfos.map(t => t.targetId));
  for (const [id, ts] of Object.entries(JSON.parse(readFileSync(IDLE_FILE, 'utf8')))) {
    if (live.has(id)) lastActive.set(id, ts);
  }
} catch {}
await cdp.send('Target.setDiscoverTargets', { discover: true }, TIMEOUT, null);
cdp.on('Target.targetCreated', ({ targetInfo }) => {
  if (targetInfo.type === 'page' && !lastActive.has(targetInfo.targetId)) touch(targetInfo.targetId);
});

// targetId → Tab (session, refs, pointer, child frames)
const tabs = new Map();
async function getTab(targetId) {
  if (tabs.has(targetId)) return tabs.get(targetId);
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }, TIMEOUT, null);
  const tab = new Tab(cdp, targetId, sessionId);
  tabs.set(targetId, tab);
  try { await tab.init(); } catch (e) { tabs.delete(targetId); tab.dispose(); throw e; }
  return tab;
}
function dropTab(targetId) {
  const tab = tabs.get(targetId);
  if (tab) { tab.dispose(); tabs.delete(targetId); }
}

// Clean up dead sessions
cdp.on('Target.detachedFromTarget', ({ sessionId }) => {
  for (const [tid, tab] of tabs) if (tab.sid === sessionId) dropTab(tid);
});
cdp.on('Target.targetDestroyed', ({ targetId }) => { dropTab(targetId); forget(targetId); unname(targetId); });

// Tab names: `open --name=mail` opens a tab once and finds it again by name. Kept on
// disk so a daemon restart keeps them; a browser restart closes the tabs and the
// names go with them.
const NAMES_FILE = join(RUNTIME_DIR, 'names.json');
let names = {};
try { names = JSON.parse(readFileSync(NAMES_FILE, 'utf8')); } catch {}
{
  const { targetInfos } = await cdp.send('Target.getTargets', {}, TIMEOUT, null);
  const live = new Set(targetInfos.map(t => t.targetId));
  for (const [n, id] of Object.entries(names)) if (!live.has(id)) delete names[n];
}
const saveNames = () => { try { writeFileSync(NAMES_FILE, JSON.stringify(names)); } catch {} };
function unname(targetId) {
  let changed = false;
  for (const [n, id] of Object.entries(names)) if (id === targetId) { delete names[n]; changed = true; }
  if (changed) saveNames();
}
const nameOf = (targetId) => Object.keys(names).find(n => names[n] === targetId);

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

let idleTimer = IDLE_TIMEOUT ? setTimeout(shutdown, IDLE_TIMEOUT) : null;
function resetIdle() {
  if (!IDLE_TIMEOUT) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
}

// --- Commands ---

async function cmdList() {
  const { targetInfos } = await cdp.send('Target.getTargets', {}, TIMEOUT, null);
  const now = Date.now();
  return targetInfos.filter(t =>
    t.type === 'page' &&
    !t.url.startsWith('chrome://') &&
    !t.url.startsWith('brave://') &&
    !t.url.startsWith('edge://') &&
    !t.url.startsWith('chrome-extension://') &&
    !t.url.startsWith('devtools://')
  ).map(t => {
    if (!lastActive.has(t.targetId)) touch(t.targetId);
    return { ...t, idleMs: now - lastActive.get(t.targetId), name: nameOf(t.targetId) };
  });
}

const opts = (a) => (a ? JSON.parse(a) : {});

// The page's own world, where its globals live and where hooks on fetch/XHR take effect
// (the capture scripts depend on both). `{"isolated":true}` runs in an isolated world:
// same DOM, but the page cannot see the call or trap the DOM methods it uses.
async function cmdEval(t, args) {
  if (opts(args[1]).isolated) return t.evalIsolated(args[0]);
  const { result, exceptionDetails } = await t.send('Runtime.evaluate', {
    expression: args[0], returnByValue: true, awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value !== undefined ? result.value : result;
}

async function cmdShot(t, args) {
  await t.ensureVisible();
  const o = opts(args[1]);
  const params = { format: 'png' };
  if (o.full) {
    const { cssContentSize: c } = await t.send('Page.getLayoutMetrics');
    params.clip = { x: 0, y: 0, width: c.width, height: c.height, scale: 1 };
    params.captureBeyondViewport = true;
  } else if (o.ref) {
    const b = await t.box(await t.resolve(o.ref));
    params.clip = { ...b, scale: 1 };
  }
  const { data } = await t.send('Page.captureScreenshot', params);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filepath = args[0] || join(tmpdir(), `screenshot-${ts}.png`);
  writeFileSync(filepath, Buffer.from(data, 'base64'));
  const dpr = await t.evalIsolated('window.devicePixelRatio');
  return { file: filepath, dpr: dpr || 1 };
}

async function cmdHtml(t, args) {
  if (args[0]) {
    const e = await t.resolve(args[0]);
    const { outerHTML } = await t.send('DOM.getOuterHTML', { backendNodeId: e.backendNodeId }, e.sid);
    return outerHTML;
  }
  return t.evalIsolated('document.documentElement.outerHTML');
}

async function cmdCookies(t) {
  const { cookies } = await t.send('Network.getCookies', {});
  return cookies;
}

async function cmdResize(t, args) {
  const w = parseInt(args[0]), h = parseInt(args[1]);
  if (isNaN(w) || isNaN(h)) throw new Error('Usage: resize <w> <h>');
  await t.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 0, mobile: w <= 768 });
  return `Viewport: ${w}x${h}`;
}

async function cmdNet(t) {
  return JSON.parse(await t.evalIsolated(
    `JSON.stringify(performance.getEntriesByType('resource').map(r=>({name:r.name,type:r.initiatorType,duration:Math.round(r.duration),size:r.transferSize,start:Math.round(r.startTime)})))`));
}

async function cmdRaw(t, args) {
  if (!args[0]) throw new Error('Usage: raw <method> [paramsJSON]');
  return t.send(args[0], args[1] ? JSON.parse(args[1]) : {});
}

async function cmdLoadAll(t, args) {
  if (!args[0]) throw new Error('Usage: loadall <selector> [delay_ms]');
  const delay = parseInt(args[1]) || 1500;
  let clicks = 0;
  while (await t.evalIsolated(`(()=>{const el=document.querySelector(${JSON.stringify(args[0])});if(!el)return false;el.click();return true;})()`)) {
    clicks++;
    await new Promise(r => setTimeout(r, delay));
  }
  return `Clicked "${args[0]}" ${clicks} times`;
}

async function cmdInjectOnNav(t, args) {
  if (!args[0]) throw new Error('Usage: injecton <script>');
  const { identifier } = await t.send('Page.addScriptToEvaluateOnNewDocument', { source: args[0] });
  return identifier;
}

async function cmdEnableNetwork(t) {
  await t.send('Network.enable', {});
  return 'enabled';
}

const need = (v, usage) => { if (v == null || v === '') throw new Error(`Usage: ${usage}`); return v; };

const CMDS = {
  eval: cmdEval, shot: cmdShot, html: cmdHtml, cookies: cmdCookies, resize: cmdResize,
  net: cmdNet, raw: cmdRaw, loadall: cmdLoadAll, injecton: cmdInjectOnNav, networkenable: cmdEnableNetwork,
  nav: (t, a) => t.nav(need(a[0], 'nav <url>')),
  url: (t) => t.url(),
  snap: (t, a) => t.snapshot(opts(a[0])),
  find: (t, a) => t.find(a[0], a[1]),
  click: (t, a) => t.click(need(a[0], 'click <ref|selector>'), opts(a[1])),
  clickxy: (t, a) => t.clickAt(need(a[0], 'clickxy <x> <y>'), need(a[1], 'clickxy <x> <y>')),
  hover: (t, a) => t.hover(need(a[0], 'hover <ref|selector>')),
  fill: (t, a) => t.fill(need(a[0], 'fill <ref|selector> <text>'), a[1] ?? ''),
  type: async (t, a) => { await t.typeText(need(a[0], 'type <text>')); return `typed ${a[0].length} chars`; },
  press: (t, a) => t.press(a.length ? a : need(null, 'press <key> [...]')),
  select: (t, a) => t.select(need(a[0], 'select <ref|selector> <value> [...]'), a.slice(1)),
  scroll: (t, a) => t.scroll(a[0]),
  wait: (t, a) => t.waitFor(opts(a[0])),
};

async function cmdOpen(args) {
  const url = args[0] || 'about:blank';
  const { name, bounds } = opts(args[1]);
  if (name && names[name]) return { targetId: names[name], existed: true };
  // Each tab gets its own window: a tab behind another in the same window is hidden,
  // draws no frames, and CDP input sent to it never completes. The window opens in the
  // background, so it never takes keyboard focus from the user (Mac); bounds place it
  // (tiles, browser-window.js).
  const { targetId } = await cdp.send('Target.createTarget',
    { url, newWindow: true, background: true, ...(bounds || {}) }, TIMEOUT, null);
  touch(targetId);
  if (name) { names[name] = targetId; saveNames(); }
  return { targetId, existed: false };
}

async function cmdCloseTab(args) {
  if (!args[0]) throw new Error('Usage: closetab <targetId>');
  dropTab(args[0]);
  await cdp.send('Target.closeTarget', { targetId: args[0] }, TIMEOUT, null);
  return 'closed';
}

async function handle({ cmd, target, args = [] }) {
  resetIdle();
  try {
    if (cmd === 'list') return { ok: true, result: JSON.stringify(await cmdList()) };
    if (cmd === 'stop') return { ok: true, result: 'stopped', stop: true };
    if (cmd === 'open') return { ok: true, result: JSON.stringify(await cmdOpen(args)) };
    if (cmd === 'closetab') return { ok: true, result: await cmdCloseTab(args) };
    if (!CMDS[cmd]) return { ok: false, error: `Unknown: ${cmd}` };
    if (!target) return { ok: false, error: 'Missing target' };
    touch(target);
    const r = await CMDS[cmd](await getTab(target), args);
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
