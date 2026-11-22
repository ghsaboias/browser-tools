// lib/intercept.js — the network record of one tab: the requests the tab and its
// out-of-process iframes make while recording is on, their responses, the response
// bodies of the URLs that match, and the requests to block. Network.enable and
// Fetch.enable are not visible to the page, unlike Runtime.enable.

const TEXT_TYPES = new Set(['Document', 'XHR', 'Fetch', 'EventSource', 'Other']);
const SKIP_TYPES = new Set(['Image', 'Media', 'Font', 'Stylesheet']);
const BODY_LIMIT = 5_000_000;   // characters kept per body
const MAX_ENTRIES = 3000;

/** A URL test: `/re/flags` is a regular expression when the flags are valid ones
 *  (`/v2/files` is a path, not /v2/ with flags "files"); anything else a substring. */
export function matcher(pattern) {
  if (!pattern) return () => true;
  const m = /^\/(.+)\/([dgimsuy]*)$/.exec(pattern);
  if (m) { const re = new RegExp(m[1], m[2]); return (u) => re.test(u); }
  return (u) => u.includes(pattern);
}

export class NetworkRecord {
  constructor(tab, { match, block } = {}) {
    this.tab = tab;
    this.match = match || null;
    this.matches = matcher(match);
    this.blocks = block ? matcher(block) : null;
    this.entries = new Map();   // `${sid}:${requestId}` → entry
    this.seq = 0;
    this.blocked = 0;
    this.offs = [];
    this.waiters = new Set();
  }

  owns(sid) { return sid === this.tab.sid || this.tab.children.has(sid); }

  async start() {
    const on = (ev, fn) => this.offs.push(this.tab.cdp.on(ev, (p, sid) => { if (this.owns(sid)) fn(p, sid); }));
    on('Network.requestWillBeSent', (p, sid) => {
      const key = `${sid}:${p.requestId}`;
      const prev = this.entries.get(key);
      if (prev && p.redirectResponse) {   // the same requestId carries every hop of a redirect
        prev.status = p.redirectResponse.status;
        prev.location = p.request.url;
        prev.done = true;
        this.entries.delete(key);
        this.entries.set(`${key}#${prev.n}`, prev);
      }
      if (this.entries.size >= MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value);
      this.entries.set(key, {
        n: ++this.seq, method: p.request.method, url: p.request.url, type: p.type || 'Other',
        frame: sid === this.tab.sid ? 'main' : 'iframe',
        postData: p.request.postData, status: 0, mime: '', size: 0, done: false,
      });
    });
    on('Network.responseReceived', (p, sid) => {
      const key = `${sid}:${p.requestId}`;
      const e = this.entries.get(key);
      if (!e) return;
      // A CORS preflight (OPTIONS) is noise, and its finishing first would end a read --wait.
      if (p.type === 'Preflight') { this.entries.delete(key); return; }
      e.status = p.response.status;
      e.mime = p.response.mimeType || '';
      e.type = p.type || e.type;
    });
    on('Network.loadingFinished', (p, sid) => {
      const e = this.entries.get(`${sid}:${p.requestId}`);
      if (!e) return;
      e.size = p.encodedDataLength;
      const wanted = this.match ? !SKIP_TYPES.has(e.type) : TEXT_TYPES.has(e.type);
      if (!wanted || !this.matches(e.url)) return this.finish(e);
      this.tab.send('Network.getResponseBody', { requestId: p.requestId }, sid)
        .then(({ body, base64Encoded }) => {
          e.base64 = base64Encoded;
          e.bodyLength = body.length;
          e.body = body.length > BODY_LIMIT ? body.slice(0, BODY_LIMIT) : body;
        })
        .catch((err) => { e.bodyError = err.message; })
        .finally(() => this.finish(e));
    });
    on('Network.loadingFailed', (p, sid) => {
      const e = this.entries.get(`${sid}:${p.requestId}`);
      if (!e) return;
      e.error = p.blockedReason || p.errorText;
      this.finish(e);
    });
    on('Fetch.requestPaused', (p, sid) => {
      const block = this.blocks(p.request.url);
      if (block) this.blocked++;
      this.tab.send(block ? 'Fetch.failRequest' : 'Fetch.continueRequest',
        block ? { requestId: p.requestId, errorReason: 'BlockedByClient' } : { requestId: p.requestId }, sid)
        .catch(() => {});
    });
    for (const sid of [this.tab.sid, ...this.tab.children.keys()]) await this.attach(sid);
  }

  /** Turn recording on in one session: the tab's, or an iframe's that attached later. */
  async attach(sid) {
    await this.tab.send('Network.enable', { maxPostDataSize: 65536 }, sid);
    if (this.blocks) await this.tab.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sid);
  }

  finish(e) {
    e.done = true;
    for (const w of this.waiters) w();
  }

  /** Entries in request order; `match` narrows them, `wait` (ms) waits for a matching one to finish. */
  async read({ match, wait = 0 } = {}) {
    const test = matcher(match || this.match);
    const pick = () => [...this.entries.values()].filter(e => test(e.url)).sort((a, b) => a.n - b.n);
    if (wait && !pick().some(e => e.done)) {
      await new Promise((resolve, reject) => {
        const w = () => { if (pick().some(e => e.done)) { clearTimeout(t); this.waiters.delete(w); resolve(); } };
        const t = setTimeout(() => {
          this.waiters.delete(w);
          reject(new Error(`no finished response matching ${JSON.stringify(match || this.match || '*')} within ${wait}ms (${this.entries.size} requests recorded)`));
        }, wait);
        this.waiters.add(w);
      });
    }
    return pick();
  }

  clear() { this.entries.clear(); this.blocked = 0; }

  async stop() {
    this.offs.forEach(off => off());
    this.offs = [];
    for (const sid of [this.tab.sid, ...this.tab.children.keys()]) {
      await this.tab.send('Network.disable', {}, sid).catch(() => {});
      if (this.blocks) await this.tab.send('Fetch.disable', {}, sid).catch(() => {});
    }
  }
}
