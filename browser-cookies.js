#!/usr/bin/env node

import puppeteer from "puppeteer-core";

const b = await puppeteer.connect({
	browserURL: "http://localhost:9222",
	defaultViewport: null,
});

// Use targets() instead of pages() to avoid hanging with many tabs
const pageTargets = (await b.targets()).filter(t => t.type() === 'page');
if (pageTargets.length === 0) {
	console.error("✗ No active tab found");
	await b.disconnect();
	process.exit(1);
}
const p = await pageTargets.at(-1).page();

const cookies = await p.cookies();

for (const cookie of cookies) {
	console.log(`${cookie.name}: ${cookie.value}`);
	console.log(`  domain: ${cookie.domain}`);
	console.log(`  path: ${cookie.path}`);
	console.log(`  httpOnly: ${cookie.httpOnly}`);
	console.log(`  secure: ${cookie.secure}`);
	console.log("");
}

await b.disconnect();
