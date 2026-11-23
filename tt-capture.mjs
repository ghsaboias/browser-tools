#!/usr/bin/env node
// Captura o feed de um perfil do TikTok pelo navegador logado: grava as respostas de
// /api/post/item_list que a própria página busca e rola com eventos reais de roda até o post
// mais antigo passar de --since. Para quando o yt-dlp não lista o perfil (devolve um vídeo só
// ou "Unable to extract secondary user ID"). Uso: tt-capture.mjs -t=<tab> <handle> <since YYYY-MM-DD> <out.json>
import { run } from './lib/client.js';
import { scrollFeed } from './lib/scroll.js';
import { paceFrom } from './lib/human.js';
import { ITEM_HOOK, readItems, refreshShown, clickRefresh } from './lib/tiktok.js';
import fs from 'node:fs';
const args = process.argv.slice(2);
const tab = args.find(a => a.startsWith('-t='))?.slice(3);
const [handle, since, out] = args.filter(a => !a.startsWith('-t='));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const REFRESH_MAX = 3;
await run(tab, 'injecton', [ITEM_HOOK]);
await run(tab, 'nav', [`https://www.tiktok.com/@${handle}`]);
// Como no ig-capture: a janela precisa estar visível (browser-window.js --tile).
await paceFrom(5000);
const sinceTs = Date.parse(since) / 1000;
let last = 0, stale = 0, items = [], refreshes = 0, refreshedAt = -1;
for (let i = 0; i < 300; i++) {
  const page = await readItems(tab);
  items = page.items;
  if (items.length > refreshedAt) refreshes = 0;
  if (await refreshShown(tab)) {
    if (refreshes >= REFRESH_MAX) { console.log(`\nparou de carregar: o TikTok mostrou "Something went wrong" depois de ${REFRESH_MAX} cliques em Refresh sem post novo`); break; }
    refreshes++; refreshedAt = items.length; stale = 0;
    if (!await clickRefresh(tab)) { console.log(`\n${handle}: o botão Refresh sumiu ou não entrou na janela antes do clique`); continue; }
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
  const t0 = Date.now();
  try { await scrollFeed(tab, 1800); }
  catch (e) { console.log(`\n${e.message}: a aba não voltou para a frente; nada foi gravado.`); process.exit(1); }
  await paceFrom(2800, t0);
}
fs.writeFileSync(out, JSON.stringify(items, null, 1));
console.log(`\n${handle}: ${items.length} itens gravados em ${out}`);
process.exit(0);
