import * as THREE from 'three';
import { GLOW, glow, toon } from './materials';
import { mulberry32 } from './math';

interface Effect {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  from: number;
  to: number;
  alpha: number;
}

class EffectPool {
  private readonly items: Effect[] = [];
  private next = 0;

  constructor(scene: THREE.Scene, geo: THREE.BufferGeometry, size: number, flat = false) {
    for (let i = 0; i < size; i++) {
      const mat = glow('#ffffff', {
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: flat ? THREE.DoubleSide : THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      if (flat) mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.items.push({ mesh, mat, life: 0, maxLife: 1, from: 1, to: 1, alpha: 1 });
    }
  }

  /** Reuses the oldest slot when the pool is full, so effects never fail to appear. */
  spawn(pos: THREE.Vector3, color: THREE.ColorRepresentation, life: number, from: number, to: number, alpha: number) {
    const e = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    e.life = e.maxLife = life;
    e.from = from;
    e.to = to;
    e.alpha = alpha;
    e.mat.color.set(color).multiplyScalar(GLOW);
    e.mesh.position.copy(pos);
    e.mesh.scale.setScalar(from);
    e.mesh.visible = true;
  }

  update(dt: number): void {
    for (const e of this.items) {
      if (e.life <= 0) continue;
      e.life -= dt;
      const k = 1 - Math.max(0, e.life) / e.maxLife; // 0 → 1
      const ease = 1 - (1 - k) * (1 - k); // fast start, slow finish
      e.mesh.scale.setScalar(e.from + (e.to - e.from) * ease);
      e.mat.opacity = (1 - k) * e.alpha;
      if (e.life <= 0) e.mesh.visible = false;
    }
  }
}

/**
 * Physics particles (embers, debris): fly out, fall with gravity, shrink away.
 * One InstancedMesh per kind, so hundreds cost a single draw call.
 */
class Particles {
  private readonly mesh: THREE.InstancedMesh;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly spin: Float32Array;
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    private readonly max: number,
    private readonly gravity: number,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, material, max);
    this.mesh.frustumCulled = false;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.spin = new Float32Array(max);
    // Start every instance hidden (zero scale).
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    scene.add(this.mesh);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = this.maxLife[i] = life;
    this.size[i] = size;
    this.spin[i] = Math.random() * 10;
  }

  update(dt: number, groundY: (x: number, z: number) => number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j + 1] -= this.gravity * dt;
      const drag = Math.exp(-1.2 * dt);
      this.vel[j] *= drag;
      this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      // Bounce off the ground, losing most of the energy.
      const gy = groundY(this.pos[j], this.pos[j + 2]) + 0.2;
      if (this.pos[j + 1] < gy) {
        this.pos[j + 1] = gy;
        this.vel[j + 1] *= -0.35;
        this.vel[j] *= 0.6;
        this.vel[j + 2] *= 0.6;
      }
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const sc = this.size[i] * Math.min(1, k * 2.5);
      this.spin[i] += dt * 8;
      this.q.setFromEuler(this.e.set(this.spin[i], this.spin[i] * 0.7, 0));
      this.p.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s.set(sc, sc, sc)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Glowing spores drifting in the air around the camera: cheap atmosphere, very Hades.
 * The field wraps around the view so it's always full.
 */
class Motes {
  private readonly mesh: THREE.InstancedMesh;
  private readonly base: Float32Array;
  private readonly phase: Float32Array;
  private readonly m = new THREE.Matrix4();
  private time = 0;
  private static readonly W = 110;
  private static readonly D = 80;

