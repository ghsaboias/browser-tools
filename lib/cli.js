// lib/cli.js — argument parsing and the run-and-print wrapper the browser-*.js scripts share.
import { run } from './client.js';

/** Split argv into { tab, flags, rest }: -t=<tab>, --key[=value] flags, positionals. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { tab: null, flags: {}, rest: [] };
  for (const a of argv) {
    if (a.startsWith('-t=')) out.tab = a.slice(3);
    else if (/^--[a-z][\w-]*(=|$)/i.test(a)) {
      const [k, ...v] = a.slice(2).split('=');
      out.flags[k] = v.length ? v.join('=') : true;
    } else out.rest.push(a);
  }
  return out;
}

/** Run a daemon command on the tab and print the result; exit 1 with the message on error. */
export async function runAndPrint(tab, cmd, args) {
  try {
    const r = await run(tab, cmd, args);
    console.log(typeof r === 'object' && r !== null ? JSON.stringify(r, null, 2) : r);
    process.exit(0);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

export function usage(text) {
  console.log(text);
  process.exit(1);
}
