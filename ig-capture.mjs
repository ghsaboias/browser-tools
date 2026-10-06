#!/usr/bin/env node
// Captura o feed de um perfil do Instagram pelo navegador logado: grava as respostas que a
// própria página busca (fetch/XHR) e rola com eventos reais de roda, num ritmo de pessoa,
// até o post mais antigo passar de --since. Uso: ig-capture.mjs -t=<tab> <handle> <since YYYY-MM-DD> <out.json>
import { run } from './lib/client.js';
import fs from 'node:fs';
const args = process.argv.slice(2);
const tab = args.find(a => a.startsWith('-t='))?.slice(3);
const [handle, since, out] = args.filter(a => !a.startsWith('-t='));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOOK = `(() => { if (window.__igCap) return; window.__igCap = []; const keep = t => { if (t && t.includes('taken_at')) window.__igCap.push(t) };
 const of = window.fetch; window.fetch = async (...a) => { const r = await of(...a); try { r.clone().text().then(keep) } catch(e){}; return r };
 const os = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send = function(...a){ this.addEventListener('load', () => { try { keep(this.responseText) } catch(e){} }); return os.apply(this, a) };
 document.addEventListener('DOMContentLoaded', () => { for (const s of document.querySelectorAll('script[type="application/json"]')) keep(s.textContent) }); })()`;
const SUM = `(() => { const m = new Map(); const best = v => { const c = (v?.image_versions2?.candidates || []).slice().sort((a, b) => b.width - a.width)[0]; return c?.url || null };
 const walk = o => { if (!o || typeof o !== 'object') return; if (o.code && o.taken_at) { if (!m.has(o.code)) m.set(o.code, { code: o.code, taken_at: new Date(o.taken_at * 1000).toISOString(), user: o.user?.username, coauthors: (o.coauthor_producers || []).map(u => u.username), media_type: o.media_type, product_type: o.product_type, caption: o.caption?.text || '', slides: (o.carousel_media || [o]).map(s => ({ media_type: s.media_type, image: best(s), video: (s.video_versions || [])[0]?.url || null })) }); return } for (const k in o) walk(o[k]) };
 for (const t of window.__igCap || []) for (const line of t.split('\\n')) { try { walk(JSON.parse(line)) } catch (e) {} }
 return JSON.stringify([...m.values()]) })()`;
await run(tab, 'injecton', [HOOK]);
await run(tab, 'nav', [`https://www.instagram.com/${handle}/`]);
await sleep(4000);
let last = 0, stale = 0, items = [];
for (let i = 0; i < 200; i++) {
  items = JSON.parse(await run(tab, 'eval', [SUM]));
  const own = items.filter(p => p.user === handle);
  const oldest = own.map(p => p.taken_at).sort()[0] || '9999';
  process.stdout.write(`\r${handle}: ${own.length} posts, mais antigo ${oldest.slice(0, 10)}   `);
  // Até 3 posts fixados no topo podem ser antigos: só para quando 4 já passaram de --since.
  if (own.filter(p => p.taken_at < since).length >= 4) break;
  stale = items.length === last ? stale + 1 : 0; last = items.length;
  if (stale >= 12) { console.log('\nparou de carregar'); break; }
  await run(tab, 'raw', ['Input.dispatchMouseEvent', JSON.stringify({ type: 'mouseWheel', x: 700, y: 500, deltaX: 0, deltaY: 1800 })]);
  await sleep(2200 + Math.random() * 1200);
}
fs.writeFileSync(out, JSON.stringify(items, null, 1));
console.log(`\n${handle}: ${items.length} itens gravados em ${out}`);
process.exit(0);
