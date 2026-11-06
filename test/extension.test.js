'use strict';
// Runs the bundled extension against a small fake of the VS Code API: open a preview, get a render,
// click a node, see diagnostics for a broken file, switch Markdown blocks, export SVG.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

function makeVscode() {
  const ev = () => { const ls = []; const f = l => { ls.push(l); return { dispose() { ls.splice(ls.indexOf(l), 1); } }; }; f.fire = x => ls.forEach(l => l(x)); return f; };
  class Uri {
    constructor(scheme, p) { this.scheme = scheme; this.path = p; this.fsPath = p; }
    toString() { return `${this.scheme}://${this.path}`; }
    static file(p) { return new Uri('file', p); }
    static parse(s) { return new Uri('file', s.replace(/^file:\/\//, '')); }
    static joinPath(u, ...ps) { return new Uri(u.scheme, path.join(u.path, ...ps)); }
  }
  class Position { constructor(l, c) { this.line = l; this.character = c; } }
  class Range { constructor(a, b, c, d) { if (a instanceof Position) { this.start = a; this.end = b; } else { this.start = new Position(a, b); this.end = new Position(c, d); } } }
  class Diagnostic { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } }
  const docs = [];
  const diag = new Map();
  const panels = [];
  const shown = [];
  const writes = [];
  const commands = new Map();
  const onChange = ev(), onSave = ev(), onSel = ev(), onClose = ev(), onCfg = ev();
  const vscode = {
    Uri, Position, Range, Diagnostic,
    DiagnosticSeverity: { Error: 0, Warning: 1 }, ViewColumn: { Active: -1, Beside: -2, One: 1 }, TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
    env: { sessionId: 's', remoteName: undefined, openExternal: async () => true },
    commands: { registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; }, executeCommand: async () => {} },
    languages: { createDiagnosticCollection: () => ({ set: (u, d) => diag.set(u.toString(), d), delete: u => diag.delete(u.toString()), dispose() {} }) },
    workspace: {
      textDocuments: docs,
      getConfiguration: () => ({ get: (k, d) => (k === 'updateDelayMs' ? 0 : d) }),
      openTextDocument: async u => docs.find(d => d.uri.toString() === u.toString()),
      onDidChangeTextDocument: onChange, onDidSaveTextDocument: onSave, onDidCloseTextDocument: onClose, onDidChangeConfiguration: onCfg,
      fs: { writeFile: async (u, b) => { writes.push([u.toString(), Buffer.from(b).toString('utf8')]); } },
      isTrusted: true,
    },
    window: {
      activeTextEditor: undefined, visibleTextEditors: [], state: { focused: true },
      onDidChangeTextEditorSelection: onSel,
      setStatusBarMessage: () => ({ dispose() {} }),
      showInformationMessage: async () => undefined, showErrorMessage: async m => { shown.push(['error', m]); }, showWarningMessage: async m => { shown.push(['warn', m]); },
      showSaveDialog: async o => Uri.file(o.defaultUri.path.replace(/\.(svg|png)$/, '-out.$1')),
      showTextDocument: async (doc, o) => { shown.push(['show', doc.uri.path, o.selection.start.line, o.selection.start.character]); return { revealRange() {} }; },
      createWebviewPanel: (viewType, title) => {
        const recv = ev(), dispose = ev(), state = ev();
        const posted = [];
        const panel = {
          viewType, title, visible: true, posted, iconPath: null,
          webview: { cspSource: 'vscode-webview://x', options: {}, html: '', asWebviewUri: u => u, postMessage: async m => { posted.push(m); return true; }, onDidReceiveMessage: recv },
          onDidDispose: dispose, onDidChangeViewState: state, reveal() {}, dispose() { dispose.fire(); },
          send: m => recv.fire(m),
        };
        panels.push(panel);
        return panel;
      },
    },
  };
  const addDoc = (p, text, languageId) => {
    const d = { uri: Uri.file(p), languageId, version: 1, text, getText() { return this.text; }, get lineCount() { return this.text.split('\n').length; }, lineAt(i) { return { text: this.text.split('\n')[i] }; } };
    docs.push(d); return d;
  };
  return { vscode, docs, diag, panels, shown, writes, commands, addDoc, onChange, onSel };
}

const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 20)); } throw new Error('timed out'); };

