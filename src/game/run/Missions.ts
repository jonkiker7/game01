import * as THREE from 'three';
import { cargoCapacity } from '../ShipDesigns';
import type { EnemyManager } from '../Enemies';
import { type Ctx, Enemy, ENEMY_ARMOR, ENEMY_BODY, ENEMY_GLOW } from '../EnemyBase';
import type { Hud } from '../Hud';
import { addOutlines, GLOW, glow, toon } from '../materials';
import { castShadows } from '../Shadows';
import { approachAngle } from '../math';
import type { Blip } from '../Radar';
import { HOVER_HEIGHT, type Ship } from '../Ship';
import type { World } from '../World';

/*
 * Arena missions beyond "destroy the towers" and "survive":
 *   Rescue    pick up stranded crew (2 at a time) and drop them at the landing zone
 *   Defend    keep the generator alive until the timer runs out (saboteurs go for it)
 *   Escort    guard a convoy crawling across the arena (saboteurs latch on and stall it)
 *   Sabotage  destroy the power pylons to drop the fortress shield, then destroy the fortress
 *   Hold      capture three zones by staying inside each one
 * Defend and Escort can be failed, which ends the sortie (like being shot down).
 */

export type MissionKind = 'rescue' | 'defend' | 'escort' | 'sabotage' | 'hold' | 'cargo';

export const MISSION_TITLES: Record<MissionKind, string> = {
  rescue: 'RESCUE THE CREW',
  defend: 'DEFEND THE GENERATOR',
  escort: 'ESCORT THE CONVOY',
  sabotage: 'SABOTAGE THE FORTRESS',
  hold: 'HOLD THE ZONES',
  cargo: 'DELIVER THE CARGO',
};

export const MISSION_RADIUS: Record<MissionKind, number> = { rescue: 150, defend: 110, escort: 150, sabotage: 150, hold: 125, cargo: 150 };

/** Missions that play on the snaking left-to-right corridor map. */
export const CORRIDOR_MISSIONS: MissionKind[] = ['escort', 'cargo'];

const GREEN = '#5dff8a';
const GOLD = '#ffd36b';
const CYAN = '#6ff7ff';

export interface MissionDeps {
  scene: THREE.Scene;
  effects: { explosion: (pos: THREE.Vector3, size: number, groundY: number) => void };
  world: World;
  enemies: EnemyManager;
  hud: Hud;
  ship: Ship;
}

/** A beam of light from the ground up past flying height, to spot things from afar. */
function beam(color: string, x: number, ground: number, z: number, radius = 1.6): THREE.Mesh {
  const h = HOVER_HEIGHT + 14;
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.4, h, 14, 1, true),
    glow(color, { transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }, 1.1),
  );
  m.position.set(x, ground + h / 2, z);
  return m;
}

/** A flat ring at flying height. */
function ring(color: string, r: number, width = 0.6, opacity = 0.75): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(r - width, r, 64),
    glow(color, { transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }, 1.3),
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

/** A progress arc at flying height (rebuilt as it changes). */
class Arc {
  mesh: THREE.Mesh | null = null;
  private shown = -1;
  constructor(
    private readonly group: THREE.Group,
    private readonly color: string,
    private readonly r: number,
  ) {}
  set(x: number, y: number, z: number, k: number): void {
    if (Math.abs(k - this.shown) < 0.01) return;
    this.shown = k;
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.group.remove(this.mesh);
      this.mesh = null;
    }
    if (k <= 0) return;
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(this.r - 1.6, this.r - 0.6, 64, 1, Math.PI / 2, -k * Math.PI * 2),
      glow(this.color, { transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }, 1.5),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(x, y + 0.1, z);
    this.group.add(this.mesh);
  }
}

// ---------------------------------------------------------------- mission units

/**
 * Saboteur: a drill-beetle that ignores you and flies straight for the objective (the generator
 * or the convoy). Once there it latches on and drains it until you shoot it off.
 */
export class Saboteur extends Enemy {
  readonly radius = 1.6;
  readonly kind = 'drone';
  readonly species = 'saboteur';
  readonly hitBottom = -2;
  readonly hitTop = 2;
  readonly aimHeight = 0;
  latched = false;
  private placed = false;
  private readonly drill: THREE.Mesh;

