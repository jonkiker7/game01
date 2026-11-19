import * as THREE from 'three';
import { addOutlines, glow, outlineInstanced, rimToon, toon } from '../game/materials';
import { mulberry32 } from '../game/math';
import { Pilot } from './Pilot';
import { CORRIDORS, type Rect, ROOMS, SEALED, type Side, SIGNS, SPOTS, WALKABLE } from './Layout';

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

export interface Collider {
  x: number;
  z: number;
  r: number;
}

/** A piece of wall that drops down when it's between the camera and the pilot. */
export interface WallSegment {
  obj: THREE.Object3D;
  x: number;
  z: number;
  cut: number; // current height scale (1 = full, small = cut away)
}

export interface StationParts {
  walls: WallSegment[];
  colliders: Collider[];
  holo: THREE.Object3D;
  planets: THREE.Object3D[];
}

/**
 * Builds the station interior: rectangular rooms and corridors (seen at an isometric angle,
 * like Diablo or the old Fallouts), with the rest of the huge station stretching away outside.
 */
export function buildStation(scene: THREE.Scene): StationParts {
  const g = new THREE.Group();
  scene.add(g);
  const parts: StationParts = { walls: [], colliders: [], holo: new THREE.Group(), planets: [] };
  const m = {
    cream: rimToon(STATION.cream, '#ffd9a8', 0.3),
    creamDark: toon(STATION.creamDark),
    orange: rimToon(STATION.orange, '#ffd9a8', 0.35),
    navy: toon(STATION.navy),
    teal: toon(STATION.teal),
    dark: toon('#2a2438'),
  };

  buildSpace(g, parts);
  buildHull(g);

  // ---- Floors ----
  const tile = floorTexture();
  for (const room of ROOMS) addFloor(g, room.rect, room.floor, tile);
  for (const c of CORRIDORS) addFloor(g, c.rect, '#a99f8e', tile);

  // ---- Walls, windows and doorways ----
  for (const room of ROOMS) {
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      const gaps = room.gaps.filter((x) => x.side === side);
      const windows = (room.windows ?? []).filter((x) => x.side === side);
      buildWallLine(g, parts, m, room.rect, side, gaps, windows);
      for (const gap of gaps) doorFrame(g, parts, m, room.rect, side, gap.a, gap.b, room.id === 'hangar' && side === 'n');
    }
  }
  for (const c of CORRIDORS) {
    const sides: Side[] = c.axis === 'ns' ? ['e', 'w'] : ['n', 's'];
    for (const side of sides) buildWallLine(g, parts, m, c.rect, side, (c.gaps ?? []).filter((x) => x.side === side), []);
  }
  for (const d of SEALED) sealedDoor(g, parts, m, d.x, d.z, d.axis, d.label);
  for (const s of SIGNS) {
    const sign = label(s.text, '#f2c46d', 13);
    sign.position.set(s.x, WALL_H + 0.9, s.z);
    g.add(sign);
  }

  // ---- Rooms ----
  concourse(g, parts, m);
  armory(g, parts, m);
  boutique(g, parts, m);
  hangar(g, parts, m);
  quarters(g, parts, m);

  addOutlines(g);
  return parts;
}

// ---------------------------------------------------------------- structure

function addFloor(g: THREE.Group, r: Rect, color: string, tile: THREE.Texture): void {
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  const tex = tile.clone();
  tex.needsUpdate = true;
  tex.repeat.set(w / 4, d / 4);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), toon(color, { map: tex }));
  floor.position.set((r.x0 + r.x1) / 2, -0.25, (r.z0 + r.z1) / 2);
  floor.userData.noOutline = true;
  g.add(floor);
}

