import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLOW, glow, outlineInstanced, toon } from './materials';
import { fbm, mulberry32, smoothstep, valueNoise } from './math';

/** Colours for one planet. Each new planet becomes a different palette + props. */
export const JUNGLE = {
  sky: '#a3d9cf', // misty mint haze in the distance
  hemiSky: '#e4fff6',
  hemiGround: '#3b2350',
  groundLow: '#2c6352', // deep teal-green in the hollows
  groundHigh: '#a9c047', // sunny yellow-green moss
  groundPink: '#c65a92',
  path: '#efe6b8', // pale winding streams
  rock: ['#5a4f86', '#6b4a7e', '#4b5b80'],
  trunk: ['#8b3f8c', '#a14f86', '#6d3a86', '#7d4a9a'],
  leaves: ['#2e8a77', '#2b6b52', '#2f6687', '#3f9a6a', '#1f5a5a'],
  pinkLeaf: ['#e5609c', '#ff86b8', '#c84a8a', '#f07aa8'],
  stalk: '#b8437c',
  bulb: '#ff5fae',
  fern: ['#3c8f5a', '#2f7a6e', '#5aa04a'],
  spore: '#e4ff7a',
  relic: ['#c9b04a', '#b39a3c', '#d6c063'],
  relicDark: '#5b5226',
};

/** Groups of enemy turrets. Coordinates are (x, z); the landing pad is at 0, 0. */
export const OUTPOSTS: [number, number][] = [
  [0, -48],
  [45, -78],
  [-55, -62],
  [75, 12],
  [-78, 20],
  [12, 85],
  [-40, 120],
  [95, -125],
  [-120, -110],
  [130, 95],
  [-150, 40],
  [150, -40],
];

type Placer = (rand: () => number) => { x: number; z: number };

/**
 * An alien jungle: mossy ground with pale streams, purple-trunked trees, pink fan plants,
 * glowing bulb stalks, ferns, half-buried relics, and giant trees around the edge of the map.
 *
 * Tree canopies stay below the ship's flying height so nothing ever hides the player, and
 * plants keep clear of the landing pad and the turret outposts so enemies stay readable.
 */
