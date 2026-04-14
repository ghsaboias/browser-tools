import { resolve } from 'path';
import { homedir } from 'os';

export const RUNTIME_DIR = process.env.XDG_RUNTIME_DIR
  ? resolve(process.env.XDG_RUNTIME_DIR, 'browser-tools')
  : resolve(homedir(), '.cache', 'browser-tools');

export const SOCK_PATH = resolve(RUNTIME_DIR, 'browser.sock');
