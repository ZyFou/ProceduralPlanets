// Minimal Chrome DevTools Protocol client (Node >= 22: global WebSocket) and a
// headless Chrome launcher that keeps the real GPU (ANGLE / D3D11 on Windows).
// No dependencies: the harness only needs Runtime / Page / Emulation / Target.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Chrome / Edge found: set CHROME_PATH');
  return found;
}

/**
 * Launch headless Chrome. `coldShaders` disables the GPU program disk cache
 * (a first visit), otherwise the per-run profile keeps it (repeat visits).
 */
export async function launchChrome({ width = 1920, height = 1080, coldShaders = false, profile = null, extraArgs = [] } = {}) {
  const userDir = profile ?? fs.mkdtempSync(path.join(os.tmpdir(), 'pp-bench-'));
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-extensions',
    `--window-size=${width},${height}`,
    ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []),
    ...(coldShaders ? ['--disable-gpu-shader-disk-cache'] : []),
    ...extraArgs,
    'about:blank',
  ];
  const proc = spawn(findChrome(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not start:\n${buf}`)), 20000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on('exit', (code) => reject(new Error(`Chrome exited (${code}):\n${buf}`)));
  });
  const browser = await CDPConnection.connect(wsUrl);
  browser.proc = proc;
  browser.userDir = profile ? null : userDir;
  return browser;
}

export class CDPConnection {
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    return new CDPConnection(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();   // `${sessionId}|${method}` -> Set(fn)
    ws.addEventListener('message', (ev) => this._onMessage(JSON.parse(ev.data)));
  }

  _onMessage(msg) {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message} ${msg.error.data ?? ''}`));
      else p.resolve(msg.result);
      return;
    }
    const key = `${msg.sessionId ?? ''}|${msg.method}`;
    for (const fn of this.listeners.get(key) ?? []) fn(msg.params);
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(method, fn, sessionId = '') {
    const key = `${sessionId}|${method}`;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(fn);
    return () => this.listeners.get(key).delete(fn);
  }

  /** New page target with its own session. */
  async newPage({ width = 1920, height = 1080 } = {}) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, targetId, sessionId);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    return page;
  }

  async close() {
    const exited = this.proc && this.proc.exitCode === null
      ? new Promise((r) => this.proc.once('exit', r))
      : Promise.resolve();
    try { await withTimeout(this.send('Browser.close'), 5000, 'Browser.close'); } catch { /* already gone */ }
    this.ws.close();
    await withTimeout(exited, 8000, 'chrome exit').catch(() => this.proc?.kill());
    if (this.userDir) {
      // Chrome keeps profile files locked for a moment after exit
      for (let i = 0; i < 10; i++) {
        try { fs.rmSync(this.userDir, { recursive: true, force: true }); break; } catch { await sleep(300); }
      }
    }
  }
}

export class Page {
  constructor(conn, targetId, sessionId) {
    this.conn = conn;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.console = [];
    conn.on('Runtime.consoleAPICalled', (p) => {
      const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
      this.console.push({ type: p.type, text });
      if (process.env.BENCH_VERBOSE) console.log(`  [page ${p.type}] ${text}`);
    }, sessionId);
    conn.on('Runtime.exceptionThrown', (p) => {
      const d = p.exceptionDetails;
      const text = d.exception?.description ?? d.text;
      this.console.push({ type: 'exception', text });
      console.log(`  [page exception] ${text}`);
    }, sessionId);
  }

  send(method, params = {}) { return this.conn.send(method, params, this.sessionId); }
  on(method, fn) { return this.conn.on(method, fn, this.sessionId); }

  /** Evaluate an expression (awaits promises) and return its JSON value. */
  async eval(expression, { timeout = 600000 } = {}) {
    const res = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, timeout,
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(`page eval failed: ${d.exception?.description ?? d.text}`);
    }
    return res.result.value;
  }

  async navigate(url, { waitFor = null, timeout = 60000 } = {}) {
    const loaded = new Promise((resolve) => {
      const off = this.on('Page.loadEventFired', () => { off(); resolve(); });
    });
    await this.send('Page.navigate', { url });
    await withTimeout(loaded, timeout, `load ${url}`);
    if (waitFor) await this.waitFor(waitFor, { timeout });
  }

  async waitFor(expression, { timeout = 60000, interval = 50 } = {}) {
    const t0 = Date.now();
    for (;;) {
      if (await this.eval(`!!(${expression})`)) return;
      if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${expression}`);
      await sleep(interval);
    }
  }

  async close() {
    await this.conn.send('Target.closeTarget', { targetId: this.targetId });
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout: ${what}`)), ms); }),
  ]);
}
