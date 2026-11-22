#!/usr/bin/env node
// Click a ref from browser-snap, a CSS selector, or a point. The mouse travels there on a
// curved path, the click is refused when something covers the target (a cookie banner, a
// modal), and the output says what the page did: navigated, changed URL, opened a tab.
//
//   browser-click.js [-t=<tab>] e12 [--double] [--right] [--force]
//   browser-click.js [-t=<tab>] "button[type=submit]"
//   browser-click.js [-t=<tab>] <x> <y>
import { parseArgs, runAndPrint, usage } from './lib/cli.js';

const { tab, flags, rest } = parseArgs();
if (!rest.length) usage('Usage: browser-click.js [-t=<tab>] <ref|selector> [--double] [--right] [--force]\n       browser-click.js [-t=<tab>] <x> <y>');
if (rest.length >= 2 && !isNaN(rest[0]) && !isNaN(rest[1])) await runAndPrint(tab, 'clickxy', rest.slice(0, 2));
const o = {};
if (flags.double) o.count = 2;
if (flags.right) o.button = 'right';
if (flags.force) o.force = true;
await runAndPrint(tab, 'click', [rest.join(' '), JSON.stringify(o)]);
