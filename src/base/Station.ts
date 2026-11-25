import * as THREE from 'three';
import { addOutlines, glow, outlineInstanced, rimToon, toon } from '../game/materials';
import { mulberry32 } from '../game/math';
import { Pilot } from './Pilot';
import { type Corridor, corridorLevel, CORRIDORS, heightAt, type Rect, ROOMS, SEALED, type Side, SIGNS, SPOTS, WALKABLE } from './Layout';

/** Retro-futuristic palette: warm cream panels, burnt orange trim, teal glass, deep space. */
export const STATION = {
  space: '#07050d',
  cream: '#e8dfcc',
  creamDark: '#bfb39b',
  orange: '#e2733a',
  teal: '#2f8f95',
  tealGlow: '#6ff7ff',
  navy: '#26304a',
  hull: '#161a2a',
  amber: '#ffb347',
  crt: '#7dff9a',
  red: '#ff4a4a',
};

const WALL_H = 5.2;
const WALL_T = 0.7;
const SEG = 6; // walls are built in short segments so each can cut away on its own
const DOOR_H = 5.7;

export interface Collider {
  x: number;
  z: number;
  r: number;
}

/** A piece of wall that turns see-through when it's between the camera and the pilot. */
export interface WallSegment {
  obj: THREE.Object3D;
  x: number;
  z: number;
  cut: number; // current opacity (1 = solid, lower = see-through)
  /** The room or corridor ('c<n>') whose near-side (south or east) wall this is, if any. */
  nearSideOf?: string;
}

/** A two-panel door that slides apart when you walk up to it. */
export interface SlidingDoor {
  left: THREE.Object3D;
  right: THREE.Object3D;
  light: THREE.MeshBasicMaterial;
  x: number;
  z: number;
  /** Half the doorway's width (how far each panel slides). */
  half: number;
  open: number; // 0 = shut, 1 = fully open
}

export interface StationParts {
  walls: WallSegment[];
  doors: SlidingDoor[];
  colliders: Collider[];
  holo: THREE.Object3D;
  planets: THREE.Object3D[];
  /** Things that spin or pulse (fans and the reactor far below). */
  spinners: THREE.Object3D[];
}

type Mats = Record<'cream' | 'creamDark' | 'orange' | 'navy' | 'teal' | 'dark', THREE.Material>;

/**
 * Builds the station interior: rectangular rooms and corridors on different levels (seen at an
 * isometric angle, like Diablo or the old Fallouts), with sliding doors between them, holes in
 * the floor dropping into the depths, and the rest of the huge station stretching away outside.
 */
export function buildStation(scene: THREE.Scene): StationParts {
  const g = new THREE.Group();
  scene.add(g);
  const parts: StationParts = { walls: [], doors: [], colliders: [], holo: new THREE.Group(), planets: [], spinners: [] };
  const m: Mats = {
    cream: rimToon(STATION.cream, '#ffd9a8', 0.3),
    creamDark: toon(STATION.creamDark),
    orange: rimToon(STATION.orange, '#ffd9a8', 0.35),
    navy: toon(STATION.navy),
    teal: toon(STATION.teal),
    dark: toon('#2a2438'),
  };

  buildSpace(g, parts);
  buildHull(g);

  // ---- Floors (with holes cut out), stairs, and the shafts under the holes ----
  const tile = floorTexture();
  const slabMat = toon(STATION.hull, { map: hullTexture() });
  for (const room of ROOMS) {
    for (const piece of subtract(room.rect, room.holes ?? [])) addFloor(g, piece, room.level, room.floor, tile, slabMat);
    for (const hole of room.holes ?? []) {
      shaft(g, parts, m, hole, room.level, room.id === 'hangar');
      railing(g, m, hole, room.level);
    }
  }
  for (const c of CORRIDORS) corridorFloor(g, c, tile, slabMat, m);

  // ---- Walls, windows and doorways ----
  for (const room of ROOMS) {
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      const gaps = room.gaps.filter((x) => x.side === side);
      const windows = (room.windows ?? []).filter((x) => x.side === side);
      const near = side === 's' || side === 'e' ? room.id : undefined;
      const h = room.sideHeights?.[side] ?? room.height;
      buildWallLine(g, parts, m, room.rect, side, gaps, windows, () => [room.level, room.level], h, [], near);
      for (const gap of gaps) doorway(g, parts, m, room.rect, side, gap.a, gap.b, room.level, h, room.id === 'hangar' && side === 'n', near);
    }
  }
  for (const [ci, c] of CORRIDORS.entries()) {
    const sides: Side[] = c.axis === 'ns' ? ['e', 'w'] : ['n', 's'];
    const levelsOver = (s0: number, s1: number): [number, number] => {
      const at = (u: number) => (c.axis === 'ns' ? corridorLevel(c, 0, u) : corridorLevel(c, u, 0));
      const h0 = at(s0);
      const h1 = at(s1);
      return [Math.min(h0, h1), Math.max(h0, h1)];
    };
    const extra = c.stairs ? [c.stairs[0], c.stairs[1]] : [];
    for (const side of sides) {
      const near = side === 's' || side === 'e' ? `c${ci}` : undefined;
      buildWallLine(g, parts, m, c.rect, side, (c.gaps ?? []).filter((x) => x.side === side), [], levelsOver, WALL_H, extra, near);
    }
  }
  for (const d of SEALED) sealedDoor(g, parts, m, d.x, d.z, d.axis, d.label);
  for (const s of SIGNS) {
    const sign = label(s.text, '#f2c46d', 13);
    sign.position.set(s.x, heightAt(s.x, s.z) + WALL_H + 0.9, s.z);
    g.add(sign);
  }

  // ---- Rooms (each one's decor sits on its own floor level) ----
  const decor: [string, (g: THREE.Group, parts: StationParts, m: Mats) => void][] = [
    ['concourse', concourse],
    ['armory', armory],
    ['boutique', boutique],
    ['hangar', hangar],
    ['quarters', quarters],
  ];
  for (const [id, build] of decor) {
    const rg = new THREE.Group();
    rg.position.y = ROOMS.find((r) => r.id === id)!.level;
    g.add(rg);
    build(rg, parts, m);
  }

  addOutlines(g);
  return parts;
}

// ---------------------------------------------------------------- structure

