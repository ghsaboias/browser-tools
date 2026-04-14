#!/usr/bin/env node
// LCP element identification and timing breakdown.
import { openTab, runDirect, closeTab } from './lib/client.js';

const url = process.argv[2];
if (!url) { console.log('Usage: browser-lcp.js <url>'); process.exit(1); }

const { targetId } = await openTab('about:blank');

try {
  await runDirect(targetId, 'injecton', [`
    window.__lcpEntries = [];
    new PerformanceObserver(l => {
      for (const e of l.getEntries()) {
        const el = e.element;
        window.__lcpEntries.push({
          time: e.startTime, size: e.size,
          tag: el?.tagName, id: el?.id, className: el?.className,
          src: el?.src || el?.currentSrc || '',
          text: el?.textContent?.substring(0, 150)?.trim(),
          loadTime: e.loadTime, renderTime: e.renderTime, url: e.url,
        });
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  `]);

  await runDirect(targetId, 'nav', [url]);
  await new Promise(r => setTimeout(r, 3000));

  const lcpRaw = await runDirect(targetId, 'eval', ['JSON.stringify(window.__lcpEntries)']);
  const lcpData = JSON.parse(lcpRaw);

  const navRaw = await runDirect(targetId, 'eval', [`JSON.stringify((() => {
    const n = performance.getEntriesByType('navigation')[0];
    return n ? { ttfb: n.responseStart, download: n.responseEnd - n.responseStart,
      domInteractive: n.domInteractive, domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd } : null;
  })())`]);
  const nav = JSON.parse(navRaw);

  const blockingRaw = await runDirect(targetId, 'eval', [`JSON.stringify(
    performance.getEntriesByType('resource').filter(r => r.renderBlockingStatus === 'blocking')
      .map(r => ({ name: r.name.split('/').pop().split('?')[0].substring(0,40), type: r.initiatorType, duration: Math.round(r.duration) }))
  )`]);
  const blocking = JSON.parse(blockingRaw);

  if (!lcpData.length) {
    console.log('No LCP entries captured.');
  } else {
    console.log(`\n📊 LCP Candidates (${lcpData.length})\n`);
    for (let i = 0; i < lcpData.length; i++) {
      const l = lcpData[i];
      const tag = i === lcpData.length - 1 ? '(FINAL LCP)' : '';
      console.log(`--- Entry ${i + 1} ${tag} ---`);
      console.log(`Time:    ${l.time?.toFixed(0) ?? 'N/A'}ms    Size: ${l.size} px²`);
      console.log(`Element: <${l.tag?.toLowerCase()}>`);
      if (l.id) console.log(`ID:      ${l.id}`);
      if (l.src) console.log(`Source:  ${l.src}`);
      if (l.text) console.log(`Text:    "${l.text.slice(0, 80)}"`);
      if (l.loadTime) console.log(`Load:    ${l.loadTime?.toFixed(0)}ms`);
      if (l.renderTime) console.log(`Render:  ${l.renderTime?.toFixed(0)}ms`);
      console.log();
    }
  }

  if (nav) {
    console.log('⏱️  Navigation Timing\n');
    console.log(`TTFB:               ${nav.ttfb?.toFixed(0) ?? 'N/A'}ms`);
    console.log(`DOM Interactive:    ${nav.domInteractive?.toFixed(0) ?? 'N/A'}ms`);
    console.log(`DOM Content Loaded: ${nav.domContentLoaded?.toFixed(0) ?? 'N/A'}ms`);
    console.log(`Full Load:          ${nav.load?.toFixed(0) ?? 'N/A'}ms`);
  }

  if (blocking.length) {
    console.log('\n🚧 Render-Blocking Resources\n');
    for (const r of blocking) console.log(`${r.duration}ms  ${r.type.padEnd(6)}  ${r.name}`);
  }

  const final = lcpData.at(-1);
  if (final && nav) {
    console.log('\n📊 LCP Breakdown\n');
    console.log(`TTFB:          ${nav.ttfb?.toFixed(0)}ms`);
    console.log(`Render Delay:  ${(final.time - (nav.ttfb || 0)).toFixed(0)}ms`);
    console.log(`Total LCP:     ${final.time.toFixed(0)}ms`);
  }
  console.log();
} finally {
  await closeTab(targetId);
  process.exit(0);
}
