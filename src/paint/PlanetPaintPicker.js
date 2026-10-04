import * as THREE from 'three';
import { tangentFrame, offsetDirection } from './sphericalPaintMapping.js';

export function surfaceNormal(planet, direction, target = new THREE.Vector3()) {
  const { east, north } = tangentFrame(direction), e = 0.0002;
  const point = (x, y) => {
    const d = offsetDirection(direction, east, north, x, y, 1);
    return d.multiplyScalar(planet.getSurfaceRadius(d));
  };
  const a = point(e, 0).sub(point(-e, 0));
  const b = point(0, e).sub(point(0, -e));
  return target.crossVectors(a, b).normalize();
}

/** Refine the first ray crossing of the final radial height field, in local space. */
export function pickPlanetRay(planet, worldRay) {
  if (planet.params.mode !== 'planet') return null;
  planet.updateWorldMatrix(true, false);
  const inverse = planet.matrixWorld.clone().invert();
  const ray = worldRay.clone().applyMatrix4(inverse);
  const bound = planet.params.radius + Math.abs(planet.params.heightScale) * 2 + planet.paintLayers.maxHeight;
  const b = ray.origin.dot(ray.direction), c = ray.origin.lengthSq() - bound * bound;
  const disc = b * b - c;
  if (disc < 0) return null;
  const start = Math.max(0, -b - Math.sqrt(disc)), end = -b + Math.sqrt(disc);
  if (end < start) return null;
  const point = new THREE.Vector3(), direction = new THREE.Vector3();
  const residual = (t) => {
    ray.at(t, point);
    const length = point.length();
    if (length < 1e-9) return -planet.params.radius;
    direction.copy(point).divideScalar(length);
    return length - planet.getSurfaceRadius(direction);
  };
  // Resolve paint texels along the chord, including oblique limb intersections.
  const steps = Math.min(4096, Math.max(96, Math.ceil((end - start) / (planet.params.radius / planet.paintLayers.resolution))));
  let previousT = start, previous = residual(start);
  for (let i = 1; i <= steps; i++) {
    const t = start + (end - start) * i / steps, value = residual(t);
    if (previous >= 0 && value <= 0) {
      let lo = previousT, hi = t;
      for (let k = 0; k < 22; k++) { const mid = (lo + hi) / 2; if (residual(mid) > 0) lo = mid; else hi = mid; }
      const localPosition = ray.at((lo + hi) / 2, new THREE.Vector3());
      const localDirection = localPosition.clone().normalize();
      const worldPosition = localPosition.clone().applyMatrix4(planet.matrixWorld);
      return { direction: localDirection, localPosition, worldPosition,
        elevation: localPosition.length() - planet.params.radius,
        normal: surfaceNormal(planet, localDirection),
        distance: worldRay.origin.distanceTo(worldPosition) };
    }
    previousT = t; previous = value;
  }
  return null;
}

export class PlanetPaintPicker {
  constructor({ planet, camera, domElement }) { Object.assign(this, { planet, camera, domElement }); this.raycaster = new THREE.Raycaster(); }
  pickEvent(event) {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), this.camera);
    return pickPlanetRay(this.planet, this.raycaster.ray);
  }
}
