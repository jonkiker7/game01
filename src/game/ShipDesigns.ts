import * as THREE from 'three';
import { glow, rimToon } from './materials';
import { STAR_ROTOR_SHIP } from './models/starRotorShip';
import type { MeshData, ShipModelData } from './models/modelTypes';

/**
 * Four twin-rotor ship designs. Each builds its model into a group, facing -Z, and reports
 * the parts the flight code animates: spinning rotors, engine glows (boost + trail),
 * gun muzzles, and materials that flash when hit.
 */
export type ShipDesignId = 'a' | 'b' | 'c' | 'd';

export const SHIP_DESIGNS: { id: ShipDesignId; name: string; blurb: string }[] = [
  { id: 'a', name: 'Valkyrie', blurb: 'Armored wedge gunship with ducted fans on the wingtips' },
  { id: 'b', name: 'Manta', blurb: 'Armored gunship with two big ducted fans on drooped wings (Blender model)' },
  { id: 'c', name: 'Kestrel', blurb: 'Slim dart with open rotors on wingtip nacelles' },
  { id: 'd', name: 'Atlas', blurb: 'Heavy lifter with big fan pods and a belly turret' },
];

export function isShipDesign(v: string | null): v is ShipDesignId {
  return v === 'a' || v === 'b' || v === 'c' || v === 'd';
}

export interface ShipParts {
  /** Rotors/fans; spun around their local Y axis, `dir` = ±1 so pairs counter-rotate. */
  spinners: { obj: THREE.Object3D; dir: number }[];
  /** Two engine glows (rear), used for the boost flare and trail. */
  engines: THREE.Mesh[];
  /** Two gun muzzle flashes. */
  muzzles: THREE.Mesh[];
  /** Translucent glow rings that gently pulse. */
  pulses: THREE.MeshBasicMaterial[];
  /** Hull materials that flash red when the ship is hit. */
  flashMats: THREE.MeshToonMaterial[];
  /**
   * Side thrusters (optional): flames that fire when turning, rolling or boosting.
   * `side` is -1 (left) or +1 (right); scale the object's Y by how hard it's firing.
   */
  thrusters: { obj: THREE.Object3D; side: number }[];
}

// White / pale blue-grey hull, strong blue accents, dark mechanical parts, cyan glows.
const COLORS = {
  hull: '#e2e8ef',
  panel: '#bccbdc',
  accent: '#2f6fd6',
  dark: '#2a3446',
  glow: '#6ff7ff',
  canopy: '#8fe6ff',
};

interface Kit {
  hull: THREE.MeshToonMaterial;
  panel: THREE.MeshToonMaterial;
  accent: THREE.MeshToonMaterial;
  dark: THREE.MeshToonMaterial;
  glow: THREE.MeshBasicMaterial;
  canopy: THREE.MeshBasicMaterial;
  engine: THREE.MeshBasicMaterial;
  parts: ShipParts;
}

export function buildShipDesign(id: ShipDesignId, root: THREE.Group, engineMat: THREE.MeshBasicMaterial): ShipParts {
  // Warm gold rim light keeps the hero ship popping against the green jungle.
  const kit: Kit = {
    hull: rimToon(COLORS.hull, '#ffd38a', 0.5),
    panel: rimToon(COLORS.panel, '#ffd38a', 0.5),
    accent: rimToon(COLORS.accent, '#ffb070', 0.55),
    dark: rimToon(COLORS.dark, '#ffb070', 0.45),
    glow: glow(COLORS.glow),
    canopy: glow(COLORS.canopy),
    engine: engineMat,
    parts: { spinners: [], engines: [], muzzles: [], pulses: [], flashMats: [], thrusters: [] },
  };
  kit.parts.flashMats.push(kit.hull, kit.panel, kit.accent, kit.dark);
  ({ a: valkyrie, b: starRotor, c: kestrel, d: atlas })[id](root, kit);
  return kit.parts;
}

// ---------------------------------------------------------------- design A