  constructor(
    hpMul: number,
    private readonly target: () => THREE.Vector3 | null,
    private readonly onDrain: (amount: number) => void,
  ) {
    super(28 * hpMul);
    this.salvage = 3;
    this.dropChance = 0.15;
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), this.mat(ENEMY_ARMOR));
    shell.scale.set(1, 0.7, 1.4);
    this.drill = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.8, 8), this.mat(ENEMY_BODY));
    this.drill.rotation.x = -Math.PI / 2;
    this.drill.position.z = -1.9;
    const glowBack = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), glow('#b6ff5a', {}, 1.8));
    glowBack.position.z = 1.4;
    this.root.add(shell, this.drill, glowBack);
    addOutlines(this.root);
  }

  protected think({ world, dt }: Ctx): void {
    const p = this.root.position;
    const t = this.target();
    if (!t) return;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const d = Math.hypot(dx, dz);
    this.root.rotation.y = approachAngle(this.root.rotation.y, Math.atan2(-dx, -dz), 5 * dt);
    // Glide down toward the target as it gets close (no snapping from flying height).
    const cruise = world.heightAt(p.x, p.z) + HOVER_HEIGHT - 3 + Math.sin(this.time * 4) * 0.4;
    const perch = t.y + 1.5;
    const descend = Math.min(1, Math.max(0, (d - 4.5) / 28)); // 1 = far (cruising), 0 = at the target
    const wantY = perch + (cruise - perch) * descend;
    if (!this.placed) {
      this.placed = true; // arrive already at flying height
      p.y = wantY;
    }
    p.y += (wantY - p.y) * (1 - Math.exp(-6 * dt));
    this.latched = d < 4.5 && Math.abs(p.y - perch) < 2;
    if (d > 4.5) {
      const step = Math.min(d - 4, 17 * dt);
      p.x += (dx / d) * step;
      p.z += (dz / d) * step;
    } else {
      // Ride along with the target (the convoy keeps moving) and drill in.
      p.x = t.x - (dx / Math.max(d, 0.01)) * Math.min(d, 4.2);
      p.z = t.z - (dz / Math.max(d, 0.01)) * Math.min(d, 4.2);
      this.drill.rotation.z += dt * 30;
      if (this.latched) this.onDrain(6 * dt);
    }
  }
}

/** A power pylon feeding the fortress shield. */
class Pylon extends Enemy {
  readonly radius = 2.6;
  readonly kind = 'ground';
  readonly species = 'pylon';
  readonly hitBottom = 8;
  readonly hitTop = 17;
  readonly aimHeight = 14;
  private readonly core = glow(CYAN, {}, 1.4);

  constructor(hpMul: number) {
    super(130 * hpMul);
    this.salvage = 6;
    this.weight = 0;
    this.dropChance = 0.35;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 2, 6), this.mat(ENEMY_BODY, false));
    base.position.y = 1;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 12, 6), this.mat(ENEMY_ARMOR, false));
    mast.position.y = 8;
    const cage = new THREE.Mesh(new THREE.TorusGeometry(2, 0.35, 6, 12), this.mat(ENEMY_ARMOR));
    cage.rotation.x = Math.PI / 2;
    cage.position.y = 14;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 10), this.core);
    orb.position.y = 14;
    this.root.add(base, mast, cage, orb);
    addOutlines(this.root);
  }

  protected think({ world }: Ctx): void {
    this.root.position.y = world.heightAt(this.root.position.x, this.root.position.z);
    this.core.color.set(CYAN).multiplyScalar(GLOW * (1.2 + Math.sin(this.time * 5) * 0.3));
  }
}

/** The fortress: shielded while any pylon stands; lobs bomb volleys at you. */
class Fortress extends Enemy {
  readonly radius = 9;
  readonly kind = 'ground';
  readonly species = 'fortress';
  readonly hitBottom = 4;
  readonly hitTop = 16;
  readonly aimHeight = 12;
  shielded = true;
  private cooldown = 3;
  private readonly shieldMesh: THREE.Mesh;
  private readonly shieldMat = glow(CYAN, { transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }, 1.1);
  private readonly guns: THREE.Object3D[] = [];
  private readonly tmp = new THREE.Vector3();
  private shieldFlash = 0;

  constructor(hpMul: number) {
    super(650 * hpMul);
    this.salvage = 40;
    this.weight = 0;
    this.dropChance = 1;
    const keep = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 10, 8), this.mat(ENEMY_BODY, false));
    keep.position.y = 5;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(8, 7, 2.4, 8), this.mat(ENEMY_ARMOR));
    crown.position.y = 11.2;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(2.2, 14, 10), glow(ENEMY_GLOW, {}, 1.8));
    eye.position.y = 13.6;
    this.root.add(keep, crown, eye);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 3.4, 8), this.mat(ENEMY_ARMOR));
      gun.position.set(Math.cos(a) * 6.5, 13.2, Math.sin(a) * 6.5);
      gun.rotation.z = Math.PI / 5;
      this.guns.push(gun);
      this.root.add(gun);
    }
    this.shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(17, 24, 16), this.shieldMat);
    this.shieldMesh.position.y = 6;
    this.shieldMesh.userData.noOutline = true;
    this.root.add(this.shieldMesh);
    addOutlines(this.root);
  }

  damage(amount: number, blast = false): void {
    if (this.shielded) {
      this.shieldFlash = 0.15;
      return;
    }
    super.damage(amount, blast);
  }

  protected think({ ship, mortars, world, dt }: Ctx): void {
    const p = this.root.position;
    p.y = world.heightAt(p.x, p.z);
    this.shieldMesh.visible = this.shielded;
    this.shieldFlash = Math.max(0, this.shieldFlash - dt);
    this.shieldMat.opacity = 0.16 + (this.shieldFlash > 0 ? 0.3 : 0.04 * Math.sin(this.time * 3));
    this.cooldown -= dt;
    const d = this.distanceTo(ship).dist;
    if (this.cooldown <= 0) {
      this.cooldown = this.shielded ? 4.5 : 3.2;
      if (!ship.alive || d > 90) return;
      // A volley of bombs from each gun, landing around the ship.
      const s = ship.root.position;
      for (const [i, gun] of this.guns.entries()) {
        gun.getWorldPosition(this.tmp);
        const a = (i / 4) * Math.PI * 2 + Math.random();
        const r = i === 0 ? 0 : 10 + Math.random() * 10;
        mortars.fireAt(this.tmp, s.x + ship.velocity.x * 0.5 + Math.cos(a) * r, s.y, s.z + ship.velocity.y * 0.5 + Math.sin(a) * r, 10, 14);
      }
    }
  }
}

