#!/usr/bin/env node
// Scroll with mouse-wheel steps by N pixels (default 600, negative goes up), or bring a
// ref or selector into view. Infinite feeds load more this way where a jump would not.
//
//   browser-scroll.js [-t=<tab>] [1500 | -600 | e30]
import { parseArgs, runAndPrint } from './lib/cli.js';

const { tab, rest } = parseArgs();
await runAndPrint(tab, 'scroll', rest.length ? [rest.join(' ')] : []);