export class World {
  readonly halfSize = 220;
  readonly palette = JUNGLE;
  readonly group = new THREE.Group();
  private readonly bulbMat: THREE.MeshBasicMaterial;
  private readonly padRing: THREE.Mesh;
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.bulbMat = glow(this.palette.bulb);
    this.buildGround();
    this.buildTrees(this.placer(4, 12, 1.8));
    this.buildPinkFans(this.placer(1, 9, 1.2));
    this.buildBulbStalks(this.placer(2, 9, 1));
    this.buildFerns(this.placer(0, 7, 0.6));
    this.buildRocks(this.placer(3, 9, 0.3));
    this.buildRelics(this.placer(9, 12, 0));
    this.buildSpores(this.placer(0, 6, 0.5));
    this.buildBorder();
    this.padRing = this.buildLandingPad();
    scene.add(this.group);
  }

  /** Ground height at a world position (the ship hovers relative to this). */
  heightAt(x: number, z: number): number {
    const hills = (fbm(x * 0.016, z * 0.016, 3) - 0.5) * 6;
    // Flatten the area around the landing pad at the centre.
    const flat = smoothstep(10, 26, Math.hypot(x, z));
    return hills * flat;
  }

  update(dt: number): void {
    this.time += dt;
    const pulse = 0.8 + Math.sin(this.time * 2.2) * 0.2;
    this.bulbMat.color.set(this.palette.bulb).multiplyScalar(GLOW * pulse);
    (this.padRing.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(this.time * 3) * 0.25;
  }

  // ---------------------------------------------------------------- ground

  private buildGround(): void {
    const size = this.halfSize * 2 + 200;
    const seg = 220;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(this.palette.groundLow);
    const high = new THREE.Color(this.palette.groundHigh);
    const pink = new THREE.Color(this.palette.groundPink);
    const path = new THREE.Color(this.palette.path);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);

      // Moss is brighter on the rises and deep teal in the hollows.
      c.copy(low).lerp(high, smoothstep(-2.2, 1.6, h));
      // Soft patches of pink ground cover.
      c.lerp(pink, 0.55 * smoothstep(0.56, 0.68, fbm(x * 0.03 + 50, z * 0.03 - 20, 2)));
      // Pale winding streams where a noise field crosses its midpoint.
      const stream = Math.abs(fbm(x * 0.009 + 13, z * 0.009 + 7, 3) - 0.5);
      c.lerp(path, 0.85 * (1 - smoothstep(0.012, 0.03, stream)));
      c.multiplyScalar((0.88 + valueNoise(x * 0.3, z * 0.3) * 0.24) * 1.1);
      c.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    this.group.add(new THREE.Mesh(geo, toon('#ffffff', { vertexColors: true, map: paintedTexture() })));
  }

  // ---------------------------------------------------------------- placement

  /**
   * Returns a function that picks random spots inside the play area, keeping `padClear`
   * units from the landing pad's edge and `outpostClear` units from every turret outpost.
   * `clumping` > 0 favours dense jungle patches (higher = stronger).
   */
  private placer(padClear: number, outpostClear: number, clumping = 1): Placer {
    const limit = this.halfSize - 6;
    return (rand) => {
      for (let tries = 0; tries < 50; tries++) {
        const x = (rand() * 2 - 1) * limit;
        const z = (rand() * 2 - 1) * limit;
        // Plants grow in thick clumps with open clearings between them.
        if (rand() > Math.pow(jungleDensity(x, z), clumping)) continue;
        if (Math.hypot(x, z) < 9 + padClear) continue;
        if (OUTPOSTS.some(([ox, oz]) => Math.hypot(x - ox, z - oz) < 8 + outpostClear)) continue;
        return { x, z };
      }
      return { x: limit, z: limit };
    };
  }

  /**
   * Adds an instanced prop (and its ink outline) to the world. Several meshes can share
   * the same transforms, e.g. a tree's trunk and canopy.
   */
  private instanced(
    parts: { geo: THREE.BufferGeometry; mat: THREE.Material; colors?: string[]; outline?: boolean }[],
    matrices: THREE.Matrix4[],
    seed: number,
  ): void {
    // Split into map sections so the GPU skips sections that are off screen.
    const cell = 80;
    const chunks = new Map<string, THREE.Matrix4[]>();
    const p = new THREE.Vector3();
    for (const m of matrices) {
      p.setFromMatrixPosition(m);
      const key = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
      let list = chunks.get(key);
      if (!list) chunks.set(key, (list = []));
      list.push(m);
    }
    const rand = mulberry32(seed);
    const color = new THREE.Color();
    for (const list of chunks.values()) {
      const tints = list.map(() => rand());
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geo, part.mat, list.length);
        list.forEach((m, i) => {
          mesh.setMatrixAt(i, m);
          if (part.colors) mesh.setColorAt(i, color.set(part.colors[Math.floor(tints[i] * part.colors.length)]));
        });
        mesh.computeBoundingSphere();
        this.group.add(mesh);
        if (part.outline !== false) {
          const line = outlineInstanced(mesh);
          line.computeBoundingSphere();
          this.group.add(line);
        }
      }
    }
  }

  private matrix(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, tilt = 0) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, tilt * 0.5));
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  }

  // ---------------------------------------------------------------- props

  /** Purple-trunked jungle trees with drooping teal leaves. Canopy tops out below the ship. */
  private buildTrees(place: Placer, count = 560): void {
    const rand = mulberry32(31);
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < count; i++) {
      const { x, z } = place(rand);
      const s = 0.7 + rand() * 0.5;
      matrices.push(this.matrix(x, this.heightAt(x, z) - 0.2, z, rand() * Math.PI * 2, s, s * (0.85 + rand() * 0.25), s, (rand() - 0.5) * 0.15));
    }
    this.instanced(
      [
        { geo: treeTrunk(), mat: toon('#ffffff'), colors: this.palette.trunk },
        { geo: treeCanopy(), mat: toon('#ffffff'), colors: this.palette.leaves },
      ],
      matrices,
      32,
    );
  }

  /** Big pink leaves fanning up out of the ground, like the reference's alien foliage. */
  private buildPinkFans(place: Placer, count = 900): void {
    const rand = mulberry32(41);
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < count; i++) {
      const { x, z } = place(rand);
      const s = 0.8 + rand() * rand() * 1.8;
      matrices.push(this.matrix(x, this.heightAt(x, z) - 0.1, z, rand() * Math.PI * 2, s, s, s));
    }
    this.instanced([{ geo: fanPlant(), mat: toon('#ffffff'), colors: this.palette.pinkLeaf }], matrices, 42);
  }

  /** Curving stalks topped with glowing pink bulbs. */
  private buildBulbStalks(place: Placer, clusters = 170): void {
    const rand = mulberry32(51);
    const matrices: THREE.Matrix4[] = [];
    for (let c = 0; c < clusters; c++) {
      const { x, z } = place(rand);
      const n = 2 + Math.floor(rand() * 4);
      for (let k = 0; k < n; k++) {
        const px = x + (rand() - 0.5) * 3;
        const pz = z + (rand() - 0.5) * 3;
        const s = 0.6 + rand() * 0.7;
        matrices.push(this.matrix(px, this.heightAt(px, pz) - 0.1, pz, rand() * Math.PI * 2, s, s * (0.8 + rand() * 0.6), s, (rand() - 0.5) * 0.5));
      }
    }
    const { stalk, bulb } = bulbStalk();
    this.instanced(
      [
        { geo: stalk, mat: toon(this.palette.stalk) },
        { geo: bulb, mat: this.bulbMat },
      ],
      matrices,
      52,
    );
  }

  /** Low ferns as ground cover. */
  private buildFerns(place: Placer, count = 1500): void {
    const rand = mulberry32(61);
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < count; i++) {
      const { x, z } = place(rand);
      const s = 0.5 + rand() * 0.7;
      matrices.push(this.matrix(x, this.heightAt(x, z) - 0.05, z, rand() * Math.PI * 2, s, s * 0.8, s));
    }
    this.instanced([{ geo: fern(), mat: toon('#ffffff'), colors: this.palette.fern, outline: false }], matrices, 62);
  }

  private buildRocks(place: Placer, count = 110): void {
    const rand = mulberry32(11);
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < count; i++) {
      const { x, z } = place(rand);
      const size = 0.6 + rand() * rand() * 2.2;
      const sy = size * (0.5 + rand() * 0.4);
      matrices.push(
        this.matrix(x, this.heightAt(x, z) + sy * 0.3, z, rand() * Math.PI * 2, size * (0.8 + rand() * 0.6), sy, size * (0.8 + rand() * 0.6), rand() * 0.4),
      );
    }
    this.instanced([{ geo: new THREE.IcosahedronGeometry(1, 0), mat: toon('#ffffff'), colors: this.palette.rock }], matrices, 12);
  }

  /** Old yellow machinery half swallowed by the jungle (like the reference's ruins). */
  private buildRelics(place: Placer, count = 18): void {
    const rand = mulberry32(71);
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < count; i++) {
      const { x, z } = place(rand);
      const s = 0.9 + rand() * 0.8;
      matrices.push(this.matrix(x, this.heightAt(x, z) - 0.6, z, rand() * Math.PI * 2, s, s, s, (rand() - 0.5) * 0.5));
    }
    const { body, trim } = relic();
    this.instanced(
      [
        { geo: body, mat: toon('#ffffff'), colors: this.palette.relic },
        { geo: trim, mat: toon(this.palette.relicDark) },
      ],
      matrices,
      72,
    );
  }

  /** Glowing seed pods on the ground. */
  private buildSpores(place: Placer, count = 220): void {
    const rand = mulberry32(37);
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < count; i++) {
      const { x, z } = place(rand);
      const s = 0.25 + rand() * 0.3;
      matrices.push(this.matrix(x, this.heightAt(x, z) + s * 0.5, z, 0, s, s * 1.3, s));
    }
    this.instanced([{ geo: new THREE.SphereGeometry(1, 10, 8), mat: glow(this.palette.spore) }], matrices, 38);
  }

  /** Giant jungle trees around the border mark the edge you can't fly past. */
  private buildBorder(): void {
    const rand = mulberry32(53);
    const spacing = 13;
    const matrices: THREE.Matrix4[] = [];
    for (let row = 0; row < 2; row++) {
      const off = this.halfSize + 8 + row * 12;
      const perSide = Math.ceil((off * 2) / spacing) + 1;
      for (let side = 0; side < 4; side++) {
        for (let k = 0; k < perSide; k++) {
          const t = -off + k * spacing + (rand() - 0.5) * 5;
          const [x, z] = side === 0 ? [t, -off] : side === 1 ? [t, off] : side === 2 ? [-off, t] : [off, t];
          const s = 2.4 + rand() * 1.6 + row * 0.8;
          matrices.push(this.matrix(x, this.heightAt(x, z) - 1, z, rand() * Math.PI * 2, s, s * (1.3 + rand() * 0.8), s));
        }
      }
    }
    this.instanced(
      [
        { geo: treeTrunk(), mat: toon('#ffffff'), colors: this.palette.trunk },
        { geo: treeCanopy(), mat: toon('#ffffff'), colors: this.palette.leaves },
      ],
      matrices,
      54,
    );
  }

  private buildLandingPad(): THREE.Mesh {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.6, 0.6, 6), toon('#5a4f86'));
    pad.position.y = 0.3;
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 0.65, 6), toon('#3a2f5a'));
    inner.position.y = 0.3;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5.4, 5.9, 6),
      glow('#6ff7ff', { transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.66;
    const outline = new THREE.InstancedMesh(pad.geometry, pad.material, 1);
    pad.updateMatrix();
    outline.setMatrixAt(0, pad.matrix);
    this.group.add(pad, outlineInstanced(outline), inner, ring);
    return ring;
  }
}