  constructor(
    scene: THREE.Scene,
    private readonly count = 80,
  ) {
    const mat = glow('#e9ffa0', { transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 6, 4), mat, count);
    this.mesh.frustumCulled = false;
    const rand = mulberry32(5);
    this.base = new Float32Array(count * 3);
    this.phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Height relative to the camera focus (the ship): from near the ground up past the ship.
      this.base.set([rand() * Motes.W, -28 + rand() * 36, rand() * Motes.D], i * 3);
      this.phase[i] = rand() * Math.PI * 2;
    }
    scene.add(this.mesh);
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.time += dt;
    const t = this.time;
    const W = Motes.W;
    const D = Motes.D;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      const ph = this.phase[i];
      // Slow drift, wrapped into a box centred on the camera focus.
      const wx = this.base[j] + t * 1.2 + Math.sin(t * 0.7 + ph) * 2;
      const wz = this.base[j + 2] - t * 0.8 + Math.cos(t * 0.5 + ph) * 2;
      const x = focus.x + ((((wx - focus.x) % W) + W) % W) - W / 2;
      const z = focus.z + ((((wz - focus.z) % D) + D) % D) - D / 2;
      const y = focus.y + this.base[j + 1] + Math.sin(t + ph) * 0.6;
      const s = 0.7 + Math.sin(t * 3 + ph) * 0.3;
      this.mesh.setMatrixAt(i, this.m.makeScale(s, s, s).setPosition(x, y, z));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * All the short-lived visual effects: smoke puffs, explosions, shockwave rings, hit sparks.
 * Pooled so that big fights don't create garbage and stutter on phones.
 */
export class Effects {
  private readonly puffs: EffectPool;
  private readonly blasts: EffectPool;
  private readonly rings: EffectPool;
  private readonly sparks: EffectPool;
  private readonly trails: EffectPool;
  private readonly embers: Particles;
  private readonly debris: Particles;
  private readonly motes: Motes;
  private readonly tmp = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {
    const sphere = new THREE.SphereGeometry(1, 12, 8);
    this.puffs = new EffectPool(scene, new THREE.SphereGeometry(1, 12, 8), 160);
    this.blasts = new EffectPool(scene, sphere, 32);
    this.rings = new EffectPool(scene, new THREE.RingGeometry(0.8, 1, 32), 16, true);
    this.sparks = new EffectPool(scene, new THREE.SphereGeometry(1, 6, 4), 60);
    this.trails = new EffectPool(scene, new THREE.SphereGeometry(1, 6, 4), 80);
    this.embers = new Particles(
      scene,
      new THREE.OctahedronGeometry(1, 0),
      glow('#ffb347', { blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      260,
      22,
    );
    this.debris = new Particles(scene, new THREE.DodecahedronGeometry(1, 0), toon('#2c1533'), 90, 38);
    this.motes = new Motes(scene);
  }

  /** Glowing streak behind the engines while boosting. */
  trail(pos: THREE.Vector3): void {
    this.trails.spawn(pos, '#6ff7ff', 0.3, 0.45, 0.1, 0.8);
  }

  /** A burst of glowing embers flung outward and upward. */
  embersBurst(pos: THREE.Vector3, count: number, speed: number, size = 0.18): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.embers.emit(
        pos.x,
        pos.y,
        pos.z,
        Math.cos(a) * s,
        speed * (0.4 + Math.random() * 0.9),
        Math.sin(a) * s,
        0.5 + Math.random() * 0.6,
        size * (0.6 + Math.random() * 0.8),
      );
    }
  }

  smoke(pos: THREE.Vector3, size = 1): void {
    this.puffs.spawn(pos, '#ffcf8a', 0.45, 0.25 * size, 0.75 * size, 0.55);
  }

  /** A hit flash where a bullet connects. */
  spark(pos: THREE.Vector3, color: THREE.ColorRepresentation = '#fff2b0', size = 1): void {
    this.sparks.spawn(pos, color, 0.12, 0.3 * size, 1.1 * size, 1);
    this.embersBurst(pos, 2, 9 * size, 0.12);
  }

  /** Fireball + bright core + flat shockwave ring on the ground. */
  explosion(pos: THREE.Vector3, size: number, groundY: number): void {
    this.blasts.spawn(pos, '#ffb347', 0.5, size * 0.2, size, 1);
    this.blasts.spawn(pos, '#fff3c4', 0.22, size * 0.15, size * 0.55, 1);
    this.blasts.spawn(pos, '#ff5a3c', 0.75, size * 0.5, size * 1.4, 0.35);
    if (pos.y - groundY < 6) {
      this.tmp.set(pos.x, groundY + 0.3, pos.z);
      this.rings.spawn(this.tmp, '#ffd27a', 0.5, size * 0.3, size * 2.2, 0.8);
    }
    this.embersBurst(pos, Math.round(8 + size * 3), 8 + size * 2.5);
    // Chunks of rock and metal thrown out of the blast.
    const chunks = Math.round(3 + size);
    for (let i = 0; i < chunks; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 6 + Math.random() * size * 2;
      this.debris.emit(pos.x, pos.y, pos.z, Math.cos(a) * s, 10 + Math.random() * 10, Math.sin(a) * s, 1.4, 0.25 + Math.random() * 0.35);
    }
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.embers.update(dt, this.groundY);
    this.debris.update(dt, this.groundY);
    this.motes.update(dt, focus);
    this.trails.update(dt);
    this.puffs.update(dt);
    this.blasts.update(dt);
    this.rings.update(dt);
    this.sparks.update(dt);
  }
}
