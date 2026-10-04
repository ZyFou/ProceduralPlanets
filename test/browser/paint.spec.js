import { test, expect } from '@playwright/test';

async function openPlanet(page, { nodes = false } = {}) {
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: null, projects: [], authenticated: false }) }));
  // Keep software WebGL startup bounded; the real Studio and renderer still run.
  // These are bootstrap quality defaults only, not substitutes for paint behavior.
  await page.route('**/src/engine/presets.js*', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/octaves:\s*\d+/, 'octaves: 3')
      .replace(/chunkRes:\s*\d+/, 'chunkRes: 16').replace(/maxDepth:\s*\d+/, 'maxDepth: 4')
      .replace(/cloudsEnabled:\s*true/, 'cloudsEnabled: false').replace(/atmoEnabled:\s*true/, 'atmoEnabled: false');
    await route.fulfill({ response, body });
  });
  const startupError = new Promise((_, reject) => page.once('pageerror', reject));
  await page.goto('/');
  await Promise.race([startupError, page.waitForFunction(() => window.planetStudio?.paintMode)]);
  await page.evaluate(async (nodes) => {
    const { projectStore } = await import('/src/project/ProjectStore.js');
    const { createNode, GRAPH_FORMAT, GRAPH_VERSION } = await import('/src/engine/graph/index.js');
    const graph = { format: GRAPH_FORMAT, version: GRAPH_VERSION,
      nodes: [createNode('constant', 'source', { value: 0.5 }), createNode('heightOutput', 'output')],
      edges: [{ id: 'edge', source: 'source', sourcePort: 'height', target: 'output', targetPort: 'height' }], outputId: 'output' };
    window.__paintProjectId = (await projectStore.save({ id: 'paint-e2e', metadata: { name: 'Paint test world', templateId: 'blank' },
      params: { mode: 'planet', radius: 200, heightScale: 40, seed: 42, noiseScale: 2, octaves: 3, chunkRes: 16, maxDepth: 4,
        waterEnabled: false, cloudsEnabled: false, atmoEnabled: false, renderResolution: 1 },
      terrain: nodes ? { mode: 'nodes', graph } : { mode: 'procedural', graph: null }, editor: nodes ? { draftGraph: graph } : {} })).id;
  }, nodes);
  await page.locator('.lp-card-main').filter({ hasText: 'Paint test world' }).click();
  await expect(page.getByRole('button', { name: 'Paint Mode', exact: true })).toBeEnabled();
  await page.waitForFunction(() => window.planetStudio.params.radius === 200);
  if (nodes) await page.waitForFunction(() => window.planetStudio.planet.terrain.mode === 'nodes');
  await page.evaluate(() => window.planetStudio.frame());
  await page.keyboard.press('p');
  await expect(page.getByRole('complementary', { name: 'Paint settings' })).toBeVisible();
  expect(await page.evaluate(() => window.planetStudio.paintMode.state.brushSize)).toBeLessThanOrEqual(90);
  await page.evaluate(() => window.planetStudio.paintMode.setState({ brushSize: 30, strength: 0.8, falloff: 0.7 }));
}
async function stroke(page, { x = 0.45, y = 0.5, dx = 70, dy = 15 } = {}) {
  const box = await page.locator('#viewport').boundingBox();
  const start = { x: box.x + box.width * x, y: box.y + box.height * y };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.planetStudio.planet.paintLayers.isEmpty())).toBe(false);
}
async function paintData(page) { return page.evaluate(() => window.planetStudio.planet.paint); }
async function savedPaint(page) {
  return page.evaluate(async () => { const { projectStore } = await import('/src/project/ProjectStore.js'); return (await projectStore.get('paint-e2e'))?.paint; });
}

test.beforeEach(async ({ page }) => {
  page.__errors = []; page.on('pageerror', (error) => page.__errors.push(error.message));
});
test.afterEach(async ({ page }) => { expect(page.__errors).toEqual([]); });

