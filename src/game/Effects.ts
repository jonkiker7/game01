import * as THREE from 'three';
import { glow } from './materials';

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
    e.mat.color.set(color);
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
 * All the short-lived visual effects: smoke puffs, explosions, shockwave rings, hit sparks.
 * Pooled so that big fights don't create garbage and stutter on phones.
 */
export class Effects {
  private readonly puffs: EffectPool;
  private readonly blasts: EffectPool;
  private readonly rings: EffectPool;
  private readonly sparks: EffectPool;
  private readonly tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const sphere = new THREE.SphereGeometry(1, 12, 8);
    this.puffs = new EffectPool(scene, new THREE.SphereGeometry(1, 8, 6), 160);
    this.blasts = new EffectPool(scene, sphere, 32);
    this.rings = new EffectPool(scene, new THREE.RingGeometry(0.8, 1, 32), 16, true);
    this.sparks = new EffectPool(scene, new THREE.SphereGeometry(1, 6, 4), 60);
  }

  smoke(pos: THREE.Vector3, size = 1): void {
    this.puffs.spawn(pos, '#ffcf8a', 0.45, 0.25 * size, 0.75 * size, 0.55);
  }

  /** A hit flash where a bullet connects. */
  spark(pos: THREE.Vector3, color: THREE.ColorRepresentation = '#fff2b0', size = 1): void {
    this.sparks.spawn(pos, color, 0.12, 0.3 * size, 1.1 * size, 1);
  }

  /** Fireball + bright core + flat shockwave ring on the ground. */
  explosion(pos: THREE.Vector3, size: number, groundY: number): void {
    this.blasts.spawn(pos, '#ffb347', 0.5, size * 0.2, size, 1);
    this.blasts.spawn(pos, '#fff3c4', 0.22, size * 0.15, size * 0.55, 1);
    this.blasts.spawn(pos, '#ff5a3c', 0.75, size * 0.5, size * 1.4, 0.35);
    this.tmp.set(pos.x, groundY + 0.3, pos.z);
    this.rings.spawn(this.tmp, '#ffd27a', 0.5, size * 0.3, size * 2.2, 0.8);
  }

  update(dt: number): void {
    this.puffs.update(dt);
    this.blasts.update(dt);
    this.rings.update(dt);
    this.sparks.update(dt);
  }
}