/** A rectangle minus some holes, as a few solid rectangles (holes must lie inside). */
function subtract(r: Rect, holes: Rect[]): Rect[] {
  let pieces = [r];
  for (const h of holes) {
    const next: Rect[] = [];
    for (const p of pieces) {
      if (h.x1 <= p.x0 || h.x0 >= p.x1 || h.z1 <= p.z0 || h.z0 >= p.z1) {
        next.push(p);
        continue;
      }
      if (h.z0 > p.z0) next.push({ ...p, z1: h.z0 });
      if (h.z1 < p.z1) next.push({ ...p, z0: h.z1 });
      const z0 = Math.max(p.z0, h.z0);
      const z1 = Math.min(p.z1, h.z1);
      if (h.x0 > p.x0) next.push({ x0: p.x0, x1: h.x0, z0, z1 });
      if (h.x1 < p.x1) next.push({ x0: h.x1, x1: p.x1, z0, z1 });
    }
    pieces = next;
  }
  return pieces;
}

function addFloor(g: THREE.Group, r: Rect, level: number, color: string, tile: THREE.Texture, slabMat: THREE.Material, under = 4): void {
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  const tex = tile.clone();
  tex.needsUpdate = true;
  tex.repeat.set(w / 4, d / 4);
  tex.offset.set(r.x0 / 4, r.z0 / 4); // keep the tiles lined up across pieces
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), toon(color, { map: tex }));
  floor.position.set((r.x0 + r.x1) / 2, level - 0.25, (r.z0 + r.z1) / 2);
  floor.userData.noOutline = true;
  // Thick hull plating underneath (you see its edges around holes and stairs).
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, under, d + 0.01), slabMat);
  slab.position.set(floor.position.x, level - 0.5 - under / 2, floor.position.z);
  slab.userData.noOutline = true;
  g.add(floor, slab);
}

/** A corridor's floor: flat at each end, with a flight of stairs between if it changes level. */
function corridorFloor(g: THREE.Group, c: Corridor, tile: THREE.Texture, slabMat: THREE.Material, m: Mats): void {
  const r = c.rect;
  const color = '#a99f8e';
  if (!c.levels || !c.stairs) {
    addFloor(g, r, c.levels?.[0] ?? 0, color, tile, slabMat);
    return;
  }
  const [l0, l1] = c.levels;
  const [a, b] = c.stairs;
  const ns = c.axis === 'ns';
  const span = (u0: number, u1: number): Rect => (ns ? { ...r, z0: u0, z1: u1 } : { ...r, x0: u0, x1: u1 });
  const start = ns ? r.z0 : r.x0;
  const end = ns ? r.z1 : r.x1;
  const low = Math.min(l0, l1);
  if (a > start) addFloor(g, span(start, a), l0, color, tile, slabMat);
  if (b < end) addFloor(g, span(b, end), l1, color, tile, slabMat);
  const steps = Math.max(2, Math.round(Math.abs(l1 - l0) / 0.5));
  for (let i = 0; i < steps; i++) {
    const u0 = a + ((b - a) * i) / steps;
    const u1 = a + ((b - a) * (i + 1)) / steps;
    // Each step's top sits at the height you'd be at halfway across it.
    const top = l0 + (l1 - l0) * ((i + 0.5) / steps);
    addFloor(g, span(u0, u1), top, color, tile, slabMat, top - low + 4);
    // A glowing nosing strip on each step's edge.
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(ns ? r.x1 - r.x0 - 1 : 0.15, 0.08, ns ? 0.15 : r.z1 - r.z0 - 1),
      glow(STATION.amber, {}, 1.1),
    );
    const edgeU = l1 > l0 ? u0 : u1; // the step's front edge faces downhill
    edge.position.set(ns ? (r.x0 + r.x1) / 2 : edgeU, top + 0.02, ns ? edgeU : (r.z0 + r.z1) / 2);
    edge.userData.noOutline = true;
    g.add(edge);
  }
  // Handrails along both sides of the stairs.
  for (const s of [0, 1]) {
    const len = b - a;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(ns ? 0.2 : len, 0.2, ns ? len : 0.2), m.orange);
    const side = ns ? (s ? r.x1 - 0.6 : r.x0 + 0.6) : s ? r.z1 - 0.6 : r.z0 + 0.6;
    rail.position.set(ns ? side : (a + b) / 2, (l0 + l1) / 2 + 1.1, ns ? (a + b) / 2 : side);
    const tilt = Math.atan2(l1 - l0, len);
    if (ns) rail.rotation.x = -tilt;
    else rail.rotation.z = tilt;
    g.add(rail);
  }
}

/**
 * One side of a rectangle as wall segments, leaving gaps (doorways) and windows.
 * `levels(s0, s1)` gives the [lowest, highest] floor along a stretch, so walls beside stairs
 * reach down to the lower floor and up past the higher one.
 */
function buildWallLine(
  g: THREE.Group,
  parts: StationParts,
  m: Mats,
  r: Rect,
  side: Side,
  gaps: { a: number; b: number }[],
  windows: { a: number; b: number }[],
  levels: (s0: number, s1: number) => [number, number],
  height: number,
  extraCuts: number[] = [],
  nearSideOf?: string,
): void {
  const alongX = side === 'n' || side === 's';
  const start = alongX ? r.x0 : r.z0;
  const end = alongX ? r.x1 : r.z1;
  const fixed = side === 'n' ? r.z0 : side === 's' ? r.z1 : side === 'w' ? r.x0 : r.x1;
  // Split [start, end] into pieces that are solid, window, or open.
  const cuts = [start, end, ...gaps.flatMap((x) => [x.a, x.b]), ...windows.flatMap((x) => [x.a, x.b]), ...extraCuts]
    .filter((u) => u >= start && u <= end)
    .sort((a, b) => a - b);
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (b - a < 0.01) continue;
    const mid = (a + b) / 2;
    if (gaps.some((x) => mid > x.a && mid < x.b)) continue;
    const isWindow = windows.some((x) => mid > x.a && mid < x.b);
    // Chop long runs into short segments so they can cut away independently.
    const n = Math.max(1, Math.round((b - a) / SEG));
    for (let k = 0; k < n; k++) {
      const s0 = a + ((b - a) * k) / n;
      const s1 = a + ((b - a) * (k + 1)) / n;
      const c = (s0 + s1) / 2;
      const x = alongX ? c : fixed;
      const z = alongX ? fixed : c;
      const [lo, hi] = levels(s0, s1);
      const h = height + (hi - lo);
      const seg = isWindow ? windowPiece(m, s1 - s0, h) : wallPiece(m, s1 - s0, h);
      seg.position.set(x, lo, z);
      if (!alongX) seg.rotation.y = Math.PI / 2;
      g.add(seg);
      parts.walls.push({ obj: seg, x, z, cut: 1, nearSideOf });
    }
  }
}

