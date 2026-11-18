#!/usr/bin/env node
// Captura o feed de um perfil do TikTok pelo navegador logado: grava as respostas de
// /api/post/item_list que a própria página busca e rola com eventos reais de roda até o post
// mais antigo passar de --since. Para quando o yt-dlp não lista o perfil (devolve um vídeo só
// ou "Unable to extract secondary user ID"). Uso: tt-capture.mjs -t=<tab> <handle> <since YYYY-MM-DD> <out.json>
import { run } from './lib/client.js';
import { scrollFeed } from './lib/scroll.js';
import { clickElement } from './lib/pointer.js';
import fs from 'node:fs';
const args = process.argv.slice(2);
const tab = args.find(a => a.startsWith('-t='))?.slice(3);
const [handle, since, out] = args.filter(a => !a.startsWith('-t='));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOOK = `(() => { if (window.__ttCap) return; window.__ttCap = []; const keep = (u, t) => { if (u && u.includes('/api/post/item_list')) window.__ttCap.push(t) };
 const of = window.fetch; window.fetch = async (...a) => { const r = await of(...a); try { const u = typeof a[0] === 'string' ? a[0] : a[0].url; r.clone().text().then(t => keep(u, t)) } catch(e){}; return r };
 const oo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m, u, ...r){ this.__u = u; return oo.call(this, m, u, ...r) };
 const os = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send = function(...a){ this.addEventListener('load', () => { try { keep(this.__u, this.responseText) } catch(e){} }); return os.apply(this, a) }; })()`;
const SUM = `(() => { const m = new Map(); for (const t of window.__ttCap || []) { try { for (const it of JSON.parse(t).itemList || []) m.set(it.id, { id: it.id, createTime: it.createTime, desc: it.desc, isPinned: !!(it.isPinned || it.isPinnedItem), imagePost: !!it.imagePost, duration: it.video?.duration || 0 }) } catch (e) {} }
 let hasMore = null; for (const t of window.__ttCap || []) { try { const j = JSON.parse(t); if (typeof j.hasMore === 'boolean') hasMore = j.hasMore } catch (e) {} }
 return JSON.stringify({ items: [...m.values()], hasMore }) })()`;
// Quando a primeira página de /api/post/item_list volta vazia, o TikTok troca o feed por "Something went wrong / Sorry
// about that! Please try again later." e um botão Refresh, sem data-e2e (contêiner DivErrorContainer, textos em inglês e
// português). Visto em captura real em 18/11/2026: a primeira resposta do item_list veio com corpo vazio, a tela apareceu
// 12 a 13 s depois de abrir o perfil, com o botão abaixo da dobra da janela de captura. O Refresh refaz a lista no próprio
// documento (sem recarregar: o gancho e o __ttCap continuam). O clique é de pessoa (lib/pointer.js): pausa, roda até o
// botão, ponteiro até ele e clique com eventos reais.
const REFRESH = `[...document.querySelectorAll('[class*="DivErrorContainer"] button, [data-e2e="user-page"] button')]
 .find(b => /^(Refresh|Atualizar|Recarregar)$/i.test(b.innerText.trim()) && /Something went wrong|Algo deu errado|Ocorreu um erro|Sorry about that|Desculpe/i.test(b.parentElement?.innerText || '')) || null`;
const REFRESH_MAX = 3;
await run(tab, 'injecton', [HOOK]);
await run(tab, 'nav', [`https://www.tiktok.com/@${handle}`]);
// Como no ig-capture: a janela precisa estar visível (browser-window.js --tile).
await sleep(5000);
const sinceTs = Date.parse(since) / 1000;
let last = 0, stale = 0, items = [], refreshes = 0, refreshedAt = -1;
for (let i = 0; i < 300; i++) {
  const page = JSON.parse(await run(tab, 'eval', [SUM]));
  items = page.items;
  if (items.length > refreshedAt) refreshes = 0;
  if (JSON.parse(await run(tab, 'eval', [`!!(${REFRESH})`])) === true) {
    if (refreshes >= REFRESH_MAX) { console.log(`\nparou de carregar: o TikTok mostrou "Something went wrong" depois de ${REFRESH_MAX} cliques em Refresh sem post novo`); break; }
    refreshes++; refreshedAt = items.length; stale = 0;
    if (!await clickElement(tab, REFRESH)) { console.log(`\n${handle}: o botão Refresh sumiu ou não entrou na janela antes do clique`); continue; }
    console.log(`\n${handle}: "Something went wrong" com ${items.length} posts, cliquei em Refresh (${refreshes}/${REFRESH_MAX})`);
    await sleep(4000);
    continue;
  }
  const oldest = items.filter(p => !p.isPinned).map(p => p.createTime).sort()[0];
  process.stdout.write(`\r${handle}: ${items.length} posts, mais antigo ${oldest ? new Date(oldest * 1000).toISOString().slice(0, 10) : '-'}   `);
  // Post fixado no topo pode ser antigo: só para quando 4 não fixados já passaram de --since.
  if (items.filter(p => !p.isPinned && p.createTime < sinceTs).length >= 4) break;
  if (page.hasMore === false) { console.log('\nfim do perfil'); break; }
  stale = items.length === last ? stale + 1 : 0; last = items.length;
  if (stale >= 12) { console.log('\nparou de carregar: a janela está visível?'); break; }
  try { await scrollFeed(tab, 1800); }
  catch (e) { console.log(`\n${e.message}: a aba não voltou para a frente; nada foi gravado.`); process.exit(1); }
  await sleep(2200 + Math.random() * 1200);
}
fs.writeFileSync(out, JSON.stringify(items, null, 1));
console.log(`\n${handle}: ${items.length} itens gravados em ${out}`);
process.exit(0);
