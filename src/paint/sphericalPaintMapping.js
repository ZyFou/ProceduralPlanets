import { Vector3 } from 'three';

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const sphericalDistance = (a, b, radius = 1) => Math.acos(clamp(a.dot(b), -1, 1)) * radius;

// Same orientation as PlanetWorld; faces are +Z, -Z, +X, -X, +Y, -Y.
export function faceToDirection(face, u, v, target = new Vector3()) {
  const a = 2 * u - 1, b = 2 * v - 1;
  switch (face) {
    case 0: target.set(a, b, 1); break;
    case 1: target.set(-a, b, -1); break;
    case 2: target.set(1, b, -a); break;
    case 3: target.set(-1, b, a); break;
    case 4: target.set(a, 1, -b); break;
    case 5: target.set(a, -1, b); break;
    default: throw new Error('Invalid spherical paint face.');
  }
  return target.normalize();
}

export function directionToFace(d) {
  const x = Math.abs(d.x), y = Math.abs(d.y), z = Math.abs(d.z);
  if (!Number.isFinite(x + y + z) || Math.max(x, y, z) === 0) throw new Error('Paint requires a finite nonzero direction.');
  let face, a, b;
  if (z >= x && z >= y) {
    face = d.z >= 0 ? 0 : 1; a = (face === 0 ? d.x : -d.x) / z; b = d.y / z;
  } else if (x >= y) {
    face = d.x >= 0 ? 2 : 3; a = (face === 2 ? -d.z : d.z) / x; b = d.y / x;
  } else {
    face = d.y >= 0 ? 4 : 5; a = d.x / y; b = (face === 4 ? -d.z : d.z) / y;
  }
  return { face, u: clamp((a + 1) / 2, 0, 1), v: clamp((b + 1) / 2, 0, 1) };
}

export function tangentFrame(direction, rotation = 0, tangent = null) {
  const east = tangent ? tangent.clone().addScaledVector(direction, -tangent.dot(direction)).normalize()
    : new Vector3().crossVectors(Math.abs(direction.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1), direction).normalize();
  if (east.lengthSq() < 0.5) east.crossVectors(new Vector3(1, 0, 0), direction).normalize();
  const north = new Vector3().crossVectors(direction, east).normalize();
  return { east: east.clone().multiplyScalar(Math.cos(rotation)).addScaledVector(north, Math.sin(rotation)),
    north: north.clone().multiplyScalar(Math.cos(rotation)).addScaledVector(east, -Math.sin(rotation)) };
}

// Spherical exponential map: tangent distances stay physical at poles and seams.
export function offsetDirection(center, east, north, x, y, radius, target = new Vector3()) {
  const length = Math.hypot(x, y);
  if (length < 1e-12) return target.copy(center);
  const angle = length / radius;
  return target.copy(center).multiplyScalar(Math.cos(angle))
    .addScaledVector(east, Math.sin(angle) * x / length).addScaledVector(north, Math.sin(angle) * y / length).normalize();
}

export const brushAspect = (shape) => shape === 'ellipse' ? 0.45 : shape === 'ribbon' ? 0.18 : 1;
export const organicRadius = (theta, seed = 0) => 0.82 + 0.10 * Math.sin(theta * 3 + seed) + 0.08 * Math.cos(theta * 5 - seed);
export function scatterDabs(seed = 0, amount = 0.55) {
  return Array.from({ length: 7 }, (_, i) => {
    const theta = i * 2.3999632297 + seed;
    const r = i === 0 ? 0 : Math.sqrt(i / 7) * amount;
    return { x: Math.cos(theta) * r, y: Math.sin(theta) * r, radius: 0.22 };
  });
}

export function brushWeight(direction, center, frame, { radius, planetRadius, falloff = 0.75, shape = 'round', seed = 0, scatter = 0.55 }) {
  const dot = clamp(center.dot(direction), -1, 1), angle = Math.acos(dot);
  const distance = angle * planetRadius;
  if (distance > radius) return 0;
  const sin = Math.sqrt(Math.max(1 - dot * dot, 0));
  const factor = sin > 1e-10 ? distance / (sin * radius) : 0;
  const x = direction.dot(frame.east) * factor, y = direction.dot(frame.north) * factor;
  let t = distance / radius;
  if (shape === 'ellipse' || shape === 'ribbon') t = Math.hypot(x, y / brushAspect(shape));
  if (shape === 'organic') t /= organicRadius(Math.atan2(y, x), seed);
  if (shape === 'scatter') t = Math.min(...scatterDabs(seed, scatter).map((d) => Math.hypot(x - d.x, y - d.y) / d.radius));
  if (t >= 1) return 0;
  if (falloff <= 0 || t <= 1 - falloff) return 1;
  const f = clamp((1 - t) / falloff, 0, 1);
  return f * f * (3 - 2 * f);
}
