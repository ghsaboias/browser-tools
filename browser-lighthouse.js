#!/usr/bin/env node

import { exec } from "child_process";
import { promisify } from "util";
import { readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const execAsync = promisify(exec);

const url = process.argv[2];
const category = process.argv[3] || "all"; // performance, accessibility, best-practices, seo, or all

if (!url) {
	console.log("Usage: browser-lighthouse.js <url> [category]");
	console.log("\nRuns Lighthouse audit via Chrome on :9222");
	console.log("\nCategories:");
	console.log("  performance      Core Web Vitals, load metrics");
	console.log("  accessibility    A11y issues");
	console.log("  best-practices   Security, modern APIs");
	console.log("  seo              Search engine optimization");
	console.log("  all              All categories (default)");
	console.log("\nExamples:");
	console.log("  browser-lighthouse.js http://localhost:3000");
	console.log("  browser-lighthouse.js https://example.com performance");
	process.exit(1);
}

// Build category flags
let categoryFlags = "";
if (category === "all") {
	categoryFlags = "--only-categories=performance,accessibility,best-practices,seo";
} else {
	categoryFlags = `--only-categories=${category}`;
}

const outputPath = join(tmpdir(), `lighthouse-${Date.now()}.json`);

console.log(`\n🔍 Running Lighthouse audit on ${url}...\n`);

try {
	// Run lighthouse CLI with existing Chrome instance
	const cmd = `npx lighthouse "${url}" --port=9222 --output=json --output-path="${outputPath}" ${categoryFlags} --chrome-flags="--headless" 2>/dev/null`;

	await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024, timeout: 120000 });

	// Read and parse results
	const json = await readFile(outputPath, "utf-8");
	const report = JSON.parse(json);

	// Display scores
	console.log("📊 Lighthouse Scores\n");

	const categories = report.categories;
	const scoreEmoji = (score) => {
		if (score >= 0.9) return "🟢";
		if (score >= 0.5) return "🟡";
		return "🔴";
	};

	for (const [key, cat] of Object.entries(categories)) {
		const score = Math.round(cat.score * 100);
		console.log(`${scoreEmoji(cat.score)} ${cat.title.padEnd(20)} ${score}`);
	}

	// Performance metrics
	if (categories.performance) {
		const audits = report.audits;
		console.log("\n⏱️  Performance Metrics\n");

		const metrics = [
			["first-contentful-paint", "FCP"],
			["largest-contentful-paint", "LCP"],
			["total-blocking-time", "TBT"],
			["cumulative-layout-shift", "CLS"],
			["speed-index", "Speed Index"],
			["interactive", "TTI"],
		];

		for (const [key, label] of metrics) {
			if (audits[key]) {
				const audit = audits[key];
				const value = audit.displayValue || "N/A";
				const emoji = scoreEmoji(audit.score);
				console.log(`${emoji} ${label.padEnd(14)} ${value}`);
			}
		}
	}

	// Top opportunities
	const opportunities = Object.values(report.audits)
		.filter(a => a.details?.type === "opportunity" && a.details?.overallSavingsMs > 0)
		.sort((a, b) => (b.details?.overallSavingsMs || 0) - (a.details?.overallSavingsMs || 0))
		.slice(0, 5);

	if (opportunities.length > 0) {
		console.log("\n💡 Top Opportunities\n");
		for (const opp of opportunities) {
			const savings = opp.details.overallSavingsMs;
			const savingsStr = savings > 1000
				? `${(savings / 1000).toFixed(1)}s`
				: `${Math.round(savings)}ms`;
			console.log(`-${savingsStr.padStart(7)} ${opp.title}`);
		}
	}

	// Top diagnostics/warnings
	const diagnostics = Object.values(report.audits)
		.filter(a => a.score !== null && a.score < 1 && a.details?.items?.length > 0)
		.filter(a => !opportunities.includes(a))
		.sort((a, b) => (a.score || 0) - (b.score || 0))
		.slice(0, 5);

	if (diagnostics.length > 0) {
		console.log("\n⚠️  Diagnostics\n");
		for (const diag of diagnostics) {
			const items = diag.details.items.length;
			console.log(`- ${diag.title} (${items} items)`);
		}
	}

	// Cleanup
	await unlink(outputPath).catch(() => {});

	console.log("");

} catch (error) {
	console.error("Error running Lighthouse:", error.message);

	// Cleanup on error
	await unlink(outputPath).catch(() => {});
	process.exit(1);
}
