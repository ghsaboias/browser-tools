#!/usr/bin/env node
// Page outline with refs: each control, heading, image and iframe gets a ref (e12) that
// browser-click, -fill, -select, -hover, -scroll and -screenshot take instead of a selector.
// Refs stay valid until the page navigates. Iframes, cross-origin ones included, are inlined.
//
//   browser-snap.js [-t=<tab>]            scoped to the page's <main> (plus open dialogs) when it has one
//   browser-snap.js [-t=<tab>] --all      the whole page
//   browser-snap.js [-t=<tab>] e40        one region
//   browser-snap.js [-t=<tab>] --max=0    no line cap (default 400)
import { parseArgs, runAndPrint } from './lib/cli.js';

const { tab, flags, rest } = parseArgs();
const o = {};
if (flags.all) o.all = true;
if (flags.max != null) o.max = parseInt(flags.max, 10);
if (rest[0]) o.root = rest[0];
await runAndPrint(tab, 'snap', [JSON.stringify(o)]);
