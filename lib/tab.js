// lib/tab.js — one browser tab as the daemon sees it: its CDP session, the iframes
// running in other processes (OOPIF), the refs handed out by the last snapshots, and
// the pointer position. Every action resolves a ref or a selector to a DOM node, moves
// the mouse there along a curved path and reports what the page did in response
// (navigation, new tab, URL change).
//
// Quiet in the page: helpers run in an isolated world (the page cannot see their
// globals or hook their DOM calls) and the daemon never sends Runtime.enable, the CDP
// call bot detectors look for.

import { NAV_TIMEOUT } from './cdp.js';
import { render, find } from './snapshot.js';
import { chordEvents, charEvents } from './keys.js';
import { sleep, pause, mousePath, pointIn, keyDelay, TYPE_LIMIT, HUMAN } from './human.js';
import { NetworkRecord } from './intercept.js';

const WORLD = 'browser-tools';
const REF_RE = /^e\d+$/;

export class Tab {
  constructor(cdp, targetId, sid) {
    this.cdp = cdp;
    this.targetId = targetId;
    this.sid = sid;
    this.refs = new Map();      // 'e12' → { sid, frameId, backendNodeId }
    this.nodeRefs = new Map();  // `${sid}:${backendNodeId}` → 'e12'
    this.nextRef = 1;
    this.worlds = new Map();    // `${sid}:${frameId}` → executionContextId
    this.children = new Map();  // OOPIF sessionId → { targetId, parentSid }
    this.mouse = null;
    this.netlog = null;         // NetworkRecord while browser-intercept.js records
    this.offs = [];
  }

  send(method, params = {}, sid = this.sid, timeout) {
    return this.cdp.send(method, params, timeout, sid);
  }

  async init() {
    const on = (ev, fn) => this.offs.push(this.cdp.on(ev, fn));
    on('Target.attachedToTarget', (p, parentSid) => {
      if (parentSid !== this.sid && !this.children.has(parentSid)) return;
      if (p.targetInfo.type !== 'iframe') return;
      this.children.set(p.sessionId, { targetId: p.targetInfo.targetId, parentSid });
      this.autoAttach(p.sessionId).catch(() => {});
      this.netlog?.attach(p.sessionId).catch(() => {});
    });
    on('Target.detachedFromTarget', (p) => { this.children.delete(p.sessionId); });
    on('Page.frameNavigated', ({ frame }, sid) => {
      if (sid === this.sid && !frame.parentId) this.resetRefs();
      for (const k of this.worlds.keys()) if (k.endsWith(`:${frame.id}`)) this.worlds.delete(k);
    });
    await this.send('Page.enable');
    this.frameId = await this.mainFrameId();
    await this.autoAttach(this.sid);
  }

