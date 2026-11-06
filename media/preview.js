// Graphviz Preview webview. Shows the SVG from the extension host, with pan, zoom, node search,
// click-to-source and export. All graph content comes in as SVG text that the host already cleaned;
// it is parsed with DOMParser (no HTML string injection) and cleaned again here.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const viewport = $('viewport'), stage = $('stage'), empty = $('empty'), problemBox = $('problem');
  const engineSel = $('engine'), blockSel = $('block'), search = $('search'), hits = $('hits'), status = $('status'), zoomLabel = $('zoomLabel');

  let view = { x: 0, y: 0, k: 1 };
  let svgEl = null, rawSvg = '', size = null, firstRender = true, lastKey = '';
  let matches = [], matchAt = -1, selected = null;

  // ---------- rendering ----------
  const BAD_TAGS = ['script', 'foreignObject', 'image', 'iframe', 'embed', 'object', 'style', 'audio', 'video'];
  function cleanNode(root) {
    for (const t of BAD_TAGS) root.querySelectorAll(t).forEach(n => n.remove());
    root.querySelectorAll('*').forEach(el => {
      for (const a of Array.from(el.attributes)) {
        const n = a.name.toLowerCase();
        if (n.startsWith('on') || n === 'style') el.removeAttribute(a.name);
        else if ((n === 'href' || n === 'xlink:href') && !a.value.startsWith('#')) el.removeAttribute(a.name);
      }
    });
  }

  function showSvg(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('The SVG from Graphviz could not be read.');
    cleanNode(root);
    const node = document.importNode(root, true);
    const vb = node.viewBox && node.viewBox.baseVal;
    size = vb && vb.width ? { w: vb.width, h: vb.height } : { w: 400, h: 300 };
    // draw at 1 CSS px per point; zoom is a transform on the stage
    node.setAttribute('width', String(size.w));
    node.setAttribute('height', String(size.h));
    stage.replaceChildren(node);
    svgEl = node;
    rawSvg = text;
    empty.classList.add('hidden');
    applySelection();
    runSearch(false);
  }

  function apply() {
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    zoomLabel.textContent = Math.round(view.k * 100) + '%';
    vscode.setState({ ...vscode.getState(), view });
  }
  function fit() {
    if (!size) return;
    const r = viewport.getBoundingClientRect();
    const k = Math.min((r.width - 24) / size.w, (r.height - 24) / size.h, 2);
    view.k = Math.max(0.02, k);
    view.x = (r.width - size.w * view.k) / 2;
    view.y = Math.max(12, (r.height - size.h * view.k) / 2);
    view.fitted = true;
    apply();
  }
  function actual() {
    if (!size) return;
    const r = viewport.getBoundingClientRect();
    view.k = 1; view.fitted = false; view.x = Math.max(12, (r.width - size.w) / 2); view.y = 12; apply();
  }
  function zoomAt(factor, cx, cy) {
    const r = viewport.getBoundingClientRect();
    if (cx === undefined) { cx = r.width / 2; cy = r.height / 2; }
    view.fitted = false;
    const k = Math.min(16, Math.max(0.02, view.k * factor));
    const f = k / view.k;
    view.x = cx - (cx - view.x) * f; view.y = cy - (cy - view.y) * f; view.k = k;
    apply();
  }
  function centerOn(el) {
    if (!el || !svgEl) return;
    const r = viewport.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const cx = b.left + b.width / 2 - r.left, cy = b.top + b.height / 2 - r.top;
    view.x += r.width / 2 - cx; view.y += r.height / 2 - cy; apply();
  }

  // ---------- problems ----------
  function showProblems(list, message, kind) {
    problemBox.replaceChildren();
    const items = (list || []).filter(p => p.severity === 'error').concat((list || []).filter(p => p.severity !== 'error'));
    if (!items.length && !message) { problemBox.classList.add('hidden'); return; }
    problemBox.className = kind === 'warning-only' ? 'warn' : '';
    if (message) { const d = document.createElement('div'); d.textContent = message; problemBox.appendChild(d); }
    for (const p of items.slice(0, 8)) {
      const row = document.createElement(p.line >= 0 ? 'button' : 'div');
      row.className = 'problem ' + p.severity;
      row.textContent = (p.line >= 0 ? `Line ${p.displayLine}: ` : '') + p.message;
      if (p.line >= 0) { row.title = 'Go to line ' + p.displayLine; row.addEventListener('click', () => vscode.postMessage({ type: 'revealLine', line: p.line })); }
      problemBox.appendChild(row);
    }
    if (items.length > 8) { const more = document.createElement('div'); more.textContent = `${items.length - 8} more in the Problems panel.`; problemBox.appendChild(more); }
  }

  // ---------- blocks (Markdown) ----------
  function showBlocks(blocks, current) {
    if (!blocks) { blockSel.classList.add('hidden'); return; }
    blockSel.classList.remove('hidden');
    const key = blocks.map(b => b.label).join('|');
    if (blockSel.dataset.key !== key) {
      blockSel.replaceChildren(...blocks.map(b => { const o = document.createElement('option'); o.value = String(b.index); o.textContent = b.label; return o; }));
      blockSel.dataset.key = key;
    }
    if (current >= 0) blockSel.value = String(current);
  }

  // ---------- search ----------
  function titleOf(g) { const t = g.querySelector(':scope > title'); return t ? t.textContent : ''; }
  function runSearch(jump) {
    const q = search.value.trim().toLowerCase();
    if (svgEl) svgEl.querySelectorAll('.gv-match, .gv-current').forEach(n => n.classList.remove('gv-match', 'gv-current'));
    stage.classList.toggle('searching', !!q && !!svgEl);
    matches = [];
    if (q && svgEl) {
      matches = Array.from(svgEl.querySelectorAll('g.node')).filter(g => titleOf(g).toLowerCase().includes(q) || g.textContent.toLowerCase().includes(q));
      matches.forEach(g => g.classList.add('gv-match'));
    }
    if (!matches.length) matchAt = -1; else if (matchAt >= matches.length || matchAt < 0) matchAt = 0;
    hits.textContent = q ? (matches.length ? `${matchAt + 1} of ${matches.length}` : 'no match') : '';
    if (matches.length && matchAt >= 0) { matches[matchAt].classList.add('gv-current'); if (jump) centerOn(matches[matchAt]); }
  }
  function nextMatch(step) {
    if (!matches.length) return;
    matchAt = (matchAt + step + matches.length) % matches.length;
    runSearch(true);
  }

  // ---------- selection / click to source ----------
  function applySelection() {
    if (!svgEl || !selected) return;
    svgEl.querySelectorAll('.gv-selected').forEach(n => n.classList.remove('gv-selected'));
    const g = Array.from(svgEl.querySelectorAll('g.' + selected.kind)).find(n => titleOf(n) === selected.name);
    if (g) g.classList.add('gv-selected');
  }
  function hitTarget(target) {
    const g = target && target.closest && target.closest('g.node, g.edge, g.cluster');
    if (!g || !svgEl || !svgEl.contains(g)) return null;
    const kind = g.classList.contains('node') ? 'node' : g.classList.contains('edge') ? 'edge' : 'cluster';
    return { kind, name: titleOf(g) };
  }

  // ---------- pan ----------
  let drag = null;
  viewport.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, target: e.target };
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; viewport.classList.add('panning'); }
    if (drag.moved) { view.fitted = false; view.x = drag.vx + dx; view.y = drag.vy + dy; apply(); }
  });
  viewport.addEventListener('pointerup', e => {
    if (!drag) return;
    const d = drag; drag = null; viewport.classList.remove('panning');
    if (!d.moved) {
      const hit = hitTarget(d.target);
      if (hit) { selected = hit; applySelection(); vscode.postMessage({ type: 'reveal', kind: hit.kind, name: hit.name }); }
    }
  });
  viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    else { view.x -= e.deltaX; view.y -= e.deltaY; apply(); }
  }, { passive: false });
  viewport.addEventListener('keydown', e => {
    if (e.key === '+' || e.key === '=') zoomAt(1.25);
    else if (e.key === '-') zoomAt(0.8);
    else if (e.key === '0') fit();
    else if (e.key === '1') actual();
    else if (e.key === 'ArrowLeft') { view.x += 40; apply(); } else if (e.key === 'ArrowRight') { view.x -= 40; apply(); }
    else if (e.key === 'ArrowUp') { view.y += 40; apply(); } else if (e.key === 'ArrowDown') { view.y -= 40; apply(); }
    else return;
    e.preventDefault();
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); search.focus(); search.select(); }
  });

  $('zoomIn').addEventListener('click', () => zoomAt(1.25));
  $('zoomOut').addEventListener('click', () => zoomAt(0.8));
  $('fit').addEventListener('click', fit);
  $('actual').addEventListener('click', actual);
  engineSel.addEventListener('change', () => { firstRender = true; vscode.postMessage({ type: 'engine', engine: engineSel.value }); });
  blockSel.addEventListener('change', () => { firstRender = true; vscode.postMessage({ type: 'block', index: Number(blockSel.value) }); });
  search.addEventListener('input', () => { matchAt = 0; runSearch(true); });
  search.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); nextMatch(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { search.value = ''; runSearch(false); viewport.focus(); }
  });
  $('exportSvg').addEventListener('click', () => vscode.postMessage({ type: 'exportSvg' }));
  $('exportPng').addEventListener('click', () => exportPng().catch(err => vscode.postMessage({ type: 'error', message: 'PNG export failed: ' + String(err && err.message || err).slice(0, 300) })));

  // PNG: draw the original Graphviz SVG (its own colors, white background) at 2x on a canvas
  async function exportPng() {
    if (!rawSvg || !size) return;
    const scale = Math.min(2, Math.sqrt(64e6 / Math.max(1, size.w * size.h)));
    const w = Math.max(1, Math.round(size.w * scale)), h = Math.max(1, Math.round(size.h * scale));
    const doc = new DOMParser().parseFromString(rawSvg, 'image/svg+xml');
    cleanNode(doc.documentElement);
    doc.documentElement.setAttribute('width', String(w));
    doc.documentElement.setAttribute('height', String(h));
    const blob = new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('the SVG could not be drawn')); img.src = url; });
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const out = await new Promise(res => c.toBlob(res, 'image/png'));
      const bytes = new Uint8Array(await out.arrayBuffer());
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      vscode.postMessage({ type: 'exportPng', data: btoa(bin) });
    } finally { URL.revokeObjectURL(url); }
  }

  window.addEventListener('resize', () => { if (view.fitted) fit(); });

  window.addEventListener('message', e => {
    const m = e.data;
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'render') {
      if (m.engine && engineSel.value !== m.engine) engineSel.value = m.engine;
      showBlocks(m.blocks, m.block);
      try { showSvg(m.svg); } catch (err) { showProblems([], String(err.message)); return; }
      const key = m.fileName + '|' + m.block + '|' + m.engine;
      if (firstRender || key !== lastKey) {
        firstRender = false;
        const st = vscode.getState();
        if (st && st.view && st.key === key && !lastKey) { view = st.view; apply(); } else fit();
      }
      lastKey = key; vscode.setState({ ...vscode.getState(), key });
      showProblems(m.problems, '', 'warning-only');
      const s = m.stats;
      status.textContent = (s ? `${s.nodes} nodes · ${s.edges} edges · ` : '') + `${m.usedEngine} · ${m.ms} ms` + (m.layoutAttr && m.engine !== 'auto' && m.layoutAttr !== m.engine ? ` · file sets layout=${m.layoutAttr}` : '');
      document.body.classList.remove('stale');
      document.body.dataset.rendered = String(Number(document.body.dataset.rendered || 0) + 1);
    } else if (m.type === 'problem') {
      if (m.engine && engineSel.value !== m.engine) engineSel.value = m.engine;
      showBlocks(m.blocks, m.block);
      showProblems(m.problems, m.message);
      if (svgEl) document.body.classList.add('stale'); else { empty.textContent = m.message || 'Fix the error above to see the graph.'; empty.classList.remove('hidden'); }
      status.textContent = '';
      document.body.dataset.problem = String(Number(document.body.dataset.problem || 0) + 1);
    } else if (m.type === 'busy') {
      status.textContent = 'Rendering…';
    } else if (m.type === 'theme') {
      document.body.dataset.theme = m.theme;
    } else if (m.type === 'select') {
      selected = { kind: 'node', name: String(m.name) }; applySelection();
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
