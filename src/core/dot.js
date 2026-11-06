'use strict';
// Pure helpers for DOT text: a small tokenizer that finds where each node, edge and cluster is written
// (for click-to-jump), the fenced dot blocks in Markdown, and line numbers in Graphviz error messages.
// Nothing here throws on bad input; a broken file just gives fewer positions.

const KEYWORDS = new Set(['graph', 'digraph', 'subgraph', 'node', 'edge', 'strict']);

/** Splits DOT text into tokens with 0-based line and column. Comments are skipped. */
function tokenize(text) {
  const src = String(text || '');
  const out = [];
  let i = 0, line = 0, col = 0;
  const n = src.length;
  const adv = () => { if (src[i] === '\n') { line++; col = 0; } else col++; i++; };
  let lineStart = true;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { adv(); lineStart = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { adv(); continue; }
    // '#' at the start of a line is a preprocessor-style comment line
    if (c === '#' && lineStart) { while (i < n && src[i] !== '\n') adv(); continue; }
    lineStart = false;
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') adv(); continue; }
    if (c === '/' && src[i + 1] === '*') { adv(); adv(); while (i < n && !(src[i] === '*' && src[i + 1] === '/')) adv(); if (i < n) { adv(); adv(); } continue; }
    const tl = line, tc = col;
    if (c === '"') {
      adv();
      let s = '';
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && src[i + 1] === '"') { s += '"'; adv(); adv(); continue; }
        if (src[i] === '\\' && src[i + 1] === '\n') { adv(); adv(); continue; }
        if (src[i] === '\\' && src[i + 1] === '\r' && src[i + 2] === '\n') { adv(); adv(); adv(); continue; }
        s += src[i]; adv();
      }
      if (i < n) adv();
      // "a" + "b" concatenation
      out.push({ t: 'id', v: s, line: tl, col: tc, quoted: true });
      continue;
    }
    if (c === '<') {
      // HTML-like label: balanced < >
      let depth = 0, s = '';
      while (i < n) { const d = src[i]; if (d === '<') depth++; else if (d === '>') depth--; s += d; adv(); if (depth === 0) break; }
      out.push({ t: 'id', v: s.slice(1, -1), line: tl, col: tc, html: true });
      continue;
    }
    if (c === '-' && (src[i + 1] === '>' || src[i + 1] === '-')) { const v = '-' + src[i + 1]; adv(); adv(); out.push({ t: 'op', v, line: tl, col: tc }); continue; }
    if ('{}[];=,:+'.includes(c)) { adv(); out.push({ t: 'p', v: c, line: tl, col: tc }); continue; }
    if (/[A-Za-z_\u0080-￿]/.test(c)) {
      let s = '';
      while (i < n && /[A-Za-z0-9_\u0080-￿]/.test(src[i])) { s += src[i]; adv(); }
      out.push({ t: 'id', v: s, line: tl, col: tc, word: true });
      continue;
    }
    if (/[0-9.]/.test(c) || (c === '-' && /[0-9.]/.test(src[i + 1] || ''))) {
      let s = c; adv();
      while (i < n && /[0-9.]/.test(src[i])) { s += src[i]; adv(); }
      out.push({ t: 'id', v: s, line: tl, col: tc });
      continue;
    }
    adv(); // unknown character: skip
  }
  // join "a" + "b"
  const joined = [];
  for (let k = 0; k < out.length; k++) {
    const tk = out[k];
    if (tk.t === 'p' && tk.v === '+' && joined.length && joined[joined.length - 1].quoted && out[k + 1] && out[k + 1].quoted) {
      joined[joined.length - 1] = { ...joined[joined.length - 1], v: joined[joined.length - 1].v + out[k + 1].v }; k++; continue;
    }
    joined.push(tk);
  }
  return joined;
}

const isKw = tk => tk && tk.t === 'id' && tk.word && KEYWORDS.has(tk.v.toLowerCase());
const isP = (tk, v) => tk && tk.t === 'p' && tk.v === v;

