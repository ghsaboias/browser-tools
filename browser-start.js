#!/usr/bin/env node
// Launch a dedicated Chromium/Chrome with remote debugging, for machines without
// a live GUI browser session (e.g. a headless Pi). Idempotent: if the browser
// from a previous run is still alive, prints its info and exits.
//
// Usage:
//   browser-start.js [--headed] [--foreground] [--kill] [--check] [<url>]
//
// Profile lives in ~/.config/browser-tools/profile (persists cookies/logins).
// Headless by default; --headed opens a window (Linux: DISPLAY, defaulting to :99 = the
// browser-tools Xvfb service on the Pi).
// --kill stops the browser started by this script.
// --check exits 0 if the browser's DevTools socket answers, 1 otherwise (watchdog).
// --foreground keeps this process alive until the browser exits and stops the
//   browser on SIGTERM/SIGINT (for systemd Type=simple units).
//
// Env: BROWSER_TOOLS_BIN (binary), BROWSER_TOOLS_PROFILE (profile dir),
//      BROWSER_TOOLS_FLAGS (extra launch flags, space-separated).
import { spawn, execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, openSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';
import { PROFILE_DIR, PROFILE_PORT_FILE } from './lib/paths.js';

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const kill = args.includes('--kill');
const foreground = args.includes('--foreground');
const check = args.includes('--check');
const url = args.find(a => !a.startsWith('-')) || 'about:blank';
const PID_FILE = resolve(PROFILE_DIR, 'browser-tools.pid');
const LOG_FILE = resolve(PROFILE_DIR, 'browser.log');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function readPortFile() {
  if (!existsSync(PROFILE_PORT_FILE)) return null;
  const [port, path] = readFileSync(PROFILE_PORT_FILE, 'utf8').trim().split('\n');
  if (!port || !path) return null;
  return { port, wsUrl: `ws://127.0.0.1:${port}${path}` };
}

async function alive(wsUrl) {
  return new Promise((res) => {
    let ws;
    try { ws = new WebSocket(wsUrl); } catch { return res(false); }
    const t = setTimeout(() => { ws.close(); res(false); }, 2000);
    ws.onopen = () => { clearTimeout(t); ws.close(); res(true); };
    ws.onerror = () => { clearTimeout(t); res(false); };
  });
}

function findBinary() {
  if (process.env.BROWSER_TOOLS_BIN) return process.env.BROWSER_TOOLS_BIN;
  const mac = [
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  const linux = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'brave-browser'];
  if (process.platform === 'darwin') {
    const hit = mac.find(p => existsSync(p));
    if (hit) return hit;
  }
  for (const name of linux) {
    try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); } catch {}
  }
  throw new Error('No Chromium/Chrome binary found. Set BROWSER_TOOLS_BIN.');
}

async function cdpClose(wsUrl) {
  return new Promise((res) => {
    let ws;
    try { ws = new WebSocket(wsUrl); } catch { return res(false); }
    const t = setTimeout(() => { ws.close(); res(false); }, 2000);
    ws.onopen = () => { ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); };
    ws.onclose = () => { clearTimeout(t); res(true); };
    ws.onerror = () => { clearTimeout(t); res(false); };
  });
}

async function stopBrowser() {
  let pid = null;
  try { pid = parseInt(readFileSync(PID_FILE, 'utf8')); } catch {}
  const info = readPortFile();
  // Graceful first: Browser.close over CDP (headless Chromium ignores SIGTERM).
  if (info && await alive(info.wsUrl)) await cdpClose(info.wsUrl);
  if (pid) {
    for (let i = 0; i < 10; i++) {
      try { process.kill(pid, 0); } catch { pid = null; break; }
      await sleep(500);
    }
    // Still up: spawn() with detached makes it a process-group leader, so -pid takes the tree.
    if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch {} } }
  }
  try { unlinkSync(PID_FILE); } catch {}
  try { unlinkSync(PROFILE_PORT_FILE); } catch {}
}

if (check) {
  const info = readPortFile();
  const ok = info ? await alive(info.wsUrl) : false;
  console.log(ok ? `alive: ${info.wsUrl}` : 'dead: no DevTools socket');
  process.exit(ok ? 0 : 1);
}

if (kill) {
  await stopBrowser();
  console.log('Stopped');
  process.exit(0);
}

const existing = readPortFile();
if (existing && await alive(existing.wsUrl)) {
  console.log(`Already running: ${existing.wsUrl}`);
  process.exit(0);
}
try { unlinkSync(PROFILE_PORT_FILE); } catch {}  // stale from an unclean exit

mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
const bin = findBinary();
const flags = [
  '--remote-debugging-port=0',
  `--user-data-dir=${PROFILE_DIR}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-search-engine-choice-screen',
  '--window-size=1280,900',
];
// Without this, the first network request blocks ~25s on a D-Bus keyring lookup
// (cookie store waits for OSCrypt) on headless Linux. Cookies are then stored
// with Chromium's fixed "basic" key instead of a system keyring.
if (process.platform === 'linux') flags.push('--password-store=basic');
if (process.platform === 'darwin') flags.push('--use-mock-keychain');
// Clears navigator.webdriver, which a remote-debugging port otherwise sets to true.
flags.push('--disable-blink-features=AutomationControlled');
if (!headed) flags.push('--headless=new', '--disable-gpu', '--hide-scrollbars');
// Headed on Linux is normally an Xvfb display with no GPU: software WebGL via
// SwiftShader. Bot challenges (e.g. Vercel Security Checkpoint) fail without WebGL.
if (headed && process.platform === 'linux') {
  flags.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
  // Headed Chromium exits when its last tab closes; other clients (michael-slack)
  // open and close their own tabs, so keep the browser alive with zero windows.
  flags.push('--keep-alive-for-test');
}
if (process.env.BROWSER_TOOLS_FLAGS) flags.push(...process.env.BROWSER_TOOLS_FLAGS.split(/\s+/).filter(Boolean));
flags.push(url);

const env = { ...process.env };
// Headed on Linux without a DISPLAY: assume the browser-tools Xvfb display (:99).
if (headed && process.platform === 'linux' && !env.DISPLAY) env.DISPLAY = ':99';
const log = openSync(LOG_FILE, 'w');
const child = spawn(bin, flags, { detached: true, stdio: ['ignore', log, log], env });
if (!foreground) child.unref();  // foreground: the child handle keeps the event loop alive
writeFileSync(PID_FILE, String(child.pid));

for (let i = 0; i < 40; i++) {
  await sleep(500);
  const info = readPortFile();
  if (info && await alive(info.wsUrl)) {
    console.log(`Started ${headed ? 'headed' : 'headless'} ${bin} (pid ${child.pid})\n${info.wsUrl}`);
    if (!foreground) process.exit(0);
    let stopping = false;
    const onSignal = async () => {
      if (stopping) return;
      stopping = true;
      await stopBrowser();
      process.exit(0);
    };
    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);
    child.on('exit', (code) => {
      if (stopping) return;
      try { unlinkSync(PID_FILE); } catch {}
      console.error(`Browser exited (${code})`);
      process.exit(code === 0 ? 0 : 1);
    });
    await new Promise(() => {});  // wait for browser exit or a signal
  }
}
console.error('Browser did not expose a DevTools port within 20s');
process.exit(1);
