import * as THREE from 'three';
import { castShadows } from './Shadows';
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

/** The landing zone: home base and respawn point. */
export const LANDING_PAD = { x: 0, z: 0, radius: 7 };

/** Groups of enemy turrets. Coordinates are (x, z); the landing pad is at 0, 0. */
export const OUTPOSTS: [number, number][] = [
  // Each sector's arena is centred on one of these (see run/Run.ts); the first is next to the
  // landing pad. Spread out so a sortie visits different parts of the jungle.
  [0, -70],
  [140, -120],
  [-140, -110],
  [170, 40],
  [-170, 30],
  [0, 110],
  [110, 200],
  [-120, 190],
  [230, -230],
  [-230, -230],
  [240, 170],
  [-240, 170],
  [60, -240],
  [-70, -240],
];

type Placer = (rand: () => number) => { x: number; z: number };

/** Flat-shaded (faceted) version of a material: every polygon face shows crisply. */
function faceted<T extends THREE.Material>(m: T): T {
  (m as T & { flatShading: boolean }).flatShading = true;
  return m;
}

/** Canyon colours (placeholders until the Blender rocks arrive). */
export const CANYON = {
  sandstone: '#d8bf7e',
  sandstoneDark: '#a98a5a',
  deep: '#16233d', // the canyon floor, far below
  floor: '#22405a',
  fog: '#e856ed', // haze in the canyons (darker and bluer the deeper you look)
  redGlow: '#ff5a4a',
};

/** How far the canyons drop below the rock tops. */
export const CANYON_DEPTH = 48;
/** Canyon fog: colour, density (opacity of each layer) and height (fraction of the depth it reaches up to). */
export const CANYON_FOG = { color: CANYON.fog, density: 0.23, height: 0.8 };
const FOG_LAYERS = 6;
/** Depth fraction of the stepped ledge part way down the canyon walls. */
const LEDGE = 0.38;
/** Canyon width (in ridge-noise units; bigger = wider canyons). */
const CANYON_WIDTH = 0.1;

/**
 * Spots that must stay solid rock: every arena centre (for every arena size the game clamps
 * them to; see run/Run.ts arenaAt).
 */
const CLEAR_SPOTS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (const [x, z] of OUTPOSTS) {
    for (const r of [110, 125, 130, 150, 180]) {
      const lim = 354 - r;
      const c: [number, number] = [Math.max(-lim, Math.min(lim, x)), Math.max(-lim, Math.min(lim, z))];
      if (!out.some((o) => Math.hypot(o[0] - c[0], o[1] - c[1]) < 4)) out.push(c);
    }
  }
  return out;
})();

/**
 * An alien jungle: mossy ground with pale streams, purple-trunked trees, pink fan plants,
 * glowing bulb stalks, ferns, half-buried relics, and giant trees around the edge of the map.
 *
 * Tree canopies stay below the ship's flying height so nothing ever hides the player, and
 * plants keep clear of the landing pad and the turret outposts so enemies stay readable.
 */