// ---------------------------------------------------------------- missions

export abstract class Mission {
  abstract readonly kind: MissionKind;
  protected readonly group = new THREE.Group();
  protected cx = 0;
  protected cz = 0;
  protected R = 100;
  protected hpMul = 1;
  protected time = 0;
  failed = false;
  done = false;

  constructor(protected readonly d: MissionDeps) {
    d.scene.add(this.group);
  }

  get title(): string {
    return MISSION_TITLES[this.kind];
  }

  begin(cx: number, cz: number, R: number, hpMul: number): void {
    this.cx = cx;
    this.cz = cz;
    this.R = R;
    this.hpMul = hpMul;
    this.setup();
  }

  protected abstract setup(): void;
  abstract update(dt: number): void;
  /** The objective line(s) under the radar. */
  abstract objective(): string;
  abstract blips(out: Blip[]): void;

  /** A health bar to show across the top (what you're protecting), or null. */
  healthBar(): { name: string; fraction: number } | null {
    return null;
  }

  /** The banner when it's failed. */
  failText = 'OBJECTIVE FAILED';

  /** Called once when failed (blow up what you were protecting). */
  onFail(): void {}

  /** Remove everything this mission placed in the world. */
  cleanup(): void {
    this.group.clear();
    this.d.scene.remove(this.group);
  }

  protected flyY(x: number, z: number): number {
    return this.d.world.heightAt(x, z) + HOVER_HEIGHT;
  }

  /** A random point in the arena, at least `min` from the centre. */
  protected spot(min: number, max: number): [number, number] {
    const a = Math.random() * Math.PI * 2;
    const r = min + Math.random() * (max - min);
    return [this.cx + Math.cos(a) * r, this.cz + Math.sin(a) * r];
  }

  protected shipNear(x: number, z: number, r: number): boolean {
    const s = this.d.ship;
    return s.alive && Math.hypot(s.root.position.x - x, s.root.position.z - z) < r;
  }
}

// ---- Rescue

class Rescue extends Mission {
  readonly kind = 'rescue';
  private readonly crew: { x: number; z: number; obj: THREE.Group; taken: boolean }[] = [];
  private carrying = 0;
  private saved = 0;
  private readonly lz = new THREE.Vector3();
  private readonly capacity = 2;
  private total = 4;

