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
  'Iframe', 'row', 'tabpanel', 'article', 'figure', 'video', 'audio', 'form', 'main', 'navigation',
  'search', 'complementary', 'banner', 'contentinfo']);
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
const CELLS = new Set(['cell', 'gridcell', 'columnheader', 'rowheader']);

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

  const seen = new Set();
  function walk(id, landmark) {
    const n = byId.get(id);
    if (!n || seen.has(id)) return [];   // aria-owns can list a node under two parents
    seen.add(id);
    const role = roleOf(n);
    const name = (n.name?.value ?? '').toString();
    const kidsOf = () => (n.childIds || []).flatMap(c => walk(c, LANDMARKS.has(role) ? role : landmark));

    if (n.ignored) return kidsOf();
    if (role === 'iframe') {
      const child = doc.children?.get(n.backendDOMNodeId);
      const sub = child ? build(child, ref, ctx) : [];
      return [{ role, name, ref: ref(doc, n.backendDOMNodeId), kids: sub, landmark, node: n, sid: doc.sid, href: child?.base }];
    }
    if (!INTERACTIVE.has(role) && doc.clickable?.has(n.backendDOMNodeId)) {
      // No ARIA role, but the page makes it clickable (cursor, onclick): autocomplete rows, div buttons.
      const kids = kidsOf();
      const text = kids.filter(k => k.role === 'text').map(k => k.name).join(' ');
      return [{ role: 'clickable', name: text, ref: ref(doc, n.backendDOMNodeId), kids: kids.filter(k => k.role !== 'text'),
        landmark, sid: doc.sid, node: n, hint: doc.hints?.get(n.backendDOMNodeId) }];
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

    item.hint = !name ? doc.hints?.get(n.backendDOMNodeId) : undefined;
    // Table cells stay even when empty, so a row's columns line up with its header.
    if (CELLS.has(role)) {
      const plain = kids.every(k => k.role === 'text');
      if (plain) return [{ role, name: '', text: name || kids.map(k => k.name).join(' '), kids: [], landmark, cell: true }];
    }
    if (role === 'row' && kids.length && kids.every(k => k.cell)) {
      item.text = kids.map(k => k.text || '·').join(' | ');
      item.kids = [];
      return [item];
    }
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
  else if (item.hint) s += ` (${clip(item.hint, 60)})`;
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
    if (origin && u.origin === new URL(origin).origin) return clip(u.pathname + u.search + u.hash, 300);
    return clip(u.href, 300);
  } catch { return clip(href, 300); }
}

const MAX_OPTIONS = 12;
function flatten(items, depth, out, origin, full = false) {
  for (const it of items) {
    out.push({ text: line(it, depth, origin), item: it });
    let kids = it.kids;
    // A select with 100 options buries the page: show the first ones and the selected.
    if (!full && kids.length > MAX_OPTIONS && kids.every(k => k.role === 'option')) {
      const shown = kids.filter((k, i) => i < MAX_OPTIONS - 2 || k.states?.includes('selected'));
      flatten(shown, depth + 1, out, origin, full);
      out.push({ text: `${'  '.repeat(Math.min(depth + 1, 14))}- … ${kids.length - shown.length} more options (snap ${it.ref || '<ref>'} lists them; select takes a label)`, item: {} });
      continue;
    }
    flatten(kids, depth + 1, out, origin, full);
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
      // Dialogs, and popups a script hangs at the end of <body> (autocomplete lists, menus),
      // sit outside main but are what the page is asking about.
      const POPUP = new Set(['dialog', 'alertdialog', 'listbox', 'menu', 'tooltip']);
      const outside = (d) => !findItem(mains[0].kids, it => it === d);
      const dialogs = collect(tree, it => (POPUP.has(it.role) || (it.role === 'clickable' && !it.landmark)) && it !== mains[0])
        .filter(outside)
        .filter((d, i, all) => !all.some(o => o !== d && findItem(o.kids, it => it === d)));
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

  const lines = flatten(roots, 0, [], origin, !!opts.rootRef).map(l => l.text);
  const max = opts.max ?? 400;
  if (max > 0 && lines.length > max) {
    const more = lines.length - max;
    lines.length = max;
    lines.push(`# … ${more} more lines. snap <ref> shows one region, --max=0 shows all`);
  }
  return [...header, ...lines].join('\n');
}

/**
 * Items matching a role and a name (string: case-insensitive substring; a /regex/
 * string works too), exact names first, then page order. `within` limits it to a ref's subtree.
 */
export function find(doc, ref, role, name, within) {
  let tree = build(doc, ref, {});
  if (within) {
    const scope = findItem(tree, it => it.ref === within);
    if (!scope) throw new Error(`${within} is not on the page any more; run snap again`);
    tree = [scope];
  }
  let test = () => true;
  if (name) {
    const m = /^\/(.*)\/([a-z]*)$/.exec(name);
    if (m) { const re = new RegExp(m[1], m[2] || 'i'); test = (s) => re.test(s); }
    else { const n = name.toLowerCase(); test = (s) => s.toLowerCase().includes(n); }
  }
  const roleOk = (r) => !role || role === '*' || r === role;
  const hits = collect(tree, it => it.ref && roleOk(it.role) && test(it.name || it.text || ''));
  // Exact names first, then page order.
  const exact = (h) => (name && (h.name || '').toLowerCase() === name.toLowerCase() ? 0 : 1);
  return hits.map((h, i) => [h, i]).sort((a, b) => exact(a[0]) - exact(b[0]) || a[1] - b[1]).map(([h]) => h);
}
