#!/usr/bin/env node
// JS and CSS code coverage analysis.
import { openTab, runDirect, closeTab } from './lib/client.js';

const url = process.argv[2];
if (!url) { console.log('Usage: browser-coverage.js <url>'); process.exit(1); }

const { targetId } = await openTab('about:blank');

try {
  // Start JS coverage
  await runDirect(targetId, 'raw', ['Profiler.enable', '{}']);
  await runDirect(targetId, 'raw', ['Profiler.startPreciseCoverage', '{"callCount":true,"detailed":true}']);
  // Start CSS coverage (requires DOM)
  await runDirect(targetId, 'raw', ['DOM.enable', '{}']);
  await runDirect(targetId, 'raw', ['CSS.enable', '{}']);
  await runDirect(targetId, 'raw', ['CSS.startRuleUsageTracking', '{}']);

  await runDirect(targetId, 'nav', [url]);
  await new Promise(r => setTimeout(r, 2000));

  // Collect JS coverage
  const jsRaw = JSON.parse(await runDirect(targetId, 'raw', ['Profiler.takePreciseCoverage', '{}']));
  await runDirect(targetId, 'raw', ['Profiler.stopPreciseCoverage', '{}']);
  await runDirect(targetId, 'raw', ['Profiler.disable', '{}']);

  // Collect CSS coverage
  const cssRaw = JSON.parse(await runDirect(targetId, 'raw', ['CSS.stopRuleUsageTracking', '{}']));
  await runDirect(targetId, 'raw', ['CSS.disable', '{}']);

  // Process JS — first range of each function is the full function,
  // nested ranges with count>0 are the used parts
  const jsResults = [];
  for (const script of jsRaw.result || []) {
    if (!script.url || script.url.startsWith('data:') || !script.url.includes('/')) continue;
    // Total = the outer range of all functions (first range = full extent)
    let total = 0;
    let used = 0;
    for (const fn of script.functions) {
      if (fn.ranges.length === 0) continue;
      const outer = fn.ranges[0];
      total += outer.endOffset - outer.startOffset;
      // Used = sum of nested ranges with count > 0 (excluding outer if count=0)
      if (outer.count > 0) {
        used += outer.endOffset - outer.startOffset;
      } else {
        // Only inner used ranges count
        for (let i = 1; i < fn.ranges.length; i++) {
          if (fn.ranges[i].count > 0) used += fn.ranges[i].endOffset - fn.ranges[i].startOffset;
        }
      }
    }
    if (total > 0) jsResults.push({ url: script.url, total, used, unused: total - used, type: 'JS' });
  }

  // Process CSS (rule-level, not byte-level)
  const cssRules = cssRaw.ruleUsage || [];
  const cssBySheet = {};
  for (const r of cssRules) {
    const key = r.styleSheetId;
    if (!cssBySheet[key]) cssBySheet[key] = { total: 0, used: 0 };
    cssBySheet[key].total++;
    if (r.used) cssBySheet[key].used++;
  }

  // Summary
  const jsTotals = jsResults.reduce((a, r) => ({ total: a.total + r.total, unused: a.unused + r.unused }), { total: 0, unused: 0 });
  const cssTotalRules = cssRules.length;
  const cssUsedRules = cssRules.filter(r => r.used).length;

  const fmtB = b => !b ? '0B' : b < 1024 ? `${b}B` : b < 1048576 ? `${(b/1024).toFixed(1)}KB` : `${(b/1048576).toFixed(2)}MB`;
  const short = (u, max=55) => { try { let p = new URL(u).pathname; return p.length > max ? '...' + p.slice(-max+3) : p; } catch { return u.slice(0, max); } };

  console.log('\n📊 Coverage Summary\n');
  console.log(`JS:   ${fmtB(jsTotals.total).padStart(10)} total, ${fmtB(jsTotals.unused).padStart(10)} unused (${jsTotals.total ? ((jsTotals.unused/jsTotals.total)*100).toFixed(1) : 0}%)`);
  console.log(`CSS:  ${String(cssTotalRules).padStart(10)} rules, ${String(cssTotalRules - cssUsedRules).padStart(10)} unused (${cssTotalRules ? (((cssTotalRules-cssUsedRules)/cssTotalRules)*100).toFixed(1) : 0}%)`);

  // Worst JS offenders
  const worst = jsResults.filter(r => r.unused > 1024).sort((a, b) => b.unused - a.unused).slice(0, 15);
  if (worst.length) {
    console.log('\n🔴 Largest Unused JS\n');
    console.log('Unused'.padStart(10) + '  ' + 'Total'.padStart(10) + '  ' + '%'.padStart(5) + '  File');
    for (const r of worst) {
      const pct = ((r.unused/r.total)*100).toFixed(0);
      console.log(`${fmtB(r.unused).padStart(10)}  ${fmtB(r.total).padStart(10)}  ${pct.padStart(4)}%  ${short(r.url)}`);
    }
  }

  console.log(`\n📈 JS Total: ${fmtB(jsTotals.total)}, ${fmtB(jsTotals.unused)} unused (${jsTotals.total ? ((jsTotals.unused/jsTotals.total)*100).toFixed(1) : 0}%)\n`);
} finally {
  await closeTab(targetId);
  process.exit(0);
}
