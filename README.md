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

## Place a window

```bash
browser-window.js -t=<id> --tile 0/3     # tile 0 of 3 in the right half of the rightmost display
browser-window.js -t=<id> --minimize
browser-window.js --displays             # display bounds in the browser's coordinates (macOS)
```

Moves the tab's window without bringing it to the front, so the user keeps keyboard focus. The tiles are a grid of ceil(sqrt(n)) columns over the right half of the rightmost display (the external monitor when one is connected). A visible, uncovered window keeps receiving wheel events and loading feeds while the user works elsewhere; a minimized or covered one does not.

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

Captures a profile's feed through the logged-in browser without calling Instagram's private API (that returns 429). It installs a fetch/XHR hook with `injecton` before navigating, so the first ~12 posts embedded in the page are not missed, then scrolls with real `mouseWheel` events through `raw` (`Input.dispatchMouseEvent`) at a human pace until 4 posts are older than `since` (up to 3 pinned posts can be old). Synthetic `scrollBy` loads nothing. The tab must be in a visible window: in a minimized or fully covered window the wheel event times out and Instagram stops loading. Open a separate window (`browser-open.js --window`) instead of reusing the user's tabs and tile it on a monitor with `browser-window.js --tile <k>/<n>`: a visible window scrolls while the user works in another application, and nothing takes keyboard focus. When a wheel event times out, `lib/scroll.js` restores the window and brings the tab to the front (this does take focus) before trying again. Output items carry `code`, `taken_at`, `user`, `coauthors`, `caption` and `slides[]` with image and video URLs (signed CDN URLs, they expire) and, for a video slide, its `duration` in seconds.
## Instagram Reels tab

```bash
./ig-reels.mjs -t=<tab> <handle> <since YYYY-MM-DD> <until YYYY-MM-DD> <feed.json>
```

Completes a feed.json written by `ig-capture.mjs` with the reels that exist only in the profile's Reels tab: a reel posted without "show on profile grid" never appears in the grid the capture scrolls (one deputy had 7 grid posts and 138 Reels-tab reels in the same seven weeks). The Reels tab carries no dates, so the window is bounded by shortcode order (a shortcode is the media id in base 64 and grows with time) against the dated posts already in feed.json. It scrolls the tab until it is past the start of the window, then fetches `/api/v1/media/<id>/info/` from the page for each missing reel, one request every 1.5 to 2.5 s, and appends the items in the same shape with `so_reels: true`; the original grid feed is kept as `<feed>.grade.json`. Needs a visible window, like the capture.


## TikTok profile

```bash
./tt-profile.mjs -t=<tab> <handle> [--posts=N]
```

Reads one TikTok profile and prints JSON: `status` (`ok`, `not_found` for "Couldn't find this account", `error_screen`, `timeout`), name, bio, bio link, follower, like and video counts, and the N latest posts (default 12) with date, URL and caption. The profile comes from the JSON TikTok embeds in the page and the posts from the `/api/post/item_list` responses the page fetches (hooked with `injecton` before navigating). Use it for every TikTok profile instead of `browser-nav.js` + `browser-eval.js`. A page read in its first seconds, or on the "Something went wrong" screen, shows the header without posts, so a live account looks empty. When that screen appears, the script clicks Refresh the way a person does (`lib/pointer.js`, at most 3 times) and reads again. A normal profile takes about 3 s. It needs a visible window, because the click is real input.

## TikTok feed capture

```bash
./tt-capture.mjs -t=<tab> <handle> <since YYYY-MM-DD> <out.json>
```

Captures a profile's posts back to `since` by scrolling with real wheel events, for profiles `yt-dlp` cannot list. It handles the "Something went wrong" screen the same way as `tt-profile.mjs`. Both use `lib/tiktok.js`.

The "Something went wrong / Sorry about that! Please try again later." screen replaces the feed when the first `item_list` response comes back empty. It was seen in real captures on 18/11/2026, 3 to 13 s after the profile opened, often with the Refresh button below the fold of a tiled window. `lib/pointer.js` clicks it like a person: it pauses 0.7 to 1.6 s, scrolls with the wheel until the button is in view, moves the pointer in 8 to 15 eased steps to a random point inside the button, then presses and releases (`Input.dispatchMouseEvent`, so `isTrusted`). It was tested by emptying the first list responses until the screen showed: one click brought the list back (195 and 83 posts in two captures, 35 in a profile read).
