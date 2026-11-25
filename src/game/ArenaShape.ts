import { mulberry32 } from './math';

/**
 * The shape of one round's arena. Every arena is centred near (0, 0) and generated fresh from a
 * seed, so no two rounds look alike. Edges are organic (wobbly), never perfect circles or
 * rectangles.
 *
 *   blob      a rounded, lumpy area (most missions)
 *   corridor  a snaking band running left to right, about one screen tall (escort)
 */
export interface ArenaShape {
  kind: 'blob' | 'corridor';
  /** How far inside the edge (x, z) is: > 0 inside, < 0 outside (roughly in world units). */
  depth(x: number, z: number): number;
  /** Rough radius, for things that scatter around the middle. */
  radius: number;
  center: { x: number; z: number };
  /** Where the ship comes in, and where the exit gates go. */
  entry: { x: number; z: number };
  exits: { x: number; z: number }[];
  /** The edge as a closed loop of points (for the radar). */
  outline: { x: number; z: number }[];
  /** The corridor's centre line, left to right (corridors only). */
  path?: { x: number; z: number }[];
  /** The corridor's centre line height at x (corridors only). */
  centreZ?: (x: number) => number;
  /** The box the arena fits in. */
  bounds: { x0: number; z0: number; x1: number; z1: number };
}

/** An organic blob of about `radius`. */
export function blobArena(radius: number, seed: number): ArenaShape {
  const rand = mulberry32(seed * 7 + 1);
  const waves = [2, 3, 5, 7].map((k, i) => ({ k, amp: [0.1, 0.09, 0.05, 0.03][i] * (0.6 + rand() * 0.8), phase: rand() * Math.PI * 2 }));
  // Squash a little one way or the other, so it isn't always round.
  const sx = 0.85 + rand() * 0.3;
  const r = (a: number) => radius * (1 + waves.reduce((s, w) => s + w.amp * Math.sin(w.k * a + w.phase), 0));
  const depth = (x: number, z: number) => {
    const xx = x / sx;
    return r(Math.atan2(z, xx)) - Math.hypot(xx, z);
  };
  const at = (a: number) => ({ x: Math.cos(a) * r(a) * sx, z: Math.sin(a) * r(a) });
  const outline = Array.from({ length: 96 }, (_, i) => at((i / 96) * Math.PI * 2));
  const south = at(Math.PI / 2);
  const north = at(-Math.PI / 2);
  return {
    kind: 'blob',
    depth,
    radius,
    center: { x: 0, z: 0 },
    entry: { x: south.x, z: south.z - 16 },
    exits: [
      { x: north.x - 18, z: north.z + 26 },
      { x: north.x + 18, z: north.z + 26 },
    ],
    outline,
    bounds: boundsOf(outline),
  };
}

/**
 * A corridor `length` long running left to right, snaking up and down, `halfWidth` either side
 * of its centre line (about a screen tall in total, so you can see both edges).
 */
export function corridorArena(length: number, halfWidth: number, seed: number): ArenaShape {
  const rand = mulberry32(seed * 13 + 5);
  const p1 = rand() * Math.PI * 2;
  const p2 = rand() * Math.PI * 2;
  const p3 = rand() * Math.PI * 2;
  const p4 = rand() * Math.PI * 2;
  const amp = 22 + rand() * 14;
  const k = (Math.PI * 2) / (length * (0.55 + rand() * 0.25)); // one to two bends along its length
  const half = length / 2;
  const centre = (x: number) => amp * Math.sin(x * k + p1) + amp * 0.35 * Math.sin(x * k * 2.3 + p2);
  const width = (x: number) => halfWidth * (1 + 0.1 * Math.sin(x * 0.045 + p3) + 0.06 * Math.sin(x * 0.11 + p4));
  const endAt = (z: number) => half + 7 * Math.sin(z * 0.09 + p3); // the ends wobble too
  const depth = (x: number, z: number) => {
    const side = width(x) - Math.abs(z - centre(x));
    const end = endAt(z - centre(x)) - Math.abs(x);
    return Math.min(side, end);
  };
  const outline: { x: number; z: number }[] = [];
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const x = -half + (length * i) / steps;
    outline.push({ x, z: centre(x) - width(x) });
  }
  for (let i = steps; i >= 0; i--) {
    const x = -half + (length * i) / steps;
    outline.push({ x, z: centre(x) + width(x) });
  }
  const path: { x: number; z: number }[] = [];
  for (let x = -half + 18; x <= half - 18; x += 4) path.push({ x, z: centre(x) });
  const exitX = half - 26;
  return {
    kind: 'corridor',
    depth,
    radius: Math.min(half, halfWidth * 1.6),
    center: { x: 0, z: centre(0) },
    entry: { x: -half + 16, z: centre(-half + 16) },
    exits: [
      { x: exitX, z: centre(exitX) - halfWidth * 0.45 },
      { x: exitX, z: centre(exitX) + halfWidth * 0.45 },
    ],
    outline,
    path,
    centreZ: centre,
    bounds: boundsOf(outline),
  };
}

function boundsOf(points: { x: number; z: number }[]): ArenaShape['bounds'] {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    z0 = Math.min(z0, p.z);
    x1 = Math.max(x1, p.x);
    z1 = Math.max(z1, p.z);
  }
  return { x0, z0, x1, z1 };
}

/** Push (x, z) back inside the arena if it's within `margin` of the edge (or outside). */
export function pullInside(shape: ArenaShape, x: number, z: number, margin: number): { x: number; z: number } {
  for (let i = 0; i < 40 && shape.depth(x, z) < margin; i++) {
    // Step along the depth gradient (toward the inside).
    const e = 1;
    const gx = shape.depth(x + e, z) - shape.depth(x - e, z);
    const gz = shape.depth(x, z + e) - shape.depth(x, z - e);
    const g = Math.hypot(gx, gz) || 1;
    const step = Math.max(1, margin - shape.depth(x, z));
    x += (gx / g) * step;
    z += (gz / g) * step;
  }
  return { x, z };
}
