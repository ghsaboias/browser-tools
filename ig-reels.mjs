#!/usr/bin/env node
// Completa o feed.json do ig-capture.mjs com os reels que só existem na aba Reels do perfil. Um reel publicado
// sem "mostrar na grade do perfil" não aparece na grade que o ig-capture.mjs rola (Ricardo Campos, 09/11/2026:
// 5 posts na grade entre 16/08 e 05/10, e dezenas de reels de campanha só na aba Reels).
// Uso: ig-reels.mjs -t=<tab> <handle> <since YYYY-MM-DD> <until YYYY-MM-DD> <feed.json>
// A aba Reels não traz data: o código do post é o id em base 64 e cresce com o tempo, então a janela sai dos
// códigos do feed.json (o post mais novo antes de <since> e o mais velho depois de <until>). Rola a aba até
// passar do início da janela, pede /api/v1/media/<id>/info/ de cada reel da janela que falta no feed.json (um
// pedido a cada 1,5 a 2,5 s) e grava os itens no mesmo formato, com `so_reels: true`. Guarda o feed da grade
// em <feed>.grade.json na primeira vez.
import { run } from './lib/client.js';
import fs from 'node:fs';
const args = process.argv.slice(2);
const tab = args.find(a => a.startsWith('-t='))?.slice(3);
const [handle, since, until, feedPath] = args.filter(a => !a.startsWith('-t='));
if (!feedPath) { console.log('Uso: ig-reels.mjs -t=<tab> <handle> <since> <until> <feed.json>'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const pk = c => { let n = 0n; for (const ch of c) n = n * 64n + BigInt(A.indexOf(ch)); return n; };
const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));
const own = feed.filter(p => p.user === handle && !p.so_reels);
const antes = own.filter(p => p.taken_at.slice(0, 10) < since).map(p => pk(p.code)).sort((a, b) => (a < b ? 1 : -1));
const depois = own.filter(p => p.taken_at.slice(0, 10) > until).map(p => pk(p.code)).sort((a, b) => (a < b ? -1 : 1));
// Fixados antigos ficam fora da conta: o limite de baixo é o post mais novo antes da janela.
const lo = antes[0] ?? 0n, hi = depois[0] ?? null;
const tem = new Set(feed.map(p => p.code));

await run(tab, 'nav', [`https://www.instagram.com/${handle}/reels/`]);
await run(tab, 'raw', ['Page.bringToFront', '{}']);
await sleep(4000);
await run(tab, 'eval', ['window.__reels = new Set(); 0']);
const COLETA = `(() => { for (const a of document.querySelectorAll('a[href*="/reel/"]')) { const m = a.href.match(/\\/reel\\/([^\\/]+)/); if (m) window.__reels.add(m[1]) } return JSON.stringify([...window.__reels]) })()`;
let codes = [], last = 0, stale = 0;
for (let i = 0; i < 400; i++) {
  codes = JSON.parse(await run(tab, 'eval', [COLETA]));
  const abaixo = codes.filter(c => pk(c) < lo).length;
  process.stdout.write(`\r${handle}: ${codes.length} reels na aba, ${abaixo} antes da janela   `);
  // Até 3 reels fixados podem ser antigos: só para quando 6 já passaram do início da janela.
  if (lo > 0n && abaixo >= 6) break;
  stale = codes.length === last ? stale + 1 : 0; last = codes.length;
  if (stale >= 10) { console.log('\nfim da aba Reels (ou parou de carregar)'); break; }
  try { await run(tab, 'raw', ['Input.dispatchMouseEvent', JSON.stringify({ type: 'mouseWheel', x: 700, y: 500, deltaX: 0, deltaY: 1600 })]); }
  catch (e) { console.log(`\n${e.message}: a aba saiu da frente; nada foi gravado.`); process.exit(1); }
  await sleep(1800 + Math.random() * 900);
}
const faltam = codes.filter(c => !tem.has(c) && pk(c) > lo && (hi === null || pk(c) < hi));
console.log(`\n${handle}: ${codes.length} reels listados, ${faltam.length} na janela e fora do feed.json`);
const INFO = id => `(async () => { const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
 const r = await fetch('/api/v1/media/${id}/info/', { headers: { 'x-ig-app-id': '936619743392459', 'x-csrftoken': csrf, 'x-requested-with': 'XMLHttpRequest', 'x-asbd-id': '359341' }, credentials: 'include' });
 if (!r.ok) return JSON.stringify({ erro: r.status });
 const o = (await r.json()).items?.[0]; if (!o) return JSON.stringify({ erro: 'sem item' });
 const best = v => { const c = (v?.image_versions2?.candidates || []).slice().sort((a, b) => b.width - a.width)[0]; return c?.url || null };
 return JSON.stringify({ code: o.code, taken_at: new Date(o.taken_at * 1000).toISOString(), user: o.user?.username, coauthors: (o.coauthor_producers || []).map(u => u.username), media_type: o.media_type, product_type: o.product_type, caption: o.caption?.text || '', slides: (o.carousel_media || [o]).map(s => ({ media_type: s.media_type, image: best(s), video: (s.video_versions || [])[0]?.url || null })), so_reels: true }) })()`;
const novos = [], erros = [];
for (const [i, c] of faltam.entries()) {
  let it;
  try { it = JSON.parse(await run(tab, 'eval', [INFO(pk(c).toString())])); } catch (e) { it = { erro: e.message }; }
  if (it.erro) { erros.push(`${c}: ${it.erro}`); if (it.erro === 429 || it.erro === 401) { console.log(`\nInstagram respondeu ${it.erro}: parando`); break; } }
  else novos.push(it);
  process.stdout.write(`\r${handle}: ${i + 1}/${faltam.length} reels pedidos, ${erros.length} erros   `);
  await sleep(1500 + Math.random() * 1000);
}
const naJanela = novos.filter(p => p.taken_at.slice(0, 10) >= since && p.taken_at.slice(0, 10) <= until);
if (!fs.existsSync(feedPath + '.grade.json')) fs.copyFileSync(feedPath, feedPath + '.grade.json');
fs.writeFileSync(feedPath, JSON.stringify([...feed, ...novos], null, 1));
console.log(`\n${handle}: ${novos.length} reels acrescentados a ${feedPath} (${naJanela.length} de ${since} a ${until}), ${erros.length} erros${erros.length ? ': ' + erros.slice(0, 5).join('; ') : ''}`);
process.exit(0);
