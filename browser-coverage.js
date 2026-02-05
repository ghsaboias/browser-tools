#!/usr/bin/env node

import puppeteer from "puppeteer-core";

const url = process.argv[2];

if (!url) {
	console.log("Usage: browser-coverage.js <url>");
	console.log("\nMeasures JS and CSS code coverage:");
	console.log("  - Identifies unused bytes per file");
	console.log("  - Shows total unused percentage");
	console.log("  - Highlights worst offenders");
	console.log("\nExample:");
	console.log("  browser-coverage.js http://localhost:3000");
	process.exit(1);
}

const b = await puppeteer.connect({
	browserURL: "http://localhost:9222",
	defaultViewport: null,
});

const p = await b.newPage();

// Start coverage collection
await Promise.all([
	p.coverage.startJSCoverage(),
	p.coverage.startCSSCoverage(),
]);

// Navigate and wait
await p.goto(url, { waitUntil: "load", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2000)); // Let page settle

// Stop and collect coverage
const [jsCoverage, cssCoverage] = await Promise.all([
	p.coverage.stopJSCoverage(),
	p.coverage.stopCSSCoverage(),
]);

function formatBytes(bytes) {
	if (!bytes) return "0B";
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function shortUrl(url, max = 55) {
	try {
		const u = new URL(url);
		let path = u.pathname;
		if (path.length > max) path = "..." + path.slice(-max + 3);
		return path;
	} catch {
		return url.slice(0, max);
	}
}

function processCoverage(entries, type) {
	const results = [];

	for (const entry of entries) {
		// Skip data URLs and inline scripts
		if (entry.url.startsWith("data:") || !entry.url.includes("/")) continue;

		const totalBytes = entry.text.length;
		let usedBytes = 0;

		for (const range of entry.ranges) {
			usedBytes += range.end - range.start;
		}

		const unusedBytes = totalBytes - usedBytes;
		const unusedPercent = totalBytes > 0 ? (unusedBytes / totalBytes) * 100 : 0;

		results.push({
			url: entry.url,
			totalBytes,
			usedBytes,
			unusedBytes,
			unusedPercent,
			type,
		});
	}

	return results;
}

const jsResults = processCoverage(jsCoverage, "JS");
const cssResults = processCoverage(cssCoverage, "CSS");
const allResults = [...jsResults, ...cssResults];

// Calculate totals
const jsTotals = jsResults.reduce(
	(acc, r) => ({ total: acc.total + r.totalBytes, unused: acc.unused + r.unusedBytes }),
	{ total: 0, unused: 0 }
);
const cssTotals = cssResults.reduce(
	(acc, r) => ({ total: acc.total + r.totalBytes, unused: acc.unused + r.unusedBytes }),
	{ total: 0, unused: 0 }
);

console.log("\n📊 Coverage Summary\n");
console.log(`JS:   ${formatBytes(jsTotals.total).padStart(10)} total, ${formatBytes(jsTotals.unused).padStart(10)} unused (${((jsTotals.unused / jsTotals.total) * 100).toFixed(1)}%)`);
console.log(`CSS:  ${formatBytes(cssTotals.total).padStart(10)} total, ${formatBytes(cssTotals.unused).padStart(10)} unused (${((cssTotals.unused / cssTotals.total) * 100).toFixed(1)}%)`);

// Sort by unused bytes
const worstOffenders = allResults
	.filter(r => r.unusedBytes > 1024) // Only show files with >1KB unused
	.sort((a, b) => b.unusedBytes - a.unusedBytes)
	.slice(0, 15);

if (worstOffenders.length > 0) {
	console.log("\n🔴 Largest Unused Code\n");
	console.log("Unused".padStart(10) + "  " + "Total".padStart(10) + "  " + "%".padStart(5) + "  File");
	console.log("-".repeat(80));

	for (const r of worstOffenders) {
		const unused = formatBytes(r.unusedBytes).padStart(10);
		const total = formatBytes(r.totalBytes).padStart(10);
		const pct = r.unusedPercent.toFixed(0).padStart(4) + "%";
		const file = shortUrl(r.url);
		console.log(`${unused}  ${total}  ${pct}  ${file}`);
	}
}

// Files with high unused percentage (>70% unused and >5KB)
const highPercentUnused = allResults
	.filter(r => r.unusedPercent > 70 && r.totalBytes > 5000)
	.sort((a, b) => b.unusedPercent - a.unusedPercent)
	.slice(0, 10);

if (highPercentUnused.length > 0) {
	console.log("\n⚠️  High Unused Percentage (>70%)\n");
	for (const r of highPercentUnused) {
		const pct = r.unusedPercent.toFixed(0).padStart(3) + "%";
		const unused = formatBytes(r.unusedBytes).padStart(10);
		console.log(`${pct} unused (${unused})  ${shortUrl(r.url)}`);
	}
}

const grandTotal = jsTotals.total + cssTotals.total;
const grandUnused = jsTotals.unused + cssTotals.unused;
console.log(`\n📈 Total: ${formatBytes(grandTotal)} code, ${formatBytes(grandUnused)} unused (${((grandUnused / grandTotal) * 100).toFixed(1)}%)\n`);

await p.close();
await b.disconnect();
