'use strict';
// Host side of the render worker. One layout runs at a time per renderer; a newer request replaces a
// waiting one (typing fast only lays out the latest text). A layout past the time limit kills the worker,
// and the next request starts a fresh one.
const { Worker } = require('worker_threads');
const path = require('path');

class Renderer {
  /** opts: { workerPath, timeoutMs } */
  constructor(opts = {}) {
    this.workerPath = path.resolve(opts.workerPath || path.join(__dirname, 'worker.js'));
    this.timeoutMs = opts.timeoutMs || 10000;
    this.worker = null; this.seq = 0; this.current = null; this.waiting = null; this.disposed = false;
  }

  /** Resolves { status: 'success' | 'failure' | 'timeout' | 'superseded', output, errors, ms } */
  render(src, engine = 'auto') {
    if (this.disposed) return Promise.resolve({ status: 'failure', errors: [{ level: 'error', message: 'Renderer closed.' }] });
    return new Promise(resolve => {
      if (this.waiting) this.waiting.resolve({ status: 'superseded', errors: [] });
      this.waiting = { src, engine, resolve };
      this.pump();
    });
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    const w = new Worker(this.workerPath);
    w.unref && w.unref();
    w.on('message', m => {
      const job = this.current;
      if (!job || m.id !== job.id) return;
      clearTimeout(job.timer);
      this.current = null;
      job.resolve({ status: m.status, output: m.output, errors: m.errors || [], ms: m.ms || 0 });
      this.pump();
    });
    w.on('error', err => this.fail(w, 'Graphviz stopped: ' + ((err && err.message) || err)));
    w.on('exit', () => this.fail(w, 'Graphviz stopped.'));
    this.worker = w;
    return w;
  }

  fail(w, message) {
    if (this.worker !== w) return;
    this.worker = null;
    const job = this.current; this.current = null;
    if (job) { clearTimeout(job.timer); job.resolve({ status: 'failure', errors: [{ level: 'error', message }] }); }
    if (!this.disposed) this.pump();
  }

  pump() {
    if (this.current || !this.waiting || this.disposed) return;
    const { src, engine, resolve } = this.waiting; this.waiting = null;
    let w;
    try { w = this.ensureWorker(); } catch (e) { resolve({ status: 'failure', errors: [{ level: 'error', message: 'Graphviz could not start: ' + ((e && e.message) || e) }] }); return; }
    const job = { id: ++this.seq, resolve, started: Date.now() };
    job.timer = setTimeout(() => {
      if (this.current !== job) return;
      this.current = null;
      this.worker = null;
      w.removeAllListeners('exit'); w.removeAllListeners('error'); w.on('error', () => {});
      w.terminate().catch(() => {});
      resolve({ status: 'timeout', errors: [], ms: Date.now() - job.started });
      this.pump();
    }, this.timeoutMs);
    this.current = job;
    w.postMessage({ id: job.id, src, engine });
  }

  dispose() {
    this.disposed = true;
    if (this.waiting) { this.waiting.resolve({ status: 'superseded', errors: [] }); this.waiting = null; }
    if (this.current) { clearTimeout(this.current.timer); this.current.resolve({ status: 'superseded', errors: [] }); this.current = null; }
    if (this.worker) { const w = this.worker; this.worker = null; w.removeAllListeners('exit'); w.on('error', () => {}); w.terminate().catch(() => {}); }
  }
}

module.exports = { Renderer };
