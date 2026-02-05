#!/usr/bin/env node

import puppeteer from "puppeteer-core";

const url = process.argv[2];

if (!url) {
	console.log("Usage: browser-performance.js <url>");
	console.log("\nMeasures Core Web Vitals with a fresh navigation:");
	console.log("  - TTFB (Time to First Byte)");
	console.log("  - FCP (First Contentful Paint)");
	console.log("  - LCP (Largest Contentful Paint)");
	console.log("  - CLS (Cumulative Layout Shift)");
	console.log("  - TBT (Total Blocking Time)");
	console.log("\nExample:");
	console.log("  browser-performance.js http://localhost:3000");
	process.exit(1);
}

const b = await puppeteer.connect({
	browserURL: "http://localhost:9222",
	defaultViewport: null,
});

const p = await b.newPage();

// Enable performance tracking via CDP
const client = await p.createCDPSession();
await client.send("Performance.enable");

// Inject performance observers before navigation
await p.evaluateOnNewDocument(() => {
	window.__perfMetrics = {
		lcp: null,
		cls: 0,
		fcp: null,
		longTasks: [],
	};

	// LCP Observer
	new PerformanceObserver((list) => {
		const entries = list.getEntries();
		const last = entries[entries.length - 1];
		window.__perfMetrics.lcp = last.startTime;
	}).observe({ type: "largest-contentful-paint", buffered: true });

	// CLS Observer
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			if (!entry.hadRecentInput) {
				window.__perfMetrics.cls += entry.value;
			}
		}
	}).observe({ type: "layout-shift", buffered: true });

	// FCP from paint timing
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			if (entry.name === "first-contentful-paint") {
				window.__perfMetrics.fcp = entry.startTime;
			}
		}
	}).observe({ type: "paint", buffered: true });

	// Long Tasks for TBT calculation
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			window.__perfMetrics.longTasks.push(entry.duration);
		}
	}).observe({ type: "longtask", buffered: true });
});

// Navigate and wait for load + extra time for LCP/CLS to settle
const start = Date.now();
await p.goto(url, { waitUntil: "load", timeout: 30000 });
const loadTime = Date.now() - start;

// Wait for LCP/CLS to finalize (longer wait for more accurate metrics)
await new Promise((r) => setTimeout(r, 2000));

// Collect metrics
const metrics = await p.evaluate(() => {
	const nav = performance.getEntriesByType("navigation")[0];
	return {
		ttfb: nav ? nav.responseStart : null,
		fcp: window.__perfMetrics.fcp,
		lcp: window.__perfMetrics.lcp,
		cls: window.__perfMetrics.cls,
		longTasks: window.__perfMetrics.longTasks,
	};
});

// Calculate TBT (sum of long task time over 50ms threshold)
const tbt = metrics.longTasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0);

// Get resource stats
const resources = await p.evaluate(() => {
	const entries = performance.getEntriesByType("resource");
	let totalSize = 0;
	let jsSize = 0;
	let cssSize = 0;
	let imgSize = 0;
	let count = entries.length;

	for (const e of entries) {
		const size = e.transferSize || 0;
		totalSize += size;
		if (e.initiatorType === "script" || e.name.includes(".js")) jsSize += size;
		else if (e.initiatorType === "css" || e.name.includes(".css")) cssSize += size;
		else if (e.initiatorType === "img" || /\.(png|jpg|jpeg|gif|webp|svg)/.test(e.name)) imgSize += size;
	}

	return { totalSize, jsSize, cssSize, imgSize, count };
});

// Rating functions based on Core Web Vitals thresholds
function rateMetric(value, good, poor) {
	if (value <= good) return "🟢 Good";
	if (value <= poor) return "🟡 Needs Improvement";
	return "🔴 Poor";
}

function formatMs(ms) {
	if (ms === null) return "N/A";
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

console.log("\n📊 Core Web Vitals\n");
console.log(`TTFB:  ${formatMs(metrics.ttfb).padEnd(10)} ${rateMetric(metrics.ttfb, 800, 1800)}`);
console.log(`FCP:   ${formatMs(metrics.fcp).padEnd(10)} ${rateMetric(metrics.fcp, 1800, 3000)}`);
console.log(`LCP:   ${formatMs(metrics.lcp).padEnd(10)} ${rateMetric(metrics.lcp, 2500, 4000)}`);
console.log(`CLS:   ${metrics.cls.toFixed(3).padEnd(10)} ${rateMetric(metrics.cls, 0.1, 0.25)}`);
console.log(`TBT:   ${formatMs(tbt).padEnd(10)} ${rateMetric(tbt, 200, 600)}`);

console.log("\n📦 Resources\n");
console.log(`Total:   ${formatBytes(resources.totalSize)} (${resources.count} requests)`);
console.log(`JS:      ${formatBytes(resources.jsSize)}`);
console.log(`CSS:     ${formatBytes(resources.cssSize)}`);
console.log(`Images:  ${formatBytes(resources.imgSize)}`);

console.log(`\n⏱️  Page Load: ${formatMs(loadTime)}\n`);

await p.close();
await b.disconnect();
