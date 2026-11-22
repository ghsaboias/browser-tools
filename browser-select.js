#!/usr/bin/env node
// Pick options in a native <select> by value or label (exact, then substring).
// Custom dropdowns (Radix, MUI) are buttons: click them and click the option ref.
//
//   browser-select.js [-t=<tab>] e9 "São Paulo" [more values for multiple]
import { parseArgs, runAndPrint, usage } from './lib/cli.js';

const { tab, rest } = parseArgs();
if (rest.length < 2) usage('Usage: browser-select.js [-t=<tab>] <ref|selector> <value|label> [...]');
await runAndPrint(tab, 'select', rest);
