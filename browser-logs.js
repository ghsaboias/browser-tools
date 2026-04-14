#!/usr/bin/env node
// Capture console logs from a tab via CDP Runtime.consoleAPICalled.
import { run } from './lib/client.js';

const args = process.argv.slice(2);
const target = args.find(a => a.startsWith('-t='))?.slice(3) || null;
const reload = args.includes('--reload');
const durArg = args.find(a => a.startsWith('--duration='));
const duration = durArg ? parseInt(durArg.split('=')[1]) * 1000 : 5000;

// We use raw CDP to enable Runtime domain and listen for events.
// The daemon handles this via a special 'logs' command.
// For now, we do it via eval — inject capture + collect.

if (reload) {
  await run(target, 'eval', ['location.reload()']);
  await new Promise(r => setTimeout(r, 1000));
}

// Inject capture
await run(target, 'eval', [`
  if (!window.__capturedLogs) {
    window.__capturedLogs = [];
    for (const level of ['log','error','warn','info']) {
      const orig = console[level];
      console[level] = function(...args) {
        window.__capturedLogs.push('[' + level.toUpperCase() + '] ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
        orig.apply(console, args);
      };
    }
  }
`]);

console.log(`Capturing logs for ${duration / 1000}s...`);
await new Promise(r => setTimeout(r, duration));

const logs = await run(target, 'eval', ['JSON.stringify(window.__capturedLogs || [])']);
const entries = JSON.parse(logs);

if (entries.length > 0) {
  console.log('\n=== Browser Console Logs ===\n');
  entries.forEach(l => console.log(l));
} else {
  console.log('No console logs captured.');
  if (!reload) console.log('Tip: use --reload to capture from page load.');
}
process.exit(0);
