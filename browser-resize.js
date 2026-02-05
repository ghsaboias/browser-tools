#!/usr/bin/env node

import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);

// Parse arguments
let width = 375;
let height = 812;

if (args[0] === "--help" || args[0] === "-h") {
	console.log("Usage: browser-resize.js [width] [height]");
	console.log("       browser-resize.js [preset]");
	console.log("\nPresets:");
	console.log("  mobile     375x812 (iPhone 13)");
	console.log("  tablet     768x1024 (iPad)");
	console.log("  desktop    1280x800");
	console.log("  wide       1920x1080");
	console.log("\nExamples:");
	console.log("  browser-resize.js mobile");
	console.log("  browser-resize.js 1440 900");
	console.log("  browser-resize.js 375     # height auto (812)");
	process.exit(0);
}

const presets = {
	mobile: [375, 812],
	tablet: [768, 1024],
	desktop: [1280, 800],
	wide: [1920, 1080],
};

if (args[0] && presets[args[0]]) {
	[width, height] = presets[args[0]];
} else if (args[0]) {
	width = parseInt(args[0], 10);
	height = args[1] ? parseInt(args[1], 10) : 812;
}

if (isNaN(width) || isNaN(height)) {
	console.error("✗ Invalid dimensions");
	process.exit(1);
}

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
await p.setViewport({ width, height });

console.log(`✓ Viewport resized to ${width}x${height}`);

await b.disconnect();
