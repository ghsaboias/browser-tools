// Client — talks to the single browser daemon via Unix socket.

import net from 'net';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { SOCK_PATH } from './paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_SCRIPT = resolve(__dirname, 'daemon.js');
const CONNECT_RETRIES = 40;
const CONNECT_DELAY = 500;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function connectSocket() {
  return new Promise((resolve, reject) => {
    const conn = net.connect(SOCK_PATH);
    conn.on('connect', () => resolve(conn));
    conn.on('error', reject);
  });
}

async function ensureDaemon() {
  try { return await connectSocket(); } catch {}

  spawn(process.execPath, [DAEMON_SCRIPT], { detached: true, stdio: 'ignore' }).unref();

  for (let i = 0; i < CONNECT_RETRIES; i++) {
    await sleep(CONNECT_DELAY);
    try { return await connectSocket(); } catch {}
  }
  throw new Error('Daemon failed to start — did you click Allow in the browser?');
}

function sendRaw(conn, msg) {
  return new Promise((resolve, reject) => {
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf('\n');
      if (idx === -1) return;
      conn.destroy();
      resolve(JSON.parse(buf.slice(0, idx)));
    });
    conn.on('error', reject);
    conn.write(JSON.stringify(msg) + '\n');
  });
}

/** List page targets. */
export async function listTargets() {
  const conn = await ensureDaemon();
  const res = await sendRaw(conn, { id: 1, cmd: 'list' });
  if (!res.ok) throw new Error(res.error);
  return JSON.parse(res.result);
}

/** Short stable handle for a target — first 8 chars of its targetId. */
export function shortId(target) {
  return (target.targetId || '').slice(0, 8).toUpperCase();
}

/** Format a tab for user-facing lists. */
export function formatTarget(t) {
  return `  [${shortId(t)}]  ${t.title || '(untitled)'}\n            ${t.url}`;
}

/**
 * Find a target by query. Matches (case-insensitive):
 *   - targetId prefix (stable across navigations)
 *   - URL substring
 *   - title substring
 * Errors with a disambiguating tab list on zero or multiple matches.
 */
export async function findTarget(query) {
  const targets = await listTargets();
  if (targets.length === 0) throw new Error('No page targets found');
  if (!query) return targets.at(-1);

  const q = query.toLowerCase();
  const matches = targets.filter(t =>
    t.targetId?.toLowerCase().startsWith(q) ||
    t.url?.toLowerCase().includes(q) ||
    t.title?.toLowerCase().includes(q)
  );

  if (matches.length === 1) return matches[0];

  const list = targets.map(formatTarget).join('\n');
  if (matches.length === 0) {
    throw new Error(`No target matches "${query}". Available tabs:\n${list}`);
  }
  const hits = matches.map(formatTarget).join('\n');
  throw new Error(
    `Query "${query}" matches ${matches.length} tabs. Use a more specific substring or the [ID]:\n${hits}`
  );
}

/** Send a command to a tab. */
export async function run(query, cmd, args = []) {
  const target = query ? await findTarget(query) : await findTarget();
  const conn = await ensureDaemon();
  const res = await sendRaw(conn, { id: 1, cmd, target: target.targetId, args });
  if (!res.ok) throw new Error(res.error);
  return res.result;
}

/** Open a new tab, returns { targetId }. */
export async function openTab(url) {
  const conn = await ensureDaemon();
  const res = await sendRaw(conn, { id: 1, cmd: 'open', args: url ? [url] : [] });
  if (!res.ok) throw new Error(res.error);
  return JSON.parse(res.result);
}

/** Close a tab by targetId. */
export async function closeTab(targetId) {
  const conn = await ensureDaemon();
  const res = await sendRaw(conn, { id: 1, cmd: 'closetab', args: [targetId] });
  if (!res.ok) throw new Error(res.error);
}

/** Send a command to a tab by targetId directly (no query resolution). */
export async function runDirect(targetId, cmd, args = []) {
  const conn = await ensureDaemon();
  const res = await sendRaw(conn, { id: 1, cmd, target: targetId, args });
  if (!res.ok) throw new Error(res.error);
  return res.result;
}

/** Stop the daemon. */
export async function stop() {
  try {
    const conn = await connectSocket();
    await sendRaw(conn, { id: 1, cmd: 'stop' });
  } catch {}
}
