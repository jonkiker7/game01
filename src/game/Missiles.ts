import * as THREE from 'three';
import type { Effects } from './Effects';
import { glow, toon } from './materials';
import type { World } from './World';

/** How far a missile flies for a given charge (0..1). Shared by the aim indicator. */
export const missileRange = (charge: number) => 3 + 39 * charge;
/** Blast radius and damage for a given charge. */
export const missileBlastRadius = (charge: number) => 3.5 + 3.5 * charge;
export const missileDamage = (charge: number) => 30 + 90 * charge;

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
      });
    }
  }

  fire(origin: THREE.Vector3, heading: number, charge: number): void {
    const m = this.missiles.find((x) => !x.active);
    if (!m) return;
    const dx = -Math.sin(heading);
    const dz = -Math.cos(heading);
    const range = missileRange(charge);

    m.start.set(origin.x + dx * 1.2, origin.y - 0.8, origin.z + dz * 1.2);
    const ex = origin.x + dx * range;
    const ez = origin.z + dz * range;
    m.end.set(ex, this.world.heightAt(ex, ez) + 0.3, ez);
    m.duration = Math.max(0.18, range / (40 + 25 * charge));
    m.arc = 0.5 + range * 0.05;
    m.power = charge;
    m.t = 0;
    m.puffTimer = 0;
    m.active = true;
    m.obj.visible = true;
    m.obj.position.copy(m.start);
  }

  update(dt: number): void {
    for (const m of this.missiles) {
      if (!m.active) continue;
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

      if (u >= 1) {
        m.active = false;
        m.obj.visible = false;
        this.effects.explosion(m.end, missileBlastRadius(m.power), m.end.y);
        this.onExplode?.(m.end, m.power);
      }
    }
  }

  /** Straight line from start to end, lifted by a sine arc. */
  private pointOnPath(m: Missile, u: number, out: THREE.Vector3): void {
    out.lerpVectors(m.start, m.end, u);
    out.y += Math.sin(u * Math.PI) * m.arc;
  }
}
