# Browser Tools

Chrome DevTools Protocol tools for agent-assisted web automation. These tools connect to Chrome running on `:9222` with remote debugging enabled.

## Start Chrome

```bash
browser-start.js              # Fresh profile
browser-start.js --profile    # Copy user's profile (cookies, logins)
```

Launch Chrome with remote debugging. Use `--profile` to preserve user's authentication state.

## Navigate

```bash
browser-nav.js https://example.com
browser-nav.js https://example.com --new
```

Navigate to URLs. Use `--new` flag to open in a new tab instead of reusing current tab.

## Evaluate JavaScript

```bash
browser-eval.js 'document.title'
browser-eval.js 'document.querySelectorAll("a").length'
```

Execute JavaScript in the active tab. Code runs in async context. Use this to extract data, inspect page state, or perform DOM operations programmatically.

## Screenshot

```bash
browser-screenshot.js
```

Capture current viewport and return temporary file path. Use this to visually inspect page state or verify UI changes.

## Pick Elements

```bash
browser-pick.js "Click the submit button"
```

**IMPORTANT**: Use this tool when the user wants to select specific DOM elements on the page. This launches an interactive picker that lets the user click elements to select them. The user can select multiple elements (Cmd/Ctrl+Click) and press Enter when done. The tool returns CSS selectors for the selected elements.

Common use cases:
- User says "I want to click that button" → Use this tool to let them select it
- User says "extract data from these items" → Use this tool to let them select the elements
- When you need specific selectors but the page structure is complex or ambiguous

## Cookies

```bash
browser-cookies.js
```

Display all cookies for the current tab including domain, path, httpOnly, and secure flags. Use this to debug authentication issues or inspect session state.

## Instagram feed capture

```bash
./ig-capture.mjs -t=<tab> <handle> <since YYYY-MM-DD> <out.json>
```

Captures a profile's feed through the logged-in browser without calling Instagram's private API (that returns 429). It installs a fetch/XHR hook with `injecton` before navigating, so the first ~12 posts embedded in the page are not missed, then scrolls with real `mouseWheel` events through `raw` (`Input.dispatchMouseEvent`) at a human pace until 4 posts are older than `since` (up to 3 pinned posts can be old). Synthetic `scrollBy` loads nothing. The tab must be in a visible window: in a background tab Instagram stops loading. Open a separate window (`Target.createTarget` with `newWindow: true`) instead of reusing the user's tabs; scrolling it by hand speeds it up. Output items carry `code`, `taken_at`, `user`, `coauthors`, `caption` and `slides[]` with image and video URLs (signed CDN URLs, they expire).
