#!/usr/bin/env node

import puppeteer from "puppeteer-core";

const url = process.argv[2];

if (!url) {
	console.log("Usage: browser-network.js <url>");
	console.log("\nCaptures network requests during page load:");
	console.log("  - Request waterfall with timing breakdown");
	console.log("  - Identifies slow requests");
	console.log("  - Shows largest resources");
	console.log("  - Groups by type (JS, CSS, images, API, etc.)");
	console.log("\nExample:");
	console.log("  browser-network.js http://localhost:3000");
	process.exit(1);
}

const b = await puppeteer.connect({
	browserURL: "http://localhost:9222",
	defaultViewport: null,
});

const p = await b.newPage();
const client = await p.createCDPSession();

// Store request data
const requests = new Map();

// Track request start
client.on("Network.requestWillBeSent", (params) => {
	requests.set(params.requestId, {
		url: params.request.url,
		method: params.request.method,
		startTime: params.timestamp,
		type: params.type || "Other",
	});
});

// Track response
client.on("Network.responseReceived", (params) => {
	const req = requests.get(params.requestId);
	if (req) {
		req.status = params.response.status;
		req.mimeType = params.response.mimeType;
		req.headers = params.response.headers;
		req.timing = params.response.timing;
		req.encodedSize = params.response.encodedDataLength;
		req.protocol = params.response.protocol;
	}
});

// Track completion
client.on("Network.loadingFinished", (params) => {
	const req = requests.get(params.requestId);
	if (req) {
		req.endTime = params.timestamp;
		req.encodedSize = params.encodedDataLength;
		req.finished = true;
	}
});

// Track failures
client.on("Network.loadingFailed", (params) => {
	const req = requests.get(params.requestId);
	if (req) {
		req.failed = true;
		req.errorText = params.errorText;
	}
});

await client.send("Network.enable");

// Navigate
const start = Date.now();
await p.goto(url, { waitUntil: "load", timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500)); // Let late requests finish
const loadTime = Date.now() - start;

// Process results
const results = [];
for (const [id, req] of requests) {
	if (!req.url || req.url.startsWith("data:")) continue;

	const duration = req.endTime && req.startTime
		? (req.endTime - req.startTime) * 1000
		: null;

	// Categorize
	let category = "Other";
	const urlLower = req.url.toLowerCase();
	if (req.type === "Document" || req.mimeType?.includes("html")) category = "Document";
	else if (req.type === "Script" || urlLower.includes(".js")) category = "JS";
	else if (req.type === "Stylesheet" || urlLower.includes(".css")) category = "CSS";
	else if (req.type === "Image" || /\.(png|jpg|jpeg|gif|webp|svg|ico)/.test(urlLower)) category = "Image";
	else if (req.type === "Font" || /\.(woff2?|ttf|otf|eot)/.test(urlLower)) category = "Font";
	else if (req.type === "XHR" || req.type === "Fetch") category = "API";
	else if (urlLower.includes("/api/")) category = "API";

	results.push({
		url: req.url,
		method: req.method,
		status: req.status || (req.failed ? "FAIL" : "?"),
		category,
		size: req.encodedSize || 0,
		duration,
		failed: req.failed,
		errorText: req.errorText,
		timing: req.timing,
	});
}

// Sort by start time (implicit via Map order) then show various views

function formatMs(ms) {
	if (ms === null) return "N/A";
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes) {
	if (!bytes) return "0B";
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function shortUrl(url, max = 60) {
	try {
		const u = new URL(url);
		let path = u.pathname + u.search;
		if (path.length > max) path = "..." + path.slice(-max + 3);
		return path;
	} catch {
		return url.slice(0, max);
	}
}

// Summary by category
const byCategory = {};
for (const r of results) {
	if (!byCategory[r.category]) byCategory[r.category] = { count: 0, size: 0 };
	byCategory[r.category].count++;
	byCategory[r.category].size += r.size;
}

console.log("\n📊 Requests by Type\n");
const categoryOrder = ["Document", "JS", "CSS", "Image", "Font", "API", "Other"];
for (const cat of categoryOrder) {
	if (byCategory[cat]) {
		const { count, size } = byCategory[cat];
		console.log(`${cat.padEnd(10)} ${String(count).padStart(3)} requests   ${formatBytes(size).padStart(10)}`);
	}
}

// Slowest requests
const slowest = results
	.filter(r => r.duration !== null)
	.sort((a, b) => b.duration - a.duration)
	.slice(0, 10);

if (slowest.length > 0) {
	console.log("\n🐢 Slowest Requests\n");
	for (const r of slowest) {
		const time = formatMs(r.duration).padStart(8);
		const size = formatBytes(r.size).padStart(10);
		console.log(`${time}  ${size}  ${r.category.padEnd(6)}  ${shortUrl(r.url)}`);
	}
}

// Largest resources
const largest = results
	.filter(r => r.size > 0)
	.sort((a, b) => b.size - a.size)
	.slice(0, 10);

if (largest.length > 0) {
	console.log("\n📦 Largest Resources\n");
	for (const r of largest) {
		const size = formatBytes(r.size).padStart(10);
		const time = formatMs(r.duration).padStart(8);
		console.log(`${size}  ${time}  ${r.category.padEnd(6)}  ${shortUrl(r.url)}`);
	}
}

// Failed requests
const failed = results.filter(r => r.failed || (r.status && r.status >= 400));
if (failed.length > 0) {
	console.log("\n❌ Failed Requests\n");
	for (const r of failed) {
		const status = String(r.status || "FAIL").padStart(4);
		console.log(`${status}  ${r.errorText || ""}  ${shortUrl(r.url)}`);
	}
}

// Total
const totalSize = results.reduce((sum, r) => sum + r.size, 0);
console.log(`\n📈 Total: ${results.length} requests, ${formatBytes(totalSize)}, ${formatMs(loadTime)} load time\n`);

await p.close();
await b.disconnect();
