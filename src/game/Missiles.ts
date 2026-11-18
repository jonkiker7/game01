import * as THREE from 'three';
import type { Effects } from './Effects';
import { glow, toon } from './materials';
import { type Hittable, rayToVerticalSegment } from './Projectiles';
import type { World } from './World';

/** How far a missile flies for a given charge (0..1). Shared by the aim indicator. */
export const missileRange = (charge: number) => 3 + 39 * charge;
/** Blast radius and damage for a given charge. */
export const missileBlastRadius = (charge: number) => 3.5 + 3.5 * charge;
export const missileDamage = (charge: number) => 30 + 90 * charge;
/** Aim-line leeway for locking on (radians either side), and extra reach beyond the range. */
export const MISSILE_LOCK_ANGLE = 0.22;
export const MISSILE_LOCK_REACH = 4;
/** A missile explodes early if it passes within this distance of an enemy's edge (on screen). */
const PROXIMITY = 1.2;
/** Positions checked per frame, so a fast missile can't skip past a small drone between frames. */
const SUBSTEPS = 4;

interface Missile {
  obj: THREE.Group;
  active: boolean;
  t: number;
  duration: number;
  power: number;
  start: THREE.Vector3;
  end: THREE.Vector3;
  arc: number;
  puffTimer: number;
  target: Hittable | null;
}

const MISSILE_POOL = 12;

/**
 * Missiles fly in a shallow arc to the end of the aim line and explode with splash damage.
 * Pooled (created once, reused) so firing never stutters on phones.
 */
export class MissileSystem {
  /** Called when a missile lands: deal damage, shake the camera, etc. */
  onExplode?: (pos: THREE.Vector3, power: number) => void;