  protected setup(): void {
    // The landing zone near the arena's south edge (where you come in).
    const lzSpot = this.d.world.nearestRock(this.cx, this.cz + this.R * 0.55, 9);
    this.lz.set(lzSpot.x, 0, lzSpot.z);
    this.lz.y = this.d.world.heightAt(this.lz.x, this.lz.z);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.6, 0.6, 6), toon('#2a3150'));
    pad.position.copy(this.lz);
    const lzRing = ring(GREEN, 9, 0.8);
    lzRing.position.set(this.lz.x, this.lz.y + HOVER_HEIGHT - 1, this.lz.z);
    this.group.add(pad, lzRing, beam(GREEN, this.lz.x, this.lz.y, this.lz.z, 2));
    // Stranded crew: escape pods with a flare, spread around the arena.
    for (let i = 0; i < this.total; i++) {
      const a = (i / this.total) * Math.PI * 2 + Math.random() * 0.8 - Math.PI / 2;
      const r = this.R * (0.45 + Math.random() * 0.4);
      const { x, z } = this.d.world.nearestRock(this.cx + Math.cos(a) * r, this.cz + Math.sin(a) * r, 3);
      const ground = this.d.world.heightAt(x, z);
      const obj = new THREE.Group();
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 2, 6, 12), toon('#e8dfcc'));
      pod.rotation.z = 1.2;
      pod.position.y = 1.2;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.36, 1.36, 0.5, 12), toon('#e2733a'));
      stripe.rotation.z = 1.2;
      stripe.position.y = 1.2;
      obj.add(pod, stripe, beam(GOLD, 0, 0, 0, 1.2));
      // The flare beam is built at the origin: lift it to start at the ground.
      obj.children[2].position.set(0, (HOVER_HEIGHT + 14) / 2, 0);
      obj.position.set(x, ground, z);
      addOutlines(obj);
      this.group.add(obj);
      this.crew.push({ x, z, obj, taken: false });
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const c of this.crew) {
      if (c.taken || this.carrying >= this.capacity) continue;
      if (this.shipNear(c.x, c.z, 7)) {
        c.taken = true;
        c.obj.visible = false;
        this.carrying++;
        this.d.hud.show(this.carrying >= this.capacity ? 'FULL · BACK TO THE LANDING ZONE' : 'CREW ABOARD', 1.6);
      }
    }
    if (this.carrying > 0 && this.shipNear(this.lz.x, this.lz.z, 9)) {
      this.saved += this.carrying;
      this.carrying = 0;
      this.d.hud.show(`CREW SAFE · ${this.saved}/${this.total}`, 1.6);
      this.d.hud.flashHeal();
    }
    if (this.saved >= this.total) this.done = true;
  }

  objective(): string {
    return `${this.title}\nSAVED ${this.saved}/${this.total} · ABOARD ${this.carrying}/${this.capacity}`;
  }

  blips(out: Blip[]): void {
    if (this.carrying < this.capacity) for (const c of this.crew) if (!c.taken) out.push({ x: c.x, z: c.z, kind: 'reward', color: GOLD });
    if (this.carrying > 0) out.push({ x: this.lz.x, z: this.lz.z, kind: 'reward', color: GREEN });
  }
}

// ---- Defend

const DEFEND_TIME = 45;

class Defend extends Mission {
  readonly kind = 'defend';
  private hp = 100;
  private timer = DEFEND_TIME;
  private spawnTimer = 3;
  private readonly pos = new THREE.Vector3();
  private readonly saboteurs: Saboteur[] = [];
  private core!: THREE.MeshBasicMaterial;
  private hurt = 0;

  protected setup(): void {
    const ground = this.d.world.heightAt(this.cx, this.cz);
    this.pos.set(this.cx, ground + HOVER_HEIGHT - 4, this.cz);
    // A generator tower whose glowing core sits just below flying height.
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 4.5, HOVER_HEIGHT - 6, 8), toon('#e8dfcc'));
    tower.position.set(this.cx, ground + (HOVER_HEIGHT - 6) / 2, this.cz);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 1.2, 8), toon('#e2733a'));
    band.position.set(this.cx, ground + HOVER_HEIGHT - 9, this.cz);
    this.core = glow(CYAN, {}, 1.5) as THREE.MeshBasicMaterial;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12), this.core);
    orb.position.copy(this.pos);
    const guard = ring(CYAN, 8, 0.5, 0.5);
    guard.position.set(this.cx, this.pos.y + 3, this.cz);
    this.group.add(tower, band, orb, guard);
    addOutlines(this.group);
  }

  update(dt: number): void {
    this.time += dt;
    this.timer -= dt;
    this.hurt = Math.max(0, this.hurt - dt);
    this.core.color.set(this.hurt > 0 ? '#ff6b6b' : CYAN).multiplyScalar(GLOW * (1.3 + Math.sin(this.time * 4) * 0.2));
    // Saboteurs arrive in twos from the arena's edge and head straight for the generator.
    this.spawnTimer -= dt;
    for (let i = this.saboteurs.length - 1; i >= 0; i--) if (!this.saboteurs[i].alive) this.saboteurs.splice(i, 1);
    if (this.spawnTimer <= 0 && this.timer > 3) {
      this.spawnTimer = 6;
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = new Saboteur(this.hpMul, () => this.pos, (amount) => this.drain(amount));
        this.saboteurs.push(e);
        this.d.enemies.add(e, this.cx + Math.cos(a) * (this.R - 6), this.cz + Math.sin(a) * (this.R - 6));
      }
    }
    if (this.hp <= 0) this.failed = true;
    else if (this.timer <= 0) this.done = true;
  }

  private drain(amount: number): void {
    this.hp -= amount;
    this.hurt = 0.2;
  }

  failText = 'GENERATOR DESTROYED · MISSION FAILED';

  healthBar(): { name: string; fraction: number } {
    return { name: 'GENERATOR', fraction: Math.max(0, this.hp) / 100 };
  }

  onFail(): void {
    this.d.effects.explosion(this.pos, 14, this.d.world.heightAt(this.cx, this.cz));
    this.group.visible = false;
    for (const s of this.saboteurs) s.alive = false;
  }

  objective(): string {
    return `${this.title}\nHOLD ${Math.ceil(Math.max(0, this.timer))}s · GENERATOR ${Math.max(0, Math.ceil(this.hp))}%`;
  }

  blips(out: Blip[]): void {
    out.push({ x: this.cx, z: this.cz, kind: 'reward', color: CYAN });
    for (const s of this.saboteurs) if (s.alive) out.push({ x: s.root.position.x, z: s.root.position.z, kind: 'target' });
  }
}

