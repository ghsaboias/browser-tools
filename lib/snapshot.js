// lib/snapshot.js — turn accessibility trees into a compact page outline with refs.
//
// Input is a frame document: { sid, nodes (Accessibility.getFullAXTree), hrefs
// (backendNodeId → href), children (backendNodeId of an <iframe> → frame document) }.
// Every line an agent can act on carries a ref (`e12`) that the daemon resolves back to
// the DOM node, so the next command is `click e12`, not a selector hunt.

export const INTERACTIVE = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch',
  'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'slider',
  'spinbutton', 'listbox', 'treeitem', 'textField', 'TextField', 'PopUpButton',
]);
const REFERABLE = new Set([...INTERACTIVE, 'heading', 'image', 'img', 'dialog', 'alertdialog',
  'Iframe', 'row', 'tabpanel', 'article', 'figure', 'video', 'audio']);
const SKIP = new Set(['none', 'generic', 'presentation', 'InlineTextBox', 'LineBreak',
  'RootWebArea', 'WebArea', 'IframePresentational', 'LabelText', 'Section', 'sectionheader', 'sectionfooter',
  'MenuListPopup']);
const FIELDS = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'TextField', 'textField']);
const STRUCTURE = new Set(['list', 'listitem', 'group', 'region', 'section', 'paragraph',
  'table', 'rowgroup', 'row', 'cell', 'gridcell', 'columnheader', 'rowheader', 'article',
  'blockquote', 'figure', 'DescriptionList', 'term', 'definition', 'Abbr', 'strong', 'emphasis',
  'code', 'mark', 'time', 'subscript', 'superscript', 'Pre', 'insertion', 'deletion', 'caption', 'Ruby']);
const LANDMARKS = new Set(['main', 'navigation', 'banner', 'contentinfo', 'complementary',
  'search', 'form', 'region']);
const STATES = ['checked', 'pressed', 'selected', 'expanded', 'disabled', 'required', 'invalid', 'focused', 'readonly'];
const MAX_TEXT = 160;

const clip = (s, n = MAX_TEXT) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const q = (s) => JSON.stringify(clip(s.replace(/\s+/g, ' ').trim()));

function prop(n, name) {
  const p = n.properties?.find(p => p.name === name);
  return p?.value?.value;
}

/** Display role, with the AX names Chrome uses mapped to ARIA ones. */
function roleOf(n) {
  const r = n.role?.value || '';
  if (r === 'StaticText') return 'text';
  if (r === 'image' || r === 'img') return 'img';
  if (r === 'Iframe') return 'iframe';
  return r;
}

/**
 * Build the outline tree (format-independent) for one frame document.
 * `ref(doc, backendNodeId)` returns the ref string for a node.
 */
function build(doc, ref, ctx) {
  const byId = new Map(doc.nodes.map(n => [n.nodeId, n]));
  const root = doc.nodes.find(n => n.parentId == null) || doc.nodes[0];

  function walk(id, landmark) {
    const n = byId.get(id);
    if (!n) return [];
    const role = roleOf(n);
    const name = (n.name?.value ?? '').toString();
    const kidsOf = () => (n.childIds || []).flatMap(c => walk(c, LANDMARKS.has(role) ? role : landmark));

    if (n.ignored) return kidsOf();
    if (role === 'iframe') {
      const child = doc.children?.get(n.backendDOMNodeId);
      const sub = child ? build(child, ref, ctx) : [];
      return [{ role, name, ref: ref(doc, n.backendDOMNodeId), kids: sub, landmark, node: n, sid: doc.sid, href: child?.base }];
    }
    if (SKIP.has(role) || SKIP.has(n.role?.value)) return kidsOf();
    if (role === 'text') {
      const t = name.replace(/\s+/g, ' ').trim();
      return t ? [{ role, name: t, kids: [], landmark }] : [];
    }

    let kids = kidsOf();
    // A control's name usually repeats its text children; drop the copies.
    if (name) {
      const flat = name.replace(/\s+/g, ' ').trim();
      kids = kids.filter(k => !(k.role === 'text' && flat.includes(k.name)));
    }
    // A field's text children are its value.
    if (FIELDS.has(role)) kids = kids.filter(k => k.role !== 'text');
    // A label's text sits next to the control it names; the control line already says it.
    const named = kids.filter(k => k.role !== 'text' && k.name).map(k => k.name.replace(/\s+/g, ' ').trim());
    if (named.length) kids = kids.filter(k => !(k.role === 'text' && named.some(nm => nm.startsWith(k.name))));
    const item = {
      role, name, kids, landmark, sid: doc.sid, node: n,
      value: n.value?.value,
      states: STATES.filter(s => { const v = prop(n, s); return v === true || v === 'true' || v === 'mixed'; }),
      level: prop(n, 'level'),
      href: role === 'link' ? doc.hrefs?.get(n.backendDOMNodeId) : undefined,
    };
    if (REFERABLE.has(n.role?.value) || REFERABLE.has(role)) item.ref = ref(doc, n.backendDOMNodeId);
    else if (prop(n, 'focusable') && name && n.backendDOMNodeId) item.ref = ref(doc, n.backendDOMNodeId);

    // Structure without a name or ref: fold away when it adds nothing.
    if (STRUCTURE.has(role) && !name && !item.ref) {
      if (kids.length === 0) return [];
      if (kids.length === 1) return kids;
      if (kids.every(k => k.role === 'text')) {
        return [{ role: 'text', name: kids.map(k => k.name).join(' '), kids: [], landmark }];
      }
    }
    // Containers whose children are all plain text collapse onto one line.
    if (kids.length && kids.every(k => k.role === 'text' && !k.kids.length) && role !== 'iframe') {
      item.text = kids.map(k => k.name).join(' ');
      item.kids = [];
    }
    if (!name && !item.ref && !item.text && !item.kids.length && !LANDMARKS.has(role)) return [];
    return [item];
  }
  return root ? walk(root.nodeId, null) : [];
}

