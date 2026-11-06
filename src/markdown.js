'use strict';
// Draws ```dot / ```graphviz / ```gv fences in VS Code's built-in Markdown preview.
// markdown-it renders synchronously, but layouts run in the worker: a block that is not in the cache
// shows a placeholder, is laid out in the background, and the preview refreshes once the queue is done.
const crypto = require('crypto');
const path = require('path');
const { Renderer } = require('./render/renderer');
const { sanitizeSvg } = require('./core/svg');
const { parseProblems, FENCE_LANGS } = require('./core/dot');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAX_CACHE = 200;

function createMarkdownPlugin(opts = {}) {
  const cache = new Map(); // hash -> { html }
  const queue = []; const queued = new Set();
  let renderer = null, running = false, disposed = false;
  const workerPath = opts.workerPath || path.join(__dirname, 'worker.js');
  const enabled = opts.enabled || (() => true);
  const maxKB = opts.maxKB || (() => 256);

  const put = (k, v) => { cache.set(k, v); if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value); };

  async function drain() {
    if (running || disposed) return;
    running = true;
    let did = 0;
    try {
      while (queue.length && !disposed) {
        const job = queue.shift();
        if (!renderer) renderer = new Renderer({ workerPath, timeoutMs: opts.timeoutMs || 15000 });
        const r = await renderer.render(job.src, 'auto');
        queued.delete(job.key);
        if (r.status === 'superseded') continue;
        put(job.key, { html: toHtml(r, job.src) });
        did++;
      }
    } finally { running = false; }
    if (did && !disposed && opts.onReady) opts.onReady();
  }

  function toHtml(r, src) {
    if (r.status === 'success') return `<div class="graphviz-preview-block">${sanitizeSvg(r.output)}</div>`;
    if (r.status === 'timeout') return `<div class="graphviz-preview-error">Graphviz layout took too long and was stopped.</div>`;
    const probs = parseProblems(r.errors, src).filter(p => p.severity === 'error');
    const text = probs.length ? probs.map(p => (p.line >= 0 ? `Line ${p.line + 1} of the block: ` : '') + p.message).join('\n') : 'Graphviz could not lay out this graph.';
    return `<div class="graphviz-preview-error">${esc(text)}</div>`;
  }

  /** Returns HTML for a fence body, or null when the cache has nothing yet (and queues the layout). */
  function htmlFor(src) {
    if (Buffer.byteLength(src, 'utf8') > maxKB() * 1024) return `<div class="graphviz-preview-error">This graph is larger than ${maxKB()} KB (setting graphvizPreview.markdownMaxBlockKB), so it is not drawn here. Open it with "Graphviz: Open Preview to the Side".</div>`;
    const key = crypto.createHash('sha1').update(src).digest('hex');
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit.html; }
    if (!queued.has(key)) { queued.add(key); queue.push({ key, src }); setImmediate(drain); }
    return null;
  }

  function extend(md) {
    const prev = md.renderer.rules.fence || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const tok = tokens[idx];
      const lang = String(tok.info || '').trim().split(/\s+/)[0].toLowerCase();
      if (!FENCE_LANGS.has(lang) || !enabled()) return prev(tokens, idx, options, env, self);
      const html = htmlFor(tok.content);
      const line = tok.map ? ` data-line="${tok.map[0]}"` : '';
      return `<div class="graphviz-preview code-line"${line}>${html || '<div class="graphviz-preview-wait">Rendering graph…</div>'}</div>`;
    };
    return md;
  }

  return {
    extend, htmlFor, drain, cacheSize: () => cache.size,
    dispose() { disposed = true; if (renderer) renderer.dispose(); },
  };
}

module.exports = { createMarkdownPlugin };
