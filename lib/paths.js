import { resolve } from 'path';
import { homedir } from 'os';

export const RUNTIME_DIR = process.env.XDG_RUNTIME_DIR
  ? resolve(process.env.XDG_RUNTIME_DIR, 'browser-tools')
  : resolve(homedir(), '.cache', 'browser-tools');

export const SOCK_PATH = resolve(RUNTIME_DIR, 'browser.sock');

// Dedicated profile used by browser-start.js (machines without a live GUI browser).
export const PROFILE_DIR = process.env.BROWSER_TOOLS_PROFILE
  || resolve(homedir(), '.config', 'browser-tools', 'profile');
export const PROFILE_PORT_FILE = resolve(PROFILE_DIR, 'DevToolsActivePort');
