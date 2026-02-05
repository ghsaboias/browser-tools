#!/usr/bin/env node

import puppeteer from "puppeteer-core";
import { writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";

const url = process.argv[2];
const duration = parseInt(process.argv[3]) || 5; // seconds to record after load

if (!url) {
	console.log("Usage: browser-trace.js <url> [duration_seconds]");
	console.log("\nRecords a performance trace during page load:");
	console.log("  - Main thread activity breakdown");
	console.log("  - Long tasks analysis");
	console.log("  - Saves trace file for Chrome DevTools import");
	console.log("\nExamples:");
	console.log("  browser-trace.js http://localhost:3000");
	console.log("  browser-trace.js https://example.com 10");
	process.exit(1);
}

const b = await puppeteer.connect({
	browserURL: "http://localhost:9222",
	defaultViewport: null,
});

const p = await b.newPage();
const client = await p.createCDPSession();

// Prepare trace output directory
const traceDir = join(process.cwd(), ".traces");
await mkdir(traceDir, { recursive: true });
const traceFile = join(traceDir, `trace-${Date.now()}.json`);

console.log(`\n🔍 Recording performance trace for ${url}...\n`);

// Start tracing
await p.tracing.start({
	categories: [
		"devtools.timeline",
		"blink.user_timing",
		"devtools.timeline.frame",
		"loading",
		"disabled-by-default-devtools.timeline",
		"disabled-by-default-devtools.timeline.stack",
	],
});

// Navigate
const navStart = Date.now();
await p.goto(url, { waitUntil: "load", timeout: 60000 });
const loadTime = Date.now() - navStart;

// Wait additional time to capture post-load activity
console.log(`Page loaded in ${loadTime}ms. Recording for ${duration}s more...\n`);
await new Promise((r) => setTimeout(r, duration * 1000));

// Stop tracing and save
const traceBuffer = await p.tracing.stop();
await writeFile(traceFile, traceBuffer);

// Read back and parse trace for summary
const traceContent = await readFile(traceFile, "utf-8");
const trace = JSON.parse(traceContent);
const events = trace.traceEvents || [];

// Analyze main thread activity
const mainThreadEvents = events.filter(
	(e) => e.cat?.includes("devtools.timeline") && e.dur
);

// Group by category
const categories = {};
for (const event of mainThreadEvents) {
	const name = event.name || "Other";
	if (!categories[name]) categories[name] = 0;
	categories[name] += event.dur / 1000; // Convert to ms
}

// Sort by time spent
const sortedCategories = Object.entries(categories)
	.sort((a, b) => b[1] - a[1])
	.slice(0, 15);

console.log("📊 Main Thread Activity (top categories)\n");
let totalTime = 0;
for (const [name, time] of sortedCategories) {
	totalTime += time;
	const ms = time.toFixed(1).padStart(8);
	console.log(`${ms}ms  ${name}`);
}

// Find long tasks (>50ms)
const longTasks = events.filter(
	(e) => e.name === "RunTask" && e.dur && e.dur > 50000 // >50ms in microseconds
);

if (longTasks.length > 0) {
	console.log(`\n🐢 Long Tasks (>50ms): ${longTasks.length} found\n`);

	// Sort by duration
	longTasks.sort((a, b) => b.dur - a.dur);

	// Show top 10
	for (const task of longTasks.slice(0, 10)) {
		const dur = (task.dur / 1000).toFixed(0).padStart(6);
		const ts = ((task.ts - events[0].ts) / 1000).toFixed(0);
		console.log(`${dur}ms  at ${ts}ms`);
	}

	const totalBlocking = longTasks.reduce(
		(sum, t) => sum + Math.max(0, t.dur / 1000 - 50),
		0
	);
	console.log(`\nTotal Blocking Time: ${totalBlocking.toFixed(0)}ms`);
}

// Find layout/paint events
const layoutEvents = events.filter((e) => e.name === "Layout" && e.dur);
const paintEvents = events.filter((e) => e.name === "Paint" && e.dur);

console.log(`\n🎨 Rendering\n`);
console.log(`Layouts: ${layoutEvents.length} (${layoutEvents.reduce((s, e) => s + e.dur / 1000, 0).toFixed(0)}ms total)`);
console.log(`Paints:  ${paintEvents.length} (${paintEvents.reduce((s, e) => s + e.dur / 1000, 0).toFixed(0)}ms total)`);

// Script execution
const scriptEvents = events.filter(
	(e) => (e.name === "EvaluateScript" || e.name === "FunctionCall") && e.dur
);
const scriptTime = scriptEvents.reduce((s, e) => s + e.dur / 1000, 0);
console.log(`Scripts: ${scriptEvents.length} evaluations (${scriptTime.toFixed(0)}ms total)`);

console.log(`\n📁 Trace saved: ${traceFile}`);
console.log(`   Open in Chrome DevTools → Performance → Load profile\n`);

await p.close();
await b.disconnect();
