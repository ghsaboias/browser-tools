#!/usr/bin/env node

import puppeteer from "puppeteer-core";

const url = process.argv[2];
const newTab = process.argv[3] === "--new";

if (!url) {
	console.log("Usage: browser-nav.js <url> [--new]");
	console.log("\nExamples:");
	console.log("  browser-nav.js https://example.com       # Navigate current tab");
	console.log("  browser-nav.js https://example.com --new # Open in new tab");
	process.exit(1);
}

const b = await puppeteer.connect({
	browserURL: "http://localhost:9222",
	defaultViewport: null,
});

if (newTab) {
	const p = await b.newPage();
	await p.goto(url, { waitUntil: "domcontentloaded" });
	console.log("✓ Opened:", url);
} else {
	// Use targets() instead of pages() to avoid hanging with many tabs
	const pageTargets = (await b.targets()).filter(t => t.type() === 'page');
	if (pageTargets.length === 0) {
		console.error("✗ No page targets found");
		await b.disconnect();
		process.exit(1);
	}
	// Get the most recent page target and convert to Page
	const p = await pageTargets.at(-1).page();
	await p.goto(url, { waitUntil: "domcontentloaded" });
	console.log("✓ Navigated to:", url);
}

await b.disconnect();
