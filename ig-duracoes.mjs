#!/usr/bin/env node
// Completa a duração dos vídeos transcritos no feed.json de capturas feitas antes de o ig-capture.mjs gravar
// `duration` nos slides (16/11/2026). Para cada post do feed.json com transcrição (<dir>/<code>/video-*.txt) e
// algum slide de vídeo sem duração, pede /api/v1/media/<id>/info/ pela aba logada, um pedido a cada 1,5 a 2,5 s
// como o ig-reels.mjs, e grava o video_duration de cada slide de vídeo. Só preenche duração que falta; o resto
// do feed.json fica como está. Guarda o original em feed.json.sem-duracao.json na primeira vez. Para no 429 ou
// 401 depois de gravar o que já veio.
// Uso: ig-duracoes.mjs -t=<tab> <pasta instagram do candidato> [...]   (a aba precisa estar em instagram.com)
import { run } from './lib/client.js';
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const tab = args.find(a => a.startsWith('-t='))?.slice(3);
const dirs = args.filter(a => !a.startsWith('-t='));
if (!tab || dirs.length === 0) { console.log('Uso: ig-duracoes.mjs -t=<tab> <pasta instagram> [...]'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const pk = c => { let n = 0n; for (const ch of c) n = n * 64n + BigInt(A.indexOf(ch)); return n; };
const INFO = id => `(async () => { const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
 const r = await fetch('/api/v1/media/${id}/info/', { headers: { 'x-ig-app-id': '936619743392459', 'x-csrftoken': csrf, 'x-requested-with': 'XMLHttpRequest', 'x-asbd-id': '359341' }, credentials: 'include' });
 if (!r.ok) return JSON.stringify({ erro: r.status });
 const o = (await r.json()).items?.[0]; if (!o) return JSON.stringify({ erro: 'sem item' });
 return JSON.stringify({ slides: (o.carousel_media || [o]).map(s => ({ media_type: s.media_type, duration: s.video_duration || null })) }) })()`;

const semDuracao = p => (p.slides || []).some(s => s.media_type === 2 && !s.duration);
let parar = false;
for (const dir of dirs) {
  const feedPath = path.join(dir, 'feed.json');
  const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));
  const alvo = feed.filter(p => semDuracao(p) && fs.existsSync(path.join(dir, p.code)) &&
    fs.readdirSync(path.join(dir, p.code)).some(f => /^video-.*\.txt$/.test(f)));
  let feitos = 0; const erros = [];
  for (const [i, p] of alvo.entries()) {
    let it;
    try { it = JSON.parse(await run(tab, 'eval', [INFO(pk(p.code).toString())])); } catch (e) { it = { erro: e.message }; }
    if (it.erro) {
      erros.push(`${p.code}: ${it.erro}`);
      if (it.erro === 429 || it.erro === 401) { console.log(`\nInstagram respondeu ${it.erro}: parando`); parar = true; break; }
    } else if (it.slides.length !== p.slides.length) {
      erros.push(`${p.code}: ${it.slides.length} slides na API, ${p.slides.length} no feed.json`);
    } else {
      p.slides.forEach((s, k) => { if (s.media_type === 2 && !s.duration && it.slides[k].duration) s.duration = it.slides[k].duration; });
      if (!semDuracao(p)) feitos++; else erros.push(`${p.code}: a API não deu a duração de todos os vídeos`);
    }
    process.stdout.write(`\r${dir}: ${i + 1}/${alvo.length} pedidos, ${feitos} completos, ${erros.length} erros   `);
    if (i < alvo.length - 1) await sleep(1500 + Math.random() * 1000);
  }
  if (feitos > 0) {
    const original = feedPath.replace(/\.json$/, '.sem-duracao.json');
    if (!fs.existsSync(original)) fs.copyFileSync(feedPath, original);
    fs.writeFileSync(feedPath, JSON.stringify(feed, null, 1));
  }
  console.log(`\n${dir}: ${feitos} de ${alvo.length} posts transcritos com a duração completa${erros.length ? '; erros: ' + erros.join('; ') : ''}`);
  if (parar) break;
}
process.exit(parar ? 2 : 0);