// These tests exercise actual Studio input, not synthetic layer calls.
test('P opens paint, sculpt changes the visible surface, right drag orbits, Shift-wheel sizes, Escape retains paint', async ({ page }) => {
  const shaderErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && /THREE.WebGLProgram|shader error/i.test(msg.text())) shaderErrors.push(msg.text()); });
  await openPlanet(page);
  const before = await page.evaluate(() => { window.planetStudio.stop(); window.planetStudio.paintMode.cursor.setVisible(false); return window.planetStudio.screenshot(500, 320); });
  await page.evaluate(() => window.planetStudio.start());
  const camera = await page.evaluate(() => window.planetStudio.camera.position.toArray());
  await stroke(page);
  expect(await page.evaluate(() => window.planetStudio.camera.position.toArray())).toEqual(camera);
  const painted = await paintData(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Paint settings' })).toHaveCount(0);
  expect(await paintData(page)).toEqual(painted);
  const after = await page.evaluate(() => { window.planetStudio.stop(); return window.planetStudio.screenshot(500, 320); });
  expect(after).not.toBe(before);
  await page.evaluate(() => window.planetStudio.start());
  await page.keyboard.press('p');
  const box = await page.locator('#viewport').boundingBox();
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.5);
  const size = await page.evaluate(() => window.planetStudio.paintMode.state.brushSize);
  await page.keyboard.down('Shift'); await page.mouse.wheel(0, -100); await page.keyboard.up('Shift');
  expect(await page.evaluate(() => window.planetStudio.paintMode.state.brushSize)).toBeGreaterThan(size);
  await page.mouse.down({ button: 'right' }); await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.6, { steps: 10 }); await page.mouse.up({ button: 'right' });
  expect(await page.evaluate(() => window.planetStudio.camera.position.toArray())).not.toEqual(camera);
  expect(shaderErrors).toEqual([]);
  await page.screenshot({ path: 'test-results/paint-workspace.png' });
});

test('undo/redo restores complete strokes; two quick strokes are two actions', async ({ page }) => {
  await openPlanet(page); const before = await paintData(page);
  await stroke(page); const first = await paintData(page);
  await stroke(page, { x: 0.49, y: 0.47, dx: -60 }); const second = await paintData(page);
  await page.keyboard.press('Control+z'); await expect.poll(() => paintData(page)).toEqual(first);
  await page.keyboard.press('Control+z'); await expect.poll(() => paintData(page)).toEqual(before);
  await page.keyboard.press('Control+Shift+z'); await expect.poll(() => paintData(page)).toEqual(first);
  await page.keyboard.press('Control+Shift+z'); await expect.poll(() => paintData(page)).toEqual(second);
});

test('autosave and browser reload preserve exact painted data and surface samples', async ({ page }) => {
  await openPlanet(page); await stroke(page); const painted = await paintData(page);
  const sample = await page.evaluate(() => { const d = window.planetStudio.paintMode.hit.direction; window.__sampleDirection = d.toArray(); return { direction: d.toArray(), radius: window.planetStudio.planet.getSurfaceRadius(d) }; });
  await expect.poll(() => savedPaint(page)).toEqual(painted);
  await page.reload();
  await page.locator('.lp-card-main').filter({ hasText: 'Paint test world' }).click();
  await expect(page.getByRole('button', { name: 'Paint Mode', exact: true })).toBeEnabled();
  await expect.poll(() => paintData(page)).toEqual(painted);
  const radius = await page.evaluate(async (direction) => { const { Vector3 } = await import('/node_modules/three/build/three.module.js'); return window.planetStudio.planet.getSurfaceRadius(new Vector3(...direction)); }, sample.direction);
  expect(radius).toBe(sample.radius);
});

test('paint remains layered over applied node edits', async ({ page }) => {
  await openPlanet(page, { nodes: true }); await stroke(page); const painted = await paintData(page);
  await page.keyboard.press('Escape');
  // Open the applied node workspace and change the real source node control.
  await page.getByRole('button', { name: 'Terrain', exact: true }).click();
  await page.getByRole('button', { name: /Open graph editor/i }).click();
  await page.locator('.react-flow__node').filter({ hasText: 'Constant' }).click();
  const value = page.locator('.node-inspector input[type="number"]').first();
  if (await value.count()) { await value.fill('0.25'); await value.press('Tab'); }
  else {
    // Inspectors use the common slider input; locate the actual constant value.
    const control = page.getByRole('textbox', { name: /Value/i }).first(); await control.fill('0.25'); await control.press('Tab');
  }
  await page.waitForFunction(() => window.planetStudio.planet.terrain.graph.nodes.find((node) => node.type === 'constant').params.value === 0.25);
  expect(await paintData(page)).toEqual(painted);
});

