'use strict';
// Message protocol between the preview webview and the extension host. Every webview message is checked
// here before the host acts on it; anything unknown or malformed is dropped.

const ENGINES = ['auto', 'dot', 'neato', 'fdp', 'sfdp', 'circo', 'twopi'];
const KINDS = ['node', 'edge', 'cluster'];
const MAX_PNG_BASE64 = 64 * 1024 * 1024; // about 48 MB of PNG

const isStr = (v, max) => typeof v === 'string' && v.length <= max;

/** Returns a clean copy of a webview message, or null to drop it. */
function validateWebviewMessage(m) {
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return null;
  switch (m.type) {
    case 'ready': return { type: 'ready' };
    case 'engine': return ENGINES.includes(m.engine) ? { type: 'engine', engine: m.engine } : null;
    case 'block': return Number.isInteger(m.index) && m.index >= 0 && m.index < 10000 ? { type: 'block', index: m.index } : null;
    case 'reveal':
      if (!KINDS.includes(m.kind) || !isStr(m.name, 10000)) return null;
      return { type: 'reveal', kind: m.kind, name: m.name };
    case 'revealLine': return Number.isInteger(m.line) && m.line >= 0 && m.line < 10000000 ? { type: 'revealLine', line: m.line } : null;
    case 'exportSvg': return { type: 'exportSvg', themed: m.themed === true };
    case 'exportPng':
      if (!isStr(m.data, MAX_PNG_BASE64) || !/^[A-Za-z0-9+/]+={0,2}$/.test(m.data.slice(0, 64) + (m.data.length > 64 ? m.data.slice(-4) : ''))) return null;
      return { type: 'exportPng', data: m.data };
    case 'copySvg': return { type: 'copySvg' };
    case 'error': return isStr(m.message, 2000) ? { type: 'error', message: m.message } : null;
    default: return null;
  }
}

/** The 'render' message for a successful layout. */
function renderMessage({ svg, engine, usedEngine, ms, problems, stats, blocks, block, fileName, layoutAttr }) {
  return {
    type: 'render', svg: String(svg), engine, usedEngine: usedEngine || engine, ms: Math.round(ms || 0),
    problems: problems || [], stats: stats || null, blocks: blocks || null, block: block ?? -1, fileName: fileName || '', layoutAttr: layoutAttr || null,
  };
}

/** The 'problem' message: layout failed; the webview keeps the last good drawing. */
function problemMessage({ problems, message, engine, blocks, block, fileName, kind }) {
  return { type: 'problem', kind: kind || 'error', message: String(message || ''), problems: problems || [], engine, blocks: blocks || null, block: block ?? -1, fileName: fileName || '' };
}

/** PNG base64 (from the webview) to bytes; checks the PNG signature. */
function pngBytes(base64) {
  const buf = Buffer.from(base64, 'base64');
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 8 || sig.some((b, i) => buf[i] !== b)) return null;
  return buf;
}

module.exports = { ENGINES, KINDS, validateWebviewMessage, renderMessage, problemMessage, pngBytes, MAX_PNG_BASE64 };
