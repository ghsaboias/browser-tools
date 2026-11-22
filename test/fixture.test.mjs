#!/usr/bin/env node
// End-to-end check of the agent-facing commands against test/fixture, in the browser the
// daemon attaches to. Serves the fixture on a free port (localhost for the page,
// 127.0.0.1 for the cross-origin iframe), drives it through the CLI scripts and
// browser-run.js, and closes its tabs. Run: node test/fixture.test.mjs
import { execFileSync, spawn } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'test', 'fixture');
// The server runs in a child: the CLI calls below block this process's event loop.
const server = spawn(process.execPath, ['-e', `
  const http = require('http'), fs = require('fs'), path = require('path');
  const s = http.createServer((req, res) => {
    const f = path.join(${JSON.stringify(FIX)}, req.url.split('?')[0].replace(/^\\/$/, '/index.html'));
    try { const b = fs.readFileSync(f); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(b); }
    catch { res.writeHead(404); res.end('not found'); }
  });
  s.listen(0, '0.0.0.0', () => console.log(s.address().port));`], { stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise(r => server.stdout.once('data', d => r(parseInt(d))));
const BASE = `http://localhost:${port}`;
const NAME = `fixture-${process.pid}`;

const bt = (script, ...args) => execFileSync(process.execPath, [join(ROOT, script), ...args],
  { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, BROWSER_TOOLS_HUMAN: process.env.BROWSER_TOOLS_HUMAN ?? '1' } }).trim();
const btFail = (script, ...args) => { try { bt(script, ...args); return null; } catch (e) { return e.stderr.toString().trim(); } };
const T = `-t=${NAME}`;

let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`ok   ${label}`); }
  catch (e) { failed++; console.log(`FAIL ${label}\n     ${e.message.split('\n').join('\n     ')}`); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const refOf = (snap, re) => { const m = snap.split('\n').find(l => re.test(l))?.match(/\[(e\d+)\]/); if (!m) throw new Error(`no line matches ${re}:\n${snap}`); return m[1]; };

try {
  await check('open --name, and the same name returns the same tab', () => {
    const a = bt('browser-open.js', `${BASE}/index.html`, `--name=${NAME}`);
    const b = bt('browser-open.js', `${BASE}/other`, `--name=${NAME}`);
    expect(a.slice(0, 10) === b.slice(0, 10) && /already open/.test(b) && /index\.html/.test(b), `${a}\n${b}`);
  });

  let snap;
  await check('snap is scoped to main, inlines both iframes, gives refs', () => {
    snap = bt('browser-snap.js', T);
    expect(/scoped to main/.test(snap), 'no scope header');
    expect(!/Política/.test(snap), 'nav leaked into the scoped outline');
    expect(/button "Botão do iframe" \[e\d+\]/.test(snap), 'same-origin iframe missing');
    expect(/textbox "Busca externa" \[e\d+\]/.test(snap), 'cross-origin iframe missing');
    expect(/link "Abrir em nova aba" \[e\d+\] → \/popup\.html/.test(snap), 'link href missing');
  });
  await check('snap --all includes navigation', () => expect(/link "Política"/.test(bt('browser-snap.js', T, '--all')), 'no nav'));

  await check('a modal over the target is reported, then closed by ref', () => {
    bt('browser-click.js', T, refOf(snap, /button "Abrir aviso"/));
    const err = btFail('browser-click.js', T, refOf(snap, /button "Enviar"/));
    expect(err && /covered by div#modal/.test(err), `expected a cover error, got ${err}`);
    const s2 = bt('browser-snap.js', T);
    expect(/dialog "Aviso de cookies"/.test(s2), 'dialog not shown in scoped snap');
    bt('browser-click.js', T, refOf(s2, /button "Aceitar"/));
  });

  await check('fill replaces text, reports reformatting; select; checkbox; submit', () => {
    bt('browser-fill.js', T, refOf(snap, /textbox "E-mail"/), 'maria@exemplo.com.br');
    const cpf = bt('browser-fill.js', T, refOf(snap, /textbox "CPF"/), '12345678901');
    expect(/123\.456\.789-01/.test(cpf), `no reformat note: ${cpf}`);
    bt('browser-select.js', T, refOf(snap, /combobox "Estado"/), 'são paulo');
    bt('browser-click.js', T, refOf(snap, /checkbox "Aceito/));
    bt('browser-click.js', T, refOf(snap, /button "Enviar"/));
    const out = bt('browser-eval.js', T, "document.getElementById('out').textContent");
    expect(out === 'enviado: maria@exemplo.com.br / SP / 123.456.789-01', out);
  });

  await check('click inside same-origin and cross-origin iframes', () => {
    bt('browser-click.js', T, refOf(snap, /button "Botão do iframe"/));
    bt('browser-fill.js', T, refOf(snap, /textbox "Busca externa"/), 'consulta externa');
    bt('browser-click.js', T, refOf(snap, /button "Buscar fora"/));
    const s = bt('browser-snap.js', T, refOf(snap, /iframe .*frame\.html/));
    expect(/resultado: consulta externa/.test(s), s);
    expect(/clicado no iframe/.test(bt('browser-snap.js', T)), 'same-origin iframe click had no effect');
  });

  await check('a link to a new tab reports the tab', () => {
    const r = bt('browser-click.js', T, refOf(snap, /link "Abrir em nova aba"/));
    expect(/opened tab \[[0-9A-F]{8}\] .*popup\.html/.test(r), r);
    const id = r.match(/\[([0-9A-F]{8})\]/)[1];
    bt('browser-close.js', `-t=${id}`);
  });

  await check('an SPA route change is reported without waiting for a load', () => {
    const t0 = Date.now();
    const r = bt('browser-click.js', T, refOf(snap, /button "Trocar rota"/));
    expect(/URL is now .*\/rota-spa/.test(r), r);
    expect(Date.now() - t0 < 5000, `took ${Date.now() - t0}ms`);
  });

  await check('wait for late content; find by role and name', () => {
    bt('browser-click.js', T, refOf(snap, /button "Carregar depois"/));
    expect(/ready after/.test(bt('browser-wait.js', T, '--text=Carregou depois')), 'no wait');
    expect(JSON.parse(bt('browser-find.js', T, 'button', 'Buscar fora')).ref, 'find failed');
  });

  await check('clickElement (lib/pointer.js) wheels to a button below the fold and clicks it', async () => {
    bt('browser-nav.js', T, `${BASE}/index.html`);
    const { clickElement } = await import(join(ROOT, 'lib', 'pointer.js'));
    const ok = await clickElement(NAME, `document.getElementById('fundo')`);
    const missing = await clickElement(NAME, `document.getElementById('nao-existe')`);
    const state = JSON.parse(bt('browser-eval.js', T, `JSON.stringify([document.getElementById('fundo').textContent, scrollY, wheels])`));
    expect(ok === true && missing === false, `ok=${ok} missing=${missing}`);
    expect(state[0] === 'fundo clicado' && state[1] > 0 && state[2] > 3, JSON.stringify(state));
  });

  await check('long option lists collapse; snap <ref> lists them; select by label still works', () => {
    const s = bt('browser-snap.js', T);
    expect(/more options/.test(s) && !/Cidade 35/.test(s), 'options not collapsed');
    const mun = refOf(s, /combobox "Município"/);
    expect(/Cidade 35/.test(bt('browser-snap.js', T, mun)), 'snap <ref> did not list all options');
    expect(/Cidade 35/.test(bt('browser-select.js', T, mun, 'Cidade 35')), 'select by label failed');
  });

  await check('a click that changes nothing says so; a link around a block clicks', () => {
    const s = bt('browser-snap.js', T);
    expect(/did not change/.test(bt('browser-click.js', T, refOf(s, /button "Não faz nada"/))), 'no warning on a no-op click');
    expect(!/did not change/.test(bt('browser-click.js', T, refOf(s, /checkbox "Aceito/))), 'checkbox click flagged as no-op');
    bt('browser-click.js', T, refOf(s, /link "Cartão/));
    expect(bt('browser-eval.js', T, "document.getElementById('out').textContent") === 'cartão clicado', 'card link not clicked');
  });

  await check('find lists the other matches and scopes with --in', () => {
    const all = JSON.parse(bt('browser-find.js', T, 'button', 'Assinar'));
    expect(all.others?.length >= 1, JSON.stringify(all));
    const form = refOf(bt('browser-snap.js', T), /form "Assinatura"/);
    const inForm = JSON.parse(bt('browser-find.js', T, `--in=${form}`, 'button', 'Assinar'));
    expect(inForm.ref && !inForm.others, JSON.stringify(inForm));
    bt('browser-click.js', T, inForm.ref);
    expect(/button "Assinado"/.test(bt('browser-snap.js', T, form)), 'the form button was not the one clicked');
  });

  await check('autocomplete rows without a role get refs (clickable)', () => {
    bt('browser-nav.js', T, `${BASE}/index.html`);
    const s0 = bt('browser-snap.js', T);
    bt('browser-fill.js', T, refOf(s0, /textbox "Empresa"/), 'va');
    const hit = JSON.parse(bt('browser-find.js', T, 'clickable', 'VALE S.A.'));
    bt('browser-click.js', T, hit.ref);
    expect(bt('browser-eval.js', T, "document.getElementById('empresa').value") === 'VALE S.A.', 'suggestion not picked');
  });

  await check('table rows keep empty cells in place; nameless links show a hint', () => {
    const s = bt('browser-snap.js', T);
    expect(/row \[e\d+\]: 2 \| 120\.125 \| · \| 125\.300/.test(s), s.split('\n').filter(l => /row/.test(l)).join('\n'));
    expect(/link \(#btnPesquisar\) \[e\d+\]/.test(s), 'no hint on the icon link');
  });

  await check('fill on a collapsed field names the section to open', () => {
    const err = btFail('browser-fill.js', T, '#dataIni', '01/01/2026');
    expect(/inside details#filtros/.test(err || ''), err);
  });

  await check('wait --new ignores rows that were already there', () => {
    const s = bt('browser-snap.js', T);
    bt('browser-click.js', T, refOf(s, /button "Buscar AJAX"/));
    const r = bt('browser-wait.js', T, '--new=#res td');
    expect(/ready after (\d+)ms/.test(r) && +r.match(/(\d+)ms/)[1] >= 300, r);
    expect(/novo resultado/.test(bt('browser-eval.js', T, "document.getElementById('res').innerText")), 'rows not replaced');
  });

  await check('a target below a sticky header after scrolling is not reported covered', () => {
    bt('browser-nav.js', T, `${BASE}/index.html`);
    bt('browser-scroll.js', T, '900');
    const s = bt('browser-snap.js', T);
    const r = bt('browser-click.js', T, refOf(s, /button "Assinar"/));
    expect(/clicked/.test(r), r);
  });

  await check('stale ref after navigation says so', () => {
    bt('browser-nav.js', T, `${BASE}/index.html`);
    const err = btFail('browser-click.js', T, 'e999');
    expect(/not a ref on this page/.test(err || ''), err);
  });

  await check('browser-run does a multi-step flow in one call', () => {
    const out = bt('browser-run.js', T, '-e', `
      await page.goto(${JSON.stringify(BASE + '/index.html')});
      await page.fill(await page.find('textbox', 'E-mail'), 'run@exemplo.com');
      await page.select(await page.find('combobox', 'Estado'), 'RJ');
      await page.click(await page.find('button', 'Enviar'));
      return page.eval("document.getElementById('out').textContent");`);
    expect(/enviado: run@exemplo\.com \/ RJ/.test(out) && /# tab \[/.test(out), out);
  });

  await check('eval runs in the page world; --isolated does not see page globals', () => {
    bt('browser-nav.js', T, `${BASE}/probe.html`);
    expect(bt('browser-eval.js', T, 'typeof window.signals') === 'object', 'page-world eval missed the page global');
    expect(bt('browser-eval.js', T, '--isolated', 'typeof window.signals') === 'undefined', '--isolated saw a page global');
  });

  await check('stealth: no Runtime.enable signal, no leaked globals, mouse moves before clicks, paced keys', async () => {
    bt('browser-nav.js', T, `${BASE}/probe.html`);
    const s = bt('browser-snap.js', T);
    bt('browser-click.js', T, refOf(s, /button "Botão"/));
    bt('browser-fill.js', T, refOf(s, /textbox "Campo"/), 'texto digitado');
    await new Promise(r => setTimeout(r, 700));
    const sig = JSON.parse(bt('browser-eval.js', T, 'JSON.stringify(window.signals)'));
    expect(sig.runtimeEnable === false, 'Runtime.enable detected');
    expect(sig.webdriver === false, 'navigator.webdriver is true');
    expect(sig.leaked.length === 0, `globals leaked: ${sig.leaked}`);
    expect(sig.clicksWithoutMove === 0 && sig.moves > 5, `moves=${sig.moves} clicksWithoutMove=${sig.clicksWithoutMove}`);
    const gaps = sig.keyGaps.slice(1);
    expect(gaps.length >= 10 && Math.min(...gaps) >= 20, `key gaps ${gaps}`);
  });
} finally {
  try { bt('browser-close.js', T); } catch {}
  server.kill();
}
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
