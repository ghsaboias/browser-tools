#!/usr/bin/env node
import { run } from './lib/client.js';

const args = process.argv.slice(2);
const target = args.find(a => a.startsWith('-t='))?.slice(3) || null;
const code = args.filter(a => !a.startsWith('-t=')).join(' ');

if (!code) {
  console.log('Usage: browser-eval.js [-t=<tab>] <code>');
  console.log('  -t=  Tab query (URL/title substring or index). Default: last tab.');
  console.log('\nExamples:');
  console.log('  browser-eval.js "document.title"');
  console.log('  browser-eval.js -t=github "document.title"');
  process.exit(1);
}

let result;
try {
  result = await run(target, 'eval', [code]);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
if (typeof result === 'object' && result !== null) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(result);
}
process.exit(0);
