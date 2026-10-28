#!/usr/bin/env node
// Captura o feed de um perfil do TikTok pelo navegador logado: grava as respostas de
// /api/post/item_list que a própria página busca e rola com eventos reais de roda até o post
// mais antigo passar de --since. Para quando o yt-dlp não lista o perfil (devolve um vídeo só
// ou "Unable to extract secondary user ID"). Uso: tt-capture.mjs -t=<tab> <handle> <since YYYY-MM-DD> <out.json>
import { run } from './lib/client.js';
import fs from 'node:fs';
const args = process.argv.slice(2);
const tab = args.find(a => a.startsWith('-t='))?.slice(3);
const [handle, since, out] = args.filter(a => !a.startsWith('-t='));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOOK = `(() => { if (window.__ttCap) return; window.__ttCap = []; const keep = (u, t) => { if (u && u.includes('/api/post/item_list')) window.__ttCap.push(t) };
 const of = window.fetch; window.fetch = async (...a) => { const r = await of(...a); try { const u = typeof a[0] === 'string' ? a[0] : a[0].url; r.clone().text().then(t => keep(u, t)) } catch(e){}; return r };
 const oo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m, u, ...r){ this.__u = u; return oo.call(this, m, u, ...r) };
 const os = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send = function(...a){ this.addEventListener('load', () => { try { keep(this.__u, this.responseText) } catch(e){} }); return os.apply(this, a) }; })()`;
const SUM = `(() => { const m = new Map(); for (const t of window.__ttCap || []) { try { for (const it of JSON.parse(t).itemList || []) m.set(it.id, { id: it.id, createTime: it.createTime, desc: it.desc, isPinned: !!it.isPinned, imagePost: !!it.imagePost, duration: it.video?.duration || 0 }) } catch (e) {} }
 return JSON.stringify([...m.values()]) })()`;
await run(tab, 'injecton', [HOOK]);
await run(tab, 'nav', [`https://www.tiktok.com/@${handle}`]);
// Como no ig-capture: numa aba em segundo plano o Brave não entrega o evento de roda.
await run(tab, 'raw', ['Page.bringToFront', '{}']);
await sleep(5000);
const sinceTs = Date.parse(since) / 1000;
let last = 0, stale = 0, items = [];
for (let i = 0; i < 300; i++) {
  items = JSON.parse(await run(tab, 'eval', [SUM]));
  const oldest = items.filter(p => !p.isPinned).map(p => p.createTime).sort()[0];
  process.stdout.write(`\r${handle}: ${items.length} posts, mais antigo ${oldest ? new Date(oldest * 1000).toISOString().slice(0, 10) : '-'}   `);
  // Post fixado no topo pode ser antigo: só para quando 4 não fixados já passaram de --since.
  if (items.filter(p => !p.isPinned && p.createTime < sinceTs).length >= 4) break;
  stale = items.length === last ? stale + 1 : 0; last = items.length;
  if (stale >= 12) { console.log('\nparou de carregar: a aba está na frente?'); break; }
  try { await run(tab, 'raw', ['Input.dispatchMouseEvent', JSON.stringify({ type: 'mouseWheel', x: 700, y: 500, deltaX: 0, deltaY: 1800 })]); }
  catch (e) { console.log(`\n${e.message}: a aba saiu da frente. Traga a aba para a frente e rode de novo; nada foi gravado.`); process.exit(1); }
  await sleep(2200 + Math.random() * 1200);
}
fs.writeFileSync(out, JSON.stringify(items, null, 1));
console.log(`\n${handle}: ${items.length} itens gravados em ${out}`);
process.exit(0);
