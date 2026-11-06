'use strict';
const vscode = require('vscode');
const path = require('path');
const { buildHtml } = require('./html');
const { Renderer } = require('./render/renderer');
const { indexDot, locate, findFencedBlocks, blockAtLine, parseProblems, layoutAttr } = require('./core/dot');
const { sanitizeSvg, svgStats } = require('./core/svg');
const { validateWebviewMessage, renderMessage, problemMessage, pngBytes, ENGINES } = require('./core/protocol');
const { createMarkdownPlugin } = require('./markdown');
const { createRatingPrompt } = require('./rate');
const { registerSupport, commandUris, showLinks } = require('./support');

const SECTION = 'graphvizPreview';
const VIEW_TYPE = 'graphvizPreview.preview';
let rating = { success() {} };

function settings() {
  const c = vscode.workspace.getConfiguration(SECTION);
  const engine = c.get('defaultEngine', 'auto');
  return {
    engine: ENGINES.includes(engine) ? engine : 'auto',
    delay: Math.max(0, Math.min(5000, Number(c.get('updateDelayMs', 300)) || 0)),
    timeoutMs: Math.max(1, Math.min(300, Number(c.get('renderTimeoutSeconds', 15)) || 15)) * 1000,
    maxKB: Math.max(1, Number(c.get('maxSourceKB', 4096)) || 4096),
    theme: c.get('theme', 'auto'),
  };
}

function isDotDoc(doc) {
  if (!doc) return false;
  if (doc.languageId === 'dot') return true;
  return /\.(dot|gv)$/i.test(doc.uri.path);
}
function isMarkdownDoc(doc) { return !!doc && (doc.languageId === 'markdown' || /\.(md|markdown)$/i.test(doc.uri.path)); }

class Preview {
  constructor(manager, doc, panel) {
    this.manager = manager; this.uri = doc.uri; this.key = doc.uri.toString(); this.panel = panel;
    this.engine = settings().engine; this.block = 0; this.timer = null; this.lastSvg = ''; this.index = null; this.lineOffset = 0;
    this.counted = false; this.ready = false; this.version = -1; this.disposed = false;
    this.fileName = path.basename(doc.uri.path);
    const wv = panel.webview;
    const media = vscode.Uri.joinPath(manager.context.extensionUri, 'media');
    // Command links are limited to the two support commands and the settings page (footer "Hide" link).
    wv.options = { enableScripts: true, localResourceRoots: [media], enableCommandUris: commandUris('graphvizPreview') };
    wv.html = buildHtml({
      cspSource: wv.cspSource, scriptUri: wv.asWebviewUri(vscode.Uri.joinPath(media, 'preview.js')).toString(),
      styleUri: wv.asWebviewUri(vscode.Uri.joinPath(media, 'preview.css')).toString(), title: this.fileName, engine: this.engine, theme: settings().theme,
      showSupportLinks: showLinks(vscode, SECTION),
    });
    panel.iconPath = vscode.Uri.joinPath(manager.context.extensionUri, 'media', 'preview-icon.svg');
    this.subs = [
      wv.onDidReceiveMessage(m => this.onMessage(m)),
      panel.onDidDispose(() => this.dispose()),
      panel.onDidChangeViewState(e => { if (e.webviewPanel.visible && this.pending) { this.pending = false; this.schedule(0); } }),
    ];
  }

  doc() { return vscode.workspace.textDocuments.find(d => d.uri.toString() === this.key); }

