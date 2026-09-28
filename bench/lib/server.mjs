// Vite dev servers for the checkouts under test (the working tree and,
// for A/B runs, a baseline checkout that gets a copy of the bench page).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sleep } from './cdp.mjs';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitHttp(url, timeout = 60000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() - t0 > timeout) throw new Error(`server did not come up: ${url}`);
    await sleep(200);
  }
}

/** Copy the in-page bench files into another checkout (baseline A/B runs). */
export function installBenchPage(fromRoot, toRoot) {
  const src = path.join(fromRoot, 'bench', 'page');
  const dst = path.join(toRoot, 'bench', 'page');
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f));
}

export async function startVite(root, label) {
  const port = await freePort();
  // own dependency cache per checkout (A/B checkouts share node_modules)
  const serve = fileURLToPath(new URL('./vite-serve.mjs', import.meta.url));
  const cacheDir = path.join(root, 'node_modules', `.vite-bench-${label}`);
  const proc = spawn(process.execPath, [serve, root, String(port), cacheDir], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitHttp(`${url}/bench/page/bench.html`);
  } catch (e) {
    proc.kill();
    throw new Error(`${e.message}\n${log}`);
  }
  return {
    label,
    root,
    url,
    log: () => log,
    stop: () => { if (!proc.killed) proc.kill(); },
  };
}
