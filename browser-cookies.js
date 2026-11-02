#!/usr/bin/env node
// Uso: browser-cookies.js [-t=<tab>] [--netscape <domínio>]
// --netscape grava no stdout os cookies do domínio (e subdomínios) no formato cookies.txt que o
// yt-dlp --cookies lê. Lidos pelo CDP, sem passar pelo Keychain do macOS.
import { run } from './lib/client.js';

const args = process.argv.slice(2);
const target = args.find(a => a.startsWith('-t='))?.slice(3) ?? null;
const ni = args.indexOf('--netscape');
const domain = ni >= 0 ? args[ni + 1] : null;
const cookies = JSON.parse(await run(target, 'cookies'));

if (domain) {
  console.log('# Netscape HTTP Cookie File');
  for (const c of cookies.filter(c => c.domain.replace(/^\./, '').endsWith(domain))) {
    const exp = c.expires && c.expires > 0 ? Math.floor(c.expires) : 0;
    console.log([c.domain, c.domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path, c.secure ? 'TRUE' : 'FALSE', exp, c.name, c.value].join('\t'));
  }
} else {
  for (const c of cookies) {
    console.log(`${c.name}: ${c.value}`);
    console.log(`  domain: ${c.domain}  path: ${c.path}  httpOnly: ${c.httpOnly}  secure: ${c.secure}`);
    console.log();
  }
}
process.exit(0);
