#!/usr/bin/env node
// Performance trace recording and analysis.
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { openTab, runDirect, closeTab } from './lib/client.js';

const url = process.argv[2];
const duration = parseInt(process.argv[3]) || 5;
if (!url) { console.log('Usage: browser-trace.js <url> [duration_seconds]'); process.exit(1); }

const { targetId } = await openTab('about:blank');

try {
  console.log(`\n🔍 Recording trace for ${url} (${duration}s)...\n`);

  await runDirect(targetId, 'raw', ['Tracing.start', JSON.stringify({
    categories: 'devtools.timeline,blink.user_timing,loading',
    transferMode: 'ReturnAsStream',
  })]);

  await runDirect(targetId, 'nav', [url]);
  console.log(`Page loaded. Recording for ${duration}s more...`);
  await new Promise(r => setTimeout(r, duration * 1000));

  // Stop tracing — need to handle the stream
  // Use ReportProgress instead for simpler collection
  await runDirect(targetId, 'raw', ['Tracing.end', '{}']);
  await new Promise(r => setTimeout(r, 1000));

  // Collect trace data via eval on performance entries (simpler than stream)
  const perfRaw = await runDirect(targetId, 'eval', [`JSON.stringify({
    resources: performance.getEntriesByType('resource').map(r => ({
      name: r.name, type: r.initiatorType, duration: Math.round(r.duration),
      start: Math.round(r.startTime), size: r.transferSize || 0,
    })),
    nav: (() => { const n = performance.getEntriesByType('navigation')[0]; return n ? {
      ttfb: Math.round(n.responseStart), domInteractive: Math.round(n.domInteractive),
      domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd),
    } : null; })(),
    longTasks: (window.__longTasks || []),
    marks: performance.getEntriesByType('mark').map(m => ({ name: m.name, start: Math.round(m.startTime) })),
  })`]);
  const perf = JSON.parse(perfRaw);

  // Analyze
  if (perf.nav) {
    console.log('\n⏱️  Navigation\n');
    console.log(`TTFB:               ${perf.nav.ttfb}ms`);
    console.log(`DOM Interactive:    ${perf.nav.domInteractive}ms`);
    console.log(`DOM Content Loaded: ${perf.nav.domContentLoaded}ms`);
    console.log(`Full Load:          ${perf.nav.load}ms`);
  }

  // Resource breakdown
  const byType = {};
  for (const r of perf.resources) {
    const t = r.type || 'other';
    if (!byType[t]) byType[t] = { count: 0, time: 0, size: 0 };
    byType[t].count++;
    byType[t].time += r.duration;
    byType[t].size += r.size;
  }

  console.log('\n📊 Resource Breakdown\n');
  const fmtB = b => !b ? '0B' : b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(2)}MB`;
  for (const [type, data] of Object.entries(byType).sort((a, b) => b[1].time - a[1].time)) {
    console.log(`${type.padEnd(12)} ${String(data.count).padStart(3)} req  ${String(Math.round(data.time)).padStart(6)}ms  ${fmtB(data.size).padStart(10)}`);
  }

  // Slowest resources
  const slowest = perf.resources.sort((a, b) => b.duration - a.duration).slice(0, 10);
  if (slowest.length) {
    console.log('\n🐢 Slowest Resources\n');
    for (const r of slowest) {
      const name = r.name.split('/').pop().split('?')[0].substring(0, 40);
      console.log(`${String(r.duration).padStart(6)}ms  ${fmtB(r.size).padStart(10)}  ${name}`);
    }
  }

  console.log(`\n📈 Total: ${perf.resources.length} resources\n`);
} finally {
  await closeTab(targetId);
  process.exit(0);
}
