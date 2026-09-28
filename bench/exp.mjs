#!/usr/bin/env node
// Ad-hoc experiment: evaluate a JS snippet in the bench page (window.bench
// exports build / warm / timePasses ...). Usage: node bench/exp.mjs file.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome } from './lib/cdp.mjs';
import { startVite } from './lib/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.BENCH_ROOT ? path.resolve(process.env.BENCH_ROOT) : ROOT;
const code = fs.readFileSync(process.argv[2], 'utf8');
const server = await startVite(root, 'exp');
const browser = await launchChrome();
try {
  const page = await browser.newPage();
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(path.join(ROOT, 'bench/lib/inject.js'), 'utf8') });
  await page.navigate(`${server.url}/bench/page/bench.html`, { waitFor: 'window.benchReady === true', timeout: 120000 });
  const out = await page.eval(`(async () => { const B = window.bench; ${code} })()`);
  console.log(JSON.stringify(out, null, 1));
  for (const c of page.console.filter((c) => c.type !== 'log' && c.type !== 'debug')) console.log('console', c.type, c.text.slice(0, 300));
} finally {
  await browser.close();
  server.stop();
}
