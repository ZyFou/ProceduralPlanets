import * as THREE from 'three';
import { tangentFrame, offsetDirection, brushAspect, organicRadius, scatterDabs } from './sphericalPaintMapping.js';

/** Geodesic contours sampled against displaced terrain, not a floating flat disc. */
export class PlanetPaintBrushCursor {
  constructor(planet) {
    this.planet = planet;
    this.group = new THREE.Group();
    this.group.name = 'PaintBrushCursor';
    this.group.visible = false;
    this.lines = [];
    for (let i = 0; i < 9; i++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(65 * 3), 3));
      const material = new THREE.LineBasicMaterial({ color: i === 1 ? 0x60a5fa : 0xffffff, transparent: true, opacity: i === 1 ? 0.5 : 0.95, depthTest: false, depthWrite: false, toneMapped: false });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false; line.renderOrder = 1000;
      this.group.add(line); this.lines.push(line);
    }
    planet._scene.add(this.group);
  }
  setVisible(visible) { this.group.visible = visible; }
  update(hit, state, tangent = null) {
    if (!hit) { this.setVisible(false); return; }
    this.setVisible(true);
    const center = hit.direction, frame = tangentFrame(center, state.brushRotation * Math.PI / 180, tangent);
    const shape = state.brushShape, aspect = brushAspect(shape);
    const dabs = shape === 'scatter' ? scatterDabs(0, state.brushScatter) : [];
    this.lines.forEach((line, index) => {
      line.visible = index < 2 || index - 2 < dabs.length;
      if (!line.visible) return;
      const data = line.geometry.attributes.position;
      const factor = index === 1 ? 1 - state.falloff : 1;
      for (let i = 0; i <= 64; i++) {
        const theta = i / 64 * Math.PI * 2;
        let r = state.brushSize * factor;
        if (shape === 'organic') r *= organicRadius(theta);
        let x = Math.cos(theta) * r, y = Math.sin(theta) * r * aspect;
        if (index >= 2) { const dab = dabs[index - 2]; x = state.brushSize * (dab.x + Math.cos(theta) * dab.radius); y = state.brushSize * (dab.y + Math.sin(theta) * dab.radius); }
        const d = offsetDirection(center, frame.east, frame.north, x, y, this.planet.params.radius);
        d.multiplyScalar(this.planet.getSurfaceRadius(d) + this.planet.params.radius * 0.0003);
        data.setXYZ(i, d.x, d.y, d.z);
      }
      data.needsUpdate = true;
    });
  }
  dispose() { this.group.removeFromParent(); this.lines.forEach((line) => { line.geometry.dispose(); line.material.dispose(); }); }
}
