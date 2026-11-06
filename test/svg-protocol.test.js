'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSvg, svgSize, svgStats } = require('../src/core/svg');
const P = require('../src/core/protocol');

test('sanitizeSvg removes scripts, handlers, external links, images and foreign objects', () => {
  const dirty = `<?xml version="1.0"?><!DOCTYPE svg PUBLIC "x" "y"><svg viewBox="0 0 10 20"><script>alert(1)</script><script href="x"/>
  <g onclick="evil()" style="fill:red"><a xlink:href="javascript:alert(2)" target="_blank"><text>t</text></a><a href='#ok'>i</a>
  <image xlink:href="/etc/passwd" width="1"/><foreignObject><div>x</div></foreignObject><iframe src="x"></iframe></g></svg>`;
  const s = sanitizeSvg(dirty);
  for (const bad of ['<script', 'onclick', 'javascript:', '<image', 'foreignObject', 'iframe', 'style=', 'target=', '<?xml', 'DOCTYPE']) assert.ok(!s.includes(bad), bad);
  assert.ok(s.includes("href='#ok'"), 'fragment links kept');
  assert.ok(s.startsWith('<svg'));
});

test('svgSize and svgStats', () => {
  assert.deepEqual(svgSize('<svg width="1pt" viewBox="0.00 0.00 134.00 116.50">'), { width: 134, height: 116.5 });
  assert.equal(svgSize('<svg>'), null);
  assert.deepEqual(svgStats('<g class="node"></g><g class="node"></g><g class="edge"></g><g class="cluster"></g>'), { nodes: 2, edges: 1, clusters: 1 });
});

test('protocol: valid webview messages pass, everything else is dropped', () => {
  assert.deepEqual(P.validateWebviewMessage({ type: 'ready', extra: 1 }), { type: 'ready' });
  assert.deepEqual(P.validateWebviewMessage({ type: 'engine', engine: 'neato' }), { type: 'engine', engine: 'neato' });
  assert.equal(P.validateWebviewMessage({ type: 'engine', engine: 'osage; rm -rf' }), null);
  assert.deepEqual(P.validateWebviewMessage({ type: 'reveal', kind: 'node', name: 'a' }), { type: 'reveal', kind: 'node', name: 'a' });
  assert.equal(P.validateWebviewMessage({ type: 'reveal', kind: 'file', name: 'a' }), null);
  assert.equal(P.validateWebviewMessage({ type: 'reveal', kind: 'node', name: 5 }), null);
  assert.deepEqual(P.validateWebviewMessage({ type: 'revealLine', line: 3 }), { type: 'revealLine', line: 3 });
  assert.equal(P.validateWebviewMessage({ type: 'revealLine', line: -1 }), null);
  assert.equal(P.validateWebviewMessage({ type: 'revealLine', line: 1.5 }), null);
  assert.deepEqual(P.validateWebviewMessage({ type: 'block', index: 2 }), { type: 'block', index: 2 });
  assert.equal(P.validateWebviewMessage({ type: 'block', index: '2' }), null);
  assert.deepEqual(P.validateWebviewMessage({ type: 'exportSvg' }), { type: 'exportSvg', themed: false });
  assert.deepEqual(P.validateWebviewMessage({ type: 'exportPng', data: 'iVBORw0KGgo=' }), { type: 'exportPng', data: 'iVBORw0KGgo=' });
  assert.equal(P.validateWebviewMessage({ type: 'exportPng', data: '<svg>' }), null);
  assert.equal(P.validateWebviewMessage({ type: 'exportPng', data: 'A'.repeat(P.MAX_PNG_BASE64 + 4) }), null);
  for (const m of [null, 1, 'x', {}, { type: 'writeFile', path: '/etc/passwd' }, { type: 'error', message: 7 }]) assert.equal(P.validateWebviewMessage(m), null);
});

test('protocol: host messages and PNG bytes', () => {
  const r = P.renderMessage({ svg: '<svg/>', engine: 'auto', usedEngine: 'dot', ms: 12.6, stats: { nodes: 1 }, block: 0, fileName: 'a.dot' });
  assert.equal(r.type, 'render'); assert.equal(r.ms, 13); assert.equal(r.usedEngine, 'dot'); assert.deepEqual(r.problems, []);
  const p = P.problemMessage({ message: 'x', engine: 'dot' });
  assert.equal(p.type, 'problem'); assert.equal(p.kind, 'error'); assert.equal(p.block, -1);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]).toString('base64');
  assert.equal(P.pngBytes(png).length, 10);
  assert.equal(P.pngBytes(Buffer.from('GIF89a....').toString('base64')), null);
});
