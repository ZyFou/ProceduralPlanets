// Browser integration check; use --software-gpu in containers without a GPU.
// It checks behaviour, not user hardware performance. Requires a Vite dev server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { launchChrome } from '../bench/lib/cdp.mjs';
const url = process.env.EXPLORATION_URL || 'http://127.0.0.1:7071/';
const out = process.env.EXPLORATION_ARTIFACTS || 'artifacts/exploration';
const software = process.argv.includes('--software-gpu');
const size = software ? { width: 1280, height: 640 } : { width: 1280, height: 800 };
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
  await page.eval(`(()=>{const input=document.querySelector('#flight-speed-value'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'1e17'); input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  assert.equal(await page.eval('window.planetExplorer.flight.speed'), 1e17);
  await clickText('.exploration-presets button', 'Precise');
  record('Scientific speed input above the former ceiling');

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
  await page.eval(`(()=>{const input=document.querySelector('#flight-layout');input.value='azerty';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert.equal(await page.eval('window.planetExplorer.flight.layout'),'azerty');
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:600,y:120,button:'left',clickCount:1});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:600,y:120,button:'left',clickCount:1});
  await page.waitFor('document.pointerLockElement === document.querySelector(".exploration canvas") && !!document.querySelector(".exploration-locked")');
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'z',windowsVirtualKeyCode:90});
  assert.equal(await page.eval('window.planetExplorer.flight.keys.has("KeyZ")'),true);
  await page.waitFor('window.planetExplorer.flight.actualSpeed > 0');
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'z',windowsVirtualKeyCode:90});
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',code:'Escape',key:'Escape',windowsVirtualKeyCode:27});
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',code:'Escape',key:'Escape',windowsVirtualKeyCode:27});
  await page.waitFor('!document.pointerLockElement');record('Actual AZERTY ZQSD events');

  await clickText('.exploration-target-actions button', 'Approach target');
  await page.waitFor('window.planetExplorer.flight.approaching');
  await page.waitFor('!window.planetExplorer.flight.approaching', { timeout: 180000 });
  await ready();
  await screenshot('approach');
  record('Smooth approach completed');

  // The shared HDR star pass must preserve a non-black host background.
  await page.eval('window.planetExplorer.select(window.planetExplorer.stream.systems.find(s=>s.id==="sol").star)');
  await ready();
  const sky = await page.eval(`(()=>{
    const e=window.planetExplorer, star=e.stream.entries.get('sol/Sun').resource;
    e.renderer.setClearColor('#224466'); e.renderer.render(e.scene,e.camera);
    const gl=e.renderer.getContext(), pixels=new Uint8Array(4);
    gl.readPixels(20,20,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels); const before=[...pixels];
    e.planets.render([star],e.camera,{delta:0});
    gl.readPixels(20,20,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    const after=[...pixels]; e.renderer.setClearColor('#02040a'); return {before,after};
  })()`);
  assert.ok(sky.before.every((v,i)=>Math.abs(v-sky.after[i])<=1),JSON.stringify(sky));
  record('Star bloom preserves host sky pixels',sky);
  await screenshot('sun');
  // Render real bodies at very different scales and near-surface orientations.
  for (const name of ['Earth','Phobos','Saturn']) {
    await page.eval(`(async()=>{
      const {relative,translate}=await import('/src/exploration/world.js');
      const e=window.planetExplorer, s=e.stream.systems.find(s=>s.id==='sol'), body=s.bodies.find(b=>b.name===${JSON.stringify('NAME')});
      const v=relative(s.star.position,body.position), d=Math.hypot(v.x,v.y,v.z), distance=body.radius*2.8;
      e.flight.clear();e.flight.position=translate(body.position,{x:v.x/d*distance,y:v.y/d*distance,z:v.z/d*distance});
      e.select(body);e.nextDiscovery=0;
    })()`.replace('"NAME"',JSON.stringify(name)));
    await ready();
    await screenshot(name.toLowerCase());
    if (name==='Earth') {
      await page.eval(`(async()=>{const {relative,translate}=await import('/src/exploration/world.js');const e=window.planetExplorer,b=e.target,v=relative(e.flight.position,b.position),d=Math.hypot(v.x,v.y,v.z); e.flight.position=translate(b.position,{x:v.x/d*(b.radius+100),y:v.y/d*(b.radius+100),z:v.z/d*(b.radius+100)});e.flight.aim(b);e.nextDiscovery=0;})()`);
      await ready();
      for (const yaw of [-1.1,0,1.1]) {
        await page.eval(`(()=>{const e=window.planetExplorer;e.flight.aim(e.target);e.camera.rotateY(${yaw});e.camera.rotateX(.3);})()`);
        await ready();await screenshot(`earth-close-${yaw}`);
        const count=await page.eval("window.planetExplorer.stream.entries.get('sol/Earth').resource.world.chunkCount");
        assert.ok(count>0);record('Close Earth yaw/pitch renders terrain',{yaw,chunkCount:count});
      }
    }
  }
  await page.eval('window.planetExplorer.visitSolarSystem()'); await ready();
  await page.eval(`document.querySelector('[aria-label="Render settings"]').click()`);
  // aria-label belongs to this icon button; use it directly for certainty.
  await clickText('.exploration-presets button','Performance');
  assert.equal(await page.eval('window.planetExplorer.renderer.getPixelRatio()'),.75);
  assert.equal(await page.eval('[...window.planetExplorer.stream.entries.values()].every(e=>e.resource.world.opts.maxDepth===7 && e.resource.params.cloudQuality===12 && e.resource.params.cloudResolution===.25)'),true);
  await page.eval('document.querySelectorAll(".exploration-toggle input")[0].click()');
  assert.equal(await page.eval('[...window.planetExplorer.stream.entries.values()].every(e=>!e.resource.params.cloudsEnabled)'),true);
  await screenshot('settings');
  record('Quality preset and clouds toggle change actual renderer parameters');
  // Find a sunlit procedural shoreline with the package's CPU terrain sampler,
  // then inspect oblique low views without clouds obscuring the ground.
  await page.eval(`(async()=>{
    const {relative,translate}=await import('/src/exploration/world.js');const e=window.planetExplorer;
    const body=e.stream.systems.find(s=>s.id==='sol').bodies.find(b=>b.name==='Earth'),p=e.stream.entries.get(body.id).resource;
    const sun=p.uniforms.uSunDir.value,dir=p.position.clone();let best=Infinity;
    for(let lat=-1.3;lat<1.3;lat+=.08)for(let lon=0;lon<Math.PI*2;lon+=.08){
      const sample=p.position.clone().set(Math.cos(lat)*Math.cos(lon),Math.sin(lat),Math.cos(lat)*Math.sin(lon));
      if(sample.dot(sun)<.5)continue;const height=p.getSurfaceRadius(sample),sea=p.uniforms.uSeaRadius.value;
      if(height<sea)continue;const difference=height-sea;if(difference<best){best=difference;dir.copy(sample);}
    }
    e.flight.position=translate(body.position,{x:dir.x*(body.radius+50),y:dir.y*(body.radius+50),z:dir.z*(body.radius+50)});
    e.select(body);e.nextDiscovery=0;
  })()`);await ready();
  for(const yaw of [-1.1,0,1.1]){
    await page.eval(`(()=>{const e=window.planetExplorer;e.flight.aim(e.target);e.camera.rotateY(${yaw});e.camera.rotateX(.25);e.camera.rotateZ(.5);})()`);
    await ready();await screenshot(`coast-close-${yaw}`);
    if (yaw === 0 && software) {
      const shorelineRuns = await page.eval(`(()=>{
        const e=window.planetExplorer;e.frame(0);const gl=e.renderer.getContext(),c=e.canvas,r=c.getBoundingClientRect(),scale=c.width/r.width;
        return [400,450,530].map(y=>{
          const x=Math.floor(350*scale),width=Math.floor(580*scale),pixels=new Uint8Array(width*4);
          gl.readPixels(x,c.height-1-Math.floor((y-r.top)*scale),width,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          let count=0,run=0;for(let i=0;i<=width;i++){
            const a=pixels[i*4],b=pixels[i*4+1],d=pixels[i*4+2];
            if(i<width && a+b+d>550 && Math.max(a,b,d)-Math.min(a,b,d)<55)run++;
            else{if(run>=4)count++;run=0;}
          }return count;
        });
      })()`);
      assert.ok(shorelineRuns.every(count=>count<=2),`disconnected triangular shoreline patches: ${shorelineRuns}`);
      record('Shallow terrain and analytic ocean keep a continuous shoreline', {shorelineRuns});
    }
  }
  record('Cloud-free shoreline rotations at 50 km altitude');
  await page.eval('window.planetExplorer.visitSolarSystem()');await ready();
  await clickText('.exploration-header button','Photo');
  await ready();
  await page.eval('window.__photoTimes=[...window.planetExplorer.stream.entries.values()].map(e=>e.resource.time)');
  await page.eval('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  assert.equal(await page.eval('[...window.planetExplorer.stream.entries.values()].every((e,i)=>e.resource.time===window.__photoTimes[i])'),true);
  await page.eval(`(()=>{const input=document.querySelector('[aria-label="Photo field of view"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'80');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  assert.equal(await page.eval('window.planetExplorer.camera.fov'),80);
  const photoImage=await page.eval('(async()=>{const e=window.planetExplorer;const ratio=e.renderer.getPixelRatio();const image=await e.takePhoto(2);return {type:image.blob.type,bytes:image.blob.size,width:image.width,height:image.height,restored:e.renderer.getPixelRatio()===ratio};})()');
  assert.equal(photoImage.type,'image/png');assert.ok(photoImage.bytes>10000);assert.equal(photoImage.restored,true);
  assert.ok(photoImage.width<=4096 && photoImage.height<=2160);
  await clickText('.exploration-photo-bar button','Hide controls');
  assert.equal(await page.eval('getComputedStyle(document.querySelector(".exploration-header")).display'), 'none');
  await screenshot('photo');
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyH',key:'h',windowsVirtualKeyCode:72});
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyH',key:'h',windowsVirtualKeyCode:72});
  assert.equal(await page.eval('document.querySelector(".exploration-hide-ui")===null'),true);
  // Test the actual download action as well as the returned PNG bytes.
  await browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:fs.realpathSync(out)});
  await clickText('.exploration-photo-bar button','Save PNG');
  await page.waitFor('document.querySelector(".exploration-photo-bar [role=status]")?.textContent.includes("Saved PNG")',{timeout:180000});
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',code:'Escape',key:'Escape',windowsVirtualKeyCode:27});
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',code:'Escape',key:'Escape',windowsVirtualKeyCode:27});
  assert.equal(await page.eval('window.planetExplorer.photo'),false);
  record('Photo freezes time, reframes FOV, exports PNG, hides controls and exits on Escape',photoImage);

  // Follow a real planet in another system through the UI and simulate time
  // deterministically to avoid spending minutes on a software GPU transfer.
  await clickText('.exploration-header button', 'Navigation');
  await page.eval('window.__remote = window.planetExplorer.stream.systems[1].bodies[1]');
  await page.eval('[...document.querySelectorAll(".exploration-catalogue section")][1].querySelectorAll("button")[1].click()');
  await clickText('.exploration-tabs button', 'Flight');
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

  await clickText('.exploration-header button', 'Navigation');
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
  assert.equal(await page.eval('window.planetExplorer.settings.maxDepth === 7 && window.planetExplorer.settings.clouds === false && window.planetExplorer.camera.fov === 80'),true);
  record('Settings persist through regeneration');
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
  await page.eval(`{
    for (const key of ['r', 'z', 'k']) document.dispatchEvent(new KeyboardEvent('keydown', {key, ctrlKey: true, bubbles: true, cancelable: true}));
  }`);
  assert.equal(await page.eval('window.planetStudio.params.seed === window.__editorSeed'), true);
  assert.equal(await page.eval('!document.querySelector(".settings-search-overlay.open")'), true);
  record('Suspended editor shortcuts cannot edit or open hidden search');
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
