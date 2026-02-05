#!/usr/bin/env node

import { tmpdir } from "node:os";
import { join } from "node:path";
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

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const filename = `screenshot-${timestamp}.png`;
const filepath = join(tmpdir(), filename);

await p.screenshot({ path: filepath });

console.log(filepath);

await b.disconnect();
