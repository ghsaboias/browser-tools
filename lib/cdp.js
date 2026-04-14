// lib/cdp.js — Raw CDP WebSocket client + browser detection.
// Zero dependencies, Node 22+ (built-in WebSocket).

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';

export const TIMEOUT = 15_000;
export const NAV_TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// Browser detection — finds DevToolsActivePort
// ---------------------------------------------------------------------------

export function detectBrowser() {
  if (process.env.CDP_PORT_FILE) {
    const pf = process.env.CDP_PORT_FILE;
    if (!existsSync(pf)) throw new Error(`CDP_PORT_FILE not found: ${pf}`);
    return readPort(pf);
  }

  const home = homedir();
  const mac = [
    'BraveSoftware/Brave-Browser', 'Google/Chrome', 'Google/Chrome Beta',
    'Google/Chrome for Testing', 'Chromium', 'Microsoft Edge',
  ];
  const linux = [
    'BraveSoftware/Brave-Browser', 'google-chrome', 'google-chrome-beta',
    'chromium', 'vivaldi', 'microsoft-edge',
  ];

  const candidates = [
    ...mac.flatMap(b => [
      resolve(home, 'Library/Application Support', b, 'DevToolsActivePort'),
      resolve(home, 'Library/Application Support', b, 'Default/DevToolsActivePort'),
    ]),
    ...linux.flatMap(b => [
      resolve(home, '.config', b, 'DevToolsActivePort'),
      resolve(home, '.config', b, 'Default/DevToolsActivePort'),
    ]),
  ];

  const found = candidates.find(p => existsSync(p));
  if (!found) {
    throw new Error(
      'No DevToolsActivePort found.\n' +
      'Enable remote debugging at brave://inspect/#remote-debugging'
    );
  }
  return readPort(found);
}

function readPort(portFile) {
  const lines = readFileSync(portFile, 'utf8').trim().split('\n');
  if (lines.length < 2 || !lines[0] || !lines[1]) {
    throw new Error(`Invalid DevToolsActivePort: ${portFile}`);
  }
  const host = process.env.CDP_HOST || '127.0.0.1';
  return {
    port: parseInt(lines[0]),
    wsPath: lines[1],
    wsUrl: `ws://${host}:${lines[0]}${lines[1]}`,
    portFile,
  };
}

// ---------------------------------------------------------------------------
// CDP WebSocket client
// ---------------------------------------------------------------------------

export class CDPClient {
  #ws; #id = 0; #pending = new Map(); #timers = new Map();
  #events = new Map(); #closeHandlers = [];

  /** Set after attachToTarget — included in all send() calls. */
  sessionId = null;

  connect(wsUrl) {
    return new Promise((res, rej) => {
      this.#ws = new WebSocket(wsUrl);
      this.#ws.onopen = () => res(this);
      this.#ws.onerror = (e) => rej(new Error('WebSocket error: ' + (e.message || e.type)));
      this.#ws.onclose = () => {
        for (const t of this.#timers.values()) clearTimeout(t);
        this.#timers.clear();
        for (const { reject } of this.#pending.values()) reject(new Error('WebSocket closed'));
        this.#pending.clear();
        this.#closeHandlers.forEach(h => h());
      };
      this.#ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id != null && this.#pending.has(msg.id)) {
          const { resolve, reject } = this.#pending.get(msg.id);
          this.#pending.delete(msg.id);
          clearTimeout(this.#timers.get(msg.id));
          this.#timers.delete(msg.id);
          msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
        } else if (msg.method) {
          const handlers = this.#events.get(msg.method);
          if (handlers) for (const h of handlers) h(msg.params || {});
        }
      };
    });
  }

  send(method, params = {}, timeout = TIMEOUT) {
    const id = ++this.#id;
    const payload = { id, method, params };
    if (this.sessionId) payload.sessionId = this.sessionId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify(payload));
      if (timeout > 0) {
        const timer = setTimeout(() => {
          if (this.#pending.has(id)) {
            this.#pending.delete(id);
            this.#timers.delete(id);
            reject(new Error(`CDP timeout: ${method} (${timeout}ms)`));
          }
        }, timeout);
        this.#timers.set(id, timer);
      }
    });
  }

  on(method, handler) {
    if (!this.#events.has(method)) this.#events.set(method, new Set());
    this.#events.get(method).add(handler);
    return () => this.#events.get(method)?.delete(handler);
  }

  waitFor(method, timeout = TIMEOUT) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error(`Timeout: ${method}`)); }, timeout);
      const off = this.on(method, (params) => { clearTimeout(timer); off(); resolve(params); });
    });
  }

  onClose(handler) { this.#closeHandlers.push(handler); }
  close() { this.#ws?.close(); }
}
