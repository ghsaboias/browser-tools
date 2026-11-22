#!/usr/bin/env node
// Find an element by role and name and print its ref, with the other matches. Name is a
// case-insensitive substring or a /regex/; exact names come first, then page order.
// Role "*" matches any role. --in=<ref> searches inside one region (a form, a dialog).
//
//   browser-find.js [-t=<tab>] [--in=e40] button "Subscribe"
//   → {"ref":"e43","role":"button","name":"Subscribe","others":["e21 button \"Subscribe\""]}
import { parseArgs, runAndPrint, usage } from './lib/cli.js';

const { tab, flags, rest } = parseArgs();
if (!rest.length) usage('Usage: browser-find.js [-t=<tab>] [--in=<ref>] <role|*> [name]');
await runAndPrint(tab, 'find', [rest[0], rest.slice(1).join(' ') || '', typeof flags.in === 'string' ? flags.in : '']);
