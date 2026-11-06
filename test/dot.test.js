'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, indexDot, locate, findFencedBlocks, blockAtLine, parseProblems, layoutAttr } = require('../src/core/dot');

test('tokenize: strings, comments, html labels, ports and lines', () => {
  const t = tokenize('digraph G { // c\n /* x\n y */ "a b" -> c:p:n [label=<<b>x</b>>]\n# pre\n d }');
  const ids = t.filter(x => x.t === 'id').map(x => [x.v, x.line]);
  assert.deepEqual(ids, [['digraph', 0], ['G', 0], ['a b', 2], ['c', 2], ['p', 2], ['n', 2], ['label', 2], ['<b>x</b>', 2], ['d', 4]]);
  assert.equal(tokenize('"x\\"y"')[0].v, 'x"y');
  assert.equal(tokenize('"ab" + "cd"')[0].v, 'abcd');
  assert.equal(tokenize('"a\\\nb"')[0].v, 'ab');
});

test('indexDot: node statements win over first use; edges, chains and clusters', () => {
  const src = [
    'digraph G {',          // 0
    '  rankdir=LR;',        // 1
    '  a -> b -> c;',       // 2
    '  subgraph cluster_x {', // 3
    '    b [shape=box];',   // 4
    '  }',                  // 5
    '  "long name" -- d:port;', // 6
    '  node [shape=circle];', // 7
    '  e;',                 // 8
    '}'];
  const ix = indexDot(src.join('\n'));
  assert.equal(ix.nodes.get('a').line, 2);
  assert.equal(ix.nodes.get('b').line, 4, 'node statement wins');
  assert.equal(ix.nodes.get('c').line, 2);
  assert.equal(ix.nodes.get('e').line, 8);
  assert.equal(ix.nodes.get('long name').line, 6);
  assert.equal(ix.nodes.get('d').line, 6);
  assert.ok(!ix.nodes.has('rankdir') && !ix.nodes.has('LR') && !ix.nodes.has('shape') && !ix.nodes.has('G') && !ix.nodes.has('cluster_x'));
  assert.equal(ix.edges.get('a->b').line, 2);
  assert.equal(ix.edges.get('b->c').line, 2);
  assert.equal(ix.clusters.get('cluster_x').line, 3);
  assert.equal(locate(ix, 'node', 'b').col, 4);
  assert.equal(locate(ix, 'edge', 'b->c').line, 2);
  assert.equal(locate(ix, 'edge', 'long name--d:port').line, 6, 'port stripped');
  assert.equal(locate(ix, 'edge', 'a->zzz').line, 2, 'falls back to the tail node');
  assert.equal(locate(ix, 'cluster', 'cluster_x').line, 3);
  assert.equal(locate(ix, 'node', 'nope'), null);
  assert.equal(locate(null, 'node', 'a'), null);
});

test('indexDot: edge to a subgraph and attribute lists do not leak names', () => {
  const ix = indexDot('graph { a -- { b c } ; x [label="y", color=red]; y=3 }');
  assert.ok(ix.nodes.has('a') && ix.nodes.has('b') && ix.nodes.has('c') && ix.nodes.has('x'));
  assert.ok(!ix.nodes.has('label') && !ix.nodes.has('red') && !ix.nodes.has('y'));
});

test('indexDot: never throws on broken or hostile input', () => {
  for (const s of ['', '{{{{', 'digraph { a -> ', '"unterminated', '<<<', '/* open', 'a -> -> b', '\u0000￿', 'x'.repeat(100000)]) assert.doesNotThrow(() => indexDot(s));
});

test('findFencedBlocks: dot, graphviz and gv fences with lines; other fences ignored', () => {
  const md = ['# T', '```dot', 'digraph { a -> b }', '```', 'text', '~~~graphviz', 'graph { x -- y }', '', '~~~', '```js', 'x', '```', '  ```gv', '  digraph { z }', '  ```', '````dot', '```', 'inner', '````'].join('\n');
  const b = findFencedBlocks(md);
  assert.equal(b.length, 4);
  assert.deepEqual(b.map(x => [x.lang, x.fenceLine, x.startLine]), [['dot', 1, 2], ['graphviz', 5, 6], ['gv', 12, 13], ['dot', 15, 16]]);
  assert.equal(b[0].source, 'digraph { a -> b }');
  assert.equal(b[1].source, 'graph { x -- y }\n');
  assert.equal(b[2].source, 'digraph { z }', 'indent removed');
  assert.equal(b[3].source, '```\ninner', 'longer fence holds a shorter one');
  assert.equal(blockAtLine(b, 2), 0);
  assert.equal(blockAtLine(b, 4), -1);
  assert.equal(blockAtLine(b, 7), 1);
  assert.equal(findFencedBlocks('```dot\nopen block').length, 1, 'unclosed block runs to the end');
});

test('parseProblems: line numbers, levels, clamping, junk', () => {
  const p = parseProblems([{ level: 'error', message: "syntax error in line 3 near ';'" }, { level: 'warning', message: 'Warning: using box for unknown shape foo' }, null, { message: 5 }, { level: 'error', message: '  ' }], 'a\nb\nc\nd');
  assert.deepEqual(p, [
    { severity: 'error', message: "syntax error near ';'", line: 2, near: ';' },
    { severity: 'warning', message: 'using box for unknown shape foo', line: -1, near: null },
  ]);
  assert.equal(parseProblems([{ level: 'error', message: 'syntax error in line 99 near x' }], 'one\ntwo')[0].line, 1);
  assert.deepEqual(parseProblems('nope', ''), []);
});

test('layoutAttr: top-level layout only', () => {
  assert.equal(layoutAttr('digraph { layout=neato; a }'), 'neato');
  assert.equal(layoutAttr('digraph { graph [layout="circo"]; a }'), 'circo');
  assert.equal(layoutAttr('digraph { a [layout=fdp] }'), null);
  assert.equal(layoutAttr('digraph { subgraph { layout=twopi } }'), null);
  assert.equal(layoutAttr('digraph { a }'), null);
});