test('extension host: preview, click to line, diagnostics, Markdown blocks, export', async t => {
  const f = makeVscode();
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'vscode' ? f.vscode : orig.call(this, req, ...rest); };
  t.after(() => { Module._load = orig; });
  const ext = require('../dist/extension.js');
  const context = { subscriptions: [], extensionUri: f.vscode.Uri.file(path.join(__dirname, '..')), globalState: { get() {}, update: async () => {} } };
  const api = ext.activate(context);
  t.after(() => context.subscriptions.forEach(s => s.dispose()));
  for (const c of ['graphvizPreview.showPreviewToSide', 'graphvizPreview.showPreview', 'graphvizPreview.openWalkthrough']) assert.ok(f.commands.has(c), c);
  assert.equal(typeof api.extendMarkdownIt, 'function');

  // 1. a .dot file renders after the webview says ready
  const doc = f.addDoc('/w/arch.dot', 'digraph {\n  a -> b;\n  b [shape=box];\n}', 'dot');
  await f.commands.get('graphvizPreview.showPreviewToSide')(doc.uri);
  const panel = f.panels[0];
  assert.match(panel.webview.html, /Content-Security-Policy/);
  panel.send({ type: 'ready' });
  const r1 = await until(() => panel.posted.find(m => m.type === 'render'));
  assert.match(r1.svg, /<svg/);
  assert.equal(r1.stats.nodes, 2);
  assert.equal(r1.usedEngine, 'dot');

  // 2. clicking node b jumps to its node statement (line 2, col 2); bad messages are ignored
  panel.send({ type: 'reveal', kind: 'node', name: 'b' });
  panel.send({ type: 'writeFile', path: '/etc/x' });
  await until(() => f.shown.find(s => s[0] === 'show'));
  assert.deepEqual(f.shown.find(s => s[0] === 'show'), ['show', '/w/arch.dot', 2, 2]);

  // 3. typing an error: diagnostic on the right line, preview gets a problem message
  doc.text = 'digraph {\n  a -> b;\n  b -> ;\n}'; doc.version = 2;
  f.onChange.fire({ document: doc, contentChanges: [{}] });
  const prob = await until(() => panel.posted.find(m => m.type === 'problem'));
  assert.equal(prob.problems[0].line, 2);
  const d = f.diag.get(doc.uri.toString());
  assert.equal(d.length, 1); assert.equal(d[0].range.start.line, 2); assert.equal(d[0].source, 'Graphviz');
  assert.equal(d[0].range.start.character, doc.text.split('\n')[2].indexOf(';'));

  // 4. fixing it clears the diagnostic; engine switch re-renders
  doc.text = 'digraph {\n  a -> b;\n}'; doc.version = 3;
  f.onChange.fire({ document: doc, contentChanges: [{}] });
  await until(() => panel.posted.filter(m => m.type === 'render').length >= 2);
  assert.equal(f.diag.get(doc.uri.toString()).length, 0);
  panel.send({ type: 'engine', engine: 'neato' });
  const r3 = await until(() => panel.posted.filter(m => m.type === 'render')[2]);
  assert.equal(r3.engine, 'neato');

  // 5. export SVG writes next to the file with an XML header
  panel.send({ type: 'exportSvg' });
  await until(() => f.writes.length);
  assert.equal(f.writes[0][0], 'file:///w/arch-out.svg');
  assert.match(f.writes[0][1], /^<\?xml[\s\S]*<svg/);

  // 6. Markdown: two blocks, the cursor picks block 2; a click maps back to the Markdown line
  const md = f.addDoc('/w/notes.md', '# N\n\n```dot\ndigraph { x -> y }\n```\n\ntext\n\n```graphviz\ndigraph {\n  p -> q;\n}\n```\n', 'markdown');
  await f.commands.get('graphvizPreview.showPreviewToSide')(md.uri);
  const mp = f.panels[1];
  mp.send({ type: 'ready' });
  const m1 = await until(() => mp.posted.find(m => m.type === 'render'));
  assert.equal(m1.blocks.length, 2); assert.equal(m1.block, 0);
  assert.match(m1.svg, /<title>x<\/title>/);
  f.onSel.fire({ textEditor: { document: md, selection: { active: { line: 10 } } } });
  const m2 = await until(() => mp.posted.filter(m => m.type === 'render')[1]);
  assert.equal(m2.block, 1);
  f.shown.length = 0;
  mp.send({ type: 'reveal', kind: 'node', name: 'q' });
  await until(() => f.shown.find(s => s[0] === 'show'));
  assert.deepEqual(f.shown.find(s => s[0] === 'show'), ['show', '/w/notes.md', 10, 7]);

  // 7. Markdown with no dot block says so
  const plain = f.addDoc('/w/plain.md', '# nothing here', 'markdown');
  await f.commands.get('graphvizPreview.showPreviewToSide')(plain.uri);
  f.panels[2].send({ type: 'ready' });
  const e = await until(() => f.panels[2].posted.find(m => m.type === 'problem'));
  assert.equal(e.kind, 'empty');

  // 8. closing the panel drops its diagnostics
  panel.dispose();
  assert.equal(f.diag.has(doc.uri.toString()), false);
});

