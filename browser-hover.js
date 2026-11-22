#!/usr/bin/env node
// Move the mouse onto a ref or selector (menus that open on hover, tooltips).
import { parseArgs, runAndPrint, usage } from './lib/cli.js';

const { tab, rest } = parseArgs();
if (!rest.length) usage('Usage: browser-hover.js [-t=<tab>] <ref|selector>');
await runAndPrint(tab, 'hover', [rest.join(' ')]);
