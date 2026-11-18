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

/**
 * A pool of simple straight-flying projectiles drawn with one InstancedMesh
 * (a single draw call no matter how many are on screen).
 */
class ShotPool {
  readonly shots: Shot[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly halo?: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s: THREE.Vector3;
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    scene: THREE.Scene,
    geo: THREE.BufferGeometry,
    color: string,
    private readonly max: number,
    scale: THREE.Vector3,
    haloColor?: string,
  ) {
    this.s = scale;
    this.mesh = new THREE.InstancedMesh(geo, glow(color), max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    if (haloColor) {
      this.halo = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1, 10, 8),
        glow(haloColor, { transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
        max,
      );
      this.halo.count = 0;
      this.halo.frustumCulled = false;
      scene.add(this.halo);
    }
  }

  add(shot: Shot): void {
    if (this.shots.length < this.max) this.shots.push(shot);
  }

  /** Moves every shot; `hit` returns true to remove a shot. */
  update(dt: number, hit: (s: Shot) => boolean): void {
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
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      this.q.setFromAxisAngle(this.up, Math.atan2(s.vx, s.vz));
      this.p.set(s.x, s.y, s.z);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      if (this.halo) this.halo.setMatrixAt(i, this.m.makeScale(1.1, 1.1, 1.1).setPosition(this.p));
    }
    this.mesh.count = list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.halo) {
      this.halo.count = list.length;
      this.halo.instanceMatrix.needsUpdate = true;
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
    this.pool = new ShotPool(scene, geo, '#ffe27a', 120, new THREE.Vector3(0.38, 0.38, 1.2));
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
    this.pool = new ShotPool(
      scene,
      new THREE.SphereGeometry(1, 10, 8),
      '#ffe0ea',
      160,
      new THREE.Vector3(0.45, 0.45, 0.45),
      '#ff2e63',
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
