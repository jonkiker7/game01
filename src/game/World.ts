import * as THREE from 'three';
import { GLOW, glow, outlineInstanced, toon } from './materials';
import { clamp, fbm, mulberry32, smoothstep, valueNoise } from './math';

/** Colors for one planet. Each new planet later becomes a different palette + props. */
export const CRIMSON_DUNES = {
  sky: '#2a0f33',
  groundLow: '#3d1649',
  groundHigh: '#b5476c',
  groundAccent: '#e8845f',
  rock: ['#4a2152', '#5e2a5a', '#3a1a45'],
  crystal: '#7ff3ff',
  spore: '#ffb347',
  spire: '#24102e',
};

/**
 * Test level: a dune field on an alien planet, with rocks, glowing crystals,
 * spore pods and a ring of tall spires marking the edge of the map.
 */
export class World {
  readonly halfSize = 220;
  readonly group = new THREE.Group();
  private readonly palette = CRIMSON_DUNES;
  private readonly crystalMat: THREE.MeshBasicMaterial;
  private readonly padRing: THREE.Mesh;
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.crystalMat = glow(this.palette.crystal);
    this.buildGround();
    this.buildRocks();
    this.buildCrystals();
    this.buildSpores();
    this.buildSpires();
    this.padRing = this.buildLandingPad();
    scene.add(this.group);
  }

  /** Ground height at a world position (the ship hovers relative to this). */
  heightAt(x: number, z: number): number {
    const dunes = (fbm(x * 0.018, z * 0.018, 3) - 0.5) * 6;
    // Flatten the area around the landing pad at the centre.
    const flat = smoothstep(10, 26, Math.hypot(x, z));
    return dunes * flat;
  }

  update(dt: number): void {
    this.time += dt;
    const pulse = 0.75 + Math.sin(this.time * 2.2) * 0.25;
    this.crystalMat.color.set(this.palette.crystal).multiplyScalar(GLOW * pulse);
    (this.padRing.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(this.time * 3) * 0.25;
  }

  private buildGround(): void {
    const size = this.halfSize * 2 + 200;
    const seg = 160;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(this.palette.groundLow);
    const high = new THREE.Color(this.palette.groundHigh);
    const accent = new THREE.Color(this.palette.groundAccent);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);

      c.copy(low).lerp(high, clamp((h + 2.5) / 5, 0, 1));
      // Soft-edged patches of a warmer colour (a hard cut-off looked blocky on the vertex grid).
      c.lerp(accent, 0.5 * smoothstep(0.52, 0.66, fbm(x * 0.045 + 50, z * 0.045 - 20, 2)));
      c.multiplyScalar((0.85 + valueNoise(x * 0.3, z * 0.3) * 0.3) * 1.15);
      c.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const ground = new THREE.Mesh(geo, toon('#ffffff', { vertexColors: true, map: paintedTexture() }));
    this.group.add(ground);
  }

  /** Random spot inside the play area, away from the landing pad. */
  private scatter(rand: () => number, margin = 8): { x: number; z: number } {
    for (;;) {
      const x = (rand() * 2 - 1) * (this.halfSize - margin);
      const z = (rand() * 2 - 1) * (this.halfSize - margin);
      if (Math.hypot(x, z) > 22) return { x, z };
    }
  }

  private buildRocks(): void {
    const rand = mulberry32(11);
    const count = 260;
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), toon('#ffffff'), count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const { x, z } = this.scatter(rand);
      const size = 0.6 + rand() * rand() * 2.4;
      s.set(size * (0.8 + rand() * 0.6), size * (0.5 + rand() * 0.4), size * (0.8 + rand() * 0.6));
      p.set(x, this.heightAt(x, z) + s.y * 0.3, z);
      q.setFromEuler(e.set(rand() * 0.5, rand() * Math.PI * 2, rand() * 0.5));
      mesh.setMatrixAt(i, m.compose(p, q, s));
      mesh.setColorAt(i, color.set(this.palette.rock[i % this.palette.rock.length]));
    }
    this.group.add(mesh, outlineInstanced(mesh));
  }

  private buildCrystals(): void {
    const rand = mulberry32(23);
    const clusters = 70;
    const perCluster = 5;
    const geo = new THREE.ConeGeometry(0.35, 2.4, 5);
    geo.translate(0, 1.2, 0); // base of the crystal at the origin
    const mesh = new THREE.InstancedMesh(geo, this.crystalMat, clusters * perCluster);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    let i = 0;
    for (let c = 0; c < clusters; c++) {
      const { x, z } = this.scatter(rand);
      for (let k = 0; k < perCluster; k++) {
        const cx = x + (rand() - 0.5) * 2;
        const cz = z + (rand() - 0.5) * 2;
        const size = 0.5 + rand() * 1.1;
        s.set(size, size * (0.7 + rand() * 0.8), size);
        p.set(cx, this.heightAt(cx, cz) - 0.1, cz);
        q.setFromEuler(e.set((rand() - 0.5) * 0.9, rand() * Math.PI, (rand() - 0.5) * 0.9));
        mesh.setMatrixAt(i++, m.compose(p, q, s));
      }
    }
    this.group.add(mesh, outlineInstanced(mesh));
  }

  private buildSpores(): void {
    const rand = mulberry32(37);
    const count = 90;
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 10, 8), glow(this.palette.spore), count);
    const m = new THREE.Matrix4();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();

    for (let i = 0; i < count; i++) {
      const { x, z } = this.scatter(rand);
      const size = 0.5 + rand() * 0.8;
      s.set(size, size * 1.3, size);
      p.set(x, this.heightAt(x, z) + size * 0.4, z);
      mesh.setMatrixAt(i, m.compose(p, q, s));
    }
    this.group.add(mesh, outlineInstanced(mesh));
  }

  /** Tall rock spires around the border: they mark the edge you can't fly past. */
  private buildSpires(): void {
    const rand = mulberry32(53);
    const spacing = 11;
    const perSide = Math.ceil((this.halfSize * 2) / spacing) + 1;
    const count = perSide * 4 * 2;
    const geo = new THREE.ConeGeometry(4, 1, 6);
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, toon(this.palette.spire), count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    let i = 0;
    const edge = this.halfSize + 6;
    for (let row = 0; row < 2; row++) {
      const off = edge + row * 9;
      for (let side = 0; side < 4; side++) {
        for (let k = 0; k < perSide; k++) {
          const t = -off + k * spacing + (rand() - 0.5) * 4;
          const [x, z] = side === 0 ? [t, -off] : side === 1 ? [t, off] : side === 2 ? [-off, t] : [off, t];
          const w = 0.8 + rand() * 0.8;
          s.set(w, 14 + rand() * 26 + row * 10, w);
          p.set(x, this.heightAt(x, z) - 1, z);
          q.setFromEuler(e.set((rand() - 0.5) * 0.15, rand() * Math.PI, (rand() - 0.5) * 0.15));
          mesh.setMatrixAt(i++, m.compose(p, q, s));
        }
      }
    }
    mesh.count = i;
    const outline = outlineInstanced(mesh);
    outline.count = i;
    this.group.add(mesh, outline);
  }

  private buildLandingPad(): THREE.Mesh {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.6, 0.6, 6), toon('#5a3a5e'));
    pad.position.y = 0.3;
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 0.65, 6), toon('#3a2340'));
    inner.position.y = 0.3;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5.4, 5.9, 6),
      glow(this.palette.crystal, { transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.66;
    this.group.add(pad, outlineSingle(pad), inner, ring);
    return ring;
  }
}

/** Outline for a single (non-instanced) mesh placed directly in the world. */
function outlineSingle(mesh: THREE.Mesh): THREE.Object3D {
  const holder = new THREE.InstancedMesh(mesh.geometry, mesh.material as THREE.Material, 1);
  mesh.updateMatrix();
  holder.setMatrixAt(0, mesh.matrix);
  return outlineInstanced(holder);
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