  private readonly missiles: Missile[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private readonly sample = new THREE.Vector3();
  private readonly ray = new THREE.Vector3();
  private readonly hitPoint = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly world: World,
    private readonly effects: Effects,
  ) {
    const body = toon('#efe2c4');
    const nose = toon('#b8233a');
    const flame = glow('#ffb347');
    for (let i = 0; i < MISSILE_POOL; i++) {
      // Built pointing down +Z so Object3D.lookAt() aims it at its target.
      const obj = new THREE.Group();
      const tube = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.0, 3, 8), body);
      tube.rotation.x = Math.PI / 2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 8), nose);
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 0.85;
      const fire = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), flame);
      fire.scale.set(1, 1, 2.5);
      fire.position.z = -0.9;
      obj.add(tube, tip, fire);
      obj.visible = false;
      scene.add(obj);
      this.missiles.push({
        obj,
        active: false,
        t: 0,
        duration: 1,
        power: 0,
        start: new THREE.Vector3(),
        end: new THREE.Vector3(),
        arc: 0,
        puffTimer: 0,
        target: null,
      });
    }
  }

  /**
   * @param target optional locked enemy: the missile steers to it, wherever it moves.
   */
  fire(origin: THREE.Vector3, heading: number, charge: number, target: Hittable | null = null): void {
    const m = this.missiles.find((x) => !x.active);
    if (!m) return;
    let range = missileRange(charge);
    if (target) {
      const tx = target.root.position.x - origin.x;
      const tz = target.root.position.z - origin.z;
      heading = Math.atan2(-tx, -tz);
      range = Math.hypot(tx, tz);
    }
    const dx = -Math.sin(heading);
    const dz = -Math.cos(heading);
    m.target = target;

    m.start.set(origin.x + dx * 1.2, origin.y - 0.8, origin.z + dz * 1.2);
    const ex = origin.x + dx * range;
    const ez = origin.z + dz * range;
    // Unlocked missiles fly level along the aim line and burst in the air at its end,
    // so the line you see on screen is the path the missile takes.
    m.end.set(ex, origin.y - 0.8, ez);
    // Travel time from the full 3D distance (the ship is high above the ground).
    const dist3 = Math.hypot(range, m.start.y - m.end.y);
    m.duration = Math.max(0.2, dist3 / (90 + 50 * charge)); // faster than the ship at full speed
    m.arc = 0.3 + range * 0.03;
    m.power = charge;
    m.t = 0;
    m.puffTimer = 0;
    m.active = true;
    m.obj.visible = true;
    m.obj.position.copy(m.start);
  }

  /**
   * @param camera camera position, for on-screen hit checks (same rule as bullets: a missile
   *   hits whatever it visually passes over).
   */
  update(dt: number, enemies: readonly Hittable[], camera: THREE.Vector3): void {
    for (const m of this.missiles) {
      if (!m.active) continue;
      this.prev.copy(m.obj.position);
      // Homing: keep the end of the flight path on the locked target.
      if (m.target?.alive) {
        const tp = m.target.root.position;
        m.end.set(tp.x, Math.max(tp.y + m.target.aimHeight, this.world.heightAt(tp.x, tp.z) + 0.3), tp.z);
      }
      m.t += dt;
      const u = Math.min(1, m.t / m.duration);
      this.pointOnPath(m, u, m.obj.position);
      this.pointOnPath(m, Math.min(1, u + 0.02), this.tmp);
      if (this.tmp.distanceToSquared(m.obj.position) > 1e-6) m.obj.lookAt(this.tmp);

      m.puffTimer -= dt;
      if (m.puffTimer <= 0) {
        m.puffTimer = 0.025;
        this.effects.smoke(m.obj.position, 1.5 + m.power * 0.8);
      }

      // Explode on the first enemy the missile flies into (or over, on screen), not just at the end.
      const hit = u > 0.03 ? this.findHit(this.prev, m.obj.position, enemies, camera) : null;
      if (hit) {
        this.detonate(m, this.hitPoint);
      } else if (u >= 1) {
        this.detonate(m, m.end);
      }
    }
  }

  /**
   * Checks the stretch the missile travelled this frame against every enemy.
   * Hits if the missile touches an enemy in 3D (e.g. a tower pillar), or if it passes over an
   * enemy's hit area on screen (the camera ray through the missile comes close to it).
   * Sets `hitPoint` to where the explosion should appear.
   */
  private findHit(
    from: THREE.Vector3,
    to: THREE.Vector3,
    enemies: readonly Hittable[],
    camera: THREE.Vector3,
  ): Hittable | null {
    for (let i = 1; i <= SUBSTEPS; i++) {
      const p = this.sample.lerpVectors(from, to, i / SUBSTEPS);
      this.ray.subVectors(p, camera).normalize();
      for (const e of enemies) {
        if (!e.alive) continue;
        const tp = e.root.position;
        const r = e.radius + PROXIMITY;
        // On screen: passes over the enemy's hit area.
        if (rayToVerticalSegment(camera, this.ray, tp.x, tp.z, tp.y + e.hitBottom, tp.y + e.hitTop, this.hitPoint) < r) {
          return e;
        }
        // In 3D: flew into any part of it (a tower's whole pillar counts).
        const ex = tp.x - p.x;
        const ez = tp.z - p.z;
        const ey = p.y - tp.y;
        if (ex * ex + ez * ez < r * r && ey > Math.min(e.hitBottom, 0) && ey < e.hitTop) {
          this.hitPoint.copy(p);
          return e;
        }
      }
    }
    return null;
  }

  private detonate(m: Missile, at: THREE.Vector3): void {
    m.active = false;
    m.obj.visible = false;
    m.target = null;
    const pos = this.tmp.copy(at);
    this.effects.explosion(pos, missileBlastRadius(m.power), this.world.heightAt(pos.x, pos.z));
    this.onExplode?.(pos, m.power);
  }

  /** Straight line from start to end, lifted by a sine arc. */
  private pointOnPath(m: Missile, u: number, out: THREE.Vector3): void {
    out.lerpVectors(m.start, m.end, u);
    out.y += Math.sin(u * Math.PI) * m.arc;
  }
}