function wallPiece(m: Mats, len: number, h: number): THREE.Group {
  const seg = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_T, h, WALL_T), m.cream);
  body.position.y = h / 2;
  const trim = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_T + 0.05, 0.35, WALL_T + 0.1), m.orange);
  trim.position.y = h - 0.15;
  const base = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_T + 0.05, 0.5, WALL_T + 0.1), m.navy);
  base.position.y = 0.25;
  const light = new THREE.Mesh(new THREE.BoxGeometry(len * 0.6, 0.12, WALL_T + 0.12), glow(STATION.amber, {}, 1.2));
  light.position.y = Math.min(3.2, h - 1);
  seg.add(body, trim, base, light);
  if (h > 8) {
    // Tall walls get a second band of trim and a glowing upper strip.
    const band = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_T + 0.05, 0.3, WALL_T + 0.1), m.orange);
    band.position.y = 6.2;
    const upper = new THREE.Mesh(new THREE.BoxGeometry(len * 0.8, 0.14, WALL_T + 0.12), glow(STATION.tealGlow, {}, 1));
    upper.position.y = h - 1.4;
    seg.add(band, upper);
  }
  return seg;
}

function windowPiece(m: Mats, len: number, h: number): THREE.Group {
  const seg = new THREE.Group();
  const sill = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_T, 1.3, WALL_T), m.navy);
  sill.position.y = 0.65;
  const header = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_T, 0.8, WALL_T), m.cream);
  header.position.y = h - 0.4;
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(len, h - 2.1),
    glow('#7fe8ff', { transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }, 1),
  );
  glass.position.y = 1.3 + (h - 2.1) / 2;
  glass.userData.noOutline = true;
  seg.add(sill, header, glass);
  for (const s of [-1, 1]) {
    // Wide and deep enough to cover where the sill, header and neighbouring wall overlap
    // (their faces line up there, which flickers if it's left showing).
    const post = new THREE.Mesh(new THREE.BoxGeometry(WALL_T + 0.3, h + 0.02, WALL_T + 0.25), m.orange);
    post.position.set((s * len) / 2, h / 2, 0);
    seg.add(post);
  }
  if (h > 8) {
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, WALL_T + 0.05), m.orange);
    mullion.position.y = 6.2;
    seg.add(mullion);
  }
  return seg;
}

/**
 * A doorway in a room wall: a chunky frame, sliding door panels (except the hangar's open bay
 * door, which has a force field instead), and wall above the door in tall rooms.
 */
function doorway(
  g: THREE.Group,
  parts: StationParts,
  m: Mats,
  r: Rect,
  side: Side,
  a: number,
  b: number,
  level: number,
  roomH: number,
  bay: boolean,
  nearSideOf?: string,
): void {
  const alongX = side === 'n' || side === 's';
  const fixed = side === 'n' ? r.z0 : side === 's' ? r.z1 : side === 'w' ? r.x0 : r.x1;
  const frame = new THREE.Group();
  const span = b - a;
  const h = bay ? roomH : DOOR_H;
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1, h, 1.1), m.cream);
    post.position.set((s * span) / 2, h / 2, 0);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.5, 1.15), m.orange);
    stripe.position.set((s * span) / 2, 1.8, 0);
    frame.add(post, stripe);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(span + 1, 0.8, 1.2), m.cream);
  lintel.position.y = h;
  const threshold = new THREE.Mesh(new THREE.PlaneGeometry(span, 0.3), glow(bay ? STATION.tealGlow : STATION.amber, {}, 1.3));
  threshold.rotation.x = -Math.PI / 2;
  threshold.position.y = 0.03;
  frame.add(lintel, threshold);
  if (!bay && roomH > DOOR_H + 1) {
    // Fill the wall above the door in tall rooms.
    const above = new THREE.Mesh(new THREE.BoxGeometry(span, roomH - h - 0.4, WALL_T), m.cream);
    above.position.y = h + 0.4 + (roomH - h - 0.4) / 2;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(span + 0.05, 0.35, WALL_T + 0.1), m.orange);
    trim.position.y = roomH - 0.15;
    frame.add(above, trim);
  }
  if (bay) {
    // Force field holding the air in, across the hangar's bay door.
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(span, h),
      glow('#6ff7ff', { transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }, 1),
    );
    field.position.y = h / 2;
    field.userData.noOutline = true;
    frame.add(field);
  } else {
    // Two panels that slide apart into the walls.
    const light = glow(STATION.red, {}, 1.6) as THREE.MeshBasicMaterial;
    const panels: THREE.Group[] = [];
    for (const s of [-1, 1]) {
      const panel = new THREE.Group();
      const slab = new THREE.Mesh(new THREE.BoxGeometry(span / 2, h - 0.2, 0.45), m.navy);
      slab.position.set((s * span) / 4, (h - 0.2) / 2, 0);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(span / 2 - 0.4, 0.6, 0.5), m.orange);
      stripe.position.set((s * span) / 4, h * 0.45, 0);
      const window = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.52), glow(STATION.tealGlow, { transparent: true, opacity: 0.5 }, 0.9));
      window.position.set((s * span) / 4, h * 0.72, 0);
      // The glowing seam where the panels meet.
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.12, h - 0.4, 0.55), light);
      seam.position.set(s * 0.06, (h - 0.2) / 2, 0);
      panel.add(slab, stripe, window, seam);
      frame.add(panel);
      panels.push(panel);
    }
    parts.doors.push({
      left: panels[0],
      right: panels[1],
      light,
      x: alongX ? (a + b) / 2 : fixed,
      z: alongX ? fixed : (a + b) / 2,
      half: span / 2,
      open: 0,
    });
  }
  frame.position.set(alongX ? (a + b) / 2 : fixed, level, alongX ? fixed : (a + b) / 2);
  if (!alongX) frame.rotation.y = Math.PI / 2;
  g.add(frame);
  // The bay door is on the far (north) side, so it never needs to cut away.
  if (!bay) parts.walls.push({ obj: frame, x: frame.position.x, z: frame.position.z, cut: 1, nearSideOf });
}

