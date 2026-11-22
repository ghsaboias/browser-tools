---
name: browser-tools
description: Drive the shared Chromium (Pi, lwcloud) or your live Brave/Chrome by refs, raw CDP. Use to navigate sites, fill and submit forms, click through SPAs, read a page that blocks curl/WebFetch (bot wall, login, JavaScript-rendered), capture the JSON a private API returns to a page, or run a multi-step browser flow in one call.
allowed-tools: Read, Bash
---

# Browser Tools

Raw Chrome DevTools Protocol, our own code (`~/agent-tools/browser-tools`, github ghsaboias/browser-tools), no Puppeteer. Scripts are run from that directory or by absolute path.

## The loop: snap, act on refs

```bash
cd ~/agent-tools/browser-tools
./browser-open.js https://site.gov.br/busca --name=busca   # own window; prints [ID]
./browser-snap.js -t=busca                                 # outline with refs
./browser-fill.js -t=busca e7 "licitação energia"
./browser-select.js -t=busca e9 "2026"
./browser-click.js -t=busca e12                            # → "clicked e12; navigated to …"
./browser-snap.js -t=busca                                 # refs for the new page
```

- **Refs** (`e12`) come from `browser-snap.js` and name controls, headings, images, rows and iframes. Every action takes a ref (or a CSS selector). A ref stays valid until the page navigates; after that the command says so and you snap again.
- **The snapshot is scoped**: when the page has one `<main>`, the outline is main plus any open dialog, with a header counting what it left out. `--all` shows everything, `browser-snap.js e40` one region, `--max=0` lifts the 400-line cap. Iframes, cross-origin ones included, are inlined and their refs work like any other.
- **Every action reports what the page did**: `navigated to <url> (HTTP 200)`, `URL is now <url>` (SPA route), `opened tab [ID] <url>` (target=_blank, window.open). Read it before the next step.
- **A covered target is refused** with the cover named (`e13 is covered by div#modal "Usamos cookies Aceitar"`): click the dialog's button ref first. `--force` clicks anyway.
- `browser-fill.js` replaces a field's text (click, select all, delete, type) and says when the page reformatted it (`"123.456.789-01"`). On a native `<select>` it picks the option.

## Commands

```bash
browser-open.js [<url>] [--name=<n>] [--no-wait] [--tile=k/n] [--id]   # own window; --name reuses an open tab of that name
browser-window.js -t=<tab> --tile k/n | --minimize # Mac: place a window without taking focus
browser-list.js                                    # tabs: [ID] "name" title (idle) url
browser-snap.js [-t] [--all] [--max=N] [<ref>]     # outline with refs
browser-find.js [-t] <role|*> [name|/regex/]       # one ref by role and name → {"ref":"e14",...}
browser-click.js [-t] <ref|selector> [--double] [--right] [--force]
browser-click.js [-t] <x> <y>
browser-fill.js [-t] <ref|selector> <text>
browser-select.js [-t] <ref|selector> <value|label> [...]
browser-hover.js [-t] <ref|selector>
browser-type.js [-t] <text>                        # into the focused element
browser-key.js [-t] Enter | Tab | "Ctrl+a" ...      # real key events
browser-scroll.js [-t] [px | -px | <ref>]          # wheel steps; default 600
browser-wait.js [-t] --text=… | --url=… | --selector=… | --gone=… [--timeout=ms]
browser-nav.js [-t] <url>                          # waits for load; prints the HTTP status
browser-intercept.js start|read|stop [-t] [--match=…] [--block=…] [--body] [--wait=ms] [--json]   # network record
browser-eval.js [-t] [--isolated] "<js>"           # page's world; --isolated: DOM only, unseen by the page
browser-screenshot.js [-t] [--full | <ref>] [--out=path]
browser-html.js [-t] [<ref|selector>]
browser-close.js -t=<tab>
browser-cookies.js · browser-resize.js · browser-logs.js · browser-pick.js · browser-stop.js · browser-reap.js
```

`-t=` takes a tab name, an `[ID]` prefix, or a URL/title substring; without it, the last tab. Name tabs in any flow longer than one command.

## Multi-step flows in one call: browser-run.js

When the steps are known, run them as one script instead of one command per step:

```bash
./browser-run.js --name=pesqele --url=https://pesqele.tse.jus.br/ -e '
  await page.click(await page.find("link", "Consultar pesquisas"));
  await page.select(await page.find("combobox", "Eleição"), "2026");
  await page.fill(await page.find("textbox", "UF"), "SP");
  await page.click(await page.find("button", "Pesquisar"));
  await page.wait({ text: "Resultado" });
  return page.snap();
'
```

In scope: `page` (`goto url snap find click fill type press select hover scroll wait eval evalIsolated screenshot html popup close intercept`), `tabs` (`open(url, {name})`, `get(q)`, `list()`), `log`, `sleep`. The last line is `# tab [ID] url`; keep going with `-t=<ID>` or the name. A failed step prints `error: …` and the tab, so the next call continues from where it stopped.

## The network behind the page: browser-intercept.js

What the rendered page hides is often in its requests: an IR portal (Mziq, RI Web) fills the document list from a private JSON API, a search form POSTs its filters, a link redirects twice. Record the tab while you act, then read:

```bash
./browser-intercept.js start -t=ri --match=/v2/files      # keeps the bodies of matching responses
./browser-click.js -t=ri e31                              # the year tab that loads the list
./browser-intercept.js read -t=ri --wait=10000 --body     # waits for a matching response; prints method, status, type, size, URL, POST body, response body
./browser-intercept.js stop -t=ri
```

`--match` and `--block` take a URL part or a `/regex/` (a path like `/v2/files` stays a URL part: only `dgimsuy` count as flags). Without `--match`, the record keeps the bodies of documents, XHR and fetch; `--max=N` caps a printed body (default 4000 characters, 0 = all), `--json` prints every entry with the full body. `--block=<pattern>` fails matching requests before they leave (ads, trackers, a script that hangs the page). In `browser-run.js`: `page.intercept.start({match, block})`, `page.intercept.read({wait})` → entries, `page.intercept.stop()`. With the endpoint and its parameters in hand, the next call can often skip the browser: `hf` or `curl` against the API.

## Quiet in the page

Bot walls look for automation, so the defaults are the quiet ones:

- snap, find, click, fill, select, scroll and wait run their own JavaScript in an isolated world: the page cannot see their globals or trap the DOM calls they make. `browser-eval.js` runs in the page's world (its globals, and hooks on fetch/XHR that catch the page's requests, as the capture scripts need); `--isolated` / `page.evalIsolated` for plain DOM reads on a site that fights bots.
- The daemon never sends `Runtime.enable` (the console-serialization leak) and adds no `sourceURL`. `browser-intercept.js` enables the Network and Fetch domains, which the page cannot observe.
- The mouse travels on a curved path before every click, typing is paced (30–95 ms a key, longer after punctuation), scrolling is wheel steps. `BROWSER_TOOLS_HUMAN=0` turns pacing off for speed on sites that don't care.

Checked against rebrowser-bot-detector on the Pi: runtimeEnableLeak, sourceUrlLeak, mainWorldExecution (with snap, click and `--isolated` reads), navigatorWebdriver and cdpBindingGlobals pass, where Puppeteer fails the first three. The Pi's binary is Chromium, which the detector flags as "not Google Chrome"; lwcloud runs Google Chrome.

## Where the browser is

- **Pi and lwcloud**: the `browser-tools-browser` systemd user unit runs a headed browser on Xvfb `:99` (Pi: Chromium, profile `~/.michael-slack/chromium-profile`; lwcloud: Google Chrome, `~/.config/browser-tools/profile`). `detectBrowser` reads its `DevToolsActivePort`. The profile is shared with michael-slack's `browser-record` and the `:7899` screenshot server, so logins made in either are visible to both. `systemctl --user restart browser-tools-browser` when it wedges.
- **Mac**: your live Brave/Chrome with remote debugging on (`brave://inspect/#remote-debugging`); each new daemon costs one approval prompt there, so leave the daemon running. A feed only loads while its window is visible and uncovered: tile capture windows (`--tile`, `browser-window.js`) instead of bringing them to the front. The Instagram and TikTok capture scripts (`ig-capture.mjs`, `ig-reels.mjs`, `tt-capture.mjs`, `tt-profile.mjs`) serve the promessas pipeline (`daily-journal-platform/scripts/elections/canais`).

**Each agent tab opens in its own window.** A tab behind another tab in the same window is hidden, draws no frames, and CDP input to it hangs; actions on an existing hidden tab bring it to the front first.

**Close your tabs when done** (`browser-close.js -t=<name>`). Rendering is software, so a live page burns CPU. On the Pi a reaper closes tabs untouched for 30+ min (`browser-tools-reap.timer`), so a tab left for later is gone after half an hour. To log into a site or watch it work on the Pi: `ssh -L 5999:localhost:5999 pi`, VNC to `localhost:5999` (password in `~/.vnc/passwd`).

## Architecture

One daemon per user (`lib/daemon.js`) holds the CDP WebSocket and the per-tab state (refs, pointer position, out-of-process iframe sessions; `lib/tab.js`); scripts talk to it over `/run/user/<uid>/browser-tools/browser.sock`. It exits after 12 h idle (`BROWSER_TOOLS_IDLE_MINUTES`, 0 = never). After editing `lib/`, run `./browser-stop.js`: the next command starts a daemon on the new code. `node test/fixture.test.mjs` drives every command against `test/fixture/` (iframes, modal, popup, SPA route, reformatting field, automation probe) and must pass before a push.

`browser-start.js` launches a dedicated browser on machines without one (`--headed`, `--foreground` for systemd, `--kill`, `--check` for the watchdog). Headed Linux needs software WebGL and `--disable-blink-features=AutomationControlled` for bot challenges (Vercel checkpoint), and `--password-store=basic` to skip a 25 s keyring wait.

## Performance audits

Each opens its own tab, measures, closes it: `browser-performance.js <url>` (TTFB, FCP, LCP, CLS, TBT), `browser-network.js <url>`, `browser-coverage.js <url>`, `browser-lcp.js <url>`, `browser-trace.js <url> [s]`, `browser-lighthouse.js <url> [category]`.
