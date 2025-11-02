# Browser Tools

Minimal CDP tools for collaborative site exploration.

## Start Chrome

```bash
./start.ts
./start.ts --profile
```

Start Chrome on `:9222` with remote debugging enabled. Use `--profile` flag to copy the default Chrome profile (cookies, logins). Without the flag, starts with a fresh profile.

## Navigate

```bash
./nav.ts https://example.com
./nav.ts https://example.com --new
```

Navigate current tab or open new tab.

## Take Screenshot

```bash
./screenshot.ts
```

Take a screenshot of the current viewport and save it to a temporary file. Returns the file path.

## Execute Code

```bash
./x.js 'document.title'
./x.js 'document.querySelectorAll("a").length'
./x.js 'Array.from(document.querySelectorAll("a")).map(a => ({text: a.textContent.trim(), href: a.href}))'
```

Execute arbitrary JavaScript in the active tab. Code runs in async context.

## Ask User to Pick Element

```bash
./x.js 'await pick("Click the article title")'
./x.js 'await pick("Select the submit button")'
```

Show overlay and ask user to click an element. The message parameter is required and should describe what element to click. Returns:
```
tag: h1
id: title
class: article-headline
text: Breaking News Story
html: <h1 id="title" class="article-headline">Breaking News Story</h1>
```