  schedule(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.update().catch(err => this.post(problemMessage({ message: 'Preview failed: ' + (err && err.message), engine: this.engine, fileName: this.fileName }))), delay);
  }

  post(m) { if (!this.disposed) this.panel.webview.postMessage(m).then(undefined, () => {}); }

  /** The DOT text to lay out, plus Markdown block info. */
  source(doc) {
    const text = doc.getText();
    if (isMarkdownDoc(doc) && !isDotDoc(doc)) {
      const blocks = findFencedBlocks(text);
      if (!blocks.length) return { empty: 'This Markdown file has no ```dot or ```graphviz block yet.', blocks: [] };
      if (this.block >= blocks.length) this.block = blocks.length - 1;
      const b = blocks[Math.max(0, this.block)];
      return { text: b.source, offset: b.startLine, blocks: blocks.map(x => ({ index: x.index, label: `Block ${x.index + 1} (line ${x.fenceLine + 1})` })), block: b.index };
    }
    return { text, offset: 0, blocks: null, block: -1 };
  }

  async update() {
    if (this.disposed || !this.ready) return;
    if (!this.panel.visible) { this.pending = true; return; }
    const doc = this.doc();
    if (!doc) return;
    const st = settings();
    const src = this.source(doc);
    if (src.empty) { this.manager.setProblems(doc.uri, [], 0); this.post(problemMessage({ message: src.empty, engine: this.engine, fileName: this.fileName, kind: 'empty' })); return; }
    const bytes = Buffer.byteLength(src.text, 'utf8');
    if (bytes > st.maxKB * 1024) {
      this.post(problemMessage({ message: `This graph is ${(bytes / 1024).toFixed(0)} KB. The preview limit is ${st.maxKB} KB (setting graphvizPreview.maxSourceKB).`, engine: this.engine, blocks: src.blocks, block: src.block, fileName: this.fileName }));
      return;
    }
    this.post({ type: 'busy' });
    const version = doc.version;
    const renderer = this.manager.renderer(st.timeoutMs);
    const r = await renderer.render(src.text, this.engine);
    if (this.disposed || r.status === 'superseded') return;
    const problems = parseProblems(r.errors, src.text).map(p => ({ ...p, line: p.line >= 0 ? p.line + src.offset : -1, displayLine: p.line >= 0 ? p.line + src.offset + 1 : 0 }));
    this.manager.setProblems(doc.uri, problems, src.offset);
    const common = { engine: this.engine, blocks: src.blocks, block: src.block, fileName: this.fileName };
    if (r.status === 'timeout') {
      this.post(problemMessage({ ...common, message: `Layout stopped after ${Math.round(st.timeoutMs / 1000)} s. Try the sfdp engine for big graphs, or raise graphvizPreview.renderTimeoutSeconds.` }));
      return;
    }
    if (r.status !== 'success') {
      this.post(problemMessage({ ...common, problems, message: problems.length ? '' : 'Graphviz could not lay out this graph.' }));
      return;
    }
    this.lastSvg = sanitizeSvg(r.output);
    this.index = indexDot(src.text); this.lineOffset = src.offset; this.version = version;
    const la = layoutAttr(src.text);
    this.post(renderMessage({ ...common, svg: this.lastSvg, usedEngine: this.engine === 'auto' ? (la || 'dot') : (la || this.engine), ms: r.ms, problems, stats: svgStats(this.lastSvg), layoutAttr: la }));
    if (!this.counted) { this.counted = true; rating.success(); }
  }

  async onMessage(raw) {
    const m = validateWebviewMessage(raw);
    if (!m) return;
    switch (m.type) {
      case 'ready': this.ready = true; this.schedule(0); break;
      case 'engine': this.engine = m.engine; this.schedule(0); break;
      case 'block': this.block = m.index; this.schedule(0); break;
      case 'reveal': {
        const p = locate(this.index, m.kind, m.name);
        if (p) await this.reveal(p.line + this.lineOffset, p.col);
        else vscode.window.setStatusBarMessage(`Graphviz Preview: could not find "${m.name.slice(0, 60)}" in the source.`, 4000);
        break;
      }
      case 'revealLine': await this.reveal(m.line, 0); break;
      case 'exportSvg': await this.exportSvg(); break;
      case 'exportPng': await this.exportPng(m.data); break;
      case 'error': vscode.window.showErrorMessage(m.message); break;
    }
  }

  async reveal(line, col) {
    const doc = this.doc() || await vscode.workspace.openTextDocument(this.uri);
    const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === this.key);
    const pos = new vscode.Position(Math.min(line, doc.lineCount - 1), col || 0);
    const ed = await vscode.window.showTextDocument(doc, { viewColumn: editor ? editor.viewColumn : vscode.ViewColumn.One, preserveFocus: false, selection: new vscode.Range(pos, pos) });
    ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  exportBase() {
    const base = this.fileName.replace(/\.[^.]+$/, '') + (this.block > 0 ? `-${this.block + 1}` : '');
    const dir = this.uri.scheme === 'file' ? vscode.Uri.file(path.dirname(this.uri.fsPath)) : undefined;
    return { base, dir };
  }

  async exportSvg() {
    if (!this.lastSvg) { vscode.window.showWarningMessage('There is no rendered graph to save yet.'); return; }
    const { base, dir } = this.exportBase();
    const target = await vscode.window.showSaveDialog({ defaultUri: dir ? vscode.Uri.joinPath(dir, base + '.svg') : undefined, filters: { SVG: ['svg'] }, saveLabel: 'Save SVG' });
    if (!target) return;
    if (target.toString() === this.key) { vscode.window.showErrorMessage('Choose a different file; this would overwrite the graph source.'); return; }
    const text = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + this.lastSvg + '\n';
    await vscode.workspace.fs.writeFile(target, Buffer.from(text, 'utf8'));
    vscode.window.setStatusBarMessage(`Saved ${path.basename(target.path)}`, 4000);
  }

  async exportPng(data) {
    const bytes = pngBytes(data);
    if (!bytes) { vscode.window.showErrorMessage('PNG export failed: the image data was not a PNG.'); return; }
    const { base, dir } = this.exportBase();
    const target = await vscode.window.showSaveDialog({ defaultUri: dir ? vscode.Uri.joinPath(dir, base + '.png') : undefined, filters: { PNG: ['png'] }, saveLabel: 'Save PNG' });
    if (!target) return;
    if (target.toString() === this.key) { vscode.window.showErrorMessage('Choose a different file; this would overwrite the graph source.'); return; }
    await vscode.workspace.fs.writeFile(target, bytes);
    vscode.window.setStatusBarMessage(`Saved ${path.basename(target.path)}`, 4000);
  }

  onSelection(editor) {
    if (!isMarkdownDoc(editor.document) || isDotDoc(editor.document)) return;
    const blocks = findFencedBlocks(editor.document.getText());
    const b = blockAtLine(blocks, editor.selection.active.line);
    if (b >= 0 && b !== this.block) { this.block = b; this.schedule(0); }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; clearTimeout(this.timer);
    this.subs.forEach(s => s.dispose());
    this.manager.previews.delete(this.key);
    this.manager.diagnostics.delete(this.uri);
  }
}

