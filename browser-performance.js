#!/usr/bin/env node
// Core Web Vitals: TTFB, FCP, LCP, CLS, TBT.
import { openTab, runDirect, closeTab } from './lib/client.js';

const url = process.argv[2];
if (!url) { console.log('Usage: browser-performance.js <url>'); process.exit(1); }

const { targetId } = await openTab('about:blank');

try {
  // Inject observers before navigation
  await runDirect(targetId, 'injecton', [`
    window.__perf = { lcp: null, cls: 0, fcp: null, longTasks: [] };
    new PerformanceObserver(l => { const e = l.getEntries().at(-1); if (e) window.__perf.lcp = e.startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__perf.fcp = e.startTime; })
      .observe({ type: 'paint', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__perf.longTasks.push(e.duration); })
      .observe({ type: 'longtask', buffered: true });
  `]);

  await runDirect(targetId, 'nav', [url]);
  await new Promise(r => setTimeout(r, 2000));

  const raw = await runDirect(targetId, 'eval', [`JSON.stringify({
    ttfb: performance.getEntriesByType('navigation')[0]?.responseStart,
    fcp: window.__perf.fcp, lcp: window.__perf.lcp,
    cls: window.__perf.cls, longTasks: window.__perf.longTasks,
  })`]);
  const m = JSON.parse(raw);
  const tbt = m.longTasks.reduce((s, d) => s + Math.max(0, d - 50), 0);

  const res = await runDirect(targetId, 'eval', [`JSON.stringify({
    total: performance.getEntriesByType('resource').reduce((s,e) => s + (e.transferSize||0), 0),
    js: performance.getEntriesByType('resource').filter(e => e.initiatorType==='script'||e.name.includes('.js')).reduce((s,e) => s + (e.transferSize||0), 0),
    css: performance.getEntriesByType('resource').filter(e => e.initiatorType==='css'||e.name.includes('.css')).reduce((s,e) => s + (e.transferSize||0), 0),
    img: performance.getEntriesByType('resource').filter(e => e.initiatorType==='img'||/\\.(png|jpg|jpeg|gif|webp|svg)/.test(e.name)).reduce((s,e) => s + (e.transferSize||0), 0),
    count: performance.getEntriesByType('resource').length,
  })`]);
  const r = JSON.parse(res);

  const fmt = ms => ms == null ? 'N/A' : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms/1000).toFixed(2)}s`;
  const fmtB = b => b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(2)}MB`;
  const rate = (v, g, p) => v <= g ? '🟢 Good' : v <= p ? '🟡 Needs Improvement' : '🔴 Poor';

  console.log('\n📊 Core Web Vitals\n');
  console.log(`TTFB:  ${fmt(m.ttfb).padEnd(10)} ${rate(m.ttfb, 800, 1800)}`);
  console.log(`FCP:   ${fmt(m.fcp).padEnd(10)} ${rate(m.fcp, 1800, 3000)}`);
  console.log(`LCP:   ${fmt(m.lcp).padEnd(10)} ${rate(m.lcp, 2500, 4000)}`);
  console.log(`CLS:   ${m.cls.toFixed(3).padEnd(10)} ${rate(m.cls, 0.1, 0.25)}`);
  console.log(`TBT:   ${fmt(tbt).padEnd(10)} ${rate(tbt, 200, 600)}`);
  console.log('\n📦 Resources\n');
  console.log(`Total:   ${fmtB(r.total)} (${r.count} requests)`);
  console.log(`JS:      ${fmtB(r.js)}`);
  console.log(`CSS:     ${fmtB(r.css)}`);
  console.log(`Images:  ${fmtB(r.img)}`);
  console.log();
} finally {
  await closeTab(targetId);
  process.exit(0);
}
