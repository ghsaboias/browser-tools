// What tt-capture.mjs and tt-profile.mjs share about a TikTok profile page: the hook that keeps the /api/post/item_list
// responses the page fetches, the reading of those items, the profile embedded in the page, and the "Something went
// wrong" screen with its Refresh button.
import { run } from './client.js';
import { clickElement } from './pointer.js';

// Installed with injecton before navigating, so the first page of posts is not missed.
export const ITEM_HOOK = `(() => { if (window.__ttCap) return; window.__ttCap = []; const keep = (u, t) => { if (u && u.includes('/api/post/item_list')) window.__ttCap.push(t) };
 const of = window.fetch; window.fetch = async (...a) => { const r = await of(...a); try { const u = typeof a[0] === 'string' ? a[0] : a[0].url; r.clone().text().then(t => keep(u, t)) } catch(e){}; return r };
 const oo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m, u, ...r){ this.__u = u; return oo.call(this, m, u, ...r) };
 const os = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send = function(...a){ this.addEventListener('load', () => { try { keep(this.__u, this.responseText) } catch(e){} }); return os.apply(this, a) }; })()`;

// { items: [{ id, createTime, desc, isPinned, imagePost, duration }], hasMore } from the responses kept so far.
export async function readItems(tab) {
  return JSON.parse(await run(tab, 'eval', [`(() => { const m = new Map(); for (const t of window.__ttCap || []) { try { for (const it of JSON.parse(t).itemList || []) m.set(it.id, { id: it.id, createTime: it.createTime, desc: it.desc, isPinned: !!(it.isPinned || it.isPinnedItem), imagePost: !!it.imagePost, duration: it.video?.duration || 0 }) } catch (e) {} }
 let hasMore = null; for (const t of window.__ttCap || []) { try { const j = JSON.parse(t); if (typeof j.hasMore === 'boolean') hasMore = j.hasMore } catch (e) {} }
 return JSON.stringify({ items: [...m.values()], hasMore }) })()`]));
}

// The profile TikTok embeds in the page (__UNIVERSAL_DATA_FOR_REHYDRATION__). statusCode 0 is a profile, 10221 an account
// that does not exist ("Couldn't find this account"); null while the page has not rendered it.
export async function readProfile(tab) {
  return JSON.parse(await run(tab, 'eval', [`(() => { const s = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__'); if (!s) return 'null';
 let u; try { u = JSON.parse(s.textContent).__DEFAULT_SCOPE__['webapp.user-detail'] } catch (e) { return 'null' } if (!u) return 'null';
 const p = u.userInfo?.user, st = u.userInfo?.stats;
 return JSON.stringify({ statusCode: u.statusCode, path: location.pathname, handle: p?.uniqueId, nickname: p?.nickname, bio: p?.signature, bioLink: p?.bioLink?.link || null, verified: p?.verified,
   followers: st?.followerCount, likes: st?.heartCount ?? st?.heart, videos: st?.videoCount }) })()`]));
}

// When the first page of /api/post/item_list comes back empty, TikTok replaces the feed with "Something went wrong / Sorry
// about that! Please try again later." and a Refresh button without data-e2e (container DivErrorContainer, English or
// Portuguese). Seen in real captures on 18/11/2026, 3 to 13 s after the profile opened, the button often below the fold
// of a capture window. Refresh fetches the list again in the same document (the hook and __ttCap stay).
export const REFRESH = `[...document.querySelectorAll('[class*="DivErrorContainer"] button, [data-e2e="user-page"] button')]
 .find(b => /^(Refresh|Atualizar|Recarregar)$/i.test(b.innerText.trim()) && /Something went wrong|Algo deu errado|Ocorreu um erro|Sorry about that|Desculpe/i.test(b.parentElement?.innerText || '')) || null`;

export async function refreshShown(tab) {
  return JSON.parse(await run(tab, 'eval', [`!!(${REFRESH})`])) === true;
}

// Clicks Refresh as a person does (lib/pointer.js). False when the button went away or never came into view.
export function clickRefresh(tab) {
  return clickElement(tab, REFRESH);
}