class Manager {
  constructor(context) {
    this.context = context; this.previews = new Map(); this._renderer = null;
    this.diagnostics = vscode.languages.createDiagnosticCollection('graphviz');
  }
  renderer(timeoutMs) {
    if (!this._renderer || this._renderer.timeoutMs !== timeoutMs) {
      if (this._renderer) this._renderer.dispose();
      this._renderer = new Renderer({ workerPath: path.join(__dirname, 'worker.js'), timeoutMs });
    }
    return this._renderer;
  }
  setProblems(uri, problems) {
    this.diagnostics.set(uri, problems.map(p => {
      const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
      const line = Math.max(0, p.line);
      let range = new vscode.Range(line, 0, line, 0);
      if (doc && line < doc.lineCount) {
        const text = doc.lineAt(line).text;
        const at = p.near ? text.indexOf(p.near) : -1;
        range = at >= 0 && p.near ? new vscode.Range(line, at, line, at + p.near.length) : new vscode.Range(line, text.length - text.trimStart().length, line, text.length);
      }
      const d = new vscode.Diagnostic(range, p.message, p.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
      d.source = 'Graphviz';
      return d;
    }));
  }
  open(uri, column) {
    return Promise.resolve(vscode.workspace.openTextDocument(uri)).then(doc => {
      const existing = this.previews.get(doc.uri.toString());
      if (existing) { existing.panel.reveal(column, true); return existing; }
      const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Preview ' + path.basename(doc.uri.path), { viewColumn: column, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: false, enableFindWidget: false, enableCommandUris: commandUris('graphvizPreview') });
      const p = new Preview(this, doc, panel);
      this.previews.set(p.key, p);
      const ed = vscode.window.activeTextEditor;
      if (ed && ed.document.uri.toString() === p.key) p.onSelection(ed);
      return p;
    });
  }
  dispose() { for (const p of [...this.previews.values()]) p.panel.dispose(); if (this._renderer) this._renderer.dispose(); this.diagnostics.dispose(); }
}

function targetUri(arg) {
  if (arg instanceof vscode.Uri) return arg;
  const ed = vscode.window.activeTextEditor;
  return ed ? ed.document.uri : null;
}

function activate(context) {
  const manager = new Manager(context);
  context.subscriptions.push({ dispose: () => manager.dispose() });
  registerSupport({ vscode, context, prefix: SECTION, selfId: 'zovo.graphviz-preview' });
  rating = createRatingPrompt({ vscode, context, extensionId: 'zovo.graphviz-preview', section: SECTION,
    message: n => `Graphviz Preview has rendered ${n} graphs for you. A rating helps other people find it.` });

  const openCmd = side => async arg => {
    const uri = targetUri(arg);
    if (!uri) { vscode.window.showInformationMessage('Open a .dot, .gv or Markdown file first.'); return; }
    await manager.open(uri, side ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active);
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('graphvizPreview.showPreviewToSide', openCmd(true)),
    vscode.commands.registerCommand('graphvizPreview.showPreview', openCmd(false)),
    vscode.commands.registerCommand('graphvizPreview.openWalkthrough', () => vscode.commands.executeCommand('workbench.action.openWalkthrough', 'zovo.graphviz-preview#graphvizPreview.start', false)),
    vscode.workspace.onDidChangeTextDocument(e => {
      const p = manager.previews.get(e.document.uri.toString());
      if (p && e.contentChanges.length) p.schedule(settings().delay);
    }),
    vscode.workspace.onDidSaveTextDocument(doc => { const p = manager.previews.get(doc.uri.toString()); if (p) p.schedule(0); }),
    vscode.window.onDidChangeTextEditorSelection(e => { const p = manager.previews.get(e.textEditor.document.uri.toString()); if (p) p.onSelection(e.textEditor); }),
    vscode.workspace.onDidCloseTextDocument(doc => { if (!manager.previews.has(doc.uri.toString())) manager.diagnostics.delete(doc.uri); }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration(SECTION)) return;
      for (const p of manager.previews.values()) { p.post({ type: 'theme', theme: settings().theme }); p.schedule(0); }
    }),
  );

  const md = createMarkdownPlugin({ onReady: () => vscode.commands.executeCommand('markdown.preview.refresh').then(undefined, () => {}),
    enabled: () => vscode.workspace.getConfiguration(SECTION).get('markdownPreview', true) !== false,
    maxKB: () => Math.max(1, Number(vscode.workspace.getConfiguration(SECTION).get('markdownMaxBlockKB', 256)) || 256) });
  context.subscriptions.push({ dispose: () => md.dispose() });
  return { extendMarkdownIt: mdi => md.extend(mdi), _manager: manager };
}

function deactivate() {}

module.exports = { activate, deactivate };