/** One side of a rectangle as wall segments, leaving gaps (doorways) and windows. */
function buildWallLine(
  g: THREE.Group,
  parts: StationParts,
  m: Record<string, THREE.Material>,
  r: Rect,
  side: Side,
  gaps: { a: number; b: number }[],
  windows: { a: number; b: number }[],
): void {
  const alongX = side === 'n' || side === 's';
  const start = alongX ? r.x0 : r.z0;
  const end = alongX ? r.x1 : r.z1;
  const fixed = side === 'n' ? r.z0 : side === 's' ? r.z1 : side === 'w' ? r.x0 : r.x1;
  // Split [start, end] into pieces that are solid, window, or open.
  const cuts = [start, end, ...gaps.flatMap((x) => [x.a, x.b]), ...windows.flatMap((x) => [x.a, x.b])].sort((a, b) => a - b);
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
      const seg = isWindow ? windowPiece(m, s1 - s0) : wallPiece(m, s1 - s0);
      seg.position.set(x, 0, z);
      if (!alongX) seg.rotation.y = Math.PI / 2;
      g.add(seg);
      parts.walls.push({ obj: seg, x, z, cut: 1 });
    }
  }
}

function wallPiece(m: Record<string, THREE.Material>, len: number): THREE.Group {
  const seg = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_T, WALL_H, WALL_T), m.cream);
  body.position.y = WALL_H / 2;
  const trim = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_T + 0.05, 0.35, WALL_T + 0.1), m.orange);
  trim.position.y = WALL_H - 0.15;
  const base = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_T + 0.05, 0.5, WALL_T + 0.1), m.navy);
  base.position.y = 0.25;
  const light = new THREE.Mesh(new THREE.BoxGeometry(len * 0.6, 0.12, WALL_T + 0.12), glow(STATION.amber, {}, 1.2));
  light.position.y = 3.2;
  seg.add(body, trim, base, light);
  return seg;
}

function windowPiece(m: Record<string, THREE.Material>, len: number): THREE.Group {
  const seg = new THREE.Group();
  const sill = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_T, 1.3, WALL_T), m.navy);
  sill.position.y = 0.65;
  const header = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_T, 0.8, WALL_T), m.cream);
  header.position.y = WALL_H - 0.4;
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(len, WALL_H - 2.1),
    glow('#7fe8ff', { transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }, 1),
  );
  glass.position.y = 1.3 + (WALL_H - 2.1) / 2;
  glass.userData.noOutline = true;
  seg.add(sill, header, glass);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, WALL_H, WALL_T + 0.1), m.orange);
    post.position.set((s * len) / 2, WALL_H / 2, 0);
    seg.add(post);
  }
  return seg;
}

function doorFrame(g: THREE.Group, parts: StationParts, m: Record<string, THREE.Material>, r: Rect, side: Side, a: number, b: number, bay: boolean): void {
  const alongX = side === 'n' || side === 's';
  const fixed = side === 'n' ? r.z0 : side === 's' ? r.z1 : side === 'w' ? r.x0 : r.x1;
  const frame = new THREE.Group();
  const span = b - a;
  const h = bay ? 9 : WALL_H + 0.5;
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
  if (bay) {
    // Force field holding the air in, across the hangar's bay door.
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(span, h),
      glow('#6ff7ff', { transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }, 1),
    );
    field.position.y = h / 2;
    field.userData.noOutline = true;
    frame.add(field);
  }
  frame.position.set(alongX ? (a + b) / 2 : fixed, 0, alongX ? fixed : (a + b) / 2);
  if (!alongX) frame.rotation.y = Math.PI / 2;
  g.add(frame);
  // The bay door is tall and on the far (north) side, so it never needs to cut away.
  if (!bay) parts.walls.push({ obj: frame, x: frame.position.x, z: frame.position.z, cut: 1 });
}

function sealedDoor(g: THREE.Group, parts: StationParts, m: Record<string, THREE.Material>, x: number, z: number, axis: 'ns' | 'ew', text: string): void {
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
  door.position.set(x, 0, z);
  if (axis === 'ns') door.rotation.y = Math.PI / 2;
  g.add(door);
  parts.walls.push({ obj: door, x, z, cut: 1 });
}

// ---------------------------------------------------------------- the rooms

