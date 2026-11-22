#!/usr/bin/env node
// Wait until the page shows a text, its URL contains a string, a selector appears, or a
// selector/text goes away. Conditions combine. Default timeout 15000 ms.
//
// --new=<selector> waits for a match that was not on the page when the wait began: AJAX
// results replacing old rows, where --selector would match the old ones at once.
//
//   browser-wait.js [-t=<tab>] --text="Resultados" [--url=/busca] [--selector=.item] [--new="tbody tr"] [--gone=.spinner] [--timeout=30000]
import { parseArgs, runAndPrint, usage } from './lib/cli.js';

const { tab, flags } = parseArgs();
const o = {};
for (const k of ['text', 'url', 'selector', 'gone']) if (typeof flags[k] === 'string') o[k] = flags[k];
if (typeof flags.new === 'string') o.fresh = flags.new;
if (flags.timeout) o.timeout = parseInt(flags.timeout, 10);
if (!Object.keys(o).filter(k => k !== 'timeout').length) usage('Usage: browser-wait.js [-t=<tab>] --text=<t> | --url=<s> | --selector=<css> | --new=<css> | --gone=<css|text> [--timeout=ms]');
await runAndPrint(tab, 'wait', [JSON.stringify(o)]);
