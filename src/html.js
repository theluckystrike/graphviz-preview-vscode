'use strict';
// Builds the preview webview page. Strict CSP: no remote sources, one nonce script, no inline styles.
const crypto = require('crypto');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function csp(cspSource, nonce) {
  return [
    "default-src 'none'",
    `img-src ${cspSource} blob: data:`,
    `style-src ${cspSource}`,
    `font-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/** opts: { cspSource, scriptUri, styleUri, title, engine, theme } */
function buildHtml(opts) {
  const nonce = opts.nonce || crypto.randomBytes(16).toString('base64');
  const engines = ['auto', 'dot', 'neato', 'fdp', 'sfdp', 'circo', 'twopi'];
  const options = engines.map(e => `<option value="${e}"${e === opts.engine ? ' selected' : ''}>${e === 'auto' ? 'auto (file or dot)' : e}</option>`).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${esc(csp(opts.cspSource, nonce))}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${esc(opts.styleUri)}">
<title>${esc(opts.title || 'Graphviz Preview')}</title>
</head>
<body data-theme="${esc(opts.theme || 'auto')}">
<div id="app">
  <div id="toolbar" role="toolbar" aria-label="Graphviz preview">
    <label class="grp" title="Layout engine. A layout= attribute in the file wins over this choice.">Engine
      <select id="engine" aria-label="Layout engine">${options}</select></label>
    <select id="block" class="hidden" aria-label="Dot block in this Markdown file"></select>
    <span class="grp search"><input id="search" type="search" placeholder="Find node" aria-label="Find node" spellcheck="false"><span id="hits" aria-live="polite"></span></span>
    <span class="grp">
      <button id="zoomOut" title="Zoom out (-)" aria-label="Zoom out">−</button>
      <span id="zoomLabel" title="Zoom">100%</span>
      <button id="zoomIn" title="Zoom in (+)" aria-label="Zoom in">+</button>
      <button id="fit" title="Fit to window (0)">Fit</button>
      <button id="actual" title="Actual size (1)">1:1</button>
    </span>
    <span class="grp">
      <button id="exportSvg" title="Save as SVG">SVG</button>
      <button id="exportPng" title="Save as PNG (2x)">PNG</button>
    </span>
    <span id="status" aria-live="polite"></span>
  </div>
  <div id="problem" class="hidden" role="alert"></div>
  <div id="viewport" tabindex="0" aria-label="Graph. Drag to pan, Ctrl or Cmd + wheel to zoom, click a node to go to its line.">
    <div id="stage"></div>
    <div id="empty">Rendering…</div>
  </div>
</div>
<script nonce="${nonce}" src="${esc(opts.scriptUri)}"></script>
</body>
</html>`;
}

module.exports = { buildHtml, csp, esc };
