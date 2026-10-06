import { Matrix4, Vector3 } from 'three';

const inverse = new Matrix4();
const relative = new Matrix4();
const eye = new Vector3();
const corner = new Vector3();

// Internal shared-renderer helper. Normalise the shared view scale so ray,
// LOD and clipping calculations use local units. Preserve any anisotropy for
// compatibility with existing non-uniformly scaled objects. Only final embed
// depth uses the original planet-to-host-view matrix.
export function fitPlanetCamera(planet, host, proxy) {
  for (const key of ['fov', 'aspect', 'zoom', 'filmGauge', 'filmOffset', 'view']) proxy[key] = host[key];
  inverse.copy(planet.matrixWorld).invert();
  relative.multiplyMatrices(inverse, host.matrixWorld);
  eye.setFromMatrixPosition(relative);
  proxy.matrixAutoUpdate = false;
  proxy.matrixWorldAutoUpdate = false;
  proxy.matrixWorld.copy(relative);
  const scale = planet.matrixWorld.getMaxScaleOnAxis();
  // Multiplying only the linear part keeps the eye in local coordinates.
  // For uniform planet scale this is a rigid camera; for non-uniform scale
  // it preserves the host projection of the ellipsoid instead of rounding
  // it back to a sphere.
  for (let column = 0; column < 3; column++) for (let row = 0; row < 3; row++) proxy.matrixWorld.elements[column * 4 + row] *= scale;
  proxy.matrixWorldInverse.copy(proxy.matrixWorld).invert();
  const distance = eye.length();
  const [near, far] = planet._clipPlanes(distance);
  // Radial clearance bounds ray distance, whereas clipping uses viewing depth.
  // Convert it using the most oblique corner ray (including lens shifts and
  // non-uniform planet transforms). This keeps foreground in wide side views
  // without collapsing near to 0.05 and losing shoreline depth precision.
  let depthPerDistance = 1;
  const matrix = proxy.matrixWorld.elements;
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    corner.set(x, y, -1).applyMatrix4(host.projectionMatrixInverse);
    const depth = Math.abs(corner.z);
    const lx = matrix[0] * corner.x + matrix[4] * corner.y + matrix[8] * corner.z;
    const ly = matrix[1] * corner.x + matrix[5] * corner.y + matrix[9] * corner.z;
    const lz = matrix[2] * corner.x + matrix[6] * corner.y + matrix[10] * corner.z;
    depthPerDistance = Math.min(depthPerDistance, depth / Math.hypot(lx, ly, lz));
  }
  proxy.near = host.userData.surfaceWalk
    ? Math.max(1e-7, host.near / scale)
    : Math.max(0.05, near * depthPerDistance);
  proxy.far = Math.max(far, proxy.near + 1);
  proxy.updateProjectionMatrix();
  return distance;
}