/**
 * Finds where nodes, edges and clusters are written.
 * Returns { nodes: Map(name -> {line, col}), edges: Map('a->b' | 'a--b' -> {line, col}), clusters: Map(name -> {line, col}) }.
 * A node's position is its first node statement (`a [..]` or `a;`), else its first use in an edge.
 */
function indexDot(text) {
  const tks = tokenize(text);
  const nodes = new Map(), firstUse = new Map(), edges = new Map(), clusters = new Map();
  let bracket = 0;
  const pos = tk => ({ line: tk.line, col: tk.col });
  // read a node id with an optional :port[:compass]; returns index after it
  const nodeRef = k => { let j = k + 1; while (isP(tks[j], ':') && tks[j + 1] && tks[j + 1].t === 'id') j += 2; return j; };
  for (let k = 0; k < tks.length; k++) {
    const tk = tks[k];
    if (isP(tk, '[')) { bracket++; continue; }
    if (isP(tk, ']')) { bracket = Math.max(0, bracket - 1); continue; }
    if (bracket > 0) continue;
    if (tk.t !== 'id') continue;
    if (isKw(tk)) {
      const kw = tk.v.toLowerCase();
      // graph name after graph/digraph, subgraph name after subgraph
      if ((kw === 'graph' || kw === 'digraph' || kw === 'subgraph') && tks[k + 1] && tks[k + 1].t === 'id' && !isKw(tks[k + 1])) {
        if (kw === 'subgraph' && !clusters.has(tks[k + 1].v)) clusters.set(tks[k + 1].v, pos(tk));
        k++;
      }
      continue;
    }
    if (isP(tks[k + 1], '=')) { k += 2; continue; } // attr = value
    // a node reference, maybe the start of an edge chain
    const after = nodeRef(k);
    const chain = [{ tk, end: after }];
    let j = after;
    while (tks[j] && tks[j].t === 'op') {
      const op = tks[j];
      const next = tks[j + 1];
      if (!next) break;
      if (isP(next, '{')) { chain.push({ op, sub: true }); break; } // edge to a subgraph: stop here
      if (next.t !== 'id' || isKw(next)) break;
      const e = nodeRef(j + 1);
      chain.push({ op, tk: next, end: e });
      j = e;
    }
    const names = chain.filter(c => c.tk).map(c => c.tk);
    for (const nt of names) if (!firstUse.has(nt.v)) firstUse.set(nt.v, pos(nt));
    if (names.length === 1 && chain.length === 1) {
      if (!nodes.has(tk.v)) nodes.set(tk.v, pos(tk));
    } else {
      for (let c = 1; c < chain.length; c++) {
        if (!chain[c].tk || !chain[c - 1].tk) continue;
        const key = chain[c - 1].tk.v + (chain[c].op.v === '->' ? '->' : '--') + chain[c].tk.v;
        if (!edges.has(key)) edges.set(key, pos(chain[c - 1].tk));
      }
    }
    k = j - 1;
  }
  for (const [name, p] of firstUse) if (!nodes.has(name)) nodes.set(name, p);
  return { nodes, edges, clusters };
}

/** Looks up the source position of a clicked SVG element (kind: node | edge | cluster). */
function locate(index, kind, name) {
  if (!index || typeof name !== 'string') return null;
  if (kind === 'node') return index.nodes.get(name) || null;
  if (kind === 'cluster') return index.clusters.get(name) || null;
  if (kind === 'edge') {
    if (index.edges.has(name)) return index.edges.get(name);
    // Graphviz edge titles may carry ports (a:p->b:q); try without them, then fall back to the tail node
    const m = /^(.*?)(->|--)(.*)$/.exec(name);
    if (!m) return null;
    const strip = s => s.replace(/:[^:]*$/, '');
    const key = [m[1], strip(m[1])].flatMap(a => [m[3], strip(m[3])].map(b => a + m[2] + b)).find(k => index.edges.has(k));
    if (key) return index.edges.get(key);
    return index.nodes.get(m[1]) || index.nodes.get(strip(m[1])) || null;
  }
  return null;
}