// ---- Escort

class Escort extends Mission {
  readonly kind = 'escort';
  private hp = 100;
  private readonly convoy = new THREE.Group();
  private readonly pos = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private progress = 0;
  private route: { x: number; z: number }[] = [];
  private cum: number[] = [];
  private routeLen = 1;
  private spawnTimer = 4;
  private readonly saboteurs: Saboteur[] = [];
  private readonly lights: THREE.MeshBasicMaterial[] = [];
  private hurt = 0;
  private stalled = false;

  protected setup(): void {
    // Along the corridor's snaking centre line, left to right (or straight across otherwise).
    const path = this.d.world.shape.path;
    if (path && path.length > 1) this.route = path.map((p) => ({ x: p.x, z: p.z }));
    else {
      const span = this.R * 0.8;
      this.route = [
        { x: this.cx - span, z: this.cz + 10 },
        { x: this.cx + span, z: this.cz - 10 },
      ];
    }
    this.cum = [0];
    for (let i = 1; i < this.route.length; i++) {
      const a = this.route[i - 1];
      const b = this.route[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.routeLen = this.cum[this.cum.length - 1];
    const a = this.route[0];
    const b = this.route[this.route.length - 1];
    this.from.set(a.x, 0, a.z);
    this.to.set(b.x, 0, b.z);
    this.buildBridges();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 9), toon('#e8dfcc'));
    hull.position.y = 1.6;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 3), toon('#2f8f95'));
    cab.position.set(0, 3.6, -2.4);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.6, 9.1), toon('#e2733a'));
    stripe.position.y = 2;
    this.convoy.add(hull, cab, stripe);
    for (const s of [-1, 1]) {
      const l = glow(GREEN, {}, 1.6) as THREE.MeshBasicMaterial;
      this.lights.push(l);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), l);
      lamp.position.set(s * 1.6, 4.8, -2.4);
      this.convoy.add(lamp);
    }
    // Tall marker so it's easy to see at flying height.
    const mast = beam(GREEN, 0, 0, 0, 1);
    mast.position.set(0, (HOVER_HEIGHT + 14) / 2, 0);
    this.convoy.add(mast);
    addOutlines(this.convoy);
    this.group.add(this.convoy);
    // Destination marker.
    const g = this.d.world.heightAt(this.to.x, this.to.z);
    const dest = ring(GREEN, 9, 0.8);
    dest.position.set(this.to.x, g + HOVER_HEIGHT - 1, this.to.z);
    this.group.add(dest, beam(GREEN, this.to.x, g, this.to.z, 2));
    this.place();
  }

  /** Bridges wherever the convoy's road crosses a canyon (it drives at rock-top height). */
  /** A point `d` along the route, and the heading there. */
  private along(d: number): { x: number; z: number; yaw: number } {
    const r = this.route;
    d = Math.max(0, Math.min(this.routeLen, d));
    let i = 1;
    while (i < r.length - 1 && this.cum[i] < d) i++;
    const a = r[i - 1];
    const b = r[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const k = (d - this.cum[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)) };
  }

  /** Bridges wherever the convoy's road crosses a canyon (it drives at rock-top height). */
  private buildBridges(): void {
    const w = this.d.world;
    const len = this.routeLen;
    const deckMat = toon('#a98a5a');
    const railMat = toon('#e2733a');
    let start = -1;
    for (let d = 0; d <= len + 2; d += 1.5) {
      const p = this.along(d);
      const gap = !w.isRock(p.x, p.z, 3.5) && d <= len;
      if (gap && start < 0) start = d;
      if (!gap && start >= 0) {
        // A straight span from a little before the gap to a little after it.
        const d0 = Math.max(0, start - 4);
        const d1 = Math.min(len, d + 3);
        const p0 = this.along(d0);
        const p1 = this.along(d1);
        const mx = (p0.x + p1.x) / 2;
        const mz = (p0.z + p1.z) / 2;
        const y = w.heightAt(mx, mz);
        // The convoy drives straight across this span (the road may curve beneath it).
        this.spans.push({ d0, d1, x0: p0.x, z0: p0.z, x1: p1.x, z1: p1.z, y });
        const span = Math.hypot(p1.x - p0.x, p1.z - p0.z);
        const bridge = new THREE.Group();
        const deck = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.8, span), deckMat);
        deck.position.y = -0.4;
        bridge.add(deck);
        for (const side of [-1, 1]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, span), railMat);
          rail.position.set(side * 3.6, 1.1, 0);
          bridge.add(rail);
          for (let q = -span / 2; q <= span / 2; q += 3) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, 0.3), deckMat);
            post.position.set(side * 3.6, 0.55, q);
            bridge.add(post);
          }
        }
        const truss = new THREE.Mesh(new THREE.BoxGeometry(5, 1.6, span), toon('#3a3448'));
        truss.position.y = -1.6;
        bridge.add(truss);
        bridge.position.set(mx, y, mz);
        bridge.rotation.y = Math.atan2(-(p1.x - p0.x), -(p1.z - p0.z));
        addOutlines(bridge);
        castShadows(bridge);
        this.group.add(bridge);
        start = -1;
      }
    }
  }

  /** Bridge spans along the route: where they start and end, and the deck's height. */
  private readonly spans: { d0: number; d1: number; x0: number; z0: number; x1: number; z1: number; y: number }[] = [];

  private place(): void {
    const d = this.progress * this.routeLen;
    const span = this.spans.find((s) => d >= s.d0 && d <= s.d1);
    if (span) {
      // On a bridge: follow the deck in a straight line, at the deck's height.
      const k = (d - span.d0) / (span.d1 - span.d0 || 1);
      this.pos.set(span.x0 + (span.x1 - span.x0) * k, span.y, span.z0 + (span.z1 - span.z0) * k);
      this.convoy.position.copy(this.pos);
      this.convoy.rotation.y = approachAngle(this.convoy.rotation.y, Math.atan2(-(span.x1 - span.x0), -(span.z1 - span.z0)), 0.15);
      return;
    }
    const p = this.along(d);
    this.pos.set(p.x, this.d.world.heightAt(p.x, p.z), p.z);
    this.convoy.position.copy(this.pos);
    this.convoy.rotation.y = approachAngle(this.convoy.rotation.y, p.yaw, 0.15);
  }

  update(dt: number): void {
    this.time += dt;
    this.hurt = Math.max(0, this.hurt - dt);
    for (let i = this.saboteurs.length - 1; i >= 0; i--) if (!this.saboteurs[i].alive) this.saboteurs.splice(i, 1);
    // Latched saboteurs stall the convoy until you shoot them off.
    this.stalled = this.saboteurs.some((s) => s.latched);
    const len = this.routeLen;
    if (!this.stalled) this.progress = Math.min(1, this.progress + (7 * dt) / len);
    this.place();
    for (const l of this.lights) l.color.set(this.hurt > 0 ? '#ff6b6b' : this.stalled ? GOLD : GREEN).multiplyScalar(GLOW * 1.6);
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.progress < 0.95) {
      this.spawnTimer = 5.5;
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = new Saboteur(this.hpMul, () => this.convoyTarget(), (amount) => this.drain(amount));
        this.saboteurs.push(e);
        this.d.enemies.add(e, this.pos.x + Math.cos(a) * 70, this.pos.z + Math.sin(a) * 70);
      }
    }
    if (this.hp <= 0) this.failed = true;
    else if (this.progress >= 1) this.done = true;
  }

  private readonly target = new THREE.Vector3();
  private convoyTarget(): THREE.Vector3 {
    return this.target.set(this.pos.x, this.pos.y + 4, this.pos.z);
  }

  private drain(amount: number): void {
    this.hp -= amount * 0.8;
    this.hurt = 0.2;
  }

  failText = 'CONVOY DESTROYED · MISSION FAILED';

  healthBar(): { name: string; fraction: number } {
    return { name: 'CONVOY', fraction: Math.max(0, this.hp) / 100 };
  }

  onFail(): void {
    this.d.effects.explosion(this.convoyTarget(), 12, this.pos.y);
    this.convoy.visible = false;
    for (const s of this.saboteurs) s.alive = false;
  }

  objective(): string {
    const pct = Math.floor(this.progress * 100);
    return `${this.title}\n${this.stalled ? 'STALLED! ' : ''}${pct}% · CONVOY ${Math.max(0, Math.ceil(this.hp))}%`;
  }

  blips(out: Blip[]): void {
    out.push({ x: this.pos.x, z: this.pos.z, kind: 'reward', color: GREEN });
    for (const s of this.saboteurs) if (s.alive) out.push({ x: s.root.position.x, z: s.root.position.z, kind: 'target' });
  }
}

