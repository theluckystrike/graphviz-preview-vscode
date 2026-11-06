'use strict';
// Runs Graphviz (viz.js, wasm) in a worker thread so a slow layout never blocks the extension host.
// The host terminates this worker when a layout runs past the time limit.
const { parentPort } = require('worker_threads');
const { instance } = require('@viz-js/viz');

const vizReady = instance();
parentPort.on('message', async m => {
  if (!m || typeof m.src !== 'string') return;
  let viz;
  try { viz = await vizReady; } catch (e) { parentPort.postMessage({ id: m.id, status: 'failure', errors: [{ level: 'error', message: 'Graphviz could not start: ' + (e && e.message) }] }); return; }
  const t0 = Date.now();
  try {
    const opts = { format: 'svg' };
    if (m.engine && m.engine !== 'auto') opts.engine = m.engine;
    const r = viz.render(m.src, opts);
    parentPort.postMessage({ id: m.id, status: r.status, output: r.status === 'success' ? r.output : undefined, errors: r.errors || [], ms: Date.now() - t0 });
  } catch (e) {
    parentPort.postMessage({ id: m.id, status: 'failure', errors: [{ level: 'error', message: String((e && e.message) || e) }], ms: Date.now() - t0 });
  }
});