// ---------------------------------------------------------------- prop shapes
// Each is built once and drawn many times with instancing.

/** 0..1: how lush the jungle is here. Big blobs of dense growth with clearings between. */
function jungleDensity(x: number, z: number): number {
  return smoothstep(0.3, 0.52, fbm(x * 0.022 + 100, z * 0.022 - 40, 3));
}

/** Tapered, slightly flared trunk with three roots. About 4.2 units tall. */
function treeTrunk(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.32, 0.55, 4.2, 7);
  trunk.translate(0, 2.1, 0);
  parts.push(trunk);
  for (let i = 0; i < 3; i++) {
    const root = new THREE.ConeGeometry(0.28, 1.6, 5);
    root.rotateZ(Math.PI / 2 - 0.5);
    root.translate(0.55, 0.3, 0);
    root.rotateY((i / 3) * Math.PI * 2 + 0.4);
    parts.push(root);
  }
  return mergeAll(parts);
}

/** Drooping leaves radiating from the top of the trunk, plus a central tuft. Tops out ~5 units. */
function treeCanopy(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const leaves = 7;
  for (let i = 0; i < leaves; i++) {
    const leaf = new THREE.SphereGeometry(1, 6, 4);
    leaf.scale(0.55, 0.1, 1.7);
    leaf.translate(0, 0, 1.5);
    leaf.rotateX(0.38 + (i % 2) * 0.12); // droop
    leaf.rotateY((i / leaves) * Math.PI * 2);
    leaf.translate(0, 4.15 + (i % 2) * 0.2, 0);
    parts.push(leaf);
  }
  const tuft = new THREE.SphereGeometry(0.75, 6, 4);
  tuft.scale(1, 0.55, 1);
  tuft.translate(0, 4.45, 0);
  parts.push(tuft);
  return mergeAll(parts);
}