function valkyrie(t: THREE.Group, k: Kit): void {
  // Wedge fuselage with a blue spine and a glowing canopy.
  add(t, flat([[0, 3.0], [0.5, 2.3], [0.85, 1.1], [0.9, -1.3], [0.55, -2.6], [0.3, -3.0]], 0.9), k.hull);
  add(t, flat([[0, 1.5], [0.32, 1.0], [0.38, -2.1], [0.14, -2.6]], 0.35), k.accent, 0, 0.5);
  add(t, sphere(0.5, 0.36, 0.95), k.canopy, 0, 0.42, -1.7);
  // Swept wings carrying ducted fans at the tips.
  add(t, flat([[0.6, 0.9], [3.0, 0.3], [3.1, -0.45], [0.6, -1.1]], 0.22), k.panel, 0, -0.1);
  for (const s of [-1, 1]) {
    add(t, new THREE.BoxGeometry(0.5, 0.26, 0.55), k.accent, s * 2.75, -0.05, 0.1);
    duct(t, k, s * 3.75, 0.05, 0.1, 1.3, s);
    // Canted twin tail fins.
    const fin = add(t, new THREE.BoxGeometry(0.12, 1.0, 0.85), k.accent, s * 0.42, 0.62, 2.55);
    fin.rotation.z = -s * 0.38;
    gun(t, k, s * 0.36, -0.45, -2.3);
    engine(t, k, s * 0.3, 0.05, 3.02, 0.26);
  }
}

// ---------------------------------------------------------------- design B

/** Ship-space scale for the Blender model, so it matches the other designs' size. */
const STAR_ROTOR_SCALE = 1.15;

/**
 * The Star Rotor ship, modelled in Blender (see src/game/models/starRotorShip.ts).
 * The two fan rotors are separate meshes that spin like the other designs' fans.
 */
function starRotor(t: THREE.Group, k: Kit): void {
  const model: ShipModelData = STAR_ROTOR_SHIP;
  const body = new THREE.Group();
  body.scale.setScalar(STAR_ROTOR_SCALE);
  t.add(body);

  const interior = rimToon('#151b26', '#ffb070', 0.3);
  k.parts.flashMats.push(interior);
  const mats: Record<string, THREE.Material> = {
    Hull_White: k.hull,
    Hull_Panel: k.panel,
    Accent_Blue: k.accent,
    Gunmetal: k.dark,
    Interior_Dark: interior,
    Glow_Cyan: k.glow,
  };
  const meshes = (group: THREE.Object3D, parts: Record<string, MeshData>, outline: boolean): void => {
    for (const [name, data] of Object.entries(parts)) {
      const mesh = new THREE.Mesh(modelGeometry(data), mats[name] ?? k.panel);
      if (!outline) mesh.userData.noOutline = true;
      group.add(mesh);
    }
  };
  meshes(body, model.static, true);

  // Fans: a tilted mount holding a spinner that turns around its local Y axis.
  for (const [name, rotor] of Object.entries(model.rotors)) {
    const mount = new THREE.Group();
    mount.position.fromArray(rotor.pos);
    mount.quaternion.fromArray(rotor.quat);
    const spinner = new THREE.Group();
    mount.add(spinner);
    meshes(spinner, rotor.geo, false);
    body.add(mount);
    k.parts.spinners.push({ obj: spinner, dir: name.includes('_L') ? 1 : -1 });
  }

  // Gun muzzles at the hardpoints under the wings (weapon pods attach here later).
  for (const hp of Object.values(model.hardpoints)) {
    const [x, y, z] = hp.map((v) => v * STAR_ROTOR_SCALE);
    gunMuzzle(t, k, x, y - 0.1, z - 0.9);
  }

  // Side thrusters: blue flames out of the bottom of the octagonal pods in front of the wings
  // (where the glowing triangles are), angled down and outward.
  for (const side of [-1, 1]) {
    const nozzle = new THREE.Group();
    nozzle.position.set(side * 1.46 * STAR_ROTOR_SCALE, -0.3 * STAR_ROTOR_SCALE, -0.95 * STAR_ROTOR_SCALE);
    nozzle.rotation.z = side * 1.15; // mostly out to the side (and a little down), so it shows from above
    const flame = new THREE.Group();
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.6, 12, 1, true), k.engine);
    outer.rotation.x = Math.PI; // tip pointing away from the nozzle
    outer.position.y = -1.3;
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.5, 10), glow('#e8ffff', {}, 2.4));
    core.rotation.x = Math.PI;
    core.position.y = -0.75;
    for (const m of [outer, core]) m.userData.noOutline = true;
    flame.add(outer, core);
    flame.scale.set(1, 0.01, 1);
    flame.visible = false;
    nozzle.add(flame);
    t.add(nozzle);
    k.parts.thrusters.push({ obj: flame, side });
  }

  // Two engine glows on the back of the tail hub (boost flare and trail).
  const s = STAR_ROTOR_SCALE;
  const tailBack = model.tail.max[2] * s + 0.03;
  const tailY = ((model.tail.min[1] + model.tail.max[1]) / 2) * s;
  for (const side of [-1, 1]) engine(t, k, side * 0.38 * s, tailY, tailBack, 0.2 * s);
}