// ---- Sabotage

class Sabotage extends Mission {
  readonly kind = 'sabotage';
  private fortress!: Fortress;
  private readonly pylons: Pylon[] = [];
  private readonly links: THREE.Mesh[] = [];
  private dropped = false;

  protected setup(): void {
    this.fortress = this.d.enemies.add(new Fortress(this.hpMul), this.cx, this.cz) as Fortress;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.random() * 0.6;
      const r = this.R * (0.45 + Math.random() * 0.3);
      const x = this.cx + Math.cos(a) * r;
      const z = this.cz + Math.sin(a) * r;
      this.pylons.push(this.d.enemies.add(new Pylon(this.hpMul), x, z) as Pylon);
      // Power link from the pylon to the fortress (a unit-length beam, stretched every frame).
      const link = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 1, 6, 1, true),
        glow(CYAN, { transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }, 1.4),
      );
      this.links.push(link);
      this.group.add(link);
    }
    this.placeLinks();
  }

  private readonly linkFrom = new THREE.Vector3();
  private readonly linkTo = new THREE.Vector3();

  /**
   * Stretch each beam between where its pylon and the fortress actually are. (Spawning can
   * nudge them onto solid rock, so the spot they were asked for isn't always where they stand.)
   */
  private placeLinks(): void {
    const f = this.fortress.root.position;
    this.linkTo.set(f.x, this.d.world.heightAt(f.x, f.z) + 12, f.z);
    for (const [i, p] of this.pylons.entries()) {
      const link = this.links[i];
      const q = p.root.position;
      this.linkFrom.set(q.x, this.d.world.heightAt(q.x, q.z) + 14, q.z);
      const len = this.linkFrom.distanceTo(this.linkTo);
      link.position.addVectors(this.linkFrom, this.linkTo).multiplyScalar(0.5);
      link.scale.set(1, Math.max(0.01, len), 1);
      link.lookAt(this.linkTo);
      link.rotateX(Math.PI / 2);
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.placeLinks();
    for (const [i, p] of this.pylons.entries()) {
      this.links[i].visible = p.alive;
      (this.links[i].material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.sin(this.time * 8 + i) * 0.2;
    }
    if (!this.dropped && this.pylons.every((p) => !p.alive)) {
      this.dropped = true;
      this.fortress.shielded = false;
      this.d.hud.show('SHIELD DOWN · DESTROY THE FORTRESS', 2.4);
    }
    if (!this.fortress.alive) this.done = true;
  }

  objective(): string {
    const left = this.pylons.filter((p) => p.alive).length;
    return this.dropped ? `${this.title}\nSHIELD DOWN · DESTROY IT` : `${this.title}\nPYLONS LEFT ${left}/3`;
  }

  blips(out: Blip[]): void {
    if (!this.dropped) {
      for (const p of this.pylons) if (p.alive) out.push({ x: p.root.position.x, z: p.root.position.z, kind: 'target' });
    } else if (this.fortress.alive) out.push({ x: this.cx, z: this.cz, kind: 'target' });
  }
}

// ---- Hold the zones

const CAPTURE_TIME = 8;
const ZONE_R = 12;

class Hold extends Mission {
  readonly kind = 'hold';
  private readonly zones: { x: number; z: number; y: number; k: number; done: boolean; arc: Arc; edge: THREE.Mesh }[] = [];

  protected setup(): void {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.random() * 0.7;
      const r = this.R * (0.4 + Math.random() * 0.3);
      const { x, z } = this.d.world.nearestRock(this.cx + Math.cos(a) * r, this.cz + Math.sin(a) * r, 4);
      const y = this.flyY(x, z) - 1;
      const edge = ring(GOLD, ZONE_R, 0.7, 0.8);
      edge.position.set(x, y, z);
      const ground = this.d.world.heightAt(x, z);
      this.group.add(edge, beam(GOLD, x, ground, z, 1.4));
      this.zones.push({ x, z, y, k: 0, done: false, arc: new Arc(this.group, '#fff1c0', ZONE_R), edge });
    }
  }

  update(dt: number): void {
    for (const zn of this.zones) {
      if (zn.done) continue;
      // Fills while you're inside; drains (slower) when you leave.
      if (this.shipNear(zn.x, zn.z, ZONE_R)) zn.k = Math.min(1, zn.k + dt / CAPTURE_TIME);
      else zn.k = Math.max(0, zn.k - dt / (CAPTURE_TIME * 2));
      zn.arc.set(zn.x, zn.y, zn.z, zn.k);
      if (zn.k >= 1) {
        zn.done = true;
        ((zn.edge.material as THREE.MeshBasicMaterial).color as THREE.Color).set(GREEN).multiplyScalar(1.3);
        this.d.hud.show(`ZONE CAPTURED · ${this.zones.filter((q) => q.done).length}/3`, 1.6);
      }
    }
    if (this.zones.every((zn) => zn.done)) this.done = true;
  }

  objective(): string {
    const inZone = this.zones.find((zn) => !zn.done && this.shipNear(zn.x, zn.z, ZONE_R));
    const captured = this.zones.filter((zn) => zn.done).length;
    return `${this.title}\nCAPTURED ${captured}/3${inZone ? ` · ${Math.floor(inZone.k * 100)}%` : ''}`;
  }

  blips(out: Blip[]): void {
    for (const zn of this.zones) if (!zn.done) out.push({ x: zn.x, z: zn.z, kind: 'reward', color: GOLD });
  }
}