/** A vase of wide leaves opening upward. */
function fanPlant(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const leaves = 5;
  for (let i = 0; i < leaves; i++) {
    const leaf = new THREE.SphereGeometry(1, 6, 4);
    leaf.scale(0.5, 0.08, 1.25);
    leaf.translate(0, 0, 1.1);
    leaf.rotateX(-0.75 - (i % 2) * 0.2); // lean outward and up
    leaf.rotateY((i / leaves) * Math.PI * 2);
    parts.push(leaf);
  }
  return mergeAll(parts);
}

/** A curved stalk and the glowing bulb at its tip. */
function bulbStalk(): { stalk: THREE.BufferGeometry; bulb: THREE.BufferGeometry } {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.9, 1.4, 0),
    new THREE.Vector3(0.35, 2.6, 0),
  );
  const stalk = new THREE.TubeGeometry(curve, 8, 0.12, 5, false);
  const bulb = new THREE.SphereGeometry(0.38, 10, 8);
  bulb.scale(1, 1.25, 1);
  bulb.translate(0.35, 2.75, 0);
  return { stalk, bulb };
}

/** Low, spiky fern. */
function fern(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const frond = new THREE.ConeGeometry(0.22, 1.6, 4);
    frond.rotateX(Math.PI / 2 - 0.55);
    frond.translate(0, 0.35, 0.65);
    frond.rotateY((i / 6) * Math.PI * 2);
    parts.push(frond);
  }
  return mergeAll(parts);
}

