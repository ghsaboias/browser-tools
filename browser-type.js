#!/usr/bin/env node
// Type into the focused element key by key, at a person's pace (long text: the first
// characters typed, the rest inserted). To replace a field's contents use browser-fill.js.
import { parseArgs, runAndPrint, usage } from './lib/cli.js';

const { tab, rest } = parseArgs();
if (!rest.length) usage('Usage: browser-type.js [-t=<tab>] <text>');
await runAndPrint(tab, 'type', [rest.join(' ')]);
