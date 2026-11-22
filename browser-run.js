#!/usr/bin/env node
// Run a multi-step browser script in one call. The script is the body of an async
// function with these in scope:
//
//   page         the tab (see -t / --name / --url below)
//   tabs         tabs.open(url, {name}) → page · tabs.get(nameOrId) → page · tabs.list()
//   log(...)     print a line
//   sleep(ms)
//
// page methods, each one daemon command (refs come from page.snap / page.find):
//   goto(url) · url() · snap({all, max, root}) · find(role, name) → ref
//   click(refOrSelector, {count, button, force}) · fill(ref, text) · type(text) · press(...keys)
//   select(ref, ...values) · hover(ref) · scroll(pxOrRef) · wait({text, url, selector, gone, timeout})
//   eval(expr) (page's world) · evalIsolated(expr) (DOM only, unseen by the page) · screenshot({path, full, ref}) · html(ref?) · close()
// click returns what happened, e.g. "clicked e12; opened tab [AB12CD34] https://…";
// page.popup() returns the page for the newest tab this one opened.
//
//   browser-run.js [-t=<tab> | --name=<name>] [--url=<url>] -e '<code>'
//   browser-run.js [-t=<tab> | --name=<name>] [--url=<url>] script.js
//   echo '<code>' | browser-run.js --url=<url>
//
// Tab: -t picks an open tab; --name opens a tab by that name once and reuses it after;
// --url alone opens a fresh tab. --url navigates only a tab this call opened.
// The last line printed is the tab the script ended in, to pass back with -t.
import { readFileSync } from 'fs';
import { openTab, runDirect, findTarget, listTargets, shortId } from './lib/client.js';
import { parseArgs } from './lib/cli.js';

const { tab, flags, rest } = parseArgs();
let code = typeof flags.e === 'string' ? flags.e : null;
const eIdx = process.argv.indexOf('-e');
if (eIdx > 0) code = process.argv[eIdx + 1];
if (code == null && rest[0] && !rest[0].startsWith('-')) code = readFileSync(rest[0], 'utf8');
if (code == null && !process.stdin.isTTY) code = readFileSync(0, 'utf8');
if (!code) {
  console.log('Usage: browser-run.js [-t=<tab> | --name=<name>] [--url=<url>] (-e <code> | file.js)');
  process.exit(1);
}

function makePage(targetId) {
  const call = (cmd, ...args) => runDirect(targetId, cmd, args.map(a => (a == null ? a : String(a))));
  const json = async (cmd, ...args) => JSON.parse(await call(cmd, ...args));
  const p = {
    targetId,
    id: shortId({ targetId }),
    goto: (url) => call('nav', url),
    url: () => call('url'),
    snap: (o = {}) => call('snap', JSON.stringify(o)),
    find: async (role, name) => (await json('find', role, name)).ref,
    click: (t, o = {}) => call('click', t, JSON.stringify(o)),
    clickAt: (x, y) => call('clickxy', x, y),
    fill: (t, text) => call('fill', t, text),
    type: (text) => call('type', text),
    press: (...keys) => call('press', ...keys),
    select: (t, ...values) => call('select', t, ...values),
    hover: (t) => call('hover', t),
    scroll: (arg = 600) => call('scroll', arg),
    wait: (o) => call('wait', JSON.stringify(o)),
    eval: async (expr) => { const r = await call('eval', expr); try { return JSON.parse(r); } catch { return r; } },
    evalIsolated: async (expr) => { const r = await call('eval', expr, JSON.stringify({ isolated: true })); try { return JSON.parse(r); } catch { return r; } },
    html: (t) => call('html', ...(t ? [t] : [])),
    screenshot: async (o = {}) => (await json('shot', o.path || '', JSON.stringify({ full: o.full, ref: o.ref }))).file,
    close: () => runDirect(targetId, 'eval', ['window.close()']).catch(() => {}),
    popup: async () => {
      const all = await listTargets();
      const mine = all.filter(t => t.openerId === targetId);
      if (!mine.length) throw new Error('this tab opened no other tab');
      current = makePage(mine.at(-1).targetId);
      return current;
    },
  };
  return p;
}

let current;
const tabs = {
  open: async (url, o = {}) => {
    const { targetId, existed } = await openTab(undefined, { name: o.name });
    if (url && !existed) await runDirect(targetId, 'nav', [url]);
    current = makePage(targetId);
    return current;
  },
  get: async (q) => { current = makePage((await findTarget(q)).targetId); return current; },
  list: async () => (await listTargets()).map(t => ({ id: shortId(t), name: t.name, title: t.title, url: t.url })),
};

let page;
try {
  if (tab) page = makePage((await findTarget(tab)).targetId);
  else if (typeof flags.name === 'string' || typeof flags.url === 'string') {
    page = await tabs.open(typeof flags.url === 'string' ? flags.url : null, { name: flags.name });
  } else page = makePage((await findTarget()).targetId);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
current = page;

const log = (...a) => console.log(...a.map(x => (typeof x === 'string' ? x : JSON.stringify(x, null, 2))));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

let status = 0;
try {
  const result = await new AsyncFunction('page', 'tabs', 'log', 'sleep', code)(page, tabs, log, sleep);
  if (result !== undefined) log(result);
} catch (e) {
  console.error(`error: ${e.message}`);
  status = 1;
}
try {
  const url = await runDirect(current.targetId, 'url');
  console.log(`# tab [${current.id}] ${url}`);
} catch { console.log(`# tab [${current.id}] closed`); }
process.exit(status);
