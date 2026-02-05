#!/usr/bin/env node

import puppeteer from "puppeteer-core";

const url = process.argv[2];

if (!url) {
	console.log("Usage: browser-lcp.js <url>");
	console.log("\nIdentifies the LCP element and timing breakdown");
	process.exit(1);
}

const b = await puppeteer.connect({
	browserURL: "http://localhost:9222",
	defaultViewport: null,
});

const p = await b.newPage();

// Inject LCP observer before navigation
await p.evaluateOnNewDocument(() => {
	window.__lcpEntries = [];
	window.__renderBlockingResources = [];

	new PerformanceObserver((list) => {
		for (const entry of list.getEntries()) {
			const el = entry.element;
			window.__lcpEntries.push({
				time: entry.startTime,
				size: entry.size,
				tag: el?.tagName,
				id: el?.id,
				className: el?.className,
				src: el?.src || el?.currentSrc || '',
				backgroundImage: el ? getComputedStyle(el).backgroundImage : '',
				text: el?.textContent?.substring(0, 150)?.trim(),
				loadTime: entry.loadTime,
				renderTime: entry.renderTime,
				url: entry.url,
				outerHTML: el?.outerHTML?.substring(0, 500)
			});
		}
	}).observe({ type: 'largest-contentful-paint', buffered: true });
});

console.log(`\n🔍 Loading ${url} to identify LCP element...\n`);

await p.goto(url, { waitUntil: 'load', timeout: 30000 });

// Wait for LCP to settle
await new Promise(r => setTimeout(r, 3000));

const lcpData = await p.evaluate(() => window.__lcpEntries);

if (!lcpData || lcpData.length === 0) {
	console.log("No LCP entries captured\n");
} else {
	// Show all LCP candidates (browser picks largest)
	console.log(`📊 LCP Candidates (${lcpData.length} found)\n`);

	for (let i = 0; i < lcpData.length; i++) {
		const lcp = lcpData[i];
		console.log(`--- Entry ${i + 1} ${i === lcpData.length - 1 ? '(FINAL LCP)' : ''} ---`);
		console.log(`Time:      ${lcp.time?.toFixed(0) ?? 'N/A'}ms`);
		console.log(`Size:      ${lcp.size} px²`);
		console.log(`Element:   <${lcp.tag?.toLowerCase()}>`);
		if (lcp.id) console.log(`ID:        ${lcp.id}`);
		if (lcp.className) console.log(`Class:     ${lcp.className.substring(0, 100)}`);
		if (lcp.src) console.log(`Source:    ${lcp.src}`);
		if (lcp.url) console.log(`URL:       ${lcp.url}`);
		if (lcp.backgroundImage && lcp.backgroundImage !== 'none') {
			console.log(`BG Image:  ${lcp.backgroundImage.substring(0, 100)}`);
		}
		if (lcp.text) console.log(`Text:      "${lcp.text.substring(0, 80)}..."`);
		if (lcp.loadTime) console.log(`Load Time: ${lcp.loadTime?.toFixed(0)}ms`);
		if (lcp.renderTime) console.log(`Render:    ${lcp.renderTime?.toFixed(0)}ms`);
		console.log('');
	}

	// Analyze the final LCP
	const final = lcpData[lcpData.length - 1];
	console.log('📋 Analysis\n');

	if (final.tag === 'IMG') {
		console.log('LCP is an IMAGE');
		console.log(`- Image loaded at: ${final.loadTime?.toFixed(0) ?? 'N/A'}ms`);
		console.log(`- Rendered at: ${final.renderTime?.toFixed(0) ?? final.time?.toFixed(0) ?? 'N/A'}ms`);
		if (final.loadTime > 1000) {
			console.log('⚠️  Image loading is slow - consider:');
			console.log('   - Preloading with <link rel="preload">');
			console.log('   - Using priority prop in Next.js Image');
			console.log('   - Optimizing image size/format');
		}
	} else if (final.text) {
		console.log('LCP is TEXT content');
		console.log(`- Rendered at: ${final.time?.toFixed(0) ?? 'N/A'}ms`);
		if (final.time > 2500) {
			console.log('⚠️  Text rendering is slow - consider:');
			console.log('   - Font loading strategy (font-display: swap)');
			console.log('   - Reducing render-blocking resources');
			console.log('   - Server-side rendering');
		}
	}
}

// Get navigation timing with null safety
const navTiming = await p.evaluate(() => {
	const nav = performance.getEntriesByType('navigation')[0];
	if (!nav) return null;
	return {
		dns: nav.domainLookupEnd - nav.domainLookupStart,
		tcp: nav.connectEnd - nav.connectStart,
		ssl: nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : 0,
		ttfb: nav.responseStart - nav.requestStart,
		download: nav.responseEnd - nav.responseStart,
		domInteractive: nav.domInteractive,
		domContentLoaded: nav.domContentLoadedEventEnd,
		load: nav.loadEventEnd
	};
});

if (navTiming) {
	console.log('\n⏱️  Navigation Timing\n');
	console.log(`TTFB:       ${navTiming.ttfb?.toFixed(0) ?? 'N/A'}ms`);
	console.log(`Download:   ${navTiming.download?.toFixed(0) ?? 'N/A'}ms`);
	console.log(`DOM Interactive: ${navTiming.domInteractive?.toFixed(0) ?? 'N/A'}ms`);
	console.log(`DOM Content Loaded: ${navTiming.domContentLoaded?.toFixed(0) ?? 'N/A'}ms`);
	console.log(`Full Load:  ${navTiming.load?.toFixed(0) ?? 'N/A'}ms`);
}

// Get render-blocking resources
const blockingResources = await p.evaluate(() => {
	return performance.getEntriesByType('resource')
		.filter(r => r.renderBlockingStatus === 'blocking')
		.map(r => ({
			name: r.name.split('/').pop().split('?')[0].substring(0, 40),
			type: r.initiatorType,
			duration: Math.round(r.duration),
			size: r.transferSize
		}));
});

if (blockingResources.length > 0) {
	console.log('\n🚧 Render-Blocking Resources\n');
	for (const r of blockingResources) {
		console.log(`${r.duration}ms  ${r.type.padEnd(6)}  ${r.name}`);
	}
}

// Get fonts and their load times
const fonts = await p.evaluate(() => {
	return performance.getEntriesByType('resource')
		.filter(r => r.name.match(/\.(woff2?|ttf|otf)/) || r.initiatorType === 'font')
		.map(r => ({
			name: r.name.split('/').pop().split('?')[0].substring(0, 35),
			duration: Math.round(r.duration),
			start: Math.round(r.startTime),
			size: r.transferSize
		}));
});

if (fonts.length > 0) {
	console.log('\n🔤 Font Loading\n');
	for (const f of fonts) {
		const sizeStr = f.size > 0 ? `${Math.round(f.size/1024)}KB` : 'cached';
		console.log(`${f.start}ms + ${f.duration}ms  ${sizeStr.padEnd(8)}  ${f.name}`);
	}
}

// Summary
const final = lcpData?.[lcpData.length - 1];
if (final && navTiming) {
	console.log('\n📊 LCP Breakdown\n');
	const ttfb = navTiming.ttfb || 0;
	const renderDelay = final.time - ttfb;
	console.log(`TTFB:          ${ttfb.toFixed(0)}ms`);
	console.log(`Render Delay:  ${renderDelay.toFixed(0)}ms`);
	console.log(`Total LCP:     ${final.time.toFixed(0)}ms`);
}

console.log('');

await p.close();
await b.disconnect();