export class World {
  readonly halfSize = 360;
  readonly palette = JUNGLE;
  readonly group = new THREE.Group();
  private readonly bulbMat: THREE.MeshBasicMaterial;
  private readonly padRing: THREE.Mesh;
  private readonly fogLayers: THREE.Mesh[] = [];
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.bulbMat = glow(this.palette.bulb);
    this.buildGround();
    this.buildTrees(this.placer(4, 12, 1.8));
    this.buildGiantTrees(this.placer(10, 34, 0.8)); // well clear of towers so they never hide them
    this.buildPinkFans(this.placer(1, 9, 1.2));
    this.buildBulbStalks(this.placer(2, 9, 1));
    this.buildFerns(this.placer(0, 7, 0.6));
    this.buildRocks(this.placer(3, 9, 0.3));
    this.buildRelics(this.placer(9, 12, 0));
    this.buildSpores(this.placer(0, 6, 0.5));
    this.buildBorder();
    this.padRing = this.buildLandingPad();
    castShadows(this.group);
    scene.add(this.group);
  }

  /**
   * Height of the rock tops (the playing surface) at a world position. Continuous across the
   * canyons, so the ship hovers at a steady height over them. Use `surfaceAt` for the real
   * ground (down in a canyon) and `isRock` to check there's solid ground.
   */
  heightAt(x: number, z: number): number {
    const hills = (fbm(x * 0.016, z * 0.016, 3) - 0.5) * 6;
    // Flatten the area around the landing pad at the centre.
    const flat = smoothstep(10, 26, Math.hypot(x, z));
    return hills * flat;
  }

  /**
   * How deep into a canyon (x, z) is: 0 = on the rock top, LEDGE = on the stepped ledge part
   * way down, 1 = on the canyon floor.
   */
  canyonAt(x: number, z: number): number {
    const t = this.canyonT(x, z);
    if (t <= 0) return 0;
    return t < 0.42 ? LEDGE : 1;
  }

  /**
   * Canyon fog: `density` is each layer's opacity (they stack, so it's thickest at the
   * bottom), `height` how far up the canyon it reaches (0..1 of the depth).
   */
  setCanyonFog(color: string, density: number, height: number): void {
    const floor = -CANYON_DEPTH + 1;
    this.fogLayers.forEach((layer, i) => {
      const k = i / (FOG_LAYERS - 1); // 0 = the bottom layer, 1 = the top one
      const m = layer.material as THREE.MeshBasicMaterial;
      m.color.set(color);
      m.opacity = density * (1 - 0.6 * k);
      layer.visible = density > 0.001 && height > 0.01;
      layer.position.y = floor + k * height * (CANYON_DEPTH - 1);
    });
  }

  /** Is every point within `r` of (x, z) at the same canyon depth (0 = rock top, LEDGE, 1 = floor)? */
  private footprintAt(x: number, z: number, r: number, depth: number): boolean {
    if (this.canyonAt(x, z) !== depth) return false;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      if (this.canyonAt(x + Math.cos(a) * r, z + Math.sin(a) * r) !== depth) return false;
    }
    return true;
  }

  /** The real ground height, including canyons. */
  surfaceAt(x: number, z: number): number {
    return this.heightAt(x, z) - this.canyonAt(x, z) * CANYON_DEPTH;
  }

  /** Is (x, z) on a rock top, with at least `margin` units of rock around it? */
  isRock(x: number, z: number, margin = 0): boolean {
    if (this.canyonT(x, z) > 0) return false;
    if (margin <= 0) return true;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (this.canyonT(x + Math.cos(a) * margin, z + Math.sin(a) * margin) > 0) return false;
    }
    return true;
  }

  /** The closest point to (x, z) that's on a rock top with `margin` of room (searches outward). */
  nearestRock(x: number, z: number, margin = 0): { x: number; z: number } {
    if (this.isRock(x, z, margin)) return { x, z };
    for (let r = 3; r <= 90; r += 3) {
      const steps = Math.max(8, Math.round(r * 1.2));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (this.isRock(px, pz, margin)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  /**
   * The canyon field: winding cracks where two noise fields cross their midpoints. > 0 means
   * canyon (1 = its centre line). Arena centres and the landing pad are always solid rock.
   */
  private canyonT(x: number, z: number): number {
    const ridgeA = 1 - Math.abs(fbm(x * 0.0072 + 31, z * 0.0072 - 17, 3) - 0.5) * 2;
    const ridgeB = 1 - Math.abs(fbm(x * 0.0115 - 60, z * 0.0115 + 44, 2) - 0.5) * 2;
    const r = Math.max(ridgeA, ridgeB * 0.985);
    const w = CANYON_WIDTH * (0.75 + valueNoise(x * 0.012 + 5, z * 0.012 - 9) * 0.6);
    let t = (r - (1 - w)) / w;
    if (t <= 0) return 0;
    // Keep solid rock around the landing pad and every arena centre.
    let clear = smoothstep(32, 48, Math.hypot(x, z));
    for (const [cx, cz] of CLEAR_SPOTS) clear = Math.min(clear, smoothstep(26, 40, Math.hypot(x - cx, z - cz)));
    t = t * 1.25 - (1 - clear) * 1.3;
    return t;
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
    const seg = 380; // ~2.4 units per cell: canyon walls drop across one cell, so they read as cliffs
    const cell = size / seg;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(this.palette.groundLow);
    const high = new THREE.Color(this.palette.groundHigh);
    const pink = new THREE.Color(this.palette.groundPink);
    const path = new THREE.Color(this.palette.path);
    const sand = new THREE.Color(CANYON.sandstone);
    const sandDark = new THREE.Color(CANYON.sandstoneDark);
    const deep = new THREE.Color(CANYON.deep);
    const floor = new THREE.Color(CANYON.floor);
    const c = new THREE.Color();

    const jitter = mulberry32(13);
    for (let i = 0; i < pos.count; i++) {
      // Nudge every grid point a little, so cliff edges break into irregular facets
      // instead of following the grid in stair steps.
      const x = pos.getX(i) + (jitter() - 0.5) * cell * 0.8;
      const z = pos.getZ(i) + (jitter() - 0.5) * cell * 0.8;
      pos.setX(i, x);
      pos.setZ(i, z);
      const depth = this.canyonAt(x, z);
      const top = this.heightAt(x, z);
      pos.setY(i, top - depth * CANYON_DEPTH + (depth >= 1 ? (valueNoise(x * 0.2, z * 0.2) - 0.5) * 3 : 0));
      const grain = 0.88 + valueNoise(x * 0.3, z * 0.3) * 0.24;

      if (depth === 0) {
        // Rock top: moss, brighter on the rises and deep teal in the hollows.
        c.copy(low).lerp(high, smoothstep(-2.2, 1.6, top));
        c.lerp(pink, 0.55 * smoothstep(0.56, 0.68, fbm(x * 0.03 + 50, z * 0.03 - 20, 2)));
        const stream = Math.abs(fbm(x * 0.009 + 13, z * 0.009 + 7, 3) - 0.5);
        c.lerp(path, 0.85 * (1 - smoothstep(0.012, 0.03, stream)));
        // Bare sandstone along the rim, where the moss gives way to the cliff edge.
        const nearEdge = [0, 1, 2, 3].some((k) => this.canyonAt(x + Math.cos(k * 1.57) * cell * 1.2, z + Math.sin(k * 1.57) * cell * 1.2) > 0);
        if (nearEdge) c.lerp(sand, 0.75);
        c.multiplyScalar(grain * 1.1);
      } else if (depth < 1) {
        // The ledge part way down: sandstone, banded.
        c.copy(sand).lerp(sandDark, 0.35 + valueNoise(x * 0.08, z * 0.08) * 0.4).multiplyScalar(grain * 0.95);
      } else {
        // The canyon floor: deep blue rubble.
        c.copy(deep).lerp(floor, valueNoise(x * 0.05 + 3, z * 0.05) * 0.8).multiplyScalar(grain);
      }
      c.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    // Flat shading gives the crisp, faceted low-poly cliffs.
    const ground = new THREE.Mesh(geo, faceted(toon('#ffffff', { vertexColors: true, map: paintedTexture() })));
    ground.receiveShadow = true;
    ground.castShadow = true; // cliffs throw shadows down into the canyons
    ground.userData.noCast = true; // (castShadows() skips it; it's set by hand above)
    this.group.add(ground);
    this.buildCanyonDecor();
  }

  /**
   * Placeholder canyon dressing (to be replaced by Blender assets): sandstone blocks scattered
   * along the rims and on the ledges, rubble on the floor, and layered fog in the depths.
   */
  private buildCanyonDecor(): void {
    // Layers of fog inside the canyons, thickest at the bottom (the rock tops hide them
    // everywhere else). They ignore the sky-coloured fog. Tunable in the ?dev panel.
    const hazeSize = this.halfSize * 2 + 200;
    for (let i = 0; i < FOG_LAYERS; i++) {
      const haze = new THREE.Mesh(
        new THREE.PlaneGeometry(hazeSize, hazeSize),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false }),
      );
      haze.rotation.x = -Math.PI / 2;
      haze.renderOrder = 1;
      haze.userData.noCast = true;
      haze.userData.noOutline = true;
      this.fogLayers.push(haze);
      this.group.add(haze);
    }
    this.setCanyonFog(CANYON_FOG.color, CANYON_FOG.density, CANYON_FOG.height);

    const rand = mulberry32(77);
    const limit = this.halfSize + 40;
    const rim: THREE.Matrix4[] = [];
    const rubble: THREE.Matrix4[] = [];
    for (let i = 0; i < 26000 && (rim.length < 900 || rubble.length < 700); i++) {
      const x = (rand() * 2 - 1) * limit;
      const z = (rand() * 2 - 1) * limit;
      const depth = this.canyonAt(x, z);
      const top = this.heightAt(x, z);
      if (depth === 0) {
        // Blocks on the rock top near a rim, but with the whole block on solid rock (plus a margin
        // for the faceted cliff edge), so nothing hangs over the drop.
        if (rim.length >= 900) continue;
        const sx = 1 + rand() * 3.2;
        const sz = sx * (0.6 + rand() * 0.6);
        const foot = Math.max(sx, sz) + 1.6;
        if (!this.footprintAt(x, z, foot, 0) || this.isRock(x, z, foot + 3)) continue;
        rim.push(this.matrix(x, top + sx * 0.25, z, rand() * Math.PI, sx, sx * (0.35 + rand() * 0.5), sz, (rand() - 0.5) * 0.3));
      } else if (depth < 1) {
        if (rim.length >= 900 || rand() < 0.6) continue;
        const sx = 1.2 + rand() * 3;
        if (!this.footprintAt(x, z, sx + 1.6, LEDGE)) continue; // fully on the ledge
        rim.push(this.matrix(x, top - LEDGE * CANYON_DEPTH + sx * 0.25, z, rand() * Math.PI, sx, sx * 0.5, sx * 0.8, (rand() - 0.5) * 0.4));
      } else {
        const y = this.surfaceAt(x, z);
        if (rubble.length < 700) {
          const sx = 0.8 + rand() * 2.6;
          if (!this.footprintAt(x, z, sx + 1.6, 1)) continue; // on the floor, not against a wall
          rubble.push(this.matrix(x, y + sx * 0.2, z, rand() * Math.PI, sx, sx * 0.55, sx * 0.9, (rand() - 0.5) * 0.6));
        }
      }
    }
    const block = new THREE.DodecahedronGeometry(1, 0);
    this.instanced([{ geo: block, mat: faceted(toon('#ffffff')), colors: [CANYON.sandstone, CANYON.sandstoneDark, '#e8d08e'] }], rim, 41);
    this.instanced([{ geo: block, mat: faceted(toon('#ffffff')), colors: [CANYON.deep, CANYON.floor, '#2b3d5c'] }], rubble, 42);
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
        if (!this.isRock(x, z, 4)) continue; // plants grow on the rock tops, not over the canyons
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
  private buildTrees(place: Placer, count = 1500): void {
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

  /**
   * Giant trees scattered through the play area: canopies far below the ship and the tower
   * guns (top out around 20 units), so they add depth without hiding anything that matters.
   */
  private buildGiantTrees(place: Placer, count = 190): void {
    const rand = mulberry32(81);
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < count; i++) {
      const { x, z } = place(rand);
      const s = 2.6 + rand() * 1.4;
      matrices.push(this.matrix(x, this.heightAt(x, z) - 0.5, z, rand() * Math.PI * 2, s, s * (0.95 + rand() * 0.2), s, (rand() - 0.5) * 0.1));
    }
    this.instanced(
      [
        { geo: treeTrunk(), mat: toon('#ffffff'), colors: this.palette.trunk },
        { geo: treeCanopy(), mat: toon('#ffffff'), colors: this.palette.leaves },
      ],
      matrices,
      82,
    );
  }

  /** Big pink leaves fanning up out of the ground, like the reference's alien foliage. */
  private buildPinkFans(place: Placer, count = 2400): void {
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
  private buildBulbStalks(place: Placer, clusters = 460): void {
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
  private buildFerns(place: Placer, count = 4000): void {
    const rand = mulberry32(61);
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < count; i++) {
      const { x, z } = place(rand);
      const s = 0.5 + rand() * 0.7;
      matrices.push(this.matrix(x, this.heightAt(x, z) - 0.05, z, rand() * Math.PI * 2, s, s * 0.8, s));
    }
    this.instanced([{ geo: fern(), mat: toon('#ffffff'), colors: this.palette.fern, outline: false }], matrices, 62);
  }

  private buildRocks(place: Placer, count = 300): void {
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
  private buildRelics(place: Placer, count = 45): void {
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
  private buildSpores(place: Placer, count = 600): void {
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
