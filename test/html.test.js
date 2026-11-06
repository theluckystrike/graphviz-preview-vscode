'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildHtml, csp } = require('../src/html');
const root = path.join(__dirname, '..');

test('webview CSP: no remote sources, nonce script only, no inline styles', () => {
  const html = buildHtml({ cspSource: 'vscode-webview://abc', scriptUri: 's.js', styleUri: 's.css', title: '<img src=x onerror=alert(1)>.dot', engine: 'neato', nonce: 'N0NCE' });
  const policy = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1].replace(/&#39;/g, "'");
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /script-src 'nonce-N0NCE'/);
  assert.match(policy, /connect-src 'none'/);
  assert.ok(!/https?:|unsafe-inline|unsafe-eval|\*/.test(policy), policy);
  assert.ok(!html.includes('<img src=x'), 'title escaped');
  assert.match(html, /<option value="neato" selected>/);
  assert.equal((html.match(/<script/g) || []).length, 1);
  assert.match(csp('x', 'y'), /form-action 'none'/);
});

test('webview script: no innerHTML, eval or network APIs', () => {
  const js = fs.readFileSync(path.join(root, 'media/preview.js'), 'utf8');
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'eval(', 'new Function', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'document.write']) assert.ok(!js.includes(bad), bad);
  assert.match(js, /DOMParser/);
});

test('extension code makes no network calls and has no telemetry', () => {
  const files = ['src/extension.js', 'src/markdown.js', 'src/render/renderer.js', 'src/render/worker.js', 'src/core/dot.js', 'src/core/svg.js', 'src/core/protocol.js'];
  for (const f of files) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    for (const bad of ["require('http')", "require('https')", "require('net')", 'fetch(', 'telemetry', 'XMLHttpRequest']) assert.ok(!s.includes(bad), `${f}: ${bad}`);
  }
});

test('manifest: id, engine, keywords, languages and Markdown plugin', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(`${pkg.publisher}.${pkg.name}`, 'zovo.graphviz-preview');
  assert.equal(pkg.version, '0.1.0');
  assert.equal(pkg.engines.vscode, '^1.90.0');
  assert.ok(pkg.displayName.startsWith('Graphviz Preview') && pkg.displayName.length <= 45);
  assert.equal(pkg.keywords.length, 30);
  assert.equal(new Set(pkg.keywords).size, 30);
  assert.deepEqual(pkg.contributes.languages[0].extensions, ['.dot', '.gv']);
  assert.equal(pkg.contributes['markdown.markdownItPlugins'], true);
  for (const f of ['icon.png', 'media/preview.js', 'media/preview.css', 'media/markdown.css', 'syntaxes/dot.tmLanguage.json']) assert.ok(fs.existsSync(path.join(root, f)), f);
  const cmds = pkg.contributes.commands.map(c => c.command);
  const src = fs.readFileSync(path.join(root, 'src/extension.js'), 'utf8');
  for (const c of cmds) assert.ok(src.includes(`'${c}'`), c);
});