  autoAttach(sid) {
    return this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid);
  }

  dispose() {
    this.offs.forEach(off => off());
    this.netlog?.offs.forEach(off => off());
  }

  // ---------------------------------------------------------------- network record

  async intercept(action, o = {}) {
    if (action === 'start') {
      if (this.netlog) await this.netlog.stop();
      this.netlog = new NetworkRecord(this, o);
      await this.netlog.start();
      return `recording requests${o.match ? ` matching ${o.match}` : ''}${o.block ? `, blocking ${o.block}` : ''}`;
    }
    if (!this.netlog) throw new Error('not recording on this tab: run browser-intercept.js start first');
    if (action === 'read') {
      const entries = await this.netlog.read(o);
      if (o.clear) this.netlog.clear();
      return { blocked: this.netlog.blocked, entries };
    }
    if (action === 'stop') {
      const n = this.netlog.entries.size;
      await this.netlog.stop();
      this.netlog = null;
      return `stopped; ${n} requests were recorded`;
    }
    throw new Error('Usage: intercept start|read|stop [optionsJSON]');
  }

  resetRefs() {
    this.refs.clear();
    this.nodeRefs.clear();
    this.worlds.clear();
  }

  // ---------------------------------------------------------------- frames & worlds

  async mainFrameId(sid = this.sid) {
    const { frameTree } = await this.send('Page.getFrameTree', {}, sid);
    return frameTree.frame.id;
  }

  async world(sid, frameId) {
    const key = `${sid}:${frameId}`;
    if (this.worlds.has(key)) return this.worlds.get(key);
    const { executionContextId } = await this.send('Page.createIsolatedWorld', { frameId, worldName: WORLD }, sid);
    this.worlds.set(key, executionContextId);
    return executionContextId;
  }

  /** Evaluate an expression in the isolated world of a frame (main frame by default). */
  async evalIsolated(expression, sid = this.sid, frameId = null) {
    frameId ??= await this.mainFrameId(sid);
    for (let attempt = 0; attempt < 2; attempt++) {
      const contextId = await this.world(sid, frameId);
      try {
        const { result, exceptionDetails } = await this.send('Runtime.evaluate',
          { expression, contextId, returnByValue: true, awaitPromise: true }, sid);
        if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
        return result.value;
      } catch (e) {
        if (!/context|Cannot find/i.test(e.message) || attempt) throw e;
        this.worlds.delete(`${sid}:${frameId}`);
      }
    }
  }

  /** Run fn(node, ...args) in the isolated world on a resolved node; returns its value. */
  async callOn(entry, fn, args = []) {
    const contextId = await this.world(entry.sid, entry.frameId);
    let objectId;
    try {
      ({ object: { objectId } } = await this.send('DOM.resolveNode',
        { backendNodeId: entry.backendNodeId, executionContextId: contextId }, entry.sid));
    } catch (e) {
      throw new Error(`${entry.label || 'element'} is gone from the page (${e.message}); run snap again`);
    }
    const { result, exceptionDetails } = await this.send('Runtime.callFunctionOn', {
      objectId, functionDeclaration: fn.toString(), returnByValue: true, awaitPromise: true,
      arguments: args.map(value => ({ value })),
    }, entry.sid);
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  }

  // ---------------------------------------------------------------- refs

  refFor(sid, frameId, backendNodeId) {
    const key = `${sid}:${backendNodeId}`;
    let ref = this.nodeRefs.get(key);
    if (!ref) {
      ref = `e${this.nextRef++}`;
      this.nodeRefs.set(key, ref);
    }
    this.refs.set(ref, { sid, frameId, backendNodeId });
    return ref;
  }

  /** A ref (`e12`) or a CSS selector → { sid, frameId, backendNodeId, label }. */
  async resolve(target) {
    if (REF_RE.test(target)) {
      const e = this.refs.get(target);
      if (!e) throw new Error(`${target} is not a ref on this page (refs reset when the page navigates); run snap again`);
      return { ...e, label: target };
    }
    // `js:<expression>` evaluates to the element (DOM only, isolated world); anything else is a CSS selector.
    const expression = target.startsWith('js:') ? `(${target.slice(3)})` : `document.querySelector(${JSON.stringify(target)})`;
    const frameId = await this.mainFrameId();
    const contextId = await this.world(this.sid, frameId);
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, contextId });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    if (!result.objectId) throw new Error(`No element matches ${target.length > 80 ? target.slice(0, 77) + '...' : target}`);
    const { node } = await this.send('DOM.describeNode', { objectId: result.objectId });
    return { sid: this.sid, frameId, backendNodeId: node.backendNodeId, label: target };
  }

  // ---------------------------------------------------------------- snapshot

  /** Build the frame document tree for a session, iframes included. */
  async frameDoc(sid, frameId = null, depth = 0) {
    const params = frameId ? { frameId } : {};
    const { nodes } = await this.send('Accessibility.getFullAXTree', params, sid);
    frameId ??= await this.mainFrameId(sid);
    const doc = { sid, frameId, nodes, hrefs: new Map(), children: new Map() };
    if (depth > 4) return doc;

    // One DOM read per document: link targets and which frame each <iframe> hosts.
    const { root } = await this.send('DOM.getDocument', { depth: -1, pierce: false }, sid);
    const frames = [];
    doc.hints = new Map();
    const attr = (n, k) => { const i = n.attributes ? n.attributes.indexOf(k) : -1; return i >= 0 && i % 2 === 0 ? n.attributes[i + 1] : null; };
    // Something to tell a nameless link or button apart by: id, title, an icon's file name, a class.
    const hintOf = (n) => {
      const id = attr(n, 'id'); if (id) return '#' + id;
      const t = attr(n, 'title') || attr(n, 'name') || attr(n, 'value'); if (t) return t;
      const img = (function first(m) { for (const c of m.children || []) { if (c.nodeName === 'IMG' || c.nodeName === 'svg') return c; const d = first(c); if (d) return d; } return null; })(n);
      const src = img && (attr(img, 'src') || attr(img, 'class'));
      if (src) return 'icon ' + src.split(/[/?#]/).filter(Boolean).pop()?.slice(0, 40);
      const cls = attr(n, 'class'); if (cls) return '.' + cls.trim().split(/\s+/)[0].slice(0, 40);
      return null;
    };
    (function walk(n, inFrame) {
      if (n.nodeName === 'A' && n.attributes) {
        const i = n.attributes.indexOf('href');
        if (i >= 0) doc.hrefs.set(n.backendNodeId, n.attributes[i + 1]);
      }
      if (n.nodeName === 'A' || n.nodeName === 'BUTTON' || (n.nodeName === 'INPUT' && attr(n, 'type') !== 'hidden')) {
        const h = hintOf(n); if (h) doc.hints.set(n.backendNodeId, h);
      }
      if ((n.nodeName === 'IFRAME' || n.nodeName === 'FRAME') && n.frameId) frames.push(n);
      for (const c of n.children || []) walk(c, inFrame);
    })(root, false);
    doc.base = root.documentURL;
    doc.clickable = await this.clickables(sid, frameId);

    const wanted = new Set(nodes.filter(n => n.role?.value === 'Iframe' && !n.ignored).map(n => n.backendDOMNodeId));
    for (const f of frames) {
      if (!wanted.has(f.backendNodeId)) continue;
      const oopif = [...this.children].find(([, c]) => c.targetId === f.frameId);
      try {
        const child = oopif
          ? await this.frameDoc(oopif[0], null, depth + 1)
          : await this.frameDoc(sid, f.frameId, depth + 1);
        doc.children.set(f.backendNodeId, child);
      } catch { /* frame went away or never loaded */ }
    }
    return doc;
  }

  /** backendNodeIds of elements a person would click that have no ARIA role: a pointer
   *  cursor or an onclick, outermost only (autocomplete rows, div buttons, chosen/select2). */
  async clickables(sid, frameId) {
    const ids = new Set();
    try {
      const contextId = await this.world(sid, frameId);
      const { result } = await this.send('Runtime.evaluate', { contextId, expression: `(() => {
        const ROLE = 'a,button,input,select,textarea,summary,label,option,[role],[contenteditable]';
        const out = [];
        for (const e of document.body ? document.body.querySelectorAll('*') : []) {
          if (out.length >= 150) break;
          if (e.matches(ROLE) || e.closest(ROLE)) continue;
          const own = e.hasAttribute('onclick') || getComputedStyle(e).cursor === 'pointer';
          if (!own) continue;
          const p = e.parentElement;
          if (p && (p.hasAttribute('onclick') || getComputedStyle(p).cursor === 'pointer')) continue;
          if (!e.getClientRects().length) continue;
          if (!(e.innerText || '').trim() && !e.querySelector('img,svg')) continue;
          out.push(e);
        }
        return out; })()` }, sid);
      if (!result.objectId) return ids;
      const { result: props } = await this.send('Runtime.getProperties', { objectId: result.objectId, ownProperties: true }, sid);
      for (const p of props) {
        if (!/^\d+$/.test(p.name) || !p.value?.objectId) continue;
        const { node } = await this.send('DOM.describeNode', { objectId: p.value.objectId }, sid);
        ids.add(node.backendNodeId);
      }
      await this.send('Runtime.releaseObject', { objectId: result.objectId }, sid).catch(() => {});
    } catch { /* best effort */ }
    return ids;
  }

  async snapshot({ all = false, max, root } = {}) {
    const doc = await this.frameDoc(this.sid);
    const ref = (d, id) => this.refFor(d.sid, d.frameId, id);
    const { result } = await this.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    const title = (await this.send('Target.getTargetInfo', { targetId: this.targetId }, null)).targetInfo.title;
    let body = render(doc, ref, { all, max, rootRef: root, origin: result.value });
    const ready = await this.evalIsolated('document.readyState').catch(() => 'unknown');
    const notes = [];
    if (ready !== 'complete') notes.push(`# still loading (readyState=${ready}); snap again or browser-wait.js`);
    if (!body.trim()) notes.push('# the page shows nothing readable yet: an app still rendering, a blank route, or content only in images. Wait (browser-wait.js --selector=…) or take a screenshot');
    return [`# ${title}`, `# ${result.value}`, ...notes, body].filter(Boolean).join('\n');
  }

  /** Best match by role and name, inside `within` (a ref) when given, plus the other matches. */
  async find(role, name, within) {
    const doc = await this.frameDoc(this.sid);
    const hits = find(doc, (d, id) => this.refFor(d.sid, d.frameId, id), role, name, within);
    if (!hits.length) throw new Error(`No ${role || 'element'}${name ? ` named like "${name}"` : ''}${within ? ` inside ${within}` : ''} on the page`);
    const [hit, ...rest] = hits;
    const out = { ref: hit.ref, role: hit.role, name: hit.name };
    if (rest.length) out.others = rest.slice(0, 8).map(h => `${h.ref} ${h.role} ${JSON.stringify(h.name || h.text || '')}`);
    return out;
  }

  // ---------------------------------------------------------------- geometry

  /** Viewport box of a node, scrolled into view; accounts for out-of-process iframes. */
  async box(entry) {
    const child = this.children.get(entry.sid);
    let offset = { x: 0, y: 0 };
    if (child) {
      const { backendNodeId } = await this.send('DOM.getFrameOwner', { frameId: child.targetId }, child.parentSid);
      const parentFrame = await this.mainFrameId(child.parentSid);
      const owner = await this.box({ sid: child.parentSid, frameId: parentFrame, backendNodeId });
      offset = { x: owner.x, y: owner.y };
    }
    try {
      await this.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: entry.backendNodeId }, entry.sid);
    } catch { /* not scrollable into view; quads tell */ }
    let quads;
    try {
      ({ quads } = await this.send('DOM.getContentQuads', { backendNodeId: entry.backendNodeId }, entry.sid));
    } catch (e) {
      throw new Error(`${entry.label} has no layout (hidden or detached): ${e.message}`);
    }
    // An inline element split across lines (a link around a card) has several quads, and
    // the first can be an empty fragment beside the content: take the largest.
    const boxes = (quads || []).map(q => {
      const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x: x + offset.x, y: y + offset.y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }).filter(b => b.width > 0 && b.height > 0);
    if (!boxes.length) throw new Error(await this.hiddenReason(entry) || `${entry.label} is not visible (no box on screen)`);
    return boxes.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  }

  /** Why a node can't be seen, naming the ancestor that hides it, or null when visible.
   *  A closed <details> or a collapsed panel keeps layout boxes, so quads alone can't tell. */
  async hiddenReason(entry) {
    const where = await this.callOn(entry, function () {
      if (!this.checkVisibility || this.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })) {
        if (this.getClientRects().length) return null;
      }
      const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/)[0] : '');
      for (let e = this.parentElement; e && e !== document.body; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if ((e.tagName === 'DETAILS' && !e.open) || cs.display === 'none' || cs.visibility === 'hidden' || cs.contentVisibility === 'hidden'
          || e.hidden || e.getAttribute('aria-hidden') === 'true' || (cs.overflow === 'hidden' && e.clientHeight === 0)) return name(e);
      }
      return 'self';
    }).catch(() => null);
    if (!where) return null;
    if (where === 'self') return `${entry.label} is not visible (display:none, hidden, or zero size)`;
    return `${entry.label} is not visible: it sits inside ${where}, which is hidden or collapsed; open that section first (a tab, an accordion, a "filters" toggle)`;
  }

  async viewport() {
    const { cssVisualViewport: v } = await this.send('Page.getLayoutMetrics');
    return { width: v.clientWidth, height: v.clientHeight };
  }

  /** What sits on top at a point, if it is not the target (or inside it). The point is in
   *  the top viewport; frames other than the top document are trusted. */
  async occluder(entry, point) {
    if (entry.sid !== this.sid || entry.frameId !== this.frameId) return null;
    return this.callOn(entry, function (x, y) {
      let h = document.elementFromPoint(x, y);
      while (h && h.shadowRoot) {
        const inner = h.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === h) break;
        h = inner;
      }
      if (!h) return 'nothing (the point is off the page)';
      const root = this.getRootNode();
      const within = (a, b) => a === b || a.contains(b) || (root !== document && root.host && root.host.contains(b));
      if (within(this, h)) return null;
      // An ancestor on top only counts as the target when the target lets clicks through.
      if (h.contains(this) && getComputedStyle(this).pointerEvents === 'none') return null;
      if (this.labels && [...this.labels].some(l => l === h || l.contains(h))) return null;
      const d = h.closest('[role=dialog],dialog,[aria-modal=true]') || h;
      const tag = d.tagName.toLowerCase() + (d.id ? '#' + d.id : '') +
        (typeof d.className === 'string' && d.className.trim() ? '.' + d.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
      return tag + ' "' + (d.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) + '"';
    }, [point.x, point.y]);
  }

  /** Input and screenshots need a visible tab; a hidden one (behind another tab in its
   *  window) is brought to the front first. */
  async ensureVisible() {
    let state;
    try { state = await this.evalIsolated('document.visibilityState'); } catch { return; }
    if (state === 'visible') return;
    await this.send('Page.bringToFront');
    for (let i = 0; i < 20 && (await this.evalIsolated('document.visibilityState')) !== 'visible'; i++) await sleep(50);
  }

  // ---------------------------------------------------------------- pointer

  async moveTo(point) {
    await this.ensureVisible();
    if (!this.mouse) {
      const vp = await this.viewport();
      this.mouse = { x: vp.width * (0.3 + Math.random() * 0.4), y: vp.height * (0.3 + Math.random() * 0.4) };
    }
    for (const p of mousePath(this.mouse, point)) {
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
      await pause(6, 16);
    }
    this.mouse = point;
  }

  /** Wait for the page's reaction to an input: navigation, a new tab, a URL change. */
  watch() {
    const seen = { nav: false, stopped: false, popup: null, sameDoc: null };
    let wake = () => {};
    const offs = [
      this.cdp.on('Page.frameStartedLoading', (p, sid) => { if (sid === this.sid && p.frameId === this.frameId) seen.nav = true; }),
      this.cdp.on('Page.frameStoppedLoading', (p, sid) => { if (sid === this.sid && p.frameId === this.frameId && seen.nav) { seen.stopped = true; wake(); } }),
      this.cdp.on('Page.navigatedWithinDocument', (p, sid) => { if (sid === this.sid && p.frameId === this.frameId) seen.sameDoc = p.url; }),
      this.cdp.on('Target.targetCreated', ({ targetInfo }) => {
        if (targetInfo.openerId === this.targetId && targetInfo.type === 'page') seen.popup = targetInfo;
      }),
    ];
    return {
      settle: async () => {
        await sleep(350);
        if (seen.nav && !seen.stopped) {
          await new Promise((res) => { const t = setTimeout(res, NAV_TIMEOUT); wake = () => { clearTimeout(t); res(); }; });
        }
        offs.forEach(off => off());
        const notes = [];
        if (seen.nav && !seen.sameDoc) notes.push(`navigated to ${await this.url()}${await this.httpStatus()}`);
        else if (seen.sameDoc) notes.push(`URL is now ${seen.sameDoc}`);
        if (seen.popup) {
          await sleep(300);
          let url = seen.popup.url;
          try { url = (await this.send('Target.getTargetInfo', { targetId: seen.popup.targetId }, null)).targetInfo.url; } catch {}
          notes.push(`opened tab [${seen.popup.targetId.slice(0, 8).toUpperCase()}] ${url}`.trim());
        }
        return notes;
      },
    };
  }

  async url() {
    const { result } = await this.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    return result.value;
  }

  /** Wheel toward an element below or above the fold, as a person scrolls to it. Only for
   *  the top document; box() still scrolls programmatically whatever the wheel left. */
  async wheelIntoView(entry) {
    if (!HUMAN || entry.sid !== this.sid) return;
    for (let i = 0; i < 40; i++) {
      let q;
      try { ({ quads: [q] = [] } = await this.send('DOM.getContentQuads', { backendNodeId: entry.backendNodeId }, entry.sid)); } catch { return; }
      if (!q) return;
      const vp = await this.viewport();
      const top = Math.min(q[1], q[5]), bottom = Math.max(q[1], q[5]);
      if (top >= 0 && bottom <= vp.height) return;
      if (!this.mouse) this.mouse = { x: vp.width * (0.3 + Math.random() * 0.4), y: vp.height * (0.3 + Math.random() * 0.4) };
      const want = (top + bottom) / 2 - vp.height / 2;
      const d = Math.sign(want) * Math.min(Math.abs(want), 100 + Math.random() * 60);
      const before = await this.evalIsolated('scrollY');
      await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: this.mouse.x, y: this.mouse.y, deltaX: 0, deltaY: d });
      await pause(16, 45);
      if (await this.evalIsolated('scrollY') === before) return;   // an inner scroller or the end: box() takes over
    }
  }

  async click(target, { button = 'left', count = 1, force = false, settle = true } = {}) {
    await this.ensureVisible();
    const entry = await this.resolve(target);
    await this.wheelIntoView(entry);
    // A point on the target that is really on top: a random one, then the centre and the
    // quarters (a badge or an overlapping neighbour can cover part of it). Retried for a
    // moment while an animation or a closing dialog clears.
    const hidden = force ? null : await this.hiddenReason(entry);
    if (hidden) throw new Error(hidden);
    const aim = async () => {
      let cover;
      for (let i = 0; i < 6; i++) {
        const box = await this.box(entry);
        const cands = [pointIn(box), ...[[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]]
          .map(([fx, fy]) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy }))];
        for (const p of cands) {
          cover = force ? null : await this.occluder(entry, p);
          if (!cover) return { box, point: p };
        }
        await sleep(250);
      }
      throw new Error(`${entry.label} is covered by ${cover}; close that first (or click with --force)`);
    };
    let { box, point } = await aim();
    const w = settle ? this.watch() : null;
    const mutations = settle ? await this.countMutations(entry) : null;
    await this.moveTo(point);
    // The layout can shift while the pointer travels (a banner or carousel loads above):
    // aim again when the target moved.
    const now = await this.box(entry);
    if (Math.abs(now.x - box.x) > 4 || Math.abs(now.y - box.y) > 4) {
      ({ box, point } = await aim());
      await this.moveTo(point);
    }
    await pause(40, 120);
    for (let c = 1; c <= count; c++) {
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button, clickCount: c });
      await pause(45, 110);
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button, clickCount: c });
      if (c < count) await pause(60, 120);
    }
    const notes = w ? await w.settle() : [];
    if (mutations && !notes.length && await this.callOn(entry, function () {
      return this.matches('a, button, summary, [role=button], [role=link], [role=tab], [role=menuitem]');
    }).catch(() => false)) {
      const n = await mutations.read();
      if (n === 0) notes.push('the page did not change (no navigation, no new tab, no DOM change); check that the target is the right one');
    }
    return [`clicked ${entry.label}`, ...notes].join('; ');
  }

  /** Count DOM mutations in the target's document from now on (isolated world, unseen by
   *  the page). read() returns the count, or null when the document went away. */
  async countMutations(entry) {
    const key = `__bt_mut_${Math.random().toString(36).slice(2)}`;
    const expr = `(() => { const k = ${JSON.stringify(key)}; window[k] = 0;
      new MutationObserver(m => { window[k] += m.length; }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      return true; })()`;
    try { await this.evalIsolated(expr, entry.sid, entry.frameId); } catch { return null; }
    return { read: async () => { try { return await this.evalIsolated(`window[${JSON.stringify(key)}]`, entry.sid, entry.frameId); } catch { return null; } } };
  }

  async clickAt(x, y) {
    const point = { x: +x, y: +y };
    const w = this.watch();
    await this.moveTo(point);
    await pause(40, 120);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await pause(45, 110);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    const notes = await w.settle();
    return [`clicked (${x}, ${y})`, ...notes].join('; ');
  }

  async hover(target) {
    await this.ensureVisible();
    const entry = await this.resolve(target);
    await this.wheelIntoView(entry);
    await this.moveTo(pointIn(await this.box(entry)));
    return `hovering ${entry.label}`;
  }

  // ---------------------------------------------------------------- keyboard

  async typeText(text, sid = this.sid) {
    await this.ensureVisible();
    const typed = text.length <= TYPE_LIMIT || !HUMAN ? (HUMAN ? text : '') : text.slice(0, 24);
    for (const ch of typed) {
      for (const ev of charEvents(ch)) await this.send('Input.dispatchKeyEvent', ev, sid);
      await keyDelay(ch);
    }
    const rest = text.slice(typed.length);
    if (rest) await this.send('Input.insertText', { text: rest }, sid);
  }

  async press(keys) {
    await this.ensureVisible();
    for (const k of keys) {
      for (const ev of chordEvents(k)) await this.send('Input.dispatchKeyEvent', ev);
      await pause(50, 140);
    }
    return `pressed ${keys.join(' ')}`;
  }

  async fill(target, text) {
    const entry = await this.resolve(target);
    const kind = await this.callOn(entry, function () {
      const t = this.tagName.toLowerCase();
      if (t === 'select') return { kind: 'select' };
      if (t === 'input' && /^(checkbox|radio|file|submit|button|reset|image)$/.test(this.type)) return { kind: this.type };
      const editable = t === 'input' || t === 'textarea' || this.isContentEditable;
      return { kind: editable ? 'text' : 'other', value: this.value ?? this.innerText ?? '', focused: document.activeElement === this, mac: /Mac/.test(navigator.platform) };
    });
    if (kind.kind === 'select') return this.select(target, [text]);
    if (kind.kind !== 'text') throw new Error(`${entry.label} is a ${kind.kind}, not a text field; use click`);
    if (!kind.focused) await this.click(target, { settle: false });
    if (kind.value) {
      for (const ev of chordEvents(kind.mac ? 'Meta+a' : 'Ctrl+a')) await this.send('Input.dispatchKeyEvent', ev);
      await pause(40, 100);
      for (const ev of chordEvents('Backspace')) await this.send('Input.dispatchKeyEvent', ev);
      await pause(40, 100);
    }
    await this.typeText(text);
    const now = await this.callOn(entry, function () { return this.value ?? this.innerText; });
    const ok = (now ?? '').toString().trim() === text.trim();
    return ok ? `filled ${entry.label}` : `filled ${entry.label}, but the field now reads ${JSON.stringify(now)} (the page reformatted or rejected it)`;
  }

  async select(target, values) {
    const entry = await this.resolve(target);
    const picked = await this.callOn(entry, function (wanted) {
      if (this.tagName !== 'SELECT') throw new Error('not a <select>; open it with click and pick the option ref');
      const opts = [...this.options];
      const hits = wanted.map(w => opts.find(o => o.value === w) || opts.find(o => o.label.trim().toLowerCase() === w.toLowerCase())
        || opts.find(o => o.label.toLowerCase().includes(w.toLowerCase())));
      const missing = wanted.filter((w, i) => !hits[i]);
      if (missing.length) throw new Error('no option ' + JSON.stringify(missing) + '; options: ' + JSON.stringify(opts.map(o => o.label.trim()).slice(0, 40)));
      for (const o of opts) o.selected = hits.includes(o);
      this.dispatchEvent(new Event('input', { bubbles: true }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
      return hits.map(o => o.label.trim());
    }, [values]);
    return `selected ${JSON.stringify(picked)} in ${entry.label}`;
  }

  // ---------------------------------------------------------------- scrolling & waiting

  async scroll(arg) {
    if (arg && (REF_RE.test(arg) || !/^-?\d+$/.test(arg))) {
      const entry = await this.resolve(arg);
      await this.box(entry);
      return `scrolled ${entry.label} into view`;
    }
    let dy = parseInt(arg ?? '600', 10);
    if (!this.mouse) await this.moveTo({ x: 400 + Math.random() * 200, y: 300 + Math.random() * 100 });
    const step = HUMAN ? 100 : dy;
    while (Math.abs(dy) > 0) {
      const d = Math.sign(dy) * Math.min(Math.abs(dy), step);
      await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: this.mouse.x, y: this.mouse.y, deltaX: 0, deltaY: d });
      dy -= d;
      await pause(14, 40);
    }
    const y = await this.evalIsolated('Math.round(scrollY)');
    return `scrolled to y=${y}`;
  }

  /** Wait until the page shows text, matches a URL substring, has (or lost) a selector. */
  async waitFor({ text, url, selector, gone, fresh, timeout = 15000 }) {
    // fresh: a selector match that was not on the page when the wait began (AJAX results
    // replacing old rows), marked in the isolated world.
    if (fresh) await this.evalIsolated(`(() => { window.__btSeen = new WeakSet(document.querySelectorAll(${JSON.stringify(fresh)})); return true; })()`);
    const cond = `(() => {
      ${fresh ? `if (![...document.querySelectorAll(${JSON.stringify(fresh)})].some(e => !window.__btSeen.has(e))) return false;` : ''}
      ${text ? `if (!(document.body?.innerText || '').includes(${JSON.stringify(text)})) return false;` : ''}
      ${url ? `if (!location.href.includes(${JSON.stringify(url)})) return false;` : ''}
      ${selector ? `if (!document.querySelector(${JSON.stringify(selector)})) return false;` : ''}
      ${gone ? `if (document.querySelector(${JSON.stringify(gone)}) || (document.body?.innerText || '').includes(${JSON.stringify(gone)})) return false;` : ''}
      return true;
    })()`;
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      try { if (await this.evalIsolated(cond)) return `ready after ${timeout - (end - Date.now())}ms`; }
      catch (e) { last = e; }   // mid-navigation
      await sleep(200);
    }
    throw new Error(`waited ${timeout}ms: ${JSON.stringify({ text, url, selector, gone, new: fresh })} never held${last ? ` (${last.message})` : ''}`);
  }

  async nav(url) {
    const load = this.cdp.waitFor('Page.loadEventFired', NAV_TIMEOUT, this.sid);
    const r = await this.send('Page.navigate', { url }, this.sid, NAV_TIMEOUT);
    if (r.errorText) { load.catch(() => {}); throw new Error(`${url}: ${r.errorText}`); }
    if (r.loaderId) await load; else load.catch(() => {});   // same-document navigations fire no load
    this.resetRefs();
    return `navigated to ${await this.url()}${await this.httpStatus()}`;
  }

  /** " (HTTP 403)" for the document now loaded, from its navigation timing entry; "" when unknown. */
  async httpStatus() {
    const s = await this.evalIsolated(`performance.getEntriesByType('navigation')[0]?.responseStatus || 0`).catch(() => 0);
    return s ? ` (HTTP ${s})` : '';
  }
}