const FENCE_LANGS = new Set(['dot', 'graphviz', 'gv']);

/**
 * Finds fenced dot blocks in Markdown: ```dot, ```graphviz or ```gv (also ~~~).
 * Returns [{ index, lang, fenceLine, startLine, endLine, source }] with 0-based lines; startLine is the first content line.
 */
function findFencedBlocks(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const blocks = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!open) {
      const m = /^( {0,3})(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)(.*)$/.exec(l);
      if (m) {
        if (m[2][0] === '`' && m[4].includes('`')) continue; // not a fence
        open = { indent: m[1].length, fence: m[2], lang: m[3].toLowerCase(), fenceLine: i, body: [] };
      }
      continue;
    }
    const close = new RegExp('^ {0,3}' + (open.fence[0] === '`' ? '`' : '~') + '{' + open.fence.length + ',}\\s*$');
    if (close.test(l)) {
      if (FENCE_LANGS.has(open.lang)) blocks.push(mk(open, i));
      open = null;
      continue;
    }
    open.body.push(open.indent ? l.replace(new RegExp('^ {0,' + open.indent + '}'), '') : l);
  }
  if (open && FENCE_LANGS.has(open.lang)) blocks.push(mk(open, lines.length));
  return blocks.map((b, k) => ({ index: k, ...b }));
  function mk(o, end) { return { lang: o.lang, fenceLine: o.fenceLine, startLine: o.fenceLine + 1, endLine: end, source: o.body.join('\n') }; }
}

/** Index of the block that holds a 0-based line, or -1. */
function blockAtLine(blocks, line) {
  for (const b of blocks) if (line >= b.fenceLine && line <= b.endLine) return b.index;
  return -1;
}

/**
 * Turns Graphviz messages into problems with a 0-based line (or -1 when the message names no line).
 * errors: [{ level: 'error' | 'warning', message }]
 */
function parseProblems(errors, sourceText) {
  const lineCount = String(sourceText || '').split('\n').length;
  const out = [];
  for (const e of Array.isArray(errors) ? errors : []) {
    if (!e || typeof e.message !== 'string') continue;
    const message = e.message.trim().replace(/^(Error|Warning):\s*/i, '');
    if (!message) continue;
    const m = /\bline (\d+)\b/i.exec(message);
    let line = m ? Number(m[1]) - 1 : -1;
    if (line >= lineCount) line = lineCount - 1;
    const near = /near '([^']*)'/.exec(message);
    // the line goes in its own field, so drop "in line N" from the text
    const text = m ? message.replace(/\s+in line \d+/i, '') : message;
    out.push({ severity: e.level === 'warning' ? 'warning' : 'error', message: text, line, near: near ? near[1] : null });
  }
  return out;
}

/** Reads a `layout=...` graph attribute (top level only), or null. */
function layoutAttr(text) {
  const tks = tokenize(text);
  let brace = 0, bracket = 0;
  for (let k = 0; k < tks.length; k++) {
    const t = tks[k];
    if (isP(t, '{')) brace++; else if (isP(t, '}')) brace--; else if (isP(t, '[')) bracket++; else if (isP(t, ']')) bracket--;
    else if (t.t === 'id' && t.v === 'layout' && isP(tks[k + 1], '=') && tks[k + 2] && brace === 1) {
      // graph [layout=x] has bracket 1 after 'graph'; a bare layout=x has bracket 0
      if (bracket === 0 || (bracket === 1 && isGraphAttr(tks, k))) return String(tks[k + 2].v).toLowerCase();
    }
  }
  return null;
}
function isGraphAttr(tks, k) {
  for (let j = k - 1; j >= 0; j--) { if (isP(tks[j], '[')) return tks[j - 1] && tks[j - 1].t === 'id' && tks[j - 1].v.toLowerCase() === 'graph'; }
  return false;
}

module.exports = { tokenize, indexDot, locate, findFencedBlocks, blockAtLine, parseProblems, layoutAttr, FENCE_LANGS };
