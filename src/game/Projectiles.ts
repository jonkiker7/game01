import * as THREE from 'three';
import type { Effects } from './Effects';
import { glow } from './materials';

interface Shot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Climbing shots stop rising at this height (enemy orbs level off at the ship's altitude). */
  ceiling: number;
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
  private readonly forward = new THREE.Vector3(0, 0, 1);
  private readonly dir = new THREE.Vector3();
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
      s.y = Math.min(s.ceiling, s.y + s.vy * dt);
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
        // Point each shot along its 3D direction of travel (bullets angle down toward the ground).
        const climbing = sh.y < sh.ceiling ? sh.vy : 0;
        this.q.setFromUnitVectors(this.forward, this.dir.set(sh.vx, climbing, sh.vz).normalize());
        this.p.set(sh.x, sh.y, sh.z);
        mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      }
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

/**
 * Shortest distance between a ray (origin `o`, unit direction `d`) and a vertical segment at
 * (x, z) from height y0 to y1. Writes the closest point on the segment into `out`.
 */
export function rayToVerticalSegment(
  o: THREE.Vector3,
  d: THREE.Vector3,
  x: number,
  z: number,
  y0: number,
  y1: number,
  out: THREE.Vector3,
): number {
  // Closest approach between the ray's line and the segment's (vertical) line.
  const wx = o.x - x;
  const wz = o.z - z;
  const horiz = d.x * d.x + d.z * d.z; // 1 - d.y², how far from vertical the ray is
  let t = horiz > 1e-6 ? -(d.x * wx + d.z * wz) / horiz : 0;
  if (t < 0) t = 0;
  let y = o.y + d.y * t;
  y = Math.min(y1, Math.max(y0, y));
  // With the segment point clamped, find the ray point closest to it.
  t = Math.max(0, d.x * (x - o.x) + d.y * (y - o.y) + d.z * (z - o.z));
  out.set(x, y, z);
  const px = o.x + d.x * t - x;
  const py = o.y + d.y * t - y;
  const pz = o.z + d.z * t - z;
  return Math.sqrt(px * px + py * py + pz * pz);
}

/** Anything bullets can hit. */
export interface Hittable {
  readonly root: THREE.Object3D;
  readonly radius: number;
  /** Vertical extent bullets can hit, relative to root.position.y (e.g. a tower's gun and platform). */
  readonly hitBottom: number;
  readonly hitTop: number;
  /** Where weapons aim, relative to root.position.y (e.g. a tower's turret head). */
  readonly aimHeight: number;
  alive: boolean;
  damage(amount: number): void;
}

const BULLET_SPEED = 80;
const BULLET_LIFE = 0.55; // → 44 units of range (about what fits on screen)
const BULLET_DAMAGE = 7;

/** The player's machine-gun rounds. */
export class Bullets {
  private readonly pool: ShotPool;
  private readonly tmp = new THREE.Vector3();
  private readonly ray = new THREE.Vector3();
  private readonly closest = new THREE.Vector3();

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

  /** `dir` is a normalized 3D direction (bullets usually angle down from the ship). */
  fire(from: THREE.Vector3, dir: THREE.Vector3): void {
    this.pool.add({
      x: from.x,
      y: from.y,
      z: from.z,
      vx: dir.x * BULLET_SPEED,
      vy: dir.y * BULLET_SPEED,
      vz: dir.z * BULLET_SPEED,
      ceiling: Infinity,
      life: BULLET_LIFE,
    });
  }

  /**
   * Hits are judged by what the player sees: a bullet hits an enemy when, on screen, it
   * passes over any part of it (a tower's gun or pillar, a drone). In 3D terms: the line from
   * the camera through the bullet comes within the enemy's radius of its vertical hit segment.
   */
  update(
    dt: number,
    targets: readonly Hittable[],
    groundY: (x: number, z: number) => number,
    camera: THREE.Vector3,
  ): void {
    this.pool.update(dt, (s) => {
      this.ray.set(s.x - camera.x, s.y - camera.y, s.z - camera.z).normalize();
      for (const t of targets) {
        if (!t.alive) continue;
        const tp = t.root.position;
        const hit = rayToVerticalSegment(camera, this.ray, tp.x, tp.z, tp.y + t.hitBottom, tp.y + t.hitTop, this.closest);
        if (hit < t.radius) {
          t.damage(BULLET_DAMAGE);
          this.effects.spark(this.closest);
          return true;
        }
      }
      // Bullets that reach the ground kick up a spark and stop.
      const gy = groundY(s.x, s.z);
      if (s.y < gy + 0.2) {
        this.effects.spark(this.tmp.set(s.x, gy + 0.3, s.z), '#fff2b0', 0.7);
        return true;
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
        { material: glow('#2a0014', { side: THREE.BackSide }, 1), scale: 1.4 },
        { material: glow('#fff4f7'), scale: 1 },
      ],
      0.12,
    );
  }

  /**
   * Fires a shot along (dirX, dirZ). Shots from the ground climb steadily so they reach
   * `targetY` (the ship's altitude) after about `travel` units, then fly level.
   */
  fire(from: THREE.Vector3, dirX: number, dirZ: number, speed: number, targetY: number, travel: number): void {
    const climb = targetY - from.y;
    const vy = climb > 0 ? (climb * speed) / Math.max(travel, 6) : 0;
    this.pool.add({
      x: from.x,
      y: from.y,
      z: from.z,
      vx: dirX * speed,
      vy,
      vz: dirZ * speed,
      ceiling: Math.max(targetY, from.y),
      life: 4,
    });
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
