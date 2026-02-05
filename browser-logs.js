#!/usr/bin/env node

import puppeteer from "puppeteer-core";

const reload = process.argv.includes('--reload');

const b = await puppeteer.connect({
	browserURL: "http://localhost:9222",
	defaultViewport: null,
});

const pageTargets = (await b.targets()).filter(t => t.type() === 'page');
if (pageTargets.length === 0) {
	console.error("✗ No active tab found");
	await b.disconnect();
	process.exit(1);
}
const p = await pageTargets.at(-1).page();

// Inject log capture script into the current page
await p.evaluate(() => {
	if (!window.__capturedLogs) {
		window.__capturedLogs = [];
		const originalLog = console.log;
		const originalError = console.error;
		const originalWarn = console.warn;
		const originalInfo = console.info;

		console.log = function(...args) {
			window.__capturedLogs.push(`[LOG] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`);
			originalLog.apply(console, args);
		};
		console.error = function(...args) {
			window.__capturedLogs.push(`[ERROR] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`);
			originalError.apply(console, args);
		};
		console.warn = function(...args) {
			window.__capturedLogs.push(`[WARN] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`);
			originalWarn.apply(console, args);
		};
		console.info = function(...args) {
			window.__capturedLogs.push(`[INFO] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`);
			originalInfo.apply(console, args);
		};
	}
});

// Also set up listener for real-time logs
const logs = [];
const messageHandler = msg => {
	const text = msg.text();
	logs.push(`[${msg.type().toUpperCase()}] ${text}`);
};

p.on('console', messageHandler);

// Optionally reload to capture logs from page load
if (reload) {
	console.log('Reloading page to capture console logs...');
	await p.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
}

// Get duration from args or default to 5 seconds
const durationArg = process.argv.find(arg => arg.startsWith('--duration='));
const duration = durationArg ? parseInt(durationArg.split('=')[1]) * 1000 : 5000;

console.log(`Capturing logs for ${duration / 1000}s...`);
await new Promise(resolve => setTimeout(resolve, duration));

// Get logs from page context
const pageLogs = await p.evaluate(() => window.__capturedLogs || []);

// Combine both sources
const allLogs = [...pageLogs, ...logs];

// Print collected logs
if (allLogs.length > 0) {
	console.log("\n=== Browser Console Logs ===\n");
	allLogs.forEach(log => console.log(log));
} else {
	console.log("No console logs captured");
	if (!reload) {
		console.log("\nTip: Use --reload flag to reload the page and capture logs from page load:");
		console.log("  browser-logs.js --reload");
	}
}

console.log("\nUsage:");
console.log("  browser-logs.js              # Capture logs for 5 seconds");
console.log("  browser-logs.js --reload     # Reload page first, then capture for 5 seconds");
console.log("  browser-logs.js --duration=10  # Capture logs for 10 seconds");
console.log("  browser-logs.js --reload --duration=10");

await b.disconnect();
