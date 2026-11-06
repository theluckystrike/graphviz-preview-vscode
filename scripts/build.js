'use strict';
// Bundles the extension host and the render worker with esbuild. viz.js (with its wasm inlined) is
// copied once to dist/viz.cjs and shared by both bundles, so it ships one time.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const prod = process.argv.includes('--production');
const shareViz = { name: 'share-viz', setup(b) { b.onResolve({ filter: /^@viz-js\/viz$/ }, () => ({ path: './viz.cjs', external: true })); } };
const common = { bundle: true, minify: prod, sourcemap: !prod, legalComments: 'none', logLevel: 'warning', absWorkingDir: root, platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'], plugins: [shareViz] };
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/@viz-js/viz/dist/viz.cjs'), path.join(root, 'dist/viz.cjs'));
Promise.all([
  esbuild.build({ ...common, entryPoints: ['src/extension.js'], outfile: 'dist/extension.js' }),
  esbuild.build({ ...common, entryPoints: ['src/render/worker.js'], outfile: 'dist/worker.js' }),
]).catch(() => process.exit(1));