/** A squat cylindrical machine with a domed cap, and its dark trim bands. */
function relic(): { body: THREE.BufferGeometry; trim: THREE.BufferGeometry } {
  const tank = new THREE.CylinderGeometry(1.3, 1.4, 2.4, 10);
  tank.translate(0, 1.2, 0);
  const cap = new THREE.SphereGeometry(1.35, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.55, 1);
  cap.translate(0, 2.4, 0);
  const bandA = new THREE.CylinderGeometry(1.45, 1.45, 0.25, 10);
  bandA.translate(0, 0.8, 0);
  const bandB = bandA.clone();
  bandB.translate(0, 1.0, 0);
  const pipe = new THREE.CylinderGeometry(0.18, 0.18, 1.6, 6);
  pipe.rotateZ(Math.PI / 2);
  pipe.translate(1.6, 1.5, 0);
  return { body: mergeAll([tank, cap]), trim: mergeAll([bandA, bandB, pipe]) };
}

/** Merge shapes into one geometry (non-indexed, position + normal only, so they combine cleanly). */
function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((g) => {
    const ni = g.index ? g.toNonIndexed() : g;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', ni.getAttribute('position'));
    out.setAttribute('normal', ni.getAttribute('normal'));
    return out;
  });
  return mergeGeometries(clean)!;
}

/**
 * A hand-painted look for the ground: hundreds of soft, overlapping brush dabs in light and
 * dark values. The texture tiles and multiplies the terrain's colours.
 */
function paintedTexture(): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgb(205,205,205)';
  g.fillRect(0, 0, size, size);
  const rand = mulberry32(7);
  for (let i = 0; i < 1800; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const w = 8 + rand() * 34;
    const h = w * (0.25 + rand() * 0.3);
    const v = Math.round(130 + rand() * 125);
    g.fillStyle = `rgba(${v},${v},${v},${0.25 + rand() * 0.3})`;
    const rot = -0.5 + rand() * 0.4; // strokes roughly share a direction, like a painter's hand
    // Draw wrapped copies so the texture tiles without seams.
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        g.beginPath();
        g.ellipse(x + ox, y + oy, w, h, rot, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace; // treat as plain brightness values
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(22, 22);
  tex.anisotropy = 4;
  return tex;
}

