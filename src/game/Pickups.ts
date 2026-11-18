import * as THREE from 'three';
import type { Effects } from './Effects';
import { glow } from './materials';
import type { Ship } from './Ship';

const MAX_PICKUPS = 12;
const HEAL = 25; // armor restored per orb
const LIFETIME = 15; // seconds before an uncollected orb fades away
const RISE_TIME = 0.7; // seconds to float up from the wreck to flying height
const COLLECT_RADIUS = 3;
const MAGNET_RADIUS = 9; // orbs drift toward the ship inside this distance
/** Chance that a destroyed enemy drops a healing orb. */
export const DROP_CHANCE = { turret: 0.35, drone: 0.25 };

interface Pickup {
  obj: THREE.Group;
  core: THREE.Mesh;
  halo: THREE.Mesh;
  ring: THREE.Mesh;
  active: boolean;
  age: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

/**
 * Green healing orbs. They pop out of a destroyed enemy, float up to the ship's flying height
 * (so they sit where the enemy appeared on screen), bob in place, pull toward the ship when
 * it's close, and restore armor when collected.
 */
export class Pickups {
  onCollect?: (heal: number) => void;
  private readonly items: Pickup[] = [];
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private readonly effects: Effects,
  ) {
    const coreGeo = new THREE.SphereGeometry(0.75, 16, 12);
    const haloGeo = new THREE.SphereGeometry(1.5, 16, 12);
    const ringGeo = new THREE.TorusGeometry(1.25, 0.08, 6, 32);
    for (let i = 0; i < MAX_PICKUPS; i++) {
      const obj = new THREE.Group();
      const core = new THREE.Mesh(coreGeo, glow('#8dff9e'));
      const halo = new THREE.Mesh(
        haloGeo,
        glow('#3dff7a', { transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      const ring = new THREE.Mesh(ringGeo, glow('#c8ffd2', { transparent: true, opacity: 0.8 }));
      obj.add(core, halo, ring);
      obj.visible = false;
      scene.add(obj);
      this.items.push({ obj, core, halo, ring, active: false, age: 0, from: new THREE.Vector3(), to: new THREE.Vector3() });
    }
  }

  /**
   * Drop an orb at `from` (the wreck), floating up to `to` (where it appears on screen at the
   * ship's altitude).
   */
  drop(from: THREE.Vector3, to: THREE.Vector3): void {
    const p = this.items.find((x) => !x.active);
    if (!p) return;
    p.active = true;
    p.age = 0;
    p.from.copy(from);
    p.to.copy(to);
    p.obj.position.copy(from);
    p.obj.visible = true;
  }

  /** Remove every orb (e.g. when a new wave starts). */
  clear(): void {
    for (const p of this.items) {
      p.active = false;
      p.obj.visible = false;
    }
  }

  update(dt: number, ship: Ship): void {
    this.time += dt;
    const sp = ship.root.position;
    for (const p of this.items) {
      if (!p.active) continue;
      p.age += dt;
      const o = p.obj.position;

      if (p.age < RISE_TIME) {
        // Ease up out of the wreck.
        const k = p.age / RISE_TIME;
        o.lerpVectors(p.from, p.to, 1 - (1 - k) * (1 - k));
      } else {
        // Hover with a gentle bob, drifting toward the ship when it's close.
        const dx = sp.x - p.to.x;
        const dz = sp.z - p.to.z;
        const d = Math.hypot(dx, dz);
        if (ship.alive && d < MAGNET_RADIUS) {
          const pull = Math.min(1, dt * 6);
          p.to.x += dx * pull;
          p.to.z += dz * pull;
          p.to.y += (sp.y - p.to.y) * pull;
        }
        o.set(p.to.x, p.to.y + Math.sin(this.time * 3 + p.age) * 0.4, p.to.z);
        if (ship.alive && d < COLLECT_RADIUS) {
          p.active = false;
          p.obj.visible = false;
          this.effects.pickupBurst(o);
          this.onCollect?.(HEAL);
          continue;
        }
      }

      // Pulse, spin the ring, and blink during the last few seconds.
      const s = 1 + Math.sin(this.time * 5 + p.age) * 0.12;
      p.core.scale.setScalar(s);
      p.halo.scale.setScalar(1.05 - (s - 1));
      p.ring.rotation.set(Math.PI / 2 + Math.sin(this.time * 2) * 0.4, this.time * 2.5, 0);
      p.obj.visible = p.age < LIFETIME - 3 || Math.floor(p.age * 8) % 2 === 0;
      if (p.age > LIFETIME) {
        p.active = false;
        p.obj.visible = false;
      }
    }
  }
}