function sealedDoor(g: THREE.Group, parts: StationParts, m: Mats, x: number, z: number, axis: 'ns' | 'ew', text: string): void {
  const door = new THREE.Group();
  const w = axis === 'ew' ? 8 : 6;
  const panel = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, 0.8), m.navy);
  panel.position.y = WALL_H / 2;
  door.add(panel);
  for (let i = 0; i < 5; i++) {
    // Hazard chevrons.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.7, WALL_H * 0.9, 0.85), m.orange);
    stripe.position.set(-w / 2 + 0.8 + i * ((w - 1.6) / 4), WALL_H / 2, 0);
    stripe.rotation.z = 0.5;
    door.add(stripe);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), glow(STATION.red, {}, 2));
  lamp.position.set(0, WALL_H + 0.3, 0.3);
  const sign = label(text, '#ff8a8a', 11);
  sign.position.set(0, WALL_H + 1.5, 0);
  door.add(lamp, sign);
  door.position.set(x, heightAt(x, z), z);
  if (axis === 'ns') door.rotation.y = Math.PI / 2;
  g.add(door);
  parts.walls.push({ obj: door, x, z, cut: 1 });
}

/** A railing around a hole in the floor. */
function railing(g: THREE.Group, m: Mats, h: Rect, level: number): void {
  const rail = 1.1;
  const edges: [number, number, number, number][] = [
    [h.x0, h.z0, h.x1, h.z0],
    [h.x0, h.z1, h.x1, h.z1],
    [h.x0, h.z0, h.x0, h.z1],
    [h.x1, h.z0, h.x1, h.z1],
  ];
  for (const [x0, z0, x1, z1] of edges) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const top = new THREE.Mesh(new THREE.BoxGeometry(x1 === x0 ? 0.25 : len + 0.25, 0.22, z1 === z0 ? 0.25 : len + 0.25), m.orange);
    top.position.set((x0 + x1) / 2, level + rail, (z0 + z1) / 2);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(x1 === x0 ? 0.3 : len, 0.3, z1 === z0 ? 0.3 : len), glow(STATION.amber, {}, 1.1));
    lip.position.set((x0 + x1) / 2, level + 0.15, (z0 + z1) / 2);
    lip.userData.noOutline = true;
    g.add(top, lip);
    const n = Math.max(2, Math.round(len / 1.6));
    for (let i = 0; i <= n; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, rail, 0.16), m.navy);
      post.position.set(x0 + ((x1 - x0) * i) / n, level + rail / 2, z0 + ((z1 - z0) * i) / n);
      g.add(post);
    }
  }
}

/**
 * The depths under a hole in the floor: a shaft dropping away past lower decks, catwalks and
 * pipes, to a glowing reactor (or, in the hangar, a cargo lift halfway down).
 */
function shaft(g: THREE.Group, parts: StationParts, m: Mats, h: Rect, level: number, cargo: boolean): void {
  const depth = 64;
  const w = h.x1 - h.x0;
  const d = h.z1 - h.z0;
  const cx = (h.x0 + h.x1) / 2;
  const cz = (h.z0 + h.z1) / 2;
  const wallMat = toon('#4a5272', { side: THREE.BackSide, map: shaftTexture() });
  // The shaft is a box seen from the inside (its faces point inward).
  // Set a little inside the hole, in front of the floor slab's edges, so no faces overlap (z-fighting).
  const inset = 0.15;
  const top = level - 0.55;
  const box = new THREE.Mesh(new THREE.BoxGeometry(w - inset * 2, depth, d - inset * 2), wallMat);
  box.position.set(cx, top - depth / 2, cz);
  box.userData.noOutline = true;
  g.add(box);
  const lights = [glow(STATION.amber, {}, 1.3), glow(STATION.tealGlow, {}, 1.1)];
  // Bands of light ringing the shaft, further apart as it goes down (lower decks).
  for (let i = 0, y = level - 3; y > level - depth + 4; i++, y -= 4 + i) {
    for (const [px, pz, lw, ld] of [
      [cx, h.z0 + 0.25, w - 0.6, 0.1],
      [cx, h.z1 - 0.25, w - 0.6, 0.1],
      [h.x0 + 0.25, cz, 0.1, d - 0.6],
      [h.x1 - 0.25, cz, 0.1, d - 0.6],
    ] as const) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(lw, 0.25, ld), lights[i % 2]);
      band.position.set(px, y, pz);
      band.userData.noOutline = true;
      g.add(band);
    }
  }
  // Pipes running down the corners.
  for (const [px, pz] of [
    [h.x0 + 0.5, h.z0 + 0.5],
    [h.x1 - 0.5, h.z1 - 0.5],
  ]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, depth, 8), m.creamDark);
    pipe.position.set(px, level - depth / 2, pz);
    g.add(pipe);
  }
  if (cargo) {
    // A cargo lift parked partway down, stacked with crates.
    const lift = new THREE.Mesh(new THREE.BoxGeometry(w - 0.6, 0.6, d - 0.6), m.navy);
    lift.position.set(cx, level - 16, cz);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(w - 0.4, 0.2, d - 0.4), m.orange);
    stripe.position.set(cx, level - 16, cz); // a band around the lift's edge, below its top
    g.add(lift, stripe);
    for (const [ox, oz, s] of [[-1.2, -1, 1.6], [1.2, 0.8, 1.3], [0.2, -1.4, 1.1]] as const) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), m.teal);
      crate.position.set(cx + ox, level - 15.7 + s / 2, cz + oz);
      g.add(crate);
    }
    return;
  }
  // Catwalks crossing the shaft at two depths.
  for (const [y, along] of [[level - 14, true], [level - 30, false]] as const) {
    const walk = new THREE.Mesh(new THREE.BoxGeometry(along ? w : 1.6, 0.3, along ? 1.6 : d), m.creamDark);
    walk.position.set(cx, y, cz);
    const railMesh = new THREE.Mesh(new THREE.BoxGeometry(along ? w : 0.1, 0.1, along ? 0.1 : d), m.orange);
    railMesh.position.set(cx + (along ? 0 : 0.75), y + 0.9, cz + (along ? 0.75 : 0));
    g.add(walk, railMesh);
  }
  // The reactor core glowing far below, with slowly turning rings.
  const core = new THREE.Mesh(new THREE.SphereGeometry(Math.min(w, d) * 0.3, 20, 14), glow('#ff9a5a', { fog: false }, 2.4));
  core.position.set(cx, level - depth + 8, cz);
  core.userData.noOutline = true;
  g.add(core);
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.min(w, d) * (0.38 + i * 0.08), 0.12, 6, 32), glow(STATION.tealGlow, {}, 1.4));
    ring.position.copy(core.position);
    ring.rotation.x = Math.PI / 2 + i * 0.6;
    ring.userData.noOutline = true;
    g.add(ring);
    parts.spinners.push(ring);
  }
  const glowPool = new THREE.PointLight('#ff9a5a', 400, 70, 1.6);
  glowPool.position.copy(core.position).setY(core.position.y + 6);
  g.add(glowPool);
}

