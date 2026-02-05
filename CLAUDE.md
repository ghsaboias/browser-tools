# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browser Tools is a collection of minimal Chrome DevTools Protocol (CDP) utilities for agent-assisted web automation. All tools connect to Chrome running with remote debugging enabled on port 9222.

## Architecture

**Core Pattern**:
1. Connect via `puppeteer-core` to existing Chrome on port 9222
2. Use `browser.targets()` to find most recent page target
3. Convert target to Page object only when needed
4. Execute operation and disconnect

**Why `targets()` not `pages()`**: `browser.pages()` hangs with many tabs (76+ tabs = indefinite hang). `browser.targets()` returns lightweight objects instantly.

**Constraint**: Chrome must run with remote debugging. Tools exit gracefully if not.

## Common Commands

### Setup
```bash
npm install  # Install puppeteer-core and cheerio
```

### Starting Chrome
```bash
./browser-start.js              # Fresh profile (blank state)
./browser-start.js --profile    # Copy user's Chrome profile (preserves cookies/logins)
```

**Important**:
- `browser-start.js` kills all existing Chrome instances before starting
- With `--profile`: Uses rsync to copy `~/Library/Application Support/Google/Chrome/` to `~/.cache/scraping` (Mac-specific path)
- Chrome launches detached (process survives after script exits)
- Waits for Chrome to accept connections before exiting (30 retries at 500ms intervals)

### Navigation
```bash
./browser-nav.js https://example.com        # Navigate current tab
./browser-nav.js https://example.com --new  # Open new tab
```

Waits for `domcontentloaded` event, not full page load.

### JavaScript Evaluation
```bash
./browser-eval.js 'document.title'
./browser-eval.js 'document.querySelectorAll("a").length'
```

**Technical detail**: Code runs in async context via `AsyncFunction` constructor. Return value is automatically formatted:
- Objects → key-value pairs
- Arrays of objects → formatted list with blank line separators
- Primitives → direct output

### Screenshots
```bash
./browser-screenshot.js
```

Returns temporary file path in system tmpdir with timestamp: `/tmp/screenshot-2025-11-03T12-34-56-789Z.png`

### Interactive Element Picker
```bash
./browser-pick.js "Click the submit button"
```

**Critical behavior**:
- Injects `window.pick()` function into current page
- User can Cmd/Ctrl+Click to select multiple elements
- Returns element metadata: tag, id, class, text (200 char limit), html (500 char limit), parent hierarchy
- Single click → return immediately with one element
- Multiple selections → press Enter to return array
- ESC → cancel and return null

**Use this when**: User needs to manually select specific DOM elements because automated selectors are ambiguous or complex.

### Cookie Inspection
```bash
./browser-cookies.js
```

Displays all cookies for current page including security flags (httpOnly, secure, domain, path).

### Hacker News Scraper
```bash
./browser-hn-scraper.js              # Get 30 submissions (default)
./browser-hn-scraper.js --limit 10   # Get 10 submissions
```

**Unique tool**: Does NOT use CDP/Puppeteer. Fetches and parses HN HTML directly with Cheerio. Returns JSON array of submissions with: id, title, url, points, author, time, comments count, hnUrl.

## Tool Implementation Patterns

**Connection boilerplate**:
```javascript
const b = await puppeteer.connect({
  browserURL: "http://localhost:9222",
  defaultViewport: null,
});

// Use targets() - efficient with many tabs
const pageTargets = (await b.targets()).filter(t => t.type() === 'page');
if (pageTargets.length === 0) {
  console.error("✗ No active tab found");
  await b.disconnect();
  process.exit(1);
}
const p = await pageTargets.at(-1).page();  // Most recent tab

// ... do work ...
await b.disconnect();
```

**Error handling**:
- No active tab → stderr + exit(1)
- Connection failure → exception from puppeteer.connect
- No retry logic - ephemeral tools

**Output**:
- Success → "✓ ..." (stdout)
- Errors → "✗ ..." (stderr)
- Data → stdout

## Development Notes

- All tools have shebang `#!/usr/bin/env node` and are executable
- Package uses `"type": "module"` for ES modules
- No TypeScript, no build step - plain Node.js
- No tests, no CI - minimal utility scripts
- Tools are independent - no shared modules or state
