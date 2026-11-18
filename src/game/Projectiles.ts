import * as THREE from 'three';
import type { Effects } from './Effects';
import { glow } from './materials';

interface Shot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  targetY: number;
  life: number;
}

/** One visual layer of a projectile (e.g. bright core, dark outline, soft halo). */
interface Layer {
  material: THREE.Material;
  scale: number;
}

/**
 * A pool of simple straight-flying projectiles. Each visual layer is one InstancedMesh,
 * so it's a single draw call per layer no matter how many shots are on screen.
 */
class ShotPool {
  readonly shots: Shot[] = [];
  private readonly meshes: { mesh: THREE.InstancedMesh; scale: number }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private time = 0;

  constructor(
    scene: THREE.Scene,
    geo: THREE.BufferGeometry,
    private readonly max: number,
    private readonly size: THREE.Vector3,
    layers: Layer[],
    private readonly pulse = 0,
  ) {
    for (const layer of layers) {
      const mesh = new THREE.InstancedMesh(geo, layer.material, max);
      mesh.count = 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes.push({ mesh, scale: layer.scale });
    }
  }

  add(shot: Shot): void {
    if (this.shots.length < this.max) this.shots.push(shot);
  }

  /** Moves every shot; `hit` returns true to remove a shot. */
  update(dt: number, hit: (s: Shot) => boolean): void {
    this.time += dt;
    const list = this.shots;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      s.y += (s.targetY - s.y) * (1 - Math.exp(-8 * dt));
      if (s.life <= 0 || hit(s)) {
        list[i] = list[list.length - 1];
        list.pop();
      }
    }
    const pulse = 1 + Math.sin(this.time * 14) * this.pulse;
    for (const { mesh, scale } of this.meshes) {
      const k = scale * pulse;
      this.s.copy(this.size).multiplyScalar(k);
      for (let i = 0; i < list.length; i++) {
        const sh = list[i];
        this.q.setFromAxisAngle(this.up, Math.atan2(sh.vx, sh.vz));
        this.p.set(sh.x, sh.y, sh.z);
        mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      }
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

/** Anything bullets can hit. */
export interface Hittable {
  readonly root: THREE.Object3D;
  readonly radius: number;
  alive: boolean;
  damage(amount: number): void;
}

const BULLET_SPEED = 80;
const BULLET_LIFE = 0.47; // → ~38 units of range (about what fits on screen)
const BULLET_DAMAGE = 7;

/** The player's machine-gun rounds. */
export class Bullets {
  private readonly pool: ShotPool;
  private readonly tmp = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly effects: Effects,
  ) {
    const geo = new THREE.CapsuleGeometry(0.5, 1, 2, 6);
    geo.rotateX(Math.PI / 2); // long axis along +Z
    this.pool = new ShotPool(scene, geo, 120, new THREE.Vector3(0.38, 0.38, 1.2), [
      { material: glow('#ffe27a'), scale: 1 },
    ]);
  }

  fire(from: THREE.Vector3, dirX: number, dirZ: number): void {
    this.pool.add({
      x: from.x,
      y: from.y,
      z: from.z,
      vx: dirX * BULLET_SPEED,
      vz: dirZ * BULLET_SPEED,
      targetY: from.y,
      life: BULLET_LIFE,
    });
  }

  update(dt: number, targets: readonly Hittable[]): void {
    this.pool.update(dt, (s) => {
      // Top-down game: hits are checked on the ground plane, like the classic 16-bit shooters.
      for (const t of targets) {
        if (!t.alive) continue;
        const dx = t.root.position.x - s.x;
        const dz = t.root.position.z - s.z;
        if (dx * dx + dz * dz < t.radius * t.radius) {
          t.damage(BULLET_DAMAGE);
          this.effects.spark(this.tmp.set(s.x, t.root.position.y + 1, s.z));
          return true;
        }
      }
      return false;
    });
  }
}

const ORB_DAMAGE = 7;
const PLAYER_HIT_RADIUS = 1.7;

/** Enemy shots: slow, glowing orbs you can see coming and dodge. */
export class EnemyShots {
  private readonly pool: ShotPool;
  private readonly tmp = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly effects: Effects,
  ) {
    // Bright core + thick dark outline (ink style) + faint red halo: readable on any ground colour.
    this.pool = new ShotPool(
      scene,
      new THREE.SphereGeometry(1, 12, 10),
      160,
      new THREE.Vector3(0.6, 0.6, 0.6),
      [
        {
          material: glow('#ff3d6e', {
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
          scale: 2,
        },
        { material: glow('#2a0014', { side: THREE.BackSide }), scale: 1.4 },
        { material: glow('#fff4f7'), scale: 1 },
      ],
      0.12,
    );
  }

  fire(from: THREE.Vector3, dirX: number, dirZ: number, speed: number, targetY: number): void {
    this.pool.add({ x: from.x, y: from.y, z: from.z, vx: dirX * speed, vz: dirZ * speed, targetY, life: 4 });
  }

  update(dt: number, player: Hittable & { invulnerable: number }): void {
    const p = player.root.position;
    this.pool.update(dt, (s) => {
      if (!player.alive || player.invulnerable > 0) return false;
      const dx = p.x - s.x;
      const dz = p.z - s.z;
      if (dx * dx + dz * dz < PLAYER_HIT_RADIUS * PLAYER_HIT_RADIUS) {
        player.damage(ORB_DAMAGE);
        this.effects.spark(this.tmp.set(s.x, s.y, s.z), '#ff6b8f', 1.5);
        return true;
      }
      return false;
    });
  }
}
