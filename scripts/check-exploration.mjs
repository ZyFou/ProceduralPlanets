// Browser integration check; use --software-gpu in containers without a GPU.
// It checks behaviour, not user hardware performance. Requires a Vite dev server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchChrome } from '../bench/lib/cdp.mjs';
const url = process.env.EXPLORATION_URL || 'http://127.0.0.1:7071/';
const out = process.env.EXPLORATION_ARTIFACTS || 'artifacts/exploration';
const software = process.argv.includes('--software-gpu');
const size = software ? { width: 960, height: 640 } : { width: 1280, height: 800 };
fs.mkdirSync(out, { recursive: true });
const browser = await launchChrome({ ...size, extraArgs: [
  ...(process.getuid?.() === 0 || process.env.CHROME_NO_SANDBOX ? ['--no-sandbox'] : []),
  ...(software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
] });
const report = [];
let page;
const record = (name, details = {}) => { report.push({ name, ...details }); console.log(name, JSON.stringify(details)); };
try {
  page = await browser.newPage(size);
  const clickText = (selector, text) => page.eval(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`);
  const screenshot = async name => {
    await page.eval('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${out}/${name}.png`, Buffer.from(shot.data, 'base64'));
  };
  const ready = () => page.waitFor('window.planetExplorer?.stream.entries.size >= 5 && window.planetExplorer.stream.queue.length === 0 && window.planetExplorer.planets.info.planets > 0 && window.planetExplorer.planets.pending === 0', { timeout: 180000 });
  await page.navigate(url);
  await page.waitFor("performance.getEntriesByName('pp:loader-hidden').length > 0", { timeout: 180000 });
  record('Studio booted', { ...size, softwareGPU: software });
  await clickText('.lp-nav-links button', 'Explore');
  await ready();
  assert.equal(await page.eval('window.planetStudio.running'), false);
  assert.equal(await page.eval('[...window.planetExplorer.stream.entries.values()].every(e => e.resource.isPlanet && Math.abs(e.body.radius-e.resource.params.radius*e.resource.scale.x)<0.001)'), true);
  await screenshot('home');
  record('Landing entry, package rendering and studio suspension', await page.eval('({resident:window.planetExplorer.stream.entries.size,info:window.planetExplorer.planets.info})'));

  await clickText('.exploration-presets button', 'Precise');
  assert.equal(await page.eval('window.planetExplorer.flight.speed'), 1);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 350, deltaX: 0, deltaY: -120 });
  assert.equal(await page.eval('window.planetExplorer.flight.speed'), 2);
  record('Speed preset and real wheel event');

  // Real user gesture captures the mouse (not a stub of requestPointerLock).
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 600, y: 120, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 600, y: 120, button: 'left', clickCount: 1 });
  await page.waitFor('document.pointerLockElement === document.querySelector(".exploration canvas") && document.querySelector(".exploration-locked")', { timeout: 15000 });
  await page.eval('window.__flightStart = structuredClone(window.planetExplorer.flight.position)');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  record('Captured input state', await page.eval('({keys:[...window.planetExplorer.flight.keys],running:window.planetExplorer.running,hidden:document.hidden,lock:!!document.pointerLockElement,error:document.querySelector(".exploration-error")?.textContent})'));
  await page.waitFor('window.planetExplorer.flight.actualSpeed > 0', { timeout: 15000 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  assert.ok(await page.eval('(async () => { const {length,relative} = await import("/src/exploration/world.js"); return length(relative(window.planetExplorer.flight.position,window.__flightStart)) > 0; })()'));
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 });
  await page.waitFor('!document.pointerLockElement', { timeout: 15000 });
  assert.equal(await page.eval('window.planetExplorer.flight.keys.size'), 0);
  record('Pointer lock, WASD movement and Escape release');

  await clickText('.exploration-target-actions button', 'Approach target');
  await page.waitFor('window.planetExplorer.flight.approaching');
  await page.waitFor('!window.planetExplorer.flight.approaching', { timeout: 180000 });
  await ready();
  await screenshot('approach');
  record('Smooth approach completed');

  // Follow a real planet in another system through the UI and simulate time
  // deterministically to avoid spending minutes on a software GPU transfer.
  await page.eval('window.__remote = window.planetExplorer.stream.systems[1].bodies[1]');
  await page.eval('[...document.querySelectorAll(".exploration-catalogue section")][1].querySelectorAll("button")[1].click()');
  await clickText('.exploration-target-actions button', 'Approach target');
  await page.eval(`{
    const ex = window.planetExplorer;
    for (let i=0;i<1000 && ex.flight.approaching;i++) {
      ex.flight.step(0.05, ex.stream.systems.flatMap(s=>s.bodies));
      if (i%10===0) ex.stream.discover(ex.flight.position,ex.target.id);
    }
    ex.nextDiscovery=0;
  }`);
  await ready();
  assert.equal(await page.eval('window.planetExplorer.target.id === window.__remote.id'), true);
  assert.equal(await page.eval('Object.values(window.planetExplorer.flight.position.sector).some(v=>v!==0)'), true);
  assert.ok(await page.eval('window.planetExplorer.stream.entries.size <= 16'));
  await screenshot('remote-system');
  record('Interstellar approach, sector crossing and bounded streaming', await page.eval('({sector:window.planetExplorer.flight.position.sector,resident:window.planetExplorer.stream.entries.size})'));

  await page.eval('void (window.__seedExplorer = window.planetExplorer)');
  await page.eval(`{
    const input=document.querySelector('#exploration-seed');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'1');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  }`);
  await clickText('.exploration-row button', 'Generate');
  await page.waitFor('window.planetExplorer && window.planetExplorer !== window.__seedExplorer');
  await ready();
  assert.equal(await page.eval('window.__seedExplorer.disposed && window.__seedExplorer.stream.entries.size === 0'), true);
  await screenshot('new-seed');
  record('Seed reset frees previous resources and renders a fresh canvas');

  await page.eval('void (window.__oldExplorer = window.planetExplorer)');
  await clickText('.exploration-header button', 'Return to studio');
  await page.waitFor('!document.querySelector(".exploration") && window.planetStudio.running');
  assert.equal(await page.eval('window.__oldExplorer.disposed && window.__oldExplorer.stream.entries.size === 0'), true);
  record('Exit disposes resources and restores studio');
  // Create an editable local project through the normal site workflow.
  await clickText('.lp-hero-actions button', 'Create planet');
  await clickText('.landing-create-options button', 'Create planet');
  await page.waitFor('!document.querySelector(".landing") && !document.querySelector(".lp-nav")', { timeout: 15000 });
  await page.eval('window.__editorPlanet = window.planetStudio.planet; window.__editorSeed = window.planetStudio.params.seed');
  await clickText('.tb-menu-btn', 'View');
  await clickText('[aria-label="View"] button', 'Explore infinite worlds');
  await ready();
  await clickText('.exploration-header button', 'Return to studio');
  await page.waitFor('window.planetStudio.running && !document.querySelector(".exploration")');
  assert.equal(await page.eval('window.planetStudio.planet === window.__editorPlanet && window.planetStudio.params.seed === window.__editorSeed'), true);
  await screenshot('editor-return');
  record('Editor menu entry and preservation of the edited planet');
  const shaderErrors = page.console.filter(e => e.type === 'exception' || e.text.includes('THREE.WebGLProgram'));
  assert.deepEqual(shaderErrors, []);
  fs.writeFileSync(`${out}/console.json`, JSON.stringify(page.console, null, 2));
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
} catch (error) {
  if (page) { console.log('Failure state',await page.eval('({keys:[...(window.planetExplorer?.flight.keys??[])],running:window.planetExplorer?.running,hidden:document.hidden,lock:!!document.pointerLockElement,error:document.querySelector(".exploration-error")?.textContent,console:document.querySelector(".exploration")?.innerText.slice(0,1200)})')); fs.writeFileSync(`${out}/console.json`,JSON.stringify(page.console,null,2)); }
  throw error;
} finally { await browser.close(); }