// ---------------------------------------------------------------- the rooms

function concourse(g: THREE.Group, parts: StationParts, m: Mats): void {
  const { x: bx, z: bz } = SPOTS.bot;
  // Information desk on a round raised dais: a curved counter wrapping the robot attendant.
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 5.1, 0.35, 32), m.navy);
  dais.position.set(bx, 0.17, bz);
  const daisRing = new THREE.Mesh(new THREE.TorusGeometry(4.95, 0.08, 6, 48), glow(STATION.tealGlow, {}, 1.3));
  daisRing.rotation.x = Math.PI / 2;
  daisRing.position.set(bx, 0.36, bz);
  daisRing.userData.noOutline = true;
  const desk = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.9, 10, 28, Math.PI * 1.1), m.cream);
  desk.rotation.set(Math.PI / 2, 0, -0.05 * Math.PI);
  desk.position.set(bx, 1.2, bz);
  const top = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.35, 6, 28, Math.PI * 1.1), m.orange);
  top.rotation.copy(desk.rotation);
  top.position.set(bx, 2.05, bz);
  g.add(dais, daisRing, desk, top);
  const info = label('INFORMATION', '#6ff7ff', 12);
  info.position.set(bx, 6.5, bz - 1.5);
  g.add(info);
  parts.colliders.push({ x: bx, z: bz, r: 4.6 });

  // Columns along the side walls, with glowing capitals, holding up the high ceiling.
  for (const [x, z] of [[-17, -8], [-17, 9], [17, -8], [17, 9], [-11, -12.8], [11, -12.8]] as const) {
    const pillar = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 11, 12), m.cream);
    col.position.y = 5.5;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.7, 12), m.orange);
    foot.position.y = 0.35;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 0.8, 0.8, 12), m.orange);
    cap.position.y = 10.4;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.08, 6, 20), glow(STATION.amber, {}, 1.4));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 7.5;
    ring.userData.noOutline = true;
    pillar.add(col, foot, cap, ring);
    pillar.position.set(x, 0, z);
    g.add(pillar);
    parts.walls.push({ obj: pillar, x, z, cut: 1 });
    parts.colliders.push({ x, z, r: 1.1 });
  }

  // A balcony along the back (north) wall: the upper level of the concourse.
  const upper = new THREE.Group();
  g.add(upper);
  parts.walls.push({ obj: upper, x: 0, z: -12.5, cut: 1 });
  const balcony = new THREE.Mesh(new THREE.BoxGeometry(36, 0.6, 3), m.creamDark);
  balcony.position.set(0, 6.3, -12.5);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(36, 0.25, 0.3), glow(STATION.amber, {}, 1.2));
  lip.position.set(0, 6.0, -11);
  lip.userData.noOutline = true;
  upper.add(balcony, lip);
  // The railing stops either side of the middle, where the leaderboard hangs in front.
  const GAP = 8.6;
  for (const side of [-1, 1]) {
    const len = 18 - GAP;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.2, 0.2), m.orange);
    rail.position.set(side * (GAP + len / 2), 7.6, -11.1);
    upper.add(rail);
  }
  for (let x = -17; x <= 17; x += 1.7) {
    if (Math.abs(x) < GAP) continue;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.12), m.navy);
    post.position.set(x, 6.95, -11.1);
    upper.add(post);
  }
  // Station directory board.
  const directory = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 0.4), m.navy);
  board.position.y = 3.2;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.6), glow(STATION.tealGlow, { map: directoryTexture() }, 1.1));
  screen.position.set(0, 3.2, 0.22);
  directory.add(board, screen);
  directory.position.set(-17.45, 0, 7);
  directory.rotation.y = Math.PI / 2;
  g.add(directory);
  parts.walls.push({ obj: directory, x: -18, z: 7, cut: 1 });

  // Benches beside the light well, and plants.
  for (const [x, z] of [[-11, 7], [11, 7]] as const) {
    const bench = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 4, 4, 10), m.orange);
    bench.rotation.x = Math.PI / 2;
    bench.position.set(x, 0.7, z);
    g.add(bench);
    parts.colliders.push({ x, z: z - 1.6, r: 1 }, { x, z: z + 1.6, r: 1 });
  }
  for (const [x, z] of [[-16, 14], [16, 14], [14, -11], [-14, -11]] as const) plant(g, parts, m, x, z);

  // Holographic station map spinning over a plinth.
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 1, 16), m.cream);
  plinth.position.set(10, 0.5, -6);
  const holo = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), glow(STATION.tealGlow, { wireframe: true, transparent: true, opacity: 0.7 }, 1.5));
  holo.position.set(10, 2.6, -6);
  parts.holo = holo;
  g.add(plinth, holo);
  parts.colliders.push({ x: 10, z: -6, r: 1.6 });
}

