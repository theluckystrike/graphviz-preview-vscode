'use strict';
// Cleans Graphviz SVG before it reaches a webview or the Markdown preview. Graphviz escapes label text,
// but a graph can still carry URL/href attributes (javascript: links) and image references. The webview
// CSP blocks scripts anyway; this removes the risky parts so the SVG is inert everywhere it goes.

function sanitizeSvg(svg) {
  let s = String(svg || '');
  s = s.replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/<script\b[^>]*\/>/gi, '');
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '');
  s = s.replace(/<image\b[^>]*\/>/gi, '').replace(/<image\b[\s\S]*?<\/image\s*>/gi, '');
  s = s.replace(/<(iframe|embed|object|audio|video|style)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<(iframe|embed|object|audio|video|style)\b[^>]*\/?>/gi, '');
  // event handlers and style attributes
  s = s.replace(/\s(on[a-z]+|style)\s*=\s*("[^"]*"|'[^']*')/gi, '');
  // links: keep only in-document fragments
  s = s.replace(/\s((?:xlink:)?href)\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, attr, q, a, b) => {
    const v = (a !== undefined ? a : b) || '';
    return v.startsWith('#') ? m : '';
  });
  // target attributes on <a> are useless without links
  s = s.replace(/\s(target|xlink:show|xlink:actuate)\s*=\s*("[^"]*"|'[^']*')/gi, '');
  return s.trim();
}

/** Width and height in points from the root <svg>, or null. */
function svgSize(svg) {
  const m = /<svg\b[^>]*?\bviewBox="\s*([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)\s*"/.exec(String(svg || ''));
  if (!m) return null;
  return { width: Number(m[3]), height: Number(m[4]) };
}

/** Counts nodes and edges in Graphviz SVG output. */
function svgStats(svg) {
  const s = String(svg || '');
  return { nodes: (s.match(/class="node"/g) || []).length, edges: (s.match(/class="edge"/g) || []).length, clusters: (s.match(/class="cluster"/g) || []).length };
}

module.exports = { sanitizeSvg, svgSize, svgStats };
