import * as THREE from 'three';
import { addOutlines, glow, outlineInstanced, rimToon, toon } from '../game/materials';
import { mulberry32 } from '../game/math';

/** Retro-futuristic palette: warm cream panels, burnt orange trim, teal glass, deep space. */
export const STATION = {
  space: '#0b0716',
  cream: '#e8dfcc',
  creamDark: '#bfb39b',
  orange: '#e2733a',
  teal: '#2f8f95',
  tealGlow: '#6ff7ff',
  navy: '#26304a',
  floor: '#d6ccb8',
  amber: '#ffb347',
  crt: '#7dff9a',
};

export const DECK_RADIUS = 26;
/** Where the player's ship is parked (on the launch pad). */
export const PAD = new THREE.Vector3(13, 0, -11);
/** Direction the ship leaves through the bay door (toward the north-east window). */
export const BAY_EXIT = new THREE.Vector3(30, 9, -48);

export interface Collider {
  x: number;
  z: number;
  r: number;
}

/**
 * The home base: an observation deck on a space station hovering over the jungle planet.
 * The camera side (south) is open like a diorama; the north side is a sweep of panoramic
 * windows looking out at the planets. Stations around the deck belong to the crew.
 */
export function buildStation(scene: THREE.Scene): { colliders: Collider[]; holo: THREE.Object3D; planet: THREE.Object3D } {
  const g = new THREE.Group();
  scene.add(g);
  const colliders: Collider[] = [];
  const cream = rimToon(STATION.cream, '#ffd9a8', 0.35);
  const creamDark = toon(STATION.creamDark);
  const orange = rimToon(STATION.orange, '#ffd9a8', 0.4);
  const navy = toon(STATION.navy);
  const teal = toon(STATION.teal);

  // ---- Space: stars and planets far below and beyond the windows ----
  const rand = mulberry32(4);
  const starPos: number[] = [];
  for (let i = 0; i < 1600; i++) {
    const a = rand() * Math.PI * 2;
    const r = 250 + rand() * 250;
    starPos.push(Math.cos(a) * r, -40 - rand() * 300, Math.sin(a) * r - 120);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  g.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#fff4e0', size: 1.6, sizeAttenuation: false })));

  const planet = new THREE.Group();
  planet.position.set(-20, -70, -190);
  // The jungle planet: greens and pinks with an atmosphere glow.
  const jungle = new THREE.Mesh(new THREE.SphereGeometry(95, 48, 32), new THREE.MeshToonMaterial({ map: planetTexture(['#2c6352', '#a9c047', '#c65a92', '#2f8f77']), gradientMap: undefined }));
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(101, 48, 32),
    glow('#9ff0e0', { transparent: true, opacity: 0.18, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending }, 1.2),
  );
  planet.add(jungle, atmo);
  g.add(planet);
  // A crimson desert moon and a ringed gas giant further out.
  const dunes = new THREE.Mesh(new THREE.SphereGeometry(22, 32, 24), new THREE.MeshToonMaterial({ map: planetTexture(['#3d1649', '#b5476c', '#e8845f', '#8a2f5a']) }));
  dunes.position.set(130, -10, -260);
  const giant = new THREE.Group();
  giant.position.set(-200, 10, -330);
  const giantBall = new THREE.Mesh(new THREE.SphereGeometry(48, 32, 24), new THREE.MeshToonMaterial({ map: planetTexture(['#e0b07a', '#c47a4a', '#f2d6a6', '#9a5a3a'], true) }));
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(62, 92, 64),
    glow('#f2d6a6', { transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }, 0.9),
  );
  ring.rotation.set(-1.2, 0.3, 0);
  giant.add(giantBall, ring);
  g.add(dunes, giant);

  // ---- The deck ----
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(DECK_RADIUS, DECK_RADIUS + 1.5, 1.2, 64), toon('#ffffff', { map: floorTexture() }));
  floor.position.y = -0.6;
  const trim = new THREE.Mesh(new THREE.TorusGeometry(DECK_RADIUS + 0.4, 0.35, 8, 96), orange);
  trim.rotation.x = Math.PI / 2;
  trim.position.y = 0.02;
  const inlay = new THREE.Mesh(new THREE.RingGeometry(5.6, 6.2, 64), glow(STATION.tealGlow, { side: THREE.DoubleSide }, 1.3));
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = 0.03;
  // Underside of the station disc, so the deck reads as hovering in space.
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(DECK_RADIUS + 1.5, 9, 9, 48), creamDark);
  hull.position.y = -5.7;
  const hullBand = new THREE.Mesh(new THREE.TorusGeometry(DECK_RADIUS - 2, 0.25, 6, 96), glow(STATION.amber, {}, 1.4));
  hullBand.rotation.x = Math.PI / 2;
  hullBand.position.y = -3;
  g.add(floor, trim, inlay, hull, hullBand);

  // ---- Panoramic window arc along the north side ----
  const sillMat = navy;
  // Cylinder angles: x = sin(a), z = cos(a); the north side (z < 0) is a = 0.56π .. 1.44π.
  const arcStart = Math.PI * 0.56;
  const arcLen = Math.PI * 0.88;
  const sill = new THREE.Mesh(new THREE.CylinderGeometry(DECK_RADIUS, DECK_RADIUS, 1.3, 64, 1, true, arcStart, arcLen), sillMat);
  sill.position.y = 0.65;
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(DECK_RADIUS, DECK_RADIUS, 7, 64, 1, true, arcStart, arcLen),
    glow('#7fe8ff', { transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }, 1),
  );
  glass.position.y = 4.8;
  g.add(sill, glass);
  for (let i = 0; i <= 12; i++) {
    const a = arcStart + (arcLen * i) / 12;
    const x = Math.sin(a) * DECK_RADIUS;
    const z = Math.cos(a) * DECK_RADIUS;
    if (Math.hypot(x - 16.5, z + 20) < 7) continue; // leave the bay door clear
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 8.2, 0.9), cream);
    pillar.position.set(x, 4.1, z);
    pillar.rotation.y = a;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 1.1), orange);
    cap.position.set(x, 8.3, z);
    cap.rotation.y = a;
    g.add(pillar, cap);
  }

  // ---- Hangar: launch pad and bay door (north-east) ----
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.6, 0.4, 6), navy);
  pad.position.set(PAD.x, 0.2, PAD.z);
  const padRing = new THREE.Mesh(new THREE.RingGeometry(5.2, 5.7, 6), glow(STATION.amber, { side: THREE.DoubleSide }, 1.5));
  padRing.rotation.x = -Math.PI / 2;
  padRing.position.set(PAD.x, 0.42, PAD.z);
  g.add(pad, padRing);
  for (let i = 0; i < 6; i++) {
    // Hazard chevrons around the pad.
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const chev = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.5), orange);
    chev.position.set(PAD.x + Math.cos(a) * 6.9, 0.05, PAD.z + Math.sin(a) * 6.9);
    chev.rotation.y = -a;
    g.add(chev);
  }
  const door = new THREE.Group();
  door.position.set(17.5, 0, -20.5);
  door.rotation.y = -0.65;
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.4, 10, 1.6), cream);
    post.position.set(s * 7, 5, 0);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.6, 1.65), orange);
    stripe.position.set(s * 7, 2, 0);
    door.add(post, stripe);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(15.4, 1.4, 1.8), cream);
  lintel.position.y = 10.4;
  const field = new THREE.Mesh(
    new THREE.PlaneGeometry(12.6, 9.6),
    glow('#6ff7ff', { transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }, 1),
  );
  field.position.y = 5;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(4, 0.8, 0.2), glow(STATION.amber, {}, 1.4));
  sign.position.set(0, 10.4, 0.95);
  door.add(lintel, field, sign);
  g.add(door);

  // ---- Quartermaster's counter (west) ----
  const qm = new THREE.Group();
  qm.position.set(-15, 0, -7);
  const counter = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 4.5, 4, 12), cream);
  counter.rotation.z = Math.PI / 2;
  counter.position.y = 0.95;
  counter.scale.set(1, 1, 0.7);
  const counterTop = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.25, 1.6), orange);
  counterTop.position.y = 1.9;
  const crt = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.1), creamDark);
  crt.position.set(-1.6, 2.6, 0);
  const crtScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), glow(STATION.crt, {}, 1.3));
  crtScreen.position.set(-1.6, 2.62, 0.56);
  qm.add(counter, counterTop, crt, crtScreen);
  for (const [x, z, s] of [[-3.5, -2.2, 1.3], [-2.2, -2.6, 1], [-3.3, -3.6, 1.1], [2.8, -2.4, 1.2]] as const) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), rand() < 0.5 ? teal : navy);
    crate.position.set(x, s / 2, z);
    crate.rotation.y = rand();
    const band = new THREE.Mesh(new THREE.BoxGeometry(s * 1.02, s * 0.15, s * 1.02), orange);
    band.position.copy(crate.position);
    band.rotation.copy(crate.rotation);
    qm.add(crate, band);
  }
  g.add(qm);
  colliders.push({ x: -15, z: -7, r: 3.4 }, { x: -18, z: -10, r: 2 });

  // ---- Outfitter's wardrobe pods (north-west) ----
  const of = new THREE.Group();
  of.position.set(-7, 0, -18);
  for (let i = 0; i < 3; i++) {
    const pod = new THREE.Group();
    pod.position.set((i - 1) * 2.8, 0, 0);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.5, 16), orange);
    base.position.y = 0.25;
    const glassPod = new THREE.Mesh(
      new THREE.CapsuleGeometry(1, 2.4, 4, 16),
      glow('#9ff4ff', { transparent: true, opacity: 0.16, depthWrite: false }, 1),
    );
    glassPod.position.y = 2.2;
    glassPod.userData.noOutline = true;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.1, 0.4, 16), cream);
    top.position.y = 4.1;
    const light = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.06, 6, 24), glow(['#ff5fd2', '#6ff7ff', '#ffd36b'][i], {}, 1.6));
    light.rotation.x = Math.PI / 2;
    light.position.y = 3.8;
    pod.add(base, glassPod, top, light);
    of.add(pod);
  }
  g.add(of);
  colliders.push({ x: -7, z: -18, r: 4.4 });

  // ---- Mechanic's workbench (north, beside the pad) ----
  const mech = new THREE.Group();
  mech.position.set(3, 0, -19);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(5, 1.4, 1.8), navy);
  bench.position.y = 0.7;
  const benchTop = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.2, 2), orange);
  benchTop.position.y = 1.45;
  const armBase = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.6, 10), cream);
  armBase.position.set(2, 1.85, 0);
  const arm1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 1.4, 4, 8), cream);
  arm1.position.set(2.3, 2.7, 0);
  arm1.rotation.z = -0.5;
  const arm2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 1.1, 4, 8), orange);
  arm2.position.set(2.0, 3.6, 0.2);
  arm2.rotation.z = 0.9;
  const toolRack = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 0.3), creamDark);
  toolRack.position.set(-1, 2.6, -0.8);
  mech.add(bench, benchTop, armBase, arm1, arm2, toolRack);
  g.add(mech);
  colliders.push({ x: 3, z: -19, r: 3 });

  // ---- Holotable in the middle: a little spinning planet hologram ----
  const holo = new THREE.Group();
  const table = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 1.4, 1.3, 24), cream);
  table.position.y = 0.65;
  const tableTop = new THREE.Mesh(new THREE.CircleGeometry(2, 32), glow(STATION.tealGlow, { transparent: true, opacity: 0.5 }, 1.3));
  tableTop.rotation.x = -Math.PI / 2;
  tableTop.position.y = 1.32;
  const hologram = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1, 2),
    glow(STATION.tealGlow, { wireframe: true, transparent: true, opacity: 0.7 }, 1.5),
  );
  hologram.position.y = 2.8;
  holo.add(hologram);
  g.add(table, tableTop, holo);
  colliders.push({ x: 0, z: 0, r: 2.6 });

  // ---- Lounge: a curved retro sofa and potted alien plants ----
  const sofa = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.7, 8, 24, Math.PI * 0.9), orange);
  sofa.rotation.set(Math.PI / 2, 0, Math.PI * 0.05);
  sofa.position.set(-15, 0.75, 9);
  const cushion = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.45, 8, 24, Math.PI * 0.9), cream);
  cushion.rotation.copy(sofa.rotation);
  cushion.position.set(-15, 1.35, 9);
  g.add(sofa, cushion);
  colliders.push({ x: -15, z: 11.5, r: 2.5 }, { x: -17.8, z: 8, r: 2 }, { x: -12.2, z: 8, r: 2 });
  for (const [x, z] of [[-21, -2], [20, 6], [8, 19], [-9, 20]] as const) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.7, 1.2, 12), cream);
    pot.position.set(x, 0.6, z);
    g.add(pot);
    const leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), toon('#ffffff'), 5);
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x, 1.6, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.8, (i / 5) * Math.PI * 2, 0)),
        new THREE.Vector3(0.45, 0.08, 1.4),
      );
      m.multiply(new THREE.Matrix4().makeTranslation(0, 0, 1));
      leaves.setMatrixAt(i, m);
      leaves.setColorAt(i, new THREE.Color(['#e5609c', '#ff86b8', '#c84a8a'][i % 3]));
    }
    g.add(leaves, outlineInstanced(leaves));
    colliders.push({ x, z, r: 1.3 });
  }

  addOutlines(g);
  return { colliders, holo, planet };
}

/** Painted bands and swirls for a planet surface. */
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

/** Deck plating: radial panel seams and a few warm tone variations. */
function floorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = STATION.floor;
  g.fillRect(0, 0, 1024, 1024);
  const cx = 512;
  g.strokeStyle = 'rgba(80, 60, 50, 0.35)';
  g.lineWidth = 3;
  for (let r = 80; r < 512; r += 90) {
    g.beginPath();
    g.arc(cx, cx, r, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 80, cx + Math.sin(a) * 80);
    g.lineTo(cx + Math.cos(a) * 512, cx + Math.sin(a) * 512);
    g.stroke();
  }
  // Orange rings near the edge, like a retro deck marking.
  g.strokeStyle = 'rgba(226, 115, 58, 0.55)';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(cx, cx, 470, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
