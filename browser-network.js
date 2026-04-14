#!/usr/bin/env node
// Network waterfall: request timing, sizes, failures.
import { openTab, runDirect, closeTab } from './lib/client.js';

const url = process.argv[2];
if (!url) { console.log('Usage: browser-network.js <url>'); process.exit(1); }

const { targetId } = await openTab('about:blank');

try {
  // Collect via Performance API (captures all resources from navigation)
  await runDirect(targetId, 'nav', [url]);
  await new Promise(r => setTimeout(r, 1500));

  const raw = await runDirect(targetId, 'eval', [`JSON.stringify(performance.getEntriesByType('resource').map(r => ({
    url: r.name, type: r.initiatorType, duration: Math.round(r.duration),
    size: r.transferSize || 0, start: Math.round(r.startTime),
    status: r.responseStatus || 0,
  })))`]);
  const entries = JSON.parse(raw);

  const fmt = ms => ms < 1000 ? `${Math.round(ms)}ms` : `${(ms/1000).toFixed(2)}s`;
  const fmtB = b => !b ? '0B' : b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(2)}MB`;
  const short = (u, max=60) => { try { let p = new URL(u).pathname + new URL(u).search; return p.length > max ? '...' + p.slice(-max+3) : p; } catch { return u.slice(0, max); } };

  // Categorize
  const cat = (e) => {
    const u = e.url.toLowerCase();
    if (e.type === 'script' || u.includes('.js')) return 'JS';
    if (e.type === 'css' || u.includes('.css')) return 'CSS';
    if (e.type === 'img' || /\.(png|jpg|jpeg|gif|webp|svg|ico)/.test(u)) return 'Image';
    if (/\.(woff2?|ttf|otf|eot)/.test(u)) return 'Font';
    if (e.type === 'xmlhttprequest' || e.type === 'fetch' || u.includes('/api/')) return 'API';
    if (e.type === 'document') return 'Doc';
    return 'Other';
  };

  // By category
  const byCat = {};
  for (const e of entries) {
    const c = cat(e);
    if (!byCat[c]) byCat[c] = { count: 0, size: 0 };
    byCat[c].count++;
    byCat[c].size += e.size;
  }

  console.log('\n📊 Requests by Type\n');
  for (const c of ['Doc', 'JS', 'CSS', 'Image', 'Font', 'API', 'Other']) {
    if (byCat[c]) console.log(`${c.padEnd(8)} ${String(byCat[c].count).padStart(3)} requests   ${fmtB(byCat[c].size).padStart(10)}`);
  }

  // Slowest
  const slowest = entries.filter(e => e.duration > 0).sort((a, b) => b.duration - a.duration).slice(0, 10);
  if (slowest.length) {
    console.log('\n🐢 Slowest Requests\n');
    for (const e of slowest) console.log(`${fmt(e.duration).padStart(8)}  ${fmtB(e.size).padStart(10)}  ${cat(e).padEnd(6)}  ${short(e.url)}`);
  }

  // Largest
  const largest = entries.filter(e => e.size > 0).sort((a, b) => b.size - a.size).slice(0, 10);
  if (largest.length) {
    console.log('\n📦 Largest Resources\n');
    for (const e of largest) console.log(`${fmtB(e.size).padStart(10)}  ${fmt(e.duration).padStart(8)}  ${cat(e).padEnd(6)}  ${short(e.url)}`);
  }

  // Failed
  const failed = entries.filter(e => e.status >= 400);
  if (failed.length) {
    console.log('\n❌ Failed Requests\n');
    for (const e of failed) console.log(`${String(e.status).padStart(4)}  ${short(e.url)}`);
  }

  const total = entries.reduce((s, e) => s + e.size, 0);
  console.log(`\n📈 Total: ${entries.length} requests, ${fmtB(total)}\n`);
} finally {
  await closeTab(targetId);
  process.exit(0);
}
