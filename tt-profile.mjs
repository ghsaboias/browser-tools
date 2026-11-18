#!/usr/bin/env node
// Reads a TikTok profile in the logged-in browser: whether the account exists, name, bio, bio link, counts and the
// latest posts with their dates, as JSON. When TikTok shows "Something went wrong" with a Refresh button instead of the
// feed, it clicks Refresh as a person does (up to 3 times) and reads again. The tab must be in a visible window (the
// click is real input). Use it instead of browser-nav.js + browser-eval.js for any TikTok profile: a page read in the
// first seconds, or on that error screen, shows the header without posts and passes for an empty account.
// Uso: tt-profile.mjs -t=<tab> <handle> [--posts=N]   (N latest posts in the output, default 12)
import { run } from './lib/client.js';
import { ITEM_HOOK, readItems, readProfile, refreshShown, clickRefresh } from './lib/tiktok.js';
const args = process.argv.slice(2);
const tab = args.find(a => a.startsWith('-t='))?.slice(3);
const keep = Number(args.find(a => a.startsWith('--posts='))?.slice(8) ?? 12);
const handle = args.find(a => !a.startsWith('-'))?.replace(/^@/, '');
if (!tab || !handle) { console.error('Uso: tt-profile.mjs -t=<tab> <handle> [--posts=N]'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const REFRESH_MAX = 3, WAIT_S = 30;

await run(tab, 'injecton', [ITEM_HOOK]);
// Two tabs navigating at the same moment can leave this one elsewhere (aba_navegador.py): navigate until it is there.
const here = async () => decodeURIComponent(JSON.parse(await run(tab, 'eval', ['JSON.stringify(location.pathname)']))).toLowerCase().startsWith(`/@${handle.toLowerCase()}`);
for (let i = 0; i < 3; i++) { await run(tab, 'nav', [`https://www.tiktok.com/@${handle}`]); await sleep(1500); if (await here()) break; }
if (!await here()) { console.log(JSON.stringify({ handle, status: 'navigation_failed' })); process.exit(1); }

let profile = null, page = { items: [], hasMore: null }, clicks = 0, status = 'timeout';
for (let s = 0; s < WAIT_S; s++) {
  profile = await readProfile(tab);
  if (profile && profile.statusCode !== 0) { status = profile.statusCode === 10221 ? 'not_found' : `profile_status_${profile.statusCode}`; break; }
  page = await readItems(tab);
  if (page.items.length || page.hasMore === false) { status = 'ok'; break; }
  if (await refreshShown(tab)) {
    if (clicks >= REFRESH_MAX) { status = 'error_screen'; break; }
    if (await clickRefresh(tab)) clicks++;
    await sleep(3000);
    continue;
  }
  await sleep(1000);
}
const posts = page.items.slice().sort((a, b) => b.createTime - a.createTime).slice(0, keep).map(p => ({
  date: new Date(p.createTime * 1000).toISOString().slice(0, 10), url: `https://www.tiktok.com/@${handle}/${p.imagePost ? 'photo' : 'video'}/${p.id}`,
  pinned: p.isPinned, desc: (p.desc || '').slice(0, 160) }));
const { statusCode, path, ...rest } = profile || {};
console.log(JSON.stringify({ status, ...(status === 'not_found' ? { handle } : rest), refresh_clicks: clicks, posts_read: page.items.length, has_more: page.hasMore, posts }, null, 1));
process.exit(0);
