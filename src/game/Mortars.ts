import * as THREE from 'three';
import type { Effects } from './Effects';
import { glow } from './materials';
import type { Ship } from './Ship';

const MAX = 24;
const BLAST_RADIUS = 6.5;
const DAMAGE = 14;
const SPEED = 17; // units per second across the ground
const LEAD = 0.35; // seconds of the ship's velocity to aim ahead by

interface Mortar {
  obj: THREE.Group;
  core: THREE.Mesh;
  halo: THREE.Mesh;
  marker: THREE.Group;
  fill: THREE.Mesh;
  active: boolean;
  t: number;
  duration: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

/**
 * Tower "plasma mortars": big pulsing orange orbs lobbed at where the ship is heading.
 * A red warning ring marks the landing spot and fills in as the orb gets closer; then it
 * explodes, damaging the ship if it's inside the ring. Slow and telegraphed, so it can be dodged.
 */
export class Mortars {
  private readonly items: Mortar[] = [];
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private readonly effects: Effects,
  ) {
    const coreGeo = new THREE.SphereGeometry(1.6, 16, 12);
    const haloGeo = new THREE.SphereGeometry(3.2, 16, 12);
    const outlineGeo = new THREE.SphereGeometry(2.05, 16, 12);
    const ringGeo = new THREE.RingGeometry(BLAST_RADIUS - 0.45, BLAST_RADIUS, 48);
    const discGeo = new THREE.CircleGeometry(BLAST_RADIUS, 48);
    for (let i = 0; i < MAX; i++) {
      const obj = new THREE.Group();
      const core = new THREE.Mesh(coreGeo, glow('#ffb36b', {}, 2));
      const outline = new THREE.Mesh(outlineGeo, glow('#2a0a00', { side: THREE.BackSide }, 1));
      const halo = new THREE.Mesh(
        haloGeo,
        glow('#ff4a1c', { transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      obj.add(outline, core, halo);
      obj.visible = false;

      // Landing marker: a red ring, with a disc that fills in as impact approaches.
      const marker = new THREE.Group();
      const ring = new THREE.Mesh(ringGeo, glow('#ff3d3d', { transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }, 1.4));
      const fill = new THREE.Mesh(
        discGeo,
        glow('#ff3d3d', { transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
      );
      for (const m of [ring, fill]) m.rotation.x = -Math.PI / 2;
      marker.add(ring, fill);
      marker.visible = false;
      marker.renderOrder = 5;
      scene.add(obj, marker);
      this.items.push({ obj, core, halo, marker, fill, active: false, t: 0, duration: 1, from: new THREE.Vector3(), to: new THREE.Vector3() });
    }
  }

  /** Lob a mortar from `from` at the ship (aiming a little ahead of where it's going). */
  fire(from: THREE.Vector3, ship: Ship): void {
    const m = this.items.find((x) => !x.active);
    if (!m) return;
    const s = ship.root.position;
    m.from.copy(from);
    m.to.set(s.x + ship.velocity.x * LEAD, s.y, s.z + ship.velocity.y * LEAD);
    const dist = Math.hypot(m.to.x - from.x, m.to.z - from.z);
    m.duration = THREE.MathUtils.clamp(dist / SPEED, 1.3, 4);
    m.t = 0;
    m.active = true;
    m.obj.visible = true;
    m.obj.position.copy(from);
    m.marker.position.set(m.to.x, m.to.y - 0.6, m.to.z);
    m.marker.visible = true;
  }

  clear(): void {
    for (const m of this.items) {
      m.active = false;
      m.obj.visible = false;
      m.marker.visible = false;
    }
  }

  update(dt: number, ship: Ship, groundY: (x: number, z: number) => number): void {
    this.time += dt;
    for (const m of this.items) {
      if (!m.active) continue;
      m.t += dt;
      const u = Math.min(1, m.t / m.duration);
      // High lob: straight line plus an arc.
      m.obj.position.lerpVectors(m.from, m.to, u);
      m.obj.position.y += Math.sin(u * Math.PI) * 10;
      const pulse = 1 + Math.sin(this.time * 14) * 0.15;
      m.core.scale.setScalar(pulse);
      m.halo.scale.setScalar(2 - pulse);
      m.fill.scale.setScalar(Math.max(0.05, u));
      (m.fill.material as THREE.MeshBasicMaterial).opacity = 0.15 + u * 0.25;

      if (u >= 1) {
        m.active = false;
        m.obj.visible = false;
        m.marker.visible = false;
        this.effects.explosion(m.to, BLAST_RADIUS * 0.9, groundY(m.to.x, m.to.z));
        const s = ship.root.position;
        if (Math.hypot(s.x - m.to.x, s.z - m.to.z) < BLAST_RADIUS + ship.radius * 0.5) ship.damage(DAMAGE);
      }
    }
  }
}