/** Builds a BufferGeometry from exported model data (normals kept, so hard edges stay crisp). */
function modelGeometry(data: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(data.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(data.n, 3));
  g.setIndex(data.i);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- design C

function kestrel(t: THREE.Group, k: Kit): void {
  // Long slim fuselage, pointed nose, front canards and a V-tail.
  const body = add(t, new THREE.CapsuleGeometry(0.52, 4.4, 4, 12), k.hull, 0, 0, 0.3);
  body.rotation.x = Math.PI / 2;
  body.scale.set(1, 1, 0.85);
  add(t, cone(0.5, 1.1), k.accent, 0, 0, -2.85);
  add(t, sphere(0.36, 0.3, 0.95), k.canopy, 0, 0.38, -1.55);
  add(t, flat([[0.3, 2.2], [1.25, 1.75], [1.25, 1.55], [0.3, 1.65]], 0.1), k.accent, 0, 0.05);
  add(t, flat([[0.4, 0.55], [2.5, 0.3], [2.5, -0.4], [0.4, -0.75]], 0.18), k.panel, 0, 0);
  for (const s of [-1, 1]) {
    // Wingtip nacelle with an open rotor on top.
    add(t, new THREE.CylinderGeometry(0.32, 0.38, 1.3, 12), k.hull, s * 2.7, 0.1, 0);
    add(t, new THREE.CylinderGeometry(0.4, 0.4, 0.18, 12), k.accent, s * 2.7, 0.35, 0);
    openRotor(t, k, s * 2.7, 0.85, 0, 1.9, s);
    const tail = add(t, new THREE.BoxGeometry(0.1, 0.95, 0.75), k.accent, s * 0.38, 0.55, 2.65);
    tail.rotation.z = -s * 0.65;
    gun(t, k, s * 0.2, -0.45, -2.3);
    engine(t, k, s * 0.22, 0.05, 3.02, 0.2);
  }
}

// ---------------------------------------------------------------- design D

function atlas(t: THREE.Group, k: Kit): void {
  // Chunky armored body with a glowing cockpit slit and a blue dorsal stripe.
  add(t, flat([[0, 2.6], [0.9, 2.3], [1.2, 1.2], [1.2, -1.6], [0.9, -2.4], [0, -2.5]], 1.2, [], 0.2), k.hull);
  add(t, new THREE.BoxGeometry(0.5, 0.12, 3.8), k.accent, 0, 0.75, 0.1);
  add(t, new THREE.BoxGeometry(1.3, 0.22, 0.25), k.canopy, 0, 0.35, -2.62);
  // Stub wings holding big fan pods.
  add(t, new THREE.BoxGeometry(1.7, 0.32, 1.1), k.panel, 0, 0, 0);
  for (const s of [-1, 1]) {
    add(t, new THREE.BoxGeometry(1.7, 0.32, 1.1), k.panel, s * 1.9, 0, 0);
    add(t, new THREE.CylinderGeometry(1.3, 1.4, 1.1, 20), k.hull, s * 3.05, 0, 0);
    add(t, new THREE.CylinderGeometry(1.43, 1.43, 0.2, 20), k.accent, s * 3.05, -0.1, 0);
    duct(t, k, s * 3.05, 0.55, 0, 1.15, s, 0.14);
    // Twin tail booms and stabiliser.
    add(t, new THREE.BoxGeometry(0.28, 0.28, 1.7), k.dark, s * 0.75, 0.1, 3.05);
    engine(t, k, s * 0.75, 0.1, 3.92, 0.18);
  }
  add(t, new THREE.BoxGeometry(2.3, 0.1, 0.55), k.accent, 0, 0.15, 3.7);
  // Belly turret with twin guns.
  add(t, new THREE.SphereGeometry(0.5, 12, 8), k.dark, 0, -0.75, -1.3);
  for (const s of [-1, 1]) gun(t, k, s * 0.2, -0.8, -2.0);
}

// ---------------------------------------------------------------- parts

/** A ducted fan: a ring around spinning blades, with a glowing inner rim. */
function duct(
  t: THREE.Group,
  k: Kit,
  x: number,
  y: number,
  z: number,
  r: number,
  dir: number,
  tube = 0.2,
  intake = false,
): void {
  if (intake) {
    // Dark recessed floor inside the ring, so a fan mounted on a wing reads as an opening.
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(r - tube * 0.5, r - tube * 0.5, 0.1, 32), k.dark);
    floor.position.set(x, y - 0.12, z);
    floor.userData.noOutline = true;
    t.add(floor);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, 36), k.hull);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, y, z);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(r - tube * 0.9, 0.05, 6, 36), k.glow);
  inner.rotation.x = Math.PI / 2;
  inner.position.set(x, y + 0.02, z);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.3, 10), k.dark);
  hub.position.set(x, y, z);
  const fan = new THREE.Group();
  fan.position.set(x, y, z);
  const blade = new THREE.BoxGeometry(0.24, 0.04, r - tube - 0.15);
  blade.translate(0, 0, (r - tube - 0.15) / 2 + 0.12);
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(blade, k.panel);
    b.rotation.set(0, (i / 5) * Math.PI * 2, 0.25);
    b.userData.noOutline = true;
    fan.add(b);
  }
  // Soft glow disc so spinning fans read as "powered" from above.
  const discMat = glow(COLORS.glow, { transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r - tube, 28), discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(x, y - 0.05, z);
  k.parts.pulses.push(discMat);
  t.add(ring, inner, hub, fan);
  if (!intake) t.add(disc); // a wing-mounted fan shows its dark opening instead
  k.parts.spinners.push({ obj: fan, dir });
}

