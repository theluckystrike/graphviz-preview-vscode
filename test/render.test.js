'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { Renderer } = require('../src/render/renderer');
const { createMarkdownPlugin } = require('../src/markdown');
const { sanitizeSvg } = require('../src/core/svg');

const DIST_WORKER = path.join(__dirname, '..', 'dist', 'worker.js');
const SRC_WORKER = path.join(__dirname, '..', 'src', 'render', 'worker.js');

function bigGraph(n) { let s = 'digraph { '; for (let i = 0; i < n; i++) s += `n${i} -> n${(i * 7919 + 13) % n}; n${i} -> n${(i * 31 + 7) % n}; `; return s + '}'; }

for (const [label, workerPath] of [['bundled dist worker', DIST_WORKER], ['source worker', SRC_WORKER]]) {
  test(`renderer (${label}): success, syntax error with line, engines`, async t => {
    const r = new Renderer({ workerPath, timeoutMs: 20000 });
    t.after(() => r.dispose());
    const ok = await r.render('digraph { a -> b; b [label="<x>&"] }');
    assert.equal(ok.status, 'success');
    assert.match(ok.output, /<svg/);
    assert.match(ok.output, /&lt;x&gt;&amp;/, 'label text escaped by Graphviz');
    const bad = await r.render('digraph {\n a -> b;\n b -> ;\n}');
    assert.equal(bad.status, 'failure');
    assert.match(bad.errors[0].message, /line 3/);
    for (const e of ['dot', 'neato', 'fdp', 'sfdp', 'circo', 'twopi']) assert.equal((await r.render('graph { a -- b -- c -- a }', e)).status, 'success', e);
  });
}

test('renderer: a newer request replaces a waiting one', async t => {
  const r = new Renderer({ workerPath: DIST_WORKER, timeoutMs: 20000 });
  t.after(() => r.dispose());
  const first = r.render(bigGraph(60));
  const second = r.render('digraph { x }');
  const third = r.render('digraph { y }');
  assert.equal((await first).status, 'success');
  assert.equal((await second).status, 'superseded');
  assert.match((await third).output, /<title>y<\/title>/);
});

test('renderer: a slow layout is stopped at the time limit and the next one still works', async t => {
  const r = new Renderer({ workerPath: DIST_WORKER, timeoutMs: 150 });
  t.after(() => r.dispose());
  const t0 = Date.now();
  const slow = await r.render(bigGraph(3000), 'dot');
  assert.equal(slow.status, 'timeout');
  assert.ok(Date.now() - t0 < 5000);
  r.timeoutMs = 20000;
  assert.equal((await r.render('digraph { a -> b }')).status, 'success');
});

test('hostile graph: Graphviz output is cleaned of links and images', async t => {
  const r = new Renderer({ workerPath: DIST_WORKER, timeoutMs: 20000 });
  t.after(() => r.dispose());
  const out = await r.render('digraph { a [label="<script>alert(1)</script>", URL="javascript:alert(2)"]; b [href="https://example.com"]; c [image="/etc/passwd"]; a -> b -> c }');
  assert.equal(out.status, 'success');
  assert.match(out.output, /javascript:alert/);
  const s = sanitizeSvg(out.output);
  assert.ok(!/javascript:|https:\/\/example|<script|<image/.test(s));
  assert.match(s, /&lt;script&gt;/, 'label stays as escaped text');
});

test('markdown plugin: dot fences render after the queue drains; other fences untouched; errors shown', async t => {
  let refreshed = 0;
  const plugin = createMarkdownPlugin({ workerPath: DIST_WORKER, onReady: () => { refreshed++; } });
  t.after(() => plugin.dispose());
  const md = { renderer: { rules: { fence: (tokens, idx) => `<pre>${tokens[idx].content}</pre>` } } };
  plugin.extend(md);
  const tok = (info, content) => [{ info, content, map: [4, 8] }];
  const first = md.renderer.rules.fence(tok('dot', 'digraph { a -> b }'), 0, {}, {}, {});
  assert.match(first, /Rendering graph/);
  assert.match(first, /data-line="4"/);
  md.renderer.rules.fence(tok('graphviz', 'digraph { a -> }'), 0, {}, {}, {});
  await new Promise(r => setTimeout(r, 50));
  await plugin.drain();
  for (let i = 0; i < 100 && refreshed === 0; i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(refreshed >= 1);
  const again = md.renderer.rules.fence(tok('dot', 'digraph { a -> b }'), 0, {}, {}, {});
  assert.match(again, /<svg/);
  assert.match(md.renderer.rules.fence(tok('graphviz', 'digraph { a -> }'), 0, {}, {}, {}), /graphviz-preview-error">Line 1 of the block: syntax error/);
  assert.equal(md.renderer.rules.fence(tok('js', 'x'), 0, {}, {}, {}), '<pre>x</pre>');
  const big = createMarkdownPlugin({ workerPath: DIST_WORKER, maxKB: () => 1 });
  t.after(() => big.dispose());
  assert.match(big.htmlFor('digraph {' + 'a; '.repeat(1000) + '}'), /larger than 1 KB/);
});