function armory(g: THREE.Group, parts: StationParts, m: Mats): void {
  // Counter with Rook behind it (north side).
  const counter = new THREE.Mesh(new THREE.BoxGeometry(10, 1.8, 1.8), m.cream);
  counter.position.set(-36, 0.9, -1.5);
  const top = new THREE.Mesh(new THREE.BoxGeometry(10.3, 0.25, 2.1), m.orange);
  top.position.set(-36, 1.9, -1.5);
  const crt = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.1), m.creamDark);
  crt.position.set(-39.5, 2.6, -1.5);
  const crtScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), glow(STATION.crt, {}, 1.3));
  crtScreen.position.set(-39.5, 2.62, -0.94);
  g.add(counter, top, crt, crtScreen);
  for (const x of [-40, -36, -32]) parts.colliders.push({ x, z: -1.5, r: 1.6 });
  // Weapon racks on the back wall.
  for (let i = 0; i < 4; i++) {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(3, 3.4, 0.6), m.navy);
    rack.position.set(-43 + i * 4, 2.1, -9.4);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 0.3), glow(i % 2 ? STATION.amber : STATION.tealGlow, {}, 1.2));
    gun.position.set(-43 + i * 4, 2.5, -9.05);
    g.add(rack, gun);
  }
  // Crates.
  const rand = mulberry32(3);
  for (const [x, z, s] of [[-44, 7, 1.6], [-42.4, 7.8, 1.2], [-44.2, 4.8, 1.3], [-29, 7.5, 1.5], [-30.6, 8, 1]] as const) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), rand() < 0.5 ? m.teal : m.navy);
    crate.position.set(x, s / 2, z);
    crate.rotation.y = rand();
    const band = new THREE.Mesh(new THREE.BoxGeometry(s * 1.02, s * 0.15, s * 1.02), m.orange);
    band.position.copy(crate.position);
    band.rotation.copy(crate.rotation);
    g.add(crate, band);
    parts.colliders.push({ x, z, r: s * 0.8 });
  }
}

function boutique(g: THREE.Group, parts: StationParts, m: Mats): void {
  // Wardrobe pods along the back wall.
  for (let i = 0; i < 3; i++) {
    const x = 31 + i * 5;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.5, 16), m.orange);
    base.position.set(x, 0.25, -7.5);
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(1.05, 2.4, 4, 16), glow('#9ff4ff', { transparent: true, opacity: 0.16, depthWrite: false }, 1));
    pod.position.set(x, 2.2, -7.5);
    pod.userData.noOutline = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.07, 6, 24), glow(['#ff5fd2', '#6ff7ff', '#ffd36b'][i], {}, 1.6));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 3.8, -7.5);
    const suit = new Pilot(['crimson', 'arctic', 'jungle'][i], ['tactical', 'dome', 'fishbowl'][i]);
    suit.root.position.set(x, 0.5, -7.5);
    suit.root.rotation.y = Math.PI;
    suit.root.scale.setScalar(0.85);
    g.add(base, pod, ring, suit.root);
    parts.colliders.push({ x, z: -7.5, r: 1.6 });
  }
  // A full-length mirror, a round rug, and a little runway light strip.
  const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.5, 2.6), m.cream);
  mirror.position.set(44.6, 2.25, 4);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 3.8), glow('#c8f6ff', { transparent: true, opacity: 0.5 }, 1));
  glass.rotation.y = -Math.PI / 2;
  glass.position.set(44.35, 2.3, 4);
  const rug = new THREE.Mesh(new THREE.RingGeometry(1.4, 3.2, 40), toon('#8a3a7e'));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(36, 0.02, 3);
  rug.userData.noOutline = true;
  g.add(mirror, glass, rug);
  for (let i = 0; i < 6; i++) {
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.25, 12), glow('#ff5fd2', {}, 1.6));
    dot.rotation.x = -Math.PI / 2;
    dot.position.set(28.5 + i * 1.8, 0.03, 8.5);
    g.add(dot);
  }
  plant(g, parts, m, 44, -8.5);
}

function hangar(g: THREE.Group, parts: StationParts, m: Mats): void {
  const { x: px, z: pz } = SPOTS.pad;
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.4, 0.4, 6), m.navy);
  pad.position.set(px, 0.2, pz);
  const ring = new THREE.Mesh(new THREE.RingGeometry(5.9, 6.5, 6), glow(STATION.amber, { side: THREE.DoubleSide }, 1.5));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(px, 0.42, pz);
  g.add(pad, ring);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const chev = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.55), m.orange);
    chev.position.set(px + Math.cos(a) * 7.8, 0.05, pz + Math.sin(a) * 7.8);
    chev.rotation.y = -a;
    g.add(chev);
  }
  parts.colliders.push({ x: px, z: pz, r: 6.2 });
  // Yellow guide lanes from the doorway to the pad.
  for (const s of [-1, 1]) {
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 14), glow('#ffd36b', {}, 1));
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(s * 3.5, 0.02, -29);
    g.add(lane);
  }
  // Pip's corner (west side): his desk faces the room, he stands behind it, and behind him a
  // workbench runs along the wall under a pegboard of hanging parts, with windows either side.
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2, 1.3, 5.5), m.navy);
  desk.position.set(-11.5, 0.65, -36);
  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.2, 5.8), m.orange);
  deskTop.position.set(-11.5, 1.4, -36);
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.1, 1.8), glow(STATION.tealGlow, {}, 1.2));
  screen.position.set(-12.1, 2.15, -37.3);
  screen.rotation.y = 0.15;
  const datapad = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.9), m.cream);
  datapad.position.set(-11.3, 1.55, -34.8);
  g.add(desk, deskTop, screen, datapad);
  parts.colliders.push({ x: -11.5, z: -37.6, r: 1.4 }, { x: -11.5, z: -34.4, r: 1.4 });

  const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 8), m.navy);
  bench.position.set(-19.6, 0.7, -36);
  const benchTop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 8.2), m.creamDark);
  benchTop.position.set(-19.6, 1.45, -36);
  const vice = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), m.dark);
  vice.position.set(-19.4, 1.85, -38.5);
  const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.6, 8), m.cream);
  engine.rotation.x = Math.PI / 2;
  engine.position.set(-19.6, 2.25, -35);
  g.add(bench, benchTop, vice, engine);
  parts.colliders.push({ x: -19.6, z: -38.5, r: 1.5 }, { x: -19.6, z: -33.5, r: 1.5 });
  // Pegboard with tools and spare parts hanging on it.
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5, 8.6), m.creamDark);
  board.position.set(-20.6, 4.2, -36);
  g.add(board);
  const hang = (mesh: THREE.Mesh, y: number, z: number, rx = 0) => {
    mesh.position.set(-20.35, y, z);
    mesh.rotation.x = rx;
    g.add(mesh);
  };
  hang(new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.18, 6, 10), m.orange), 5.2, -38.6, 0);
  hang(new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.12, 6, 10), m.teal), 3.4, -38.9, 0);
  for (const [z, len] of [[-37.2, 1.6], [-36.6, 1.2], [-36.1, 1.9]] as const) hang(new THREE.Mesh(new THREE.BoxGeometry(0.12, len, 0.22), m.dark), 4.6, z);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 3.4), m.cream);
  hang(blade, 6.2, -34.6, 0.25);
  hang(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.6, 8), m.teal), 3.6, -33.6, Math.PI / 2);
  hang(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.9, 1.3), m.navy), 3.4, -35.2);
  // Robot arm over the bench.
  const armBase = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.5, 8), m.dark);
  armBase.position.set(-19.8, 1.8, -32.6);
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.8, 4, 8), m.cream);
  arm.position.set(-19.4, 2.8, -33.2);
  arm.rotation.x = 0.7;
  g.add(armBase, arm);
  // Fuel tanks and crates.
  for (const [x, z] of [[18, -27], [18, -31.5], [14.5, -27]] as const) {
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 2, 4, 12), m.cream);
    tank.position.set(x, 2.3, z);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.36, 1.36, 0.4, 14), m.orange);
    band.position.set(x, 2.3, z);
    g.add(tank, band);
    parts.colliders.push({ x, z, r: 1.6 });
  }
  for (const [x, z, s] of [[-17, -26, 1.8], [-15, -25, 1.2], [-17.5, -49, 1.6]] as const) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), m.teal);
    crate.position.set(x, s / 2, z);
    g.add(crate);
    parts.colliders.push({ x, z, r: s * 0.8 });
  }
}

