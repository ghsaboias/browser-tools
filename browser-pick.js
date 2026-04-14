#!/usr/bin/env node
// Interactive element picker — injects overlay, user clicks elements.
import { run } from './lib/client.js';

const args = process.argv.slice(2);
const target = args.find(a => a.startsWith('-t='))?.slice(3) || null;
const message = args.filter(a => !a.startsWith('-t=')).join(' ');

if (!message) {
  console.log('Usage: browser-pick.js [-t=<tab>] "message"');
  process.exit(1);
}

// Inject picker
await run(target, 'eval', [`
  if (!window.pick) {
    window.pick = (message) => new Promise((resolve) => {
      const selections = [];
      const selectedEls = new Set();
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;pointer-events:none';
      const highlight = document.createElement('div');
      highlight.style.cssText = 'position:absolute;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);transition:all 0.1s';
      overlay.appendChild(highlight);
      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1f2937;color:white;padding:12px 24px;border-radius:8px;font:14px sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);pointer-events:auto;z-index:2147483647';
      const update = () => { banner.textContent = message + ' (' + selections.length + ' selected, Cmd+click to add, Enter to finish, ESC to cancel)'; };
      update();
      document.body.append(banner, overlay);
      const cleanup = () => { document.removeEventListener('mousemove',onMove,true); document.removeEventListener('click',onClick,true); document.removeEventListener('keydown',onKey,true); overlay.remove(); banner.remove(); selectedEls.forEach(el => el.style.outline = ''); };
      const info = (el) => ({ tag: el.tagName.toLowerCase(), id: el.id||null, class: el.className||null, text: el.textContent?.trim().slice(0,200)||null, html: el.outerHTML.slice(0,500) });
      const onMove = (e) => { const el = document.elementFromPoint(e.clientX,e.clientY); if (!el||overlay.contains(el)||banner.contains(el)) return; const r = el.getBoundingClientRect(); highlight.style.cssText = 'position:absolute;border:2px solid #3b82f6;background:rgba(59,130,246,0.1);top:'+r.top+'px;left:'+r.left+'px;width:'+r.width+'px;height:'+r.height+'px'; };
      const onClick = (e) => { if (banner.contains(e.target)) return; e.preventDefault(); e.stopPropagation(); const el = document.elementFromPoint(e.clientX,e.clientY); if (!el||overlay.contains(el)||banner.contains(el)) return; if (e.metaKey||e.ctrlKey) { if (!selectedEls.has(el)) { selectedEls.add(el); el.style.outline='3px solid #10b981'; selections.push(info(el)); update(); } } else { cleanup(); resolve(selections.length > 0 ? selections : info(el)); } };
      const onKey = (e) => { if (e.key==='Escape') { e.preventDefault(); cleanup(); resolve(null); } else if (e.key==='Enter' && selections.length > 0) { e.preventDefault(); cleanup(); resolve(selections); } };
      document.addEventListener('mousemove',onMove,true);
      document.addEventListener('click',onClick,true);
      document.addEventListener('keydown',onKey,true);
    });
  }
`]);

const result = await run(target, 'eval', [`JSON.stringify(await window.pick(${JSON.stringify(message)}))`]);
const parsed = JSON.parse(result);

if (Array.isArray(parsed)) {
  parsed.forEach((el, i) => {
    if (i > 0) console.log('');
    Object.entries(el).forEach(([k, v]) => { if (v) console.log(`${k}: ${v}`); });
  });
} else if (parsed) {
  Object.entries(parsed).forEach(([k, v]) => { if (v) console.log(`${k}: ${v}`); });
} else {
  console.log('Cancelled');
}
process.exit(0);