// ---------- support links (Sponsor, More free viewers) ----------
test('support: package.json has the sponsor field, the two commands and the setting', () => {
  const pkg = require('../package.json');
  const support = require('../src/support');
  assert.equal(pkg.sponsor.url, 'https://github.com/sponsors/theluckystrike');
  assert.equal(pkg.sponsor.url, support.sponsorUrl());
  const ids = pkg.contributes.commands.map(c => c.command);
  assert.ok(ids.includes('graphvizPreview.supportDeveloper') && ids.includes('graphvizPreview.moreViewers'));
  const props = Object.assign({}, ...[].concat(pkg.contributes.configuration).map(c => c.properties));
  assert.equal(props['graphvizPreview.showSupportLinks'].default, true);
  assert.ok(support.otherProducts('zovo.graphviz-preview').every(x => x.id !== 'zovo.graphviz-preview'));
});

test('support: the preview footer shows by default and graphvizPreview.showSupportLinks=false hides it', async t => {
  for (const [value, shown] of [[undefined, true], [false, false]]) {
    const f = makeVscode();
    f.vscode.workspace.getConfiguration = () => ({ get: (k, d) => (k === 'showSupportLinks' && value !== undefined ? value : k === 'updateDelayMs' ? 0 : d) });
    const orig = Module._load;
    Module._load = function (req, ...rest) { return req === 'vscode' ? f.vscode : orig.call(this, req, ...rest); };
    const p = require.resolve('../dist/extension.js');
    delete require.cache[p];
    let ext;
    try { ext = require(p); } finally { Module._load = orig; }
    const context = { subscriptions: [], extensionUri: f.vscode.Uri.file(path.join(__dirname, '..')), globalState: { get() {}, update: async () => {} } };
    ext.activate(context);
    assert.ok(f.commands.has('graphvizPreview.supportDeveloper') && f.commands.has('graphvizPreview.moreViewers'));
    const doc = f.addDoc('/w/s.dot', 'digraph { a -> b }', 'dot');
    await f.commands.get('graphvizPreview.showPreview')(doc.uri);
    const html = f.panels[0].webview.html;
    assert.equal(/id="zovo-support"/.test(html), shown, String(value));
    assert.equal(html.includes('command:graphvizPreview.moreViewers'), shown);
    assert.deepEqual(f.panels[0].webview.options.enableCommandUris, ['graphvizPreview.supportDeveloper', 'graphvizPreview.moreViewers', 'workbench.action.openSettings']);
    context.subscriptions.forEach(s => s.dispose());
  }
});