// ---- Cargo

/** Crates scattered along the corridor; deliver them all to the safe zone on the far right. */
const CARGO_CRATES = 6;

class Cargo extends Mission {
  readonly kind = 'cargo';
  private readonly crates: { x: number; z: number; obj: THREE.Group; taken: boolean }[] = [];
  private readonly zone = new THREE.Vector3();
  private carrying = 0;
  private delivered = 0;
  private readonly total = CARGO_CRATES;
  /** Loads carried at once: depends on the ship (Manta 2, Atlas 4...). */
  private get capacity(): number {
    return cargoCapacity(this.d.ship.design);
  }
  private readonly hold = new THREE.Group();

  protected setup(): void {
    // The route: the corridor's centre line, left to right.
    const path = this.d.world.shape.path ?? [
      { x: this.cx - this.R * 0.8, z: this.cz },
      { x: this.cx + this.R * 0.8, z: this.cz },
    ];
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
    const len = cum[cum.length - 1];
    const at = (d: number) => {
      let i = 1;
      while (i < path.length - 1 && cum[i] < d) i++;
      const a = path[i - 1];
      const b = path[i];
      const k = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      return { x: a.x + dx * k, z: a.z + dz * k, nx: -dz / l, nz: dx / l };
    };
    // The safe zone at the far right end.
    const end = path[path.length - 1];
    const zs = this.d.world.nearestRock(end.x, end.z, 10);
    this.zone.set(zs.x, this.d.world.heightAt(zs.x, zs.z), zs.z);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.6, 0.6, 6), toon('#2a3150'));
    pad.position.copy(this.zone);
    const zr = ring(GREEN, 12, 0.9);
    zr.position.set(this.zone.x, this.zone.y + HOVER_HEIGHT - 1, this.zone.z);
    this.group.add(pad, zr, beam(GREEN, this.zone.x, this.zone.y, this.zone.z, 2.4));
    // Crates spread along the way, off to either side of the route.
    for (let i = 0; i < this.total; i++) {
      const p = at(len * (0.12 + (0.7 * (i + Math.random() * 0.6)) / this.total));
      const side = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 22);
      const { x, z } = this.d.world.nearestRock(p.x + p.nx * side, p.z + p.nz * side, 3);
      const ground = this.d.world.heightAt(x, z);
      const obj = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 3), toon('#e2733a'));
      box.position.y = 1.1;
      const band = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.5, 3.1), toon('#2f8f95'));
      band.position.y = 1.1;
      const flare = beam(GOLD, 0, 0, 0, 1.1);
      flare.position.set(0, (HOVER_HEIGHT + 14) / 2, 0);
      obj.add(box, band, flare);
      obj.position.set(x, ground, z);
      obj.rotation.y = Math.random() * Math.PI;
      addOutlines(obj);
      this.group.add(obj);
      this.crates.push({ x, z, obj, taken: false });
    }
    // Crates you're carrying hang under the ship.
    this.d.ship.root.add(this.hold);
  }

  update(dt: number): void {
    this.time += dt;
    const cap = this.capacity;
    for (const c of this.crates) {
      if (c.taken || this.carrying >= cap) continue;
      if (this.shipNear(c.x, c.z, 7)) {
        c.taken = true;
        c.obj.visible = false;
        this.carrying++;
        this.showHold();
        this.d.hud.show(this.carrying >= cap ? 'HOLD FULL · TO THE SAFE ZONE' : `CARGO ABOARD ${this.carrying}/${cap}`, 1.6);
      }
    }
    if (this.carrying > 0 && this.shipNear(this.zone.x, this.zone.z, 12)) {
      this.delivered += this.carrying;
      this.carrying = 0;
      this.showHold();
      this.d.hud.show(`DELIVERED · ${this.delivered}/${this.total}`, 1.6);
      this.d.hud.flashHeal();
    }
    if (this.delivered >= this.total) this.done = true;
  }

  /** Little crates slung under the ship, one per load aboard. */
  private showHold(): void {
    this.hold.clear();
    for (let i = 0; i < this.carrying; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.2), toon('#e2733a'));
      b.position.set((i - (this.carrying - 1) / 2) * 1.5, -2.2, 0.6);
      this.hold.add(b);
    }
  }

  objective(): string {
    return `${this.title}\nDELIVERED ${this.delivered}/${this.total} · ABOARD ${this.carrying}/${this.capacity}`;
  }

  blips(out: Blip[]): void {
    if (this.carrying < this.capacity) for (const c of this.crates) if (!c.taken) out.push({ x: c.x, z: c.z, kind: 'reward', color: GOLD });
    if (this.carrying > 0) out.push({ x: this.zone.x, z: this.zone.z, kind: 'reward', color: GREEN });
  }

  cleanup(): void {
    this.hold.clear();
    this.hold.removeFromParent();
    super.cleanup();
  }
}

export function createMission(kind: MissionKind, d: MissionDeps): Mission {
  switch (kind) {
    case 'cargo':
      return new Cargo(d);
    case 'rescue':
      return new Rescue(d);
    case 'defend':
      return new Defend(d);
    case 'escort':
      return new Escort(d);
    case 'sabotage':
      return new Sabotage(d);
    default:
      return new Hold(d);
  }
}
