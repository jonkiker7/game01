import * as THREE from 'three';
import { castShadows } from './Shadows';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { blobArena, type ArenaShape } from './ArenaShape';
import { GLOW, glow, outlineInstanced, outlineMaterial, toon } from './materials';
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

export type Palette = typeof JUNGLE;

/** The desert planet: sun-baked sand, red rock, cacti, and tall mesas around the edge. */
export const DESERT: Palette = {
  sky: '#f2c48a',
  hemiSky: '#fff2d8',
  hemiGround: '#5a2e2a',
  groundLow: '#c98a4e', // dusty orange in the hollows
  groundHigh: '#ecc888', // pale sand on the rises
  groundPink: '#d8724a', // patches of red sand
  path: '#f6e2b6', // dry, pale riverbeds
  rock: ['#9a5a3c', '#b4704a', '#7e4a36'],
  trunk: ['#4f8a4a', '#5f9a52', '#467f44'], // cactus greens
  leaves: ['#b5583a', '#c76a42', '#a14a32', '#d27a4c'], // mesa reds
  pinkLeaf: ['#e0a060', '#f0b878', '#d89050'], // mesa caps
  stalk: '#6f9a52',
  bulb: '#ff8a5c',
  fern: ['#a8915a', '#8a7a4a', '#b9a36a'], // dry brush
  spore: '#ffd37a',
  relic: ['#c9b04a', '#b39a3c', '#d6c063'],
  relicDark: '#5b5226',
};

/** The ice planet: snowfields, frozen streams, snowy pines, ice crystals, and ice spires. */
export const ICE: Palette = {
  sky: '#cfe8f7',
  hemiSky: '#f4fbff',
  hemiGround: '#3a4f6e',
  groundLow: '#9cc4e2', // blue shadows in the hollows
  groundHigh: '#f4f9ff', // bright snow on the rises
  groundPink: '#c9dcf2', // wind-packed snow
  path: '#7cc0ec', // frozen streams
  rock: ['#8aa6c0', '#a7bdd2', '#6f8eaa'],
  trunk: ['#4a3a3a', '#5a4644'], // pine trunks
  leaves: ['#2f5a6a', '#346a72', '#28505e'], // pine needles
  pinkLeaf: ['#d8f0ff', '#b8e2fa', '#eaf7ff'], // ice spires
  stalk: '#6f8eaa',
  bulb: '#7fe8ff',
  fern: ['#b8cfe2', '#a2bdd4', '#d0e2f0'], // frosted shrubs
  spore: '#bff4ff',
  relic: ['#c9b04a', '#b39a3c', '#d6c063'],
  relicDark: '#5b5226',
};

export type Biome = 'jungle' | 'desert' | 'ice';

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

export type CanyonColors = typeof CANYON;
/** Desert canyons: red rock walls over a deep plum floor, with an orange dust haze. */
const DESERT_CANYON: CanyonColors = {
  sandstone: '#c46a3c',
  sandstoneDark: '#8e4426',
  deep: '#3a1f2e',
  floor: '#5a2e2e',
  fog: '#d8abff', // a lilac haze
  redGlow: '#ff5a4a',
};
/** Ice canyons: pale ice walls dropping to deep blue, with a cold blue mist. */
const ICE_CANYON: CanyonColors = {
  sandstone: '#cfe8f7',
  sandstoneDark: '#86b6d8',
  deep: '#0e2238',
  floor: '#1e4a6e',
  fog: '#8fdcff',
  redGlow: '#7fe8ff',
};
const BIOMES: Record<Biome, { palette: Palette; canyon: CanyonColors }> = {
  jungle: { palette: JUNGLE, canyon: CANYON },
  desert: { palette: DESERT, canyon: DESERT_CANYON },
  ice: { palette: ICE, canyon: ICE_CANYON },
};

/** Each planet's canyon fog colour (the ?dev panel can change them). */
export const BIOME_FOG: Record<Biome, string> = { jungle: CANYON.fog, desert: DESERT_CANYON.fog, ice: ICE_CANYON.fog };
/** Each planet's canyon fog density (the opacity of each fog layer). */
export const BIOME_FOG_DENSITY: Record<Biome, number> = { jungle: 0.23, desert: 0.28, ice: 0.23 };

/** How far the canyons drop below the rock tops. */
export const CANYON_DEPTH = 48;
/** Canyon fog: colour, density (opacity of each layer) and height (fraction of the depth it reaches up to). */
export const CANYON_FOG = { color: CANYON.fog, density: 0.23, height: 0.8 };
const FOG_LAYERS = 6;
/** Depth fraction of the stepped ledge part way down the canyon walls. */
const LEDGE = 0.38;
/** Canyon width (in ridge-noise units; bigger = wider canyons). */
const CANYON_WIDTH = 0.1;