function line(item, depth, origin) {
  const pad = '  '.repeat(Math.min(depth, 14));
  if (item.role === 'text') return `${pad}- text: ${clip(item.name.replace(/\s+/g, ' '), 300)}`;
  let s = `${pad}- ${item.role}`;
  if (item.name) s += ` ${q(item.name)}`;
  if (item.level) s += ` [h${item.level}]`;
  for (const st of item.states || []) s += ` [${st}]`;
  if (item.ref) s += ` [${item.ref}]`;
  if (item.value != null && item.value !== '' && item.value !== item.name) s += ` = ${q(String(item.value))}`;
  if (item.href) s += ` → ${shortHref(item.href, origin)}`;
  if (item.text) s += `: ${clip(item.text, 300)}`;
  return s;
}

function shortHref(href, origin) {
  try {
    const u = new URL(href, origin);
    if (origin && u.origin === new URL(origin).origin) return clip(u.pathname + u.search + u.hash, 90);
    return clip(u.href, 110);
  } catch { return clip(href, 110); }
}

function flatten(items, depth, out, origin) {
  for (const it of items) {
    out.push({ text: line(it, depth, origin), item: it });
    flatten(it.kids, depth + 1, out, origin);
  }
  return out;
}

function findItem(items, pred) {
  for (const it of items) {
    if (pred(it)) return it;
    const hit = findItem(it.kids, pred);
    if (hit) return hit;
  }
  return null;
}

function collect(items, pred, out = []) {
  for (const it of items) {
    if (pred(it)) out.push(it);
    collect(it.kids, pred, out);
  }
  return out;
}

/**
 * Render the outline.
 * opts: { all, max, rootRef, origin }
 * Without `all`, a page with exactly one `main` landmark is scoped to it, plus any
 * open dialog (cookie banners and modals sit outside main and block clicks).
 */
export function render(doc, ref, opts = {}) {
  const tree = build(doc, ref, {});
  const origin = opts.origin;
  let roots = tree, header = [];

  if (opts.rootRef) {
    const hit = findItem(tree, it => it.ref === opts.rootRef);
    if (!hit) throw new Error(`${opts.rootRef} is not on the page any more; run snap again`);
    roots = [hit];
  } else if (!opts.all) {
    const mains = collect(tree, it => it.role === 'main');
    if (mains.length === 1) {
      const dialogs = collect(tree, it => it.role === 'dialog' || it.role === 'alertdialog')
        .filter(d => !findItem(mains[0].kids, it => it === d));
      roots = [...dialogs, mains[0]];
      const inScope = new Set(flatten(roots, 0, [], origin).map(l => l.item));
      const left = {};
      for (const l of flatten(tree, 0, [], origin)) {
        if (inScope.has(l.item) || l.item === mains[0]) continue;
        const k = l.item.landmark || (LANDMARKS.has(l.item.role) ? l.item.role : 'other');
        left[k] = (left[k] || 0) + 1;
      }
      const parts = Object.entries(left).filter(([k]) => k !== 'main').map(([k, v]) => `${k} ${v}`);
      if (parts.length) header.push(`# scoped to main; left out ${parts.join(', ')} lines (snap --all shows them)`);
    }
  }

  const lines = flatten(roots, 0, [], origin).map(l => l.text);
  const max = opts.max ?? 400;
  if (max > 0 && lines.length > max) {
    const more = lines.length - max;
    lines.length = max;
    lines.push(`# … ${more} more lines. snap <ref> shows one region, --max=0 shows all`);
  }
  return [...header, ...lines].join('\n');
}

/**
 * Find the best item for a role and a name (string: case-insensitive substring;
 * a /regex/ string works too). Returns the item or null.
 */
export function find(doc, ref, role, name) {
  const tree = build(doc, ref, {});
  let test = () => true;
  if (name) {
    const m = /^\/(.*)\/([a-z]*)$/.exec(name);
    if (m) { const re = new RegExp(m[1], m[2] || 'i'); test = (s) => re.test(s); }
    else { const n = name.toLowerCase(); test = (s) => s.toLowerCase().includes(n); }
  }
  const roleOk = (r) => !role || role === '*' || r === role;
  const hits = collect(tree, it => it.ref && roleOk(it.role) && test(it.name || it.text || ''));
  if (!hits.length) return null;
  // Prefer an exact name, then the shortest.
  const exact = name && hits.find(h => (h.name || '').toLowerCase() === name.toLowerCase());
  return exact || hits.sort((a, b) => (a.name || '').length - (b.name || '').length)[0];
}