test('brush stays continuous across cube edges and keeps equal angular size near a pole', async ({ page }) => {
  await openPlanet(page);
  // Camera default points toward +X/+Z: a center stroke crosses that face edge.
  await stroke(page, { x: 0.475, dx: 100, dy: 0 });
  const seam = await page.evaluate(async () => {
    const { Vector3 } = await import('/node_modules/three/build/three.module.js'); const field = window.planetStudio.planet.paintLayers;
    const hit = window.planetStudio.paintMode.hit.direction;
    const a = new Vector3(1-1e-7, hit.y / Math.max(hit.x,hit.z), 1).normalize(), b = new Vector3(1+1e-7, a.y / a.z, 1).normalize();
    return Math.abs(field.sampleHeightOffset(a) - field.sampleHeightOffset(b));
  });
  expect(seam).toBeLessThan(0.001);
  await page.evaluate(() => { const e = window.planetStudio; e.camera.position.set(0, 700, 0.001); e.camera.lookAt(0, 0, 0); e.controls.update(); });
  await stroke(page, { x: 0.5, dx: 60, dy: 0 });
  const pole = await page.evaluate(async () => {
    const { Vector3 } = await import('/node_modules/three/build/three.module.js'); const { tangentFrame, offsetDirection, brushWeight } = await import('/src/paint/sphericalPaintMapping.js');
    const center = new Vector3(0, 1, 0), frame = tangentFrame(center), e = window.planetStudio;
    const settings = { radius: e.paintMode.state.brushSize, planetRadius: e.params.radius, falloff: 1 };
    return [0, Math.PI/2, Math.PI, Math.PI*1.5].map((a) => brushWeight(offsetDirection(center, frame.east, frame.north, Math.cos(a)*15,Math.sin(a)*15,e.params.radius), center,frame,settings));
  });
  expect(Math.max(...pole) - Math.min(...pole)).toBeLessThan(1e-8);
  await page.screenshot({ path: 'test-results/paint-pole.png' });
});

test('smooth, flatten, material and erase tools work; outside pointerup releases paint', async ({ page }) => {
  await openPlanet(page); await stroke(page); const sculpt = await paintData(page);
  await page.getByRole('button', { name: 'Smooth', exact: true }).click(); await stroke(page);
  expect(await paintData(page)).not.toEqual(sculpt);
  await page.getByRole('button', { name: 'Flatten', exact: true }).click(); await stroke(page);
  await page.getByRole('button', { name: 'Material', exact: true }).click(); await page.getByRole('combobox', { name: 'Material', exact: true }).selectOption('snow'); await stroke(page);
  const box = await page.locator('#viewport').boundingBox();
  await page.mouse.move(box.x + box.width * 0.46, box.y + box.height * 0.5); await page.mouse.down();
  await page.mouse.move(1270, 790, { steps: 5 }); await page.mouse.up();
  expect(await page.evaluate(() => window.planetStudio.paintMode.isPainting)).toBe(false);
  await page.getByRole('button', { name: 'Erase', exact: true }).click(); await stroke(page);
  await page.getByRole('button', { name: 'Clear Painted Layers' }).click();
  await page.getByRole('button', { name: 'Clear paint', exact: true }).click();
  expect(await page.evaluate(() => window.planetStudio.planet.paintLayers.isEmpty())).toBe(true);
});

test('actual WebGL bake, GLB reload and ZIP preset include final painted geometry and material', async ({ page }) => {
  await page.goto('/test/visual/paint-export-checks.html');
  await page.waitForFunction(() => window.__paintExportChecks?.state !== 'running');
  expect(await page.evaluate(() => window.__paintExportChecks)).toMatchObject({ state: 'passed', shaderErrors: [] });
});