/** Width of the band of tall trees outside the arena, which fades to black. */
const EDGE_BAND = 38;
/** Ground beyond the band (fully black), so the screen edges never show empty space. */
const EDGE_EXTRA = 70;

/**
 * An alien jungle: mossy ground with pale streams, purple-trunked trees, pink fan plants,
 * glowing bulb stalks, ferns, half-buried relics, and giant trees around the edge of the map.
 *
 * Tree canopies stay below the ship's flying height so nothing ever hides the player, and
 * plants keep clear of the landing pad and the turret outposts so enemies stay readable.
 */
export class World {
  /** Far bound for anything clamping to the map (arenas confine the ship themselves). */
  readonly halfSize = 2000;
  palette: Palette = JUNGLE;
  private canyon: CanyonColors = CANYON;
  biome: Biome = 'jungle';

  /** Which planet the next generate() builds (jungle, desert or ice). */
  setBiome(b: Biome): void {
    if (b === this.biome) return;
    this.biome = b;
    this.palette = BIOMES[b].palette;
    this.canyon = BIOMES[b].canyon;
    this.setCanyonFog(BIOME_FOG[b], BIOME_FOG_DENSITY[b], this.fog.height);
  }
  readonly group = new THREE.Group();
  private readonly bulbMat: THREE.MeshBasicMaterial;
  private readonly fogLayers: THREE.Mesh[] = [];
  private time = 0;
  /** The current round's arena, and the noise offsets that make its terrain unique. */
  shape: ArenaShape = blobArena(150, 1);
  private ox = 0;
  /** How far around the arena's centre stays canyon-free (the Sandworm's arena clears a lot). */
  centerClear = 26;
  private oz = 0;
  private fog = { ...CANYON_FOG };

  constructor(scene: THREE.Scene) {
    this.bulbMat = glow(this.palette.bulb);
    scene.add(this.group);
    this.generate(this.shape, 1);
  }

