import * as THREE from 'three';
import { glow, toon } from './materials';
import type { World } from './World';

/** How far a missile flies for a given charge (0..1). Shared by the aim indicator. */
export const missileRange = (charge: number) => 12 + 30 * charge;

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

interface Effect {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
}

const MISSILE_POOL = 12;
const PUFF_POOL = 160;
const BLAST_POOL = 16;

/**
 * Missiles fly in a shallow arc to the end of the aim line and explode.
 * Everything is pooled (created once, reused) so firing never stutters on phones.
 */
export class MissileSystem {
  onExplode?: (x: number, z: number, power: number) => void;

  private readonly missiles: Missile[] = [];
  private readonly puffs: Effect[] = [];
  private readonly blasts: Effect[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly world: World,
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

    const puffGeo = new THREE.SphereGeometry(0.5, 8, 6);
    for (let i = 0; i < PUFF_POOL; i++) this.puffs.push(this.makeEffect(scene, puffGeo, '#ffcf8a'));

    const blastGeo = new THREE.SphereGeometry(1, 16, 12);
    for (let i = 0; i < BLAST_POOL; i++) this.blasts.push(this.makeEffect(scene, blastGeo, '#ffd27a'));
  }

  fire(origin: THREE.Vector3, heading: number, charge: number): void {
    const m = this.missiles.find((x) => !x.active);
    if (!m) return;
    const dx = -Math.sin(heading);
    const dz = -Math.cos(heading);
    const range = missileRange(charge);

    m.start.set(origin.x + dx * 1.5, origin.y - 0.8, origin.z + dz * 1.5);
    const ex = origin.x + dx * range;
    const ez = origin.z + dz * range;
    m.end.set(ex, this.world.heightAt(ex, ez) + 0.3, ez);
    m.duration = range / (40 + 25 * charge);
    m.arc = 1.5 + range * 0.04;
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
        this.spawn(this.puffs, m.obj.position, 0.45, 0.5, 1.4 + m.power, 0.55);
      }

      if (u >= 1) {
        m.active = false;
        m.obj.visible = false;
        const size = 3 + m.power * 4;
        this.spawn(this.blasts, m.end, 0.45, 0.6, size, 1);
        this.spawn(this.blasts, m.end, 0.7, size * 0.6, size * 1.6, 0.35);
        this.onExplode?.(m.end.x, m.end.z, m.power);
      }
    }

    for (const list of [this.puffs, this.blasts]) {
      for (const e of list) {
        if (e.life <= 0) continue;
        e.life -= dt;
        const k = 1 - Math.max(0, e.life) / e.maxLife; // 0 → 1 over the effect's life
        e.mesh.scale.setScalar(e.startScale + (e.endScale - e.startScale) * (1 - (1 - k) * (1 - k)));
        e.mat.opacity = (1 - k) * (e.mesh.userData.alpha as number);
        if (e.life <= 0) e.mesh.visible = false;
      }
    }
  }

  /** Straight line from start to end, lifted by a sine arc. */
  private pointOnPath(m: Missile, u: number, out: THREE.Vector3): void {
    out.lerpVectors(m.start, m.end, u);
    out.y += Math.sin(u * Math.PI) * m.arc;
  }

  private makeEffect(scene: THREE.Scene, geo: THREE.BufferGeometry, color: string): Effect {
    const mat = glow(color, { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, mat, life: 0, maxLife: 1, startScale: 1, endScale: 1 };
  }

  private spawn(
    pool: Effect[],
    pos: THREE.Vector3,
    life: number,
    startScale: number,
    endScale: number,
    alpha: number,
  ): void {
    const e = pool.find((x) => x.life <= 0);
    if (!e) return;
    e.life = e.maxLife = life;
    e.startScale = startScale;
    e.endScale = endScale;
    e.mesh.userData.alpha = alpha;
    e.mesh.position.copy(pos);
    e.mesh.scale.setScalar(startScale);
    e.mesh.visible = true;
  }
}