function concourse(g: THREE.Group, parts: StationParts, m: Record<string, THREE.Material>): void {
  // Information desk: a curved counter wrapping the robot attendant.
  const desk = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.9, 10, 28, Math.PI * 1.1), m.cream);
  desk.rotation.set(Math.PI / 2, 0, -0.05 * Math.PI);
  desk.position.set(SPOTS.bot.x, 1, SPOTS.bot.z);
  const top = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.35, 6, 28, Math.PI * 1.1), m.orange);
  top.rotation.copy(desk.rotation);
  top.position.set(SPOTS.bot.x, 1.85, SPOTS.bot.z);
  g.add(desk, top);
  const info = label('INFORMATION', '#6ff7ff', 12);
  info.position.set(SPOTS.bot.x, 6.3, SPOTS.bot.z - 1.5);
  g.add(info);
  parts.colliders.push({ x: SPOTS.bot.x, z: SPOTS.bot.z, r: 4.6 });

  // Station directory board.
  const board = new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 0.4), m.navy);
  board.position.set(9, 3.2, -11.3);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.6), glow(STATION.tealGlow, { map: directoryTexture() }, 1.1));
  screen.position.set(9, 3.2, -11.08);
  g.add(board, screen);

  // Benches and plants.
  for (const [x, z] of [[-8, 7], [8, 7]] as const) {
    const bench = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 4, 4, 10), m.orange);
    bench.rotation.z = Math.PI / 2;
    bench.position.set(x, 0.7, z);
    g.add(bench);
    parts.colliders.push({ x: x - 1.6, z, r: 1 }, { x: x + 1.6, z, r: 1 });
  }
  for (const [x, z] of [[-12, -10], [12, 10], [-12, 10], [12, -9]] as const) plant(g, parts, m, x, z);

  // Holographic station map spinning over a plinth.
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 1, 16), m.cream);
  plinth.position.set(-8, 0.5, -6);
  const holo = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), glow(STATION.tealGlow, { wireframe: true, transparent: true, opacity: 0.7 }, 1.5));
  holo.position.set(-8, 2.6, -6);
  parts.holo = holo;
  g.add(plinth, holo);
  parts.colliders.push({ x: -8, z: -6, r: 1.6 });
}

function armory(g: THREE.Group, parts: StationParts, m: Record<string, THREE.Material>): void {
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

function boutique(g: THREE.Group, parts: StationParts, m: Record<string, THREE.Material>): void {
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

function hangar(g: THREE.Group, parts: StationParts, m: Record<string, THREE.Material>): void {
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
  // Pip's workbench, tool wall and robot arm.
  const bench = new THREE.Mesh(new THREE.BoxGeometry(6, 1.4, 2), m.navy);
  bench.position.set(-13, 0.7, -37);
  const benchTop = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.2, 2.2), m.orange);
  benchTop.position.set(-13, 1.45, -37);
  const tools = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 0.4), m.creamDark);
  tools.position.set(-13, 2.8, -38.8);
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.6, 4, 8), m.cream);
  arm.position.set(-10.8, 2.5, -37);
  arm.rotation.z = -0.6;
  g.add(bench, benchTop, tools, arm);
  parts.colliders.push({ x: -15, z: -37, r: 1.6 }, { x: -11, z: -37, r: 1.6 });
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

function quarters(g: THREE.Group, parts: StationParts, m: Record<string, THREE.Material>): void {
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

function plant(g: THREE.Group, parts: StationParts, m: Record<string, THREE.Material>, x: number, z: number): void {
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
  const hullTex = hullTexture();
  const slabMat = toon(STATION.hull, { map: hullTex });
  // Thick plating under every room and corridor.
  for (const r of WALKABLE) {
    const w = r.x1 - r.x0 + 2;
    const d = r.z1 - r.z0 + 2;
    const tex = hullTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(w / 12, d / 12);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 4, d), toon(STATION.hull, { map: tex }));
    slab.position.set((r.x0 + r.x1) / 2, -2.5, (r.z0 + r.z1) / 2);
    slab.userData.noOutline = true;
    g.add(slab);
  }

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