  /**
   * Build a fresh level for an arena: new hills and canyons (from `seed`), jungle on the rock
   * tops inside it, and a few rows of tall trees outside that fade to black.
   */
  generate(shape: ArenaShape, seed: number): void {
    this.clear();
    this.shape = shape;
    const rand = mulberry32(seed * 977 + 3);
    this.ox = (rand() - 0.5) * 9000;
    this.oz = (rand() - 0.5) * 9000;
    this.seed = seed;
    const area = this.arenaArea();
    // Prop counts were tuned for a 720×720 map: scale them to this arena's area.
    const per = (n: number) => Math.round((n * area) / (720 * 720));
    this.buildGround();
    if (this.biome === 'desert') {
      this.buildCacti(this.placer(1.2), per(800));
      this.buildBarrelCacti(this.placer(0.8), per(900));
      this.buildFerns(this.placer(0.6), per(2600)); // dry brush
      this.buildHoodoos(this.placer(0.4), per(140));
      this.buildRocks(this.placer(0.3), per(600));
      this.buildRelics(this.placer(0), Math.max(2, per(45)));
      this.buildEdgeMesas();
    } else if (this.biome === 'ice') {
      this.buildPines(this.placer(1.6), per(1100));
      this.buildIceCrystals(this.placer(0.7), per(500));
      this.buildFerns(this.placer(0.6), per(2600)); // frosted shrubs
      this.buildRocks(this.placer(0.3), per(500));
      this.buildRelics(this.placer(0), Math.max(2, per(45)));
      this.buildEdgeIce();
    } else {
      this.buildTrees(this.placer(1.8), per(1500));
      this.buildGiantTrees(this.placer(0.8), per(190));
      this.buildPinkFans(this.placer(1.2), per(2400));
      this.buildBulbStalks(this.placer(1), per(460));
      this.buildFerns(this.placer(0.6), per(4000));
      this.buildRocks(this.placer(0.3), per(300));
      this.buildRelics(this.placer(0), Math.max(2, per(45)));
      this.buildSpores(this.placer(0.5), per(600));
      this.buildEdgeTrees();
    }
    castShadows(this.group);
    // Everything that casts a shadow here is static: it can go into the baked shadows.
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.castShadow) o.userData.bakeCaster = true;
    });
    this.setStaticCasting(this.staticCasting);
    this.setProps(this.propsVisible);
    this.onGenerated?.();
  }

  /** Called after each new arena is built (main re-bakes the shadows). */
  onGenerated?: () => void;
  /** Lets main add baked shadows to the ground material. */
  patchGround?: (mat: THREE.Material) => void;
  private staticCasting = true;
  private propsVisible = true;

  /** Whether the terrain, trees and rocks go into the live shadow map (off when baked). */
  setStaticCasting(on: boolean): void {
    this.staticCasting = on;
    this.group.traverse((o) => {
      if (o.userData.bakeCaster) o.castShadow = on;
    });
  }

  /** Show or hide every plant, tree, rock and relic (for measuring what they cost). */
  setProps(visible: boolean): void {
    this.propsVisible = visible;
    for (const o of this.group.children) if (!o.userData.isGround && !this.fogLayers.includes(o as THREE.Mesh)) o.visible = visible;
  }

  private seed = 1;

  /** Remove (and free) the previous level. */
  private clear(): void {
    const shared = outlineMaterial();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) if (mat && mat !== shared && mat !== this.bulbMat) mat.dispose();
    });
    this.group.clear();
    this.fogLayers.length = 0;
  }

  /** Rough area of the arena (for scaling prop counts). */
  private arenaArea(): number {
    const b = this.shape.bounds;
    let inside = 0;
    const n = 40;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = b.x0 + ((i + 0.5) / n) * (b.x1 - b.x0);
        const z = b.z0 + ((j + 0.5) / n) * (b.z1 - b.z0);
        if (this.shape.depth(x, z) > 0) inside++;
      }
    }
    return (inside / (n * n)) * (b.x1 - b.x0) * (b.z1 - b.z0);
  }

  /** 0 inside the arena, rising to 1 (black) at the outer edge of the tree band. */
  darkAt(x: number, z: number): number {
    const out = -this.shape.depth(x, z);
    return smoothstep(0, EDGE_BAND, out);
  }

  /**
   * Height of the rock tops (the playing surface) at a world position. Continuous across the
   * canyons, so the ship hovers at a steady height over them. Use `surfaceAt` for the real
   * ground (down in a canyon) and `isRock` to check there's solid ground.
   */
  heightAt(x: number, z: number): number {
    return (fbm((x + this.ox) * 0.016, (z + this.oz) * 0.016, 3) - 0.5) * 6;
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
  /** Set every planet's fog colour and density, and the fog's height (for the ?dev panel). */
  setFogColors(colors: Record<Biome, string>, densities: Record<Biome, number>, height: number): void {
    Object.assign(BIOME_FOG, colors);
    Object.assign(BIOME_FOG_DENSITY, densities);
    this.setCanyonFog(BIOME_FOG[this.biome], BIOME_FOG_DENSITY[this.biome], height);
  }

  setCanyonFog(color: string, density: number, height: number): void {
    this.fog = { color, density, height };
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
    if (this.shape.depth(x, z) < margin + 3) return false; // inside the arena, too
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
    const nx = x + this.ox;
    const nz = z + this.oz;
    const ridgeA = 1 - Math.abs(fbm(nx * 0.0072 + 31, nz * 0.0072 - 17, 3) - 0.5) * 2;
    const ridgeB = 1 - Math.abs(fbm(nx * 0.0115 - 60, nz * 0.0115 + 44, 2) - 0.5) * 2;
    const r = Math.max(ridgeA, ridgeB * 0.985);
    const w = CANYON_WIDTH * (0.75 + valueNoise(nx * 0.012 + 5, nz * 0.012 - 9) * 0.6);
    let t = (r - (1 - w)) / w;
    if (t <= 0) return 0;
    // Solid rock around the arena's centre and where you fly in, and canyons die out toward
    // the arena edge (the trees outside stand on solid ground).
    const sh = this.shape;
    let clear = smoothstep(this.centerClear, this.centerClear + 16, Math.hypot(x - sh.center.x, z - sh.center.z));
    clear = Math.min(clear, smoothstep(14, 26, Math.hypot(x - sh.entry.x, z - sh.entry.z)));
    clear = Math.min(clear, smoothstep(4, 18, sh.depth(x, z)));
    t = t * 1.25 - (1 - clear) * 1.3;
    return t;
  }

  update(dt: number): void {
    this.time += dt;
    const pulse = 0.8 + Math.sin(this.time * 2.2) * 0.2;
    this.bulbMat.color.set(this.palette.bulb).multiplyScalar(GLOW * pulse);
  }

  // ---------------------------------------------------------------- ground

  /** The area to build ground over: the arena, its tree band, and black ground beyond. */
  region(): { x0: number; z0: number; x1: number; z1: number } {
    const b = this.shape.bounds;
    const m = EDGE_BAND + EDGE_EXTRA;
    return { x0: b.x0 - m, z0: b.z0 - m, x1: b.x1 + m, z1: b.z1 + m };
  }

  private buildGround(): void {
    const r = this.region();
    const cell = 2.4; // canyon walls drop across one cell, so they read as cliffs
    const segX = Math.ceil((r.x1 - r.x0) / cell);
    const segZ = Math.ceil((r.z1 - r.z0) / cell);
    const geo = new THREE.PlaneGeometry(segX * cell, segZ * cell, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    geo.translate((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(this.palette.groundLow);
    const high = new THREE.Color(this.palette.groundHigh);
    const pink = new THREE.Color(this.palette.groundPink);
    const path = new THREE.Color(this.palette.path);
    const sand = new THREE.Color(this.canyon.sandstone);
    const sandDark = new THREE.Color(this.canyon.sandstoneDark);
    const deep = new THREE.Color(this.canyon.deep);
    const floor = new THREE.Color(this.canyon.floor);
    const c = new THREE.Color();

    const jitter = mulberry32(this.seed * 31 + 13);
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
        c.lerp(pink, 0.55 * smoothstep(0.56, 0.68, fbm((x + this.ox) * 0.03 + 50, (z + this.oz) * 0.03 - 20, 2)));
        const stream = Math.abs(fbm((x + this.ox) * 0.009 + 13, (z + this.oz) * 0.009 + 7, 3) - 0.5);
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
      // Outside the arena the ground fades to black through the tree band.
      c.multiplyScalar(1 - this.darkAt(x, z));
      c.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    // Flat shading gives the crisp, faceted low-poly cliffs.
    const ground = new THREE.Mesh(geo, faceted(toon('#ffffff', { vertexColors: true, map: paintedTexture() })));
    ground.receiveShadow = true;
    ground.castShadow = true; // cliffs throw shadows down into the canyons
    ground.userData.noCast = true; // (castShadows() skips it; it's set by hand above)
    ground.userData.isGround = true;
    this.patchGround?.(ground.material as THREE.Material);
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
    const reg = this.region();
    for (let i = 0; i < FOG_LAYERS; i++) {
      const haze = new THREE.Mesh(
        new THREE.PlaneGeometry(reg.x1 - reg.x0, reg.z1 - reg.z0).translate((reg.x0 + reg.x1) / 2, -(reg.z0 + reg.z1) / 2, 0),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false }),
      );
      haze.rotation.x = -Math.PI / 2;
      haze.renderOrder = 1;
      haze.userData.noCast = true;
      haze.userData.noOutline = true;
      this.fogLayers.push(haze);
      this.group.add(haze);
    }
    this.setCanyonFog(this.fog.color, this.fog.density, this.fog.height);

    const rand = mulberry32(this.seed * 17 + 77);
    const b = this.shape.bounds;
    const rim: THREE.Matrix4[] = [];
    const rubble: THREE.Matrix4[] = [];
    const scale = this.arenaArea() / (720 * 720);
    const maxRim = Math.round(900 * scale);
    const maxRubble = Math.round(700 * scale);
    for (let i = 0; i < 26000 * scale + 2000 && (rim.length < maxRim || rubble.length < maxRubble); i++) {
      const x = b.x0 + rand() * (b.x1 - b.x0);
      const z = b.z0 + rand() * (b.z1 - b.z0);
      if (this.shape.depth(x, z) < 2) continue;
      const depth = this.canyonAt(x, z);
      const top = this.heightAt(x, z);
      if (depth === 0) {
        // Blocks on the rock top near a rim, but with the whole block on solid rock (plus a margin
        // for the faceted cliff edge), so nothing hangs over the drop.
        if (rim.length >= maxRim) continue;
        const sx = 1 + rand() * 3.2;
        const sz = sx * (0.6 + rand() * 0.6);
        const foot = Math.max(sx, sz) + 1.6;
        if (!this.footprintAt(x, z, foot, 0) || this.isRock(x, z, foot + 3)) continue;
        rim.push(this.matrix(x, top + sx * 0.25, z, rand() * Math.PI, sx, sx * (0.35 + rand() * 0.5), sz, (rand() - 0.5) * 0.3));
      } else if (depth < 1) {
        if (rim.length >= maxRim || rand() < 0.6) continue;
        const sx = 1.2 + rand() * 3;
        if (!this.footprintAt(x, z, sx + 1.6, LEDGE)) continue; // fully on the ledge
        rim.push(this.matrix(x, top - LEDGE * CANYON_DEPTH + sx * 0.25, z, rand() * Math.PI, sx, sx * 0.5, sx * 0.8, (rand() - 0.5) * 0.4));
      } else {
        const y = this.surfaceAt(x, z);
        if (rubble.length < maxRubble) {
          const sx = 0.8 + rand() * 2.6;
          if (!this.footprintAt(x, z, sx + 1.6, 1)) continue; // on the floor, not against a wall
          rubble.push(this.matrix(x, y + sx * 0.2, z, rand() * Math.PI, sx, sx * 0.55, sx * 0.9, (rand() - 0.5) * 0.6));
        }
      }
    }
    const block = new THREE.DodecahedronGeometry(1, 0);
    const k = this.canyon;
    this.instanced([{ geo: block, mat: faceted(toon('#ffffff')), colors: [k.sandstone, k.sandstoneDark, this.biome === 'jungle' ? '#e8d08e' : k.sandstone] }], rim, 41);
    this.instanced([{ geo: block, mat: faceted(toon('#ffffff')), colors: [k.deep, k.floor, this.biome === 'jungle' ? '#2b3d5c' : k.floor] }], rubble, 42);
  }

  // ---------------------------------------------------------------- placement

  /**
   * Returns a function that picks random spots on the rock tops inside the arena.
   * `clumping` > 0 favours dense jungle patches (higher = stronger).
   */
  private placer(clumping = 1): Placer {
    const b = this.shape.bounds;
    return (rand) => {
      for (let tries = 0; tries < 60; tries++) {
        const x = b.x0 + rand() * (b.x1 - b.x0);
        const z = b.z0 + rand() * (b.z1 - b.z0);
        if (this.shape.depth(x, z) < 2) continue;
        // Plants grow in thick clumps with open clearings between them.
        if (rand() > Math.pow(jungleDensity(x + this.ox, z + this.oz), clumping)) continue;
        if (Math.hypot(x - this.shape.entry.x, z - this.shape.entry.z) < 12) continue; // room to fly in
        if (this.canyonT(x, z) > 0 || !this.footprintRock(x, z, 4)) continue; // on the rock tops
        return { x, z };
      }
      return { x: b.x1 + 999, z: b.z1 + 999 }; // nowhere suitable: put it far off screen
    };
  }

  /** Rock-top check that ignores the arena edge (plants may grow right up to it). */
  private footprintRock(x: number, z: number, margin: number): boolean {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (this.canyonT(x + Math.cos(a) * margin, z + Math.sin(a) * margin) > 0) return false;
    }
    return true;
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
    const rand = mulberry32(seed + this.seed * 101);
    const color = new THREE.Color();
    for (const list of chunks.values()) {
      const tints = list.map(() => rand());
      // Things outside the arena fade to black with the ground.
      const light = list.map((m) => {
        p.setFromMatrixPosition(m);
        return 1 - this.darkAt(p.x, p.z);
      });
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geo, part.mat, list.length);
        list.forEach((m, i) => {
          mesh.setMatrixAt(i, m);
          if (part.colors) color.set(part.colors[Math.floor(tints[i] * part.colors.length)]);
          else color.setRGB(1, 1, 1);
          mesh.setColorAt(i, color.multiplyScalar(light[i]));
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
    const rand = mulberry32(31 + this.seed * 7);
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
    const rand = mulberry32(81 + this.seed * 7);
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
    const rand = mulberry32(41 + this.seed * 7);
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
    const rand = mulberry32(51 + this.seed * 7);
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
    const rand = mulberry32(61 + this.seed * 7);
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < count; i++) {
      const { x, z } = place(rand);
      const s = 0.5 + rand() * 0.7;
      matrices.push(this.matrix(x, this.heightAt(x, z) - 0.05, z, rand() * Math.PI * 2, s, s * 0.8, s));
    }
    this.instanced([{ geo: fern(), mat: toon('#ffffff'), colors: this.palette.fern, outline: false }], matrices, 62);
  }

  private buildRocks(place: Placer, count = 300): void {
    const rand = mulberry32(11 + this.seed * 7);
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
    const rand = mulberry32(71 + this.seed * 7);
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
    const rand = mulberry32(37 + this.seed * 7);
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < count; i++) {
      const { x, z } = place(rand);
      const s = 0.25 + rand() * 0.3;
      matrices.push(this.matrix(x, this.heightAt(x, z) + s * 0.5, z, 0, s, s * 1.3, s));
    }
    this.instanced([{ geo: new THREE.SphereGeometry(1, 10, 8), mat: glow(this.palette.spore) }], matrices, 38);
  }

  /**
   * A few rows of thick, tall jungle trees all around the arena edge. They grow taller and
   * closer together further out, and fade to black with the ground.
   */
  private buildEdgeTrees(): void {
    const rand = mulberry32(this.seed * 19 + 53);
    const b = this.shape.bounds;
    const m = EDGE_BAND + 6;
    const spacing = 6.5;
    const matrices: THREE.Matrix4[] = [];
    for (let x = b.x0 - m; x <= b.x1 + m; x += spacing) {
      for (let z = b.z0 - m; z <= b.z1 + m; z += spacing) {
        const px = x + (rand() - 0.5) * spacing * 0.9;
        const pz = z + (rand() - 0.5) * spacing * 0.9;
        const out = -this.shape.depth(px, pz); // how far outside the arena
        if (out < -1 || out > EDGE_BAND + 4) continue;
        const k = Math.min(1, Math.max(0, out / EDGE_BAND));
        const s = 1.7 + k * 1.3 + rand() * 0.6; // tall but below the camera's line of sight
        matrices.push(this.matrix(px, this.heightAt(px, pz) - 0.6, pz, rand() * Math.PI * 2, s, s * (1.1 + rand() * 0.5), s, (rand() - 0.5) * 0.1));
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
}

// ---------------------------------------------------------------- desert and ice props
// (added to the World class's prototype below, to keep the jungle code above untouched)

declare module './World' {
  interface World {
    buildCacti(place: Placer, count: number): void;
    buildBarrelCacti(place: Placer, count: number): void;
    buildHoodoos(place: Placer, count: number): void;
    buildEdgeMesas(): void;
    buildPines(place: Placer, count: number): void;
    buildIceCrystals(place: Placer, count: number): void;
    buildEdgeIce(): void;
  }
}

type WorldInternals = {
  seed: number;
  palette: Palette;
  shape: ArenaShape;
  heightAt(x: number, z: number): number;
  matrix(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, tilt?: number): THREE.Matrix4;
  instanced(parts: { geo: THREE.BufferGeometry; mat: THREE.Material; colors?: string[]; outline?: boolean }[], matrices: THREE.Matrix4[], seed: number): void;
};
const W = World.prototype as unknown as Record<string, unknown>;

/** Saguaro cacti: a tall green column with an arm or two. Below the ship's flying height. */
W.buildCacti = function (this: WorldInternals, place: Placer, count: number): void {
  const rand = mulberry32(131 + this.seed * 7);
  const m: THREE.Matrix4[] = [];
  for (let i = 0; i < count; i++) {
    const { x, z } = place(rand);
    const s = 0.8 + rand() * 0.6;
    m.push(this.matrix(x, this.heightAt(x, z) - 0.2, z, rand() * Math.PI * 2, s, s * (0.85 + rand() * 0.35), s, (rand() - 0.5) * 0.08));
  }
  this.instanced([{ geo: saguaro(), mat: toon('#ffffff'), colors: this.palette.trunk }], m, 132);
};

/** Round, ribbed barrel cacti with a pink flower on top. */
W.buildBarrelCacti = function (this: WorldInternals, place: Placer, count: number): void {
  const rand = mulberry32(141 + this.seed * 7);
  const m: THREE.Matrix4[] = [];
  for (let i = 0; i < count; i++) {
    const { x, z } = place(rand);
    const s = 0.5 + rand() * 0.6;
    m.push(this.matrix(x, this.heightAt(x, z) - 0.1, z, rand() * Math.PI * 2, s, s * (0.8 + rand() * 0.5), s));
  }
  const { body, flower } = barrelCactus();
  this.instanced(
    [
      { geo: body, mat: toon('#ffffff'), colors: this.palette.trunk },
      { geo: flower, mat: toon('#ff7aa8'), outline: false },
    ],
    m,
    142,
  );
};

/** Hoodoos: stacked sandstone pillars in the play area (well below the ship). */
W.buildHoodoos = function (this: WorldInternals, place: Placer, count: number): void {
  const rand = mulberry32(151 + this.seed * 7);
  const m: THREE.Matrix4[] = [];
  for (let i = 0; i < count; i++) {
    const { x, z } = place(rand);
    const s = 1.2 + rand() * 1.1;
    m.push(this.matrix(x, this.heightAt(x, z) - 0.4, z, rand() * Math.PI * 2, s, s * (0.8 + rand() * 0.5), s));
  }
  this.instanced([{ geo: hoodoo(), mat: faceted(toon('#ffffff')), colors: this.palette.leaves }], m, 152);
};

/** Tall flat-topped mesas all around the arena edge (they wall it in), fading to black. */
W.buildEdgeMesas = function (this: WorldInternals): void {
  const rand = mulberry32(this.seed * 19 + 61);
  const b = this.shape.bounds;
  const mrg = EDGE_BAND + 10;
  const spacing = 13;
  const m: THREE.Matrix4[] = [];
  for (let x = b.x0 - mrg; x <= b.x1 + mrg; x += spacing) {
    for (let z = b.z0 - mrg; z <= b.z1 + mrg; z += spacing) {
      const px = x + (rand() - 0.5) * spacing * 0.8;
      const pz = z + (rand() - 0.5) * spacing * 0.8;
      const out = -this.shape.depth(px, pz);
      if (out < 2 || out > EDGE_BAND + 8) continue;
      const k = Math.min(1, out / EDGE_BAND);
      const r = 7 + rand() * 4;
      // Lower on the camera's side (south), so they never hide the play area; tall beyond.
      const h = (8 + k * 8 + rand() * 6) * nearSide(this.shape, pz);
      m.push(this.matrix(px, this.heightAt(px, pz) - 1, pz, rand() * Math.PI * 2, r, h, r * (0.8 + rand() * 0.4)));
    }
  }
  const { body, cap } = mesa();
  this.instanced(
    [
      { geo: body, mat: faceted(toon('#ffffff')), colors: this.palette.leaves },
      { geo: cap, mat: faceted(toon('#ffffff')), colors: this.palette.pinkLeaf },
    ],
    m,
    62,
  );
};

/** Snowy pines: stacked dark-green tiers with snow on each. */
W.buildPines = function (this: WorldInternals, place: Placer, count: number): void {
  const rand = mulberry32(161 + this.seed * 7);
  const m: THREE.Matrix4[] = [];
  for (let i = 0; i < count; i++) {
    const { x, z } = place(rand);
    const s = 0.7 + rand() * 0.6;
    m.push(this.matrix(x, this.heightAt(x, z) - 0.2, z, rand() * Math.PI * 2, s, s * (0.85 + rand() * 0.3), s, (rand() - 0.5) * 0.08));
  }
  const { trunk, needles, snow } = pine();
  this.instanced(
    [
      { geo: trunk, mat: toon('#ffffff'), colors: this.palette.trunk, outline: false },
      { geo: needles, mat: toon('#ffffff'), colors: this.palette.leaves },
      { geo: snow, mat: toon('#f4f9ff'), outline: false },
    ],
    m,
    162,
  );
};

/** Clusters of glassy ice crystals. */
W.buildIceCrystals = function (this: WorldInternals, place: Placer, count: number): void {
  const rand = mulberry32(171 + this.seed * 7);
  const m: THREE.Matrix4[] = [];
  for (let i = 0; i < count; i++) {
    const { x, z } = place(rand);
    const s = 0.6 + rand() * 0.9;
    m.push(this.matrix(x, this.heightAt(x, z) - 0.2, z, rand() * Math.PI * 2, s, s * (0.8 + rand() * 0.6), s));
  }
  this.instanced([{ geo: crystalCluster(), mat: faceted(toon('#ffffff')), colors: ['#8fe6ff', '#b8f2ff', '#6fd0f5'] }], m, 172);
};

/** Tall jagged ice spires all around the arena edge (they wall it in), fading to black. */
W.buildEdgeIce = function (this: WorldInternals): void {
  const rand = mulberry32(this.seed * 19 + 71);
  const b = this.shape.bounds;
  const mrg = EDGE_BAND + 8;
  const spacing = 8;
  const m: THREE.Matrix4[] = [];
  for (let x = b.x0 - mrg; x <= b.x1 + mrg; x += spacing) {
    for (let z = b.z0 - mrg; z <= b.z1 + mrg; z += spacing) {
      const px = x + (rand() - 0.5) * spacing * 0.9;
      const pz = z + (rand() - 0.5) * spacing * 0.9;
      const out = -this.shape.depth(px, pz);
      if (out < 0 || out > EDGE_BAND + 6) continue;
      const k = Math.min(1, out / EDGE_BAND);
      const r = 3.5 + rand() * 3;
      const h = (8 + k * 9 + rand() * 6) * nearSide(this.shape, pz);
      m.push(this.matrix(px, this.heightAt(px, pz) - 1, pz, rand() * Math.PI * 2, r, h, r * (0.7 + rand() * 0.6), (rand() - 0.5) * 0.25));
    }
  }
  this.instanced([{ geo: iceSpire(), mat: faceted(toon('#ffffff')), colors: this.palette.pinkLeaf }], m, 72);
};

/** Height factor for edge walls: low on the south (camera) side, tall on the far side. */
function nearSide(shape: ArenaShape, z: number): number {
  const t = (z - shape.center.z) / Math.max(1, shape.radius);
  return 1.35 - 0.95 * smoothstep(-0.2, 0.7, t);
}

/** A saguaro: a ribbed column (about 5 units tall) with two arms. */
function saguaro(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CapsuleGeometry(0.45, 4.2, 3, 8);
  trunk.translate(0, 2.5, 0);
  parts.push(trunk);
  for (const [side, h, up] of [
    [1, 2.0, 1.4],
    [-1, 2.8, 1.0],
  ] as const) {
    const out = new THREE.CapsuleGeometry(0.3, 0.8, 3, 6);
    out.rotateZ(Math.PI / 2);
    out.translate(side * 0.75, h, 0);
    const rise = new THREE.CapsuleGeometry(0.3, up, 3, 6);
    rise.translate(side * 1.2, h + up / 2 + 0.1, 0);
    parts.push(out, rise);
  }
  return mergeAll(parts);
}

/** A ribbed barrel cactus and the flower on top. */
function barrelCactus(): { body: THREE.BufferGeometry; flower: THREE.BufferGeometry } {
  const body = new THREE.SphereGeometry(0.9, 10, 7);
  body.scale(1, 1.1, 1);
  body.translate(0, 0.8, 0);
  const flower = new THREE.ConeGeometry(0.35, 0.4, 6);
  flower.rotateX(Math.PI);
  flower.translate(0, 1.95, 0);
  return { body: mergeAll([body]), flower: mergeAll([flower]) };
}

/** A hoodoo: a tapering pillar with a wider rock balanced on top (about 6 units tall). */
function hoodoo(): THREE.BufferGeometry {
  const base = new THREE.CylinderGeometry(0.7, 1.2, 3.6, 7);
  base.translate(0, 1.8, 0);
  const neck = new THREE.CylinderGeometry(0.45, 0.7, 1.2, 7);
  neck.translate(0, 4.2, 0);
  const cap = new THREE.DodecahedronGeometry(1.1, 0);
  cap.scale(1.1, 0.6, 1.1);
  cap.translate(0, 5.2, 0);
  return mergeAll([base, neck, cap]);
}

/** A mesa: a steep, slightly tapered block (unit size, scaled per instance) and its flat cap. */
function mesa(): { body: THREE.BufferGeometry; cap: THREE.BufferGeometry } {
  const body = new THREE.CylinderGeometry(0.82, 1, 1, 7);
  body.translate(0, 0.5, 0);
  const cap = new THREE.CylinderGeometry(0.84, 0.84, 0.05, 7);
  cap.translate(0, 1.0, 0);
  return { body: mergeAll([body]), cap: mergeAll([cap]) };
}

/** A pine: a short trunk, three tiers of needles, and snow on each tier. */
function pine(): { trunk: THREE.BufferGeometry; needles: THREE.BufferGeometry; snow: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.22, 0.3, 1.4, 6);
  trunk.translate(0, 0.7, 0);
  const needles: THREE.BufferGeometry[] = [];
  const snow: THREE.BufferGeometry[] = [];
  const tiers = [
    [1.6, 1.8, 1.2],
    [1.25, 1.6, 2.4],
    [0.85, 1.4, 3.5],
  ];
  for (const [r, h, y] of tiers) {
    const cone = new THREE.ConeGeometry(r, h, 7);
    cone.translate(0, y + h / 2, 0);
    needles.push(cone);
    const cap = new THREE.ConeGeometry(r * 0.62, h * 0.42, 7);
    cap.translate(0, y + h - h * 0.21 + 0.02, 0);
    snow.push(cap);
  }
  return { trunk: mergeAll([trunk]), needles: mergeAll(needles), snow: mergeAll(snow) };
}

/** A few long ice crystals leaning out of the snow. */
function crystalCluster(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const specs = [
    [0, 0, 1.0, 0],
    [0.6, 0.2, 0.7, 0.5],
    [-0.5, -0.3, 0.6, -0.45],
    [0.1, -0.6, 0.5, 0.3],
  ];
  for (const [x, z, s, lean] of specs) {
    const c = new THREE.OctahedronGeometry(0.5, 0);
    c.scale(0.7 * s, 2.4 * s, 0.7 * s);
    c.rotateZ(lean);
    c.translate(x, 1.1 * s, z);
    parts.push(c);
  }
  return mergeAll(parts);
}

/** A tall, jagged ice spire (unit radius, scaled per instance). */
function iceSpire(): THREE.BufferGeometry {
  const main = new THREE.ConeGeometry(1, 1, 5);
  main.translate(0, 0.5, 0);
  const side = new THREE.ConeGeometry(0.55, 0.6, 5);
  side.rotateZ(0.3);
  side.translate(0.6, 0.3, 0.2);
  return mergeAll([main, side]);
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