function quarters(g: THREE.Group, parts: StationParts, m: Mats): void {
  // Bunk bed against the west wall.
  for (const y of [0.9, 3]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.4, 5.4), m.navy);
    frame.position.set(-32.3, y, 20.5);
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 5.1), m.cream);
    mattress.position.set(-32.3, y + 0.35, 20.5);
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.2, 3), m.orange);
    blanket.position.set(-32.3, y + 0.55, 21.5);
    g.add(frame, mattress, blanket);
  }
  for (const z of [17.9, 23.1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.3), m.navy);
    post.position.set(-31.2, 2, z);
    g.add(post);
  }
  parts.colliders.push({ x: -32.3, z: 19, r: 1.8 }, { x: -32.3, z: 22, r: 1.8 });
  // Locker, desk with a lamp, and a photo frame.
  const locker = new THREE.Mesh(new THREE.BoxGeometry(1.8, 4, 1.4), m.teal);
  locker.position.set(-32.6, 2, 28.6);
  const vent = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.1), m.dark);
  vent.position.set(-31.7, 3.2, 28.6);
  vent.rotation.y = Math.PI / 2;
  g.add(locker, vent);
  parts.colliders.push({ x: -32.6, z: 28.6, r: 1.3 });
  const desk = new THREE.Mesh(new THREE.BoxGeometry(4, 1.3, 1.8), m.cream);
  desk.position.set(-21.5, 0.65, 16.6);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), glow(STATION.amber, {}, 1.8));
  lamp.position.set(-20.4, 2, 16.4);
  const photo = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.1), m.orange);
  photo.position.set(-22.4, 1.7, 16.2);
  photo.rotation.x = -0.25;
  g.add(desk, lamp, photo);
  parts.colliders.push({ x: -21.5, z: 16.6, r: 2 });
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), toon('#7a2b2b'));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-26, 0.02, 24);
  rug.userData.noOutline = true;
  g.add(rug);
  plant(g, parts, m, -19.5, 29.5);
}

function plant(g: THREE.Group, parts: StationParts, m: Mats, x: number, z: number): void {
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.7, 1.2, 12), m.cream);
  pot.position.set(x, 0.6, z);
  g.add(pot);
  const leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), toon('#ffffff'), 5);
  for (let i = 0; i < 5; i++) {
    const mtx = new THREE.Matrix4().compose(
      new THREE.Vector3(x, 1.6, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.8, (i / 5) * Math.PI * 2, 0)),
      new THREE.Vector3(0.45, 0.08, 1.4),
    );
    mtx.multiply(new THREE.Matrix4().makeTranslation(0, 0, 1));
    leaves.setMatrixAt(i, mtx);
    leaves.setColorAt(i, new THREE.Color(['#e5609c', '#ff86b8', '#c84a8a'][i % 3]));
  }
  g.add(leaves, outlineInstanced(leaves));
  parts.colliders.push({ x, z, r: 1.2 });
}

// ---------------------------------------------------------------- outside

/** Stars all around and planets seen through the windows and the hangar bay door. */
function buildSpace(g: THREE.Group, parts: StationParts): void {
  const rand = mulberry32(4);
  const pos: number[] = [];
  for (let i = 0; i < 2200; i++) {
    const u = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    pos.push(Math.cos(a) * r * 1250, u * 1250, Math.sin(a) * r * 1250);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: '#fff4e0', size: 1.6, sizeAttenuation: false, fog: false })));

  const jungle = planet(420, ['#2c6352', '#a9c047', '#c65a92', '#2f8f77'], '#9ff0e0');
  jungle.position.set(-260, -780, -320);
  const dunes = planet(40, ['#3d1649', '#b5476c', '#e8845f', '#8a2f5a'], '#ff9aa8');
  dunes.position.set(-110, -260, 120);
  const giant = planet(80, ['#e0b07a', '#c47a4a', '#f2d6a6', '#9a5a3a'], '#ffd9a8', true);
  giant.position.set(260, -330, -60);
  g.add(jungle, dunes, giant);
  parts.planets.push(jungle, dunes, giant);
}

function planet(radius: number, colors: string[], atmo: string, ringed = false): THREE.Group {
  const p = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), new THREE.MeshToonMaterial({ map: planetTexture(colors, ringed), fog: false }));
  const glowShell = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.06, 48, 32),
    glow(atmo, { transparent: true, opacity: 0.18, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending, fog: false }, 1.2),
  );
  p.add(ball, glowShell);
  if (ringed) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.3, radius * 1.9, 64),
      glow('#f2d6a6', { transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, fog: false }, 0.9),
    );
    ring.rotation.set(-1.2, 0.3, 0);
    p.add(ring);
  }
  p.traverse((o) => (o.userData.noOutline = true));
  return p;
}

/**
 * The rest of the (huge) station: a dark plated hull stretching away below and around the rooms,
 * dotted with lights and other modules, fading into the dark.
 */
