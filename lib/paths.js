import { resolve } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';

// One daemon per user: systemd timers get XDG_RUNTIME_DIR and agent shells often don't,
// so fall back to /run/user/<uid> before ~/.cache. Two daemons would keep two sets of
// refs and idle clocks, and the reaper would close tabs the other one is using.
const userRun = process.getuid ? `/run/user/${process.getuid()}` : null;
const base = process.env.XDG_RUNTIME_DIR
  || (userRun && existsSync(userRun) ? userRun : resolve(homedir(), '.cache'));
export const RUNTIME_DIR = resolve(base, 'browser-tools');

export const SOCK_PATH = resolve(RUNTIME_DIR, 'browser.sock');

// Dedicated profile used by browser-start.js (machines without a live GUI browser).
export const PROFILE_DIR = process.env.BROWSER_TOOLS_PROFILE
  || resolve(homedir(), '.config', 'browser-tools', 'profile');
export const PROFILE_PORT_FILE = resolve(PROFILE_DIR, 'DevToolsActivePort');
