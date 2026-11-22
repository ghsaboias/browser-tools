#!/usr/bin/env node
// Replace a field's text the way a person would: click it, select all, delete, type.
// A <select> ref picks the option by value or label instead.
//
//   browser-fill.js [-t=<tab>] e7 "maria@example.com"
import { parseArgs, runAndPrint, usage } from './lib/cli.js';

const { tab, rest } = parseArgs();
if (rest.length < 2) usage('Usage: browser-fill.js [-t=<tab>] <ref|selector> <text>');
await runAndPrint(tab, 'fill', [rest[0], rest.slice(1).join(' ')]);