/** An open rotor: long blades with glowing tips and a faint ring tracing their sweep. */
function openRotor(t: THREE.Group, k: Kit, x: number, y: number, z: number, r: number, dir: number): void {
  const rotor = new THREE.Group();
  rotor.position.set(x, y, z);
  const blade = new THREE.BoxGeometry(0.26, 0.05, r);
  blade.translate(0, 0, r / 2);
  for (let i = 0; i < 3; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / 3) * Math.PI * 2;
    const b = new THREE.Mesh(blade, k.hull);
    b.userData.noOutline = true;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), k.glow);
    tip.position.z = r;
    arm.add(b, tip);
    rotor.add(arm);
  }
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), k.dark);
  rotor.add(hub);
  const ringMat = glow(COLORS.glow, { transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.04, 6, 40), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, y, z);
  k.parts.pulses.push(ringMat);
  t.add(rotor, ring);
  k.parts.spinners.push({ obj: rotor, dir });
}

function gun(t: THREE.Group, k: Kit, x: number, y: number, z: number): void {
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.0, 6), k.dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(x, y, z);
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), glow('#ffe27a'));
  muzzle.scale.set(1, 1, 2.2);
  muzzle.position.set(x, y, z - 0.8);
  muzzle.visible = false;
  t.add(barrel, muzzle);
  k.parts.muzzles.push(muzzle);
}

/** Just a muzzle flash (no barrel), for ships whose guns are mounted separately. */
function gunMuzzle(t: THREE.Group, k: Kit, x: number, y: number, z: number): void {
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), glow('#ffe27a'));
  muzzle.scale.set(1, 1, 2.2);
  muzzle.position.set(x, y, z);
  muzzle.visible = false;
  t.add(muzzle);
  k.parts.muzzles.push(muzzle);
}

function engine(t: THREE.Group, k: Kit, x: number, y: number, z: number, r: number): void {
  const e = new THREE.Mesh(new THREE.CircleGeometry(r, 16), k.engine); // faces +Z (backwards)
  e.position.set(x, y, z);
  t.add(e);
  k.parts.engines.push(e);
}

function add(t: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  t.add(m);
  return m;
}

function sphere(sx: number, sy: number, sz: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 16, 12);
  g.scale(sx, sy, sz);
  return g;
}

/** A cone pointing forward (-Z). */
function cone(r: number, h: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, 12);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * A flat, bevelled plate seen from above. `half` lists the right half of the outline from
 * nose to tail as (x, forward) pairs; it is mirrored to make the left half. `holes` cut
 * round openings (for fans). Thickness is centred on y = 0.
 */
function flat(half: [number, number][], depth: number, holes: { x: number; y: number; r: number }[] = [], bevel = 0.1): THREE.BufferGeometry {
  const pts = [...half];
  for (let i = half.length - 1; i >= 0; i--) {
    const [x, y] = half[i];
    if (x !== 0) pts.push([-x, y]);
  }
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) {
    const path = new THREE.Path();
    path.absarc(h.x, h.y, h.r, 0, Math.PI * 2, true);
    shape.holes.push(path);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 24,
  });
  geo.rotateX(-Math.PI / 2); // outline lies flat; shape "forward" becomes -Z, thickness goes up
  geo.translate(0, -depth / 2, 0);
  return geo;
}