function buildHull(g: THREE.Group): void {
  const slabMat = toon(STATION.hull, { map: hullTexture() });

  // The rest of the station: modules, spines and girders at different depths, with space
  // (and the planet far below) showing through the gaps.
  const rand = mulberry32(21);
  const modMat = toon('#262c42');
  const lightMats = [glow(STATION.amber, {}, 1.4), glow(STATION.tealGlow, {}, 1.2), glow('#ff5fd2', {}, 1.2)];
  let placed = 0;
  for (let tries = 0; tries < 600 && placed < 80; tries++) {
    const x = (rand() * 2 - 1) * 200;
    const z = (rand() * 2 - 1) * 200;
    const y = -8 - rand() * 50;
    const w = 8 + rand() * 26;
    const d = 8 + rand() * 26;
    const h = 3 + rand() * 8;
    // Keep clear of the rooms (and the space just around them).
    if (WALKABLE.some((r) => x + w / 2 > r.x0 - 8 && x - w / 2 < r.x1 + 8 && z + d / 2 > r.z0 - 8 && z - d / 2 < r.z1 + 8)) continue;
    const mod = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rand() < 0.3 ? slabMat : modMat);
    mod.position.set(x, y, z);
    g.add(mod);
    // Rows of lit windows.
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.5, d + 0.1), lightMats[placed % 3]);
    strip.position.set(x, y + h * 0.2, z);
    strip.userData.noOutline = true;
    g.add(strip);
    if (rand() < 0.35) {
      // A dish or a tower on top.
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.4, 6 + rand() * 10, 8), modMat);
      tower.position.set(x + (rand() - 0.5) * w * 0.5, y + h / 2 + 4, z + (rand() - 0.5) * d * 0.5);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), lightMats[0]);
      beacon.position.copy(tower.position).setY(tower.position.y + 6);
      g.add(tower, beacon);
    }
    placed++;
  }
  // Long spines running off into the dark, tying it all together.
  for (const [x, z, len, rot] of [[0, 60, 220, 0], [70, -10, 260, Math.PI / 2], [-70, -30, 260, Math.PI / 2], [0, -110, 160, 0]] as const) {
    const spine = new THREE.Mesh(new THREE.BoxGeometry(5, 4, len), modMat);
    spine.position.set(x, -14, z);
    spine.rotation.y = rot;
    const lights = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, len), lightMats[1]);
    lights.position.set(x, -11.8, z);
    lights.rotation.y = rot;
    lights.userData.noOutline = true;
    g.add(spine, lights);
  }
}

// ---------------------------------------------------------------- textures and labels

/** A floating text label that always faces the camera. */
export function label(text: string, color: string, width = 14): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.font = "900 64px 'Cinzel', Georgia, serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 12;
  g.strokeStyle = 'rgba(10, 6, 20, 0.9)';
  g.strokeText(text, 512, 64);
  g.fillStyle = color;
  g.fillText(text, 512, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(width, width / 8, 1);
  sprite.renderOrder = 20;
  return sprite;
}

function floorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(0, 0, 0, 0.05)';
  g.fillRect(8, 8, 116, 116);
  g.fillRect(132, 132, 116, 116);
  g.strokeStyle = 'rgba(70, 55, 45, 0.35)';
  g.lineWidth = 4;
  g.strokeRect(2, 2, 252, 252);
  g.beginPath();
  g.moveTo(128, 0);
  g.lineTo(128, 256);
  g.moveTo(0, 128);
  g.lineTo(256, 128);
  g.stroke();
  for (const [x, y] of [[20, 20], [236, 20], [20, 236], [236, 236]]) {
    g.fillStyle = 'rgba(70, 55, 45, 0.4)';
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function hullTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 256, 256);
  g.strokeRect(0, 0, 128, 256);
  const rand = mulberry32(9);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(255, 179, 71, 0.9)' : 'rgba(111, 247, 255, 0.8)';
    g.fillRect(rand() * 240, rand() * 240, 6, 6);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Shaft walls: plating with rows of little lit windows (the decks below). */
function shaftTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 512);
  g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  g.lineWidth = 3;
  for (let y = 0; y < 512; y += 64) g.strokeRect(0, y, 128, 64);
  const rand = mulberry32(5);
  for (let y = 20; y < 512; y += 64) {
    for (let x = 8; x < 120; x += 16) {
      g.fillStyle = rand() < 0.6 ? 'rgba(255, 190, 110, 0.95)' : 'rgba(20, 20, 30, 0.6)';
      g.fillRect(x, y, 9, 6);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 3);
  return tex;
}

function directoryTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 300;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d2a33';
  g.fillRect(0, 0, 512, 300);
  g.strokeStyle = '#6ff7ff';
  g.lineWidth = 4;
  // A little map of the deck.
  g.strokeRect(206, 110, 100, 80);
  g.strokeRect(186, 20, 140, 70);
  g.strokeRect(60, 120, 80, 60);
  g.strokeRect(372, 120, 80, 60);
  g.strokeRect(70, 220, 70, 60);
  g.beginPath();
  g.moveTo(256, 90);
  g.lineTo(256, 110);
  g.moveTo(140, 150);
  g.lineTo(206, 150);
  g.moveTo(306, 150);
  g.lineTo(372, 150);
  g.moveTo(256, 190);
  g.lineTo(256, 300);
  g.moveTo(140, 250);
  g.lineTo(256, 250);
  g.stroke();
  g.fillStyle = '#ffd36b';
  g.beginPath();
  g.arc(256, 150, 8, 0, Math.PI * 2);
  g.fill();
  g.font = '700 22px sans-serif';
  g.fillText('YOU ARE HERE', 272, 158);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function planetTexture(colors: string[], banded = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = colors[0];
  g.fillRect(0, 0, 512, 256);
  const rand = mulberry32(colors.length * 31 + (banded ? 7 : 0));
  if (banded) {
    for (let y = 0; y < 256; y += 6 + rand() * 14) {
      g.fillStyle = colors[Math.floor(rand() * colors.length)];
      g.globalAlpha = 0.6 + rand() * 0.4;
      g.fillRect(0, y, 512, 4 + rand() * 18);
    }
  } else {
    for (let i = 0; i < 220; i++) {
      g.fillStyle = colors[1 + Math.floor(rand() * (colors.length - 1))];
      g.globalAlpha = 0.35 + rand() * 0.5;
      g.beginPath();
      g.ellipse(rand() * 512, rand() * 256, 10 + rand() * 50, 5 + rand() * 20, rand() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
