#!/usr/bin/env node
// Lighthouse audit via Chrome on :9222.
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { detectBrowser } from './lib/cdp.js';

const execAsync = promisify(exec);

const url = process.argv[2];
const category = process.argv[3] || 'all';
if (!url) {
  console.log('Usage: browser-lighthouse.js <url> [category]');
  console.log('Categories: performance, accessibility, best-practices, seo, all');
  process.exit(1);
}

const { port } = detectBrowser();
const cats = category === 'all'
  ? '--only-categories=performance,accessibility,best-practices,seo'
  : `--only-categories=${category}`;
const out = join(tmpdir(), `lighthouse-${Date.now()}.json`);

console.log(`\n🔍 Running Lighthouse on ${url}...\n`);

try {
  await execAsync(
    `npx lighthouse "${url}" --port=${port} --output=json --output-path="${out}" ${cats} --chrome-flags="--headless" 2>/dev/null`,
    { maxBuffer: 50 * 1024 * 1024, timeout: 120000 }
  );

  const report = JSON.parse(await readFile(out, 'utf-8'));

  const emoji = s => s >= 0.9 ? '🟢' : s >= 0.5 ? '🟡' : '🔴';

  console.log('📊 Scores\n');
  for (const [, cat] of Object.entries(report.categories)) {
    console.log(`${emoji(cat.score)} ${cat.title.padEnd(20)} ${Math.round(cat.score * 100)}`);
  }

  if (report.categories.performance) {
    console.log('\n⏱️  Metrics\n');
    for (const [key, label] of [['first-contentful-paint','FCP'],['largest-contentful-paint','LCP'],['total-blocking-time','TBT'],['cumulative-layout-shift','CLS'],['speed-index','Speed Index']]) {
      const a = report.audits[key];
      if (a) console.log(`${emoji(a.score)} ${label.padEnd(14)} ${a.displayValue || 'N/A'}`);
    }
  }

  const opps = Object.values(report.audits)
    .filter(a => a.details?.type === 'opportunity' && a.details?.overallSavingsMs > 0)
    .sort((a, b) => b.details.overallSavingsMs - a.details.overallSavingsMs)
    .slice(0, 5);
  if (opps.length) {
    console.log('\n💡 Opportunities\n');
    for (const o of opps) {
      const s = o.details.overallSavingsMs;
      console.log(`-${(s > 1000 ? `${(s/1000).toFixed(1)}s` : `${Math.round(s)}ms`).padStart(7)} ${o.title}`);
    }
  }
  console.log();

  await unlink(out).catch(() => {});
} catch (e) {
  console.error('Error:', e.message);
  await unlink(out).catch(() => {});
  process.exit(1);
}
process.exit(0);
