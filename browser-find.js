#!/usr/bin/env node
// Find one element by role and name, print its ref. Name is a case-insensitive substring
// or a /regex/; an exact name wins. Role "*" or omitted matches any role.
//
//   browser-find.js [-t=<tab>] button "Buscar"     →  {"ref":"e14","role":"button","name":"Buscar"}
import { parseArgs, runAndPrint, usage } from './lib/cli.js';

const { tab, rest } = parseArgs();
if (!rest.length) usage('Usage: browser-find.js [-t=<tab>] <role|*> [name]');
await runAndPrint(tab, 'find', [rest[0], rest.slice(1).join(' ') || undefined]);
