#!/usr/bin/env node

import puppeteer from "puppeteer-core";

try {
	// Connect using Puppeteer for proper connection management
	const browser = await puppeteer.connect({
		browserURL: "http://localhost:9222",
		defaultViewport: null,
	});

	// Use targets() instead of pages() - more efficient, no full Page objects
	const targets = await browser.targets();

	// Filter to page-type targets only
	const pageTargets = targets.filter(t => t.type() === 'page');

	if (pageTargets.length === 0) {
		console.error("✗ No page targets found");
		await browser.disconnect();
		process.exit(1);
	}

	// Get URLs directly from targets (synchronous, no CDP calls)
	// For titles, we need to fetch from the REST API or call .page() (slow)
	// Let's use REST API for titles while keeping Puppeteer connection
	const response = await fetch("http://localhost:9222/json");
	const tabsData = await response.json();

	// Create URL->title map from REST API
	const urlToTitle = new Map();
	tabsData.forEach(tab => {
		if (tab.url && tab.title) {
			urlToTitle.set(tab.url, tab.title);
		}
	});

	// Filter out background/noise tabs
	const mainTargets = pageTargets.filter(target => {
		const url = target.url();

		// Skip extensions, blob URLs, etc.
		if (url.startsWith('chrome-extension://')) return false;
		if (url.startsWith('blob:')) return false;
		if (url.includes('service_worker')) return false;
		if (url.includes('recaptcha')) return false;
		if (url.includes('googletagmanager')) return false;
		if (url.includes('freshchat.com/error')) return false;
		if (url.includes('shopping/customerreviews/badge')) return false;
		if (url.includes('smct.io')) return false;
		if (url.includes('cloudfront.net')) return false;

		return true;
	});

	console.log(`Found ${mainTargets.length} main tab${mainTargets.length === 1 ? '' : 's'} (${pageTargets.length} total pages):\n`);

	mainTargets.forEach((target, i) => {
		const url = target.url();
		const title = urlToTitle.get(url) || '(untitled)';

		console.log(`[${i + 1}] ${title}`);
		console.log(`    ${url}`);
		console.log();
	});

	await browser.disconnect();

} catch (error) {
	console.error("✗ Failed to connect to Chrome DevTools");
	console.error("  Make sure Chrome is running with remote debugging: browser-start.js");
	process.exit(1);
}
