import * as THREE from 'three';
import { type Ctx, Enemy, ENEMY_ARMOR, ENEMY_BODY, ENEMY_GLOW } from './EnemyBase';
import { Crawler, Pulsar, Swarmer } from './EnemyTypes';
import { addOutlines, GLOW, glow, rimToon, toon } from './materials';
import { approachAngle } from './math';
import { HOVER_HEIGHT, type Ship } from './Ship';

/*
 * Bosses. Each is a big Enemy (the "core") plus, for some, separate hittable parts
 * (BossPart). Every attack has a tell: red lanes, warning rings, a glow or a stomp.
 * Below half health each boss enters phase 2: faster attacks and more helpers.
 *
 *   Skyreaver      flying gunship: bullet spirals, a lane-charge across the arena,
 *                  missile volleys, calls in swarmers and drones
 *   Juggernaut     giant tank: two side cannons (destroy them to expose the core) fire
 *                  bomb barrages; a charged main-cannon beam; ground shockwaves; brings crawlers
 *   Jungle Titan   rooted plant colossus: only its open pod can be hurt (the weak spot moves);
 *                  tentacle slams, lingering spore clouds, seed spirals, calls in swarmers
 */

export type BossId = 'flyer' | 'tank' | 'titan';
export const BOSS_NAMES: Record<BossId, string> = { flyer: 'SKYREAVER', tank: 'JUGGERNAUT', titan: 'JUNGLE TITAN' };

const RED = '#ff3d3d';
const warnMat = () => glow(RED, { transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }, 1.4);

/** Shared boss behaviour: health, phase 2, helpers, and part bookkeeping. */
export abstract class Boss extends Enemy {
  readonly species = 'boss';
  abstract readonly id: BossId;
  protected adds: Enemy[] = [];
  protected readonly parts: BossPart[] = [];
  protected attackTimer = 2.5;
  private partsSpawned = false;

  get name(): string {
    return BOSS_NAMES[this.id];
  }

  /** 0..1 for the health bar. */
  get healthFraction(): number {
    return Math.max(0, this.hp) / this.maxHp;
  }

  get phase2(): boolean {
    return this.healthFraction < 0.5;
  }

  /** Called once on the first update (parts need the boss to be in the world first). */
  protected setupParts(_ctx: Ctx): void {}

  update(ctx: Ctx): void {
    if (!this.partsSpawned) {
      this.partsSpawned = true;
      this.setupParts(ctx);
    }
    this.adds = this.adds.filter((a) => a.alive);
    super.update(ctx);
  }

  /** Bosses can be chilled, but never frozen solid or stopped. */
  freeze(_seconds: number): void {}

  protected summon(ctx: Ctx, e: Enemy, dist = 26): void {
    const a = Math.random() * Math.PI * 2;
    const p = ctx.ship.root.position;
    ctx.spawn(e, p.x + Math.cos(a) * dist, p.z + Math.sin(a) * dist);
    this.adds.push(e);
  }

  /** Damage passed on from a part (goes straight to health, past any shield on the core). */
  takeShared(amount: number, blast: boolean): void {
    Enemy.prototype.damage.call(this, amount, blast);
  }

  protected addPart(ctx: Ctx, part: BossPart): void {
    this.parts.push(part);
    const p = this.root.position;
    ctx.spawn(part, p.x, p.z);
  }

  /** Ship inside a strip of `halfWidth` along a ray (origin, angle `a` as a heading), up to `len`? */
  protected inLane(ship: Ship, ox: number, oz: number, a: number, len: number, halfWidth: number): boolean {
    const fx = -Math.sin(a);
    const fz = -Math.cos(a);
    const dx = ship.root.position.x - ox;
    const dz = ship.root.position.z - oz;
    const along = dx * fx + dz * fz;
    const across = Math.abs(dx * -fz + dz * fx);
    return along > -2 && along < len && across < halfWidth + ship.radius;
  }
}

/**
 * A separate hittable piece of a boss (a side cannon, a pod). Either it has its own health
 * (destroy it), or it passes damage to the boss (`shared`). It can be shielded (immune).
 */
export class BossPart extends Enemy {
  readonly kind: 'drone' | 'ground';
  readonly species = 'bosspart';
  readonly radius: number;
  readonly hitBottom: number;
  readonly hitTop: number;
  readonly aimHeight: number;
  shielded = false;
  /** Damage goes to this boss instead of the part's own health. */
  shared: Boss | null = null;
  readonly look = new THREE.Group();
  /** Free-form data for the boss that owns it (which side, its angle, …). */
  data: Record<string, unknown> = {};

  constructor(hp: number, radius: number, low: number, high: number, ground: boolean) {
    super(hp);
    this.kind = ground ? 'ground' : 'drone';
    this.radius = radius;
    this.hitBottom = low;
    this.hitTop = high;
    this.aimHeight = (low + high) / 2;
    this.salvage = 10;
    this.weight = 0;
    this.dropChance = 0.6;
    this.root.add(this.look);
  }

  material(color: string, flashes = true): THREE.MeshToonMaterial {
    return this.mat(color, flashes);
  }

  damage(amount: number, blast = false): void {
    if (!this.alive || this.shielded) return;
    if (this.shared) {
      this.flash = 0.08;
      this.shared.takeShared(amount, blast);
      return;
    }
    super.damage(amount, blast);
  }

  freeze(_seconds: number): void {}

  protected think(): void {}
}


// ---------------------------------------------------------------- Skyreaver (flying)

export class Skyreaver extends Boss {
  readonly id = 'flyer';
  readonly kind = 'drone';
  readonly radius = 8;
  readonly hitBottom = -3.5;
  readonly hitTop = 3.5;
  readonly aimHeight = 0;
  private state: 'move' | 'spiral' | 'aim' | 'charge' | 'volley' = 'move';
  private stateTime = 0;
  private spin = 0;
  private fireTimer = 0;
  private shotsLeft = 0;
  private readonly vel = new THREE.Vector2();
  private orbit = Math.random() * Math.PI * 2;
  private readonly dashDir = new THREE.Vector2();
  private dashLeft = 0;
  private dashHit = false;
  private readonly lane: THREE.Mesh;
  private readonly laneMat = warnMat();
  private readonly engines = glow('#ff7a3a', {}, 1.6);
  private readonly eye = glow(ENEMY_GLOW, {}, 1.6);
  private readonly body = new THREE.Group();
  private readonly tmp = new THREE.Vector3();
  private next = 0;

  constructor(hpMul = 1) {
    super(1800 * hpMul);
    this.salvage = 150;
    this.weight = 0;
    this.dropChance = 0;
    const armor = rimToon(ENEMY_ARMOR, ENEMY_GLOW, 0.75);
    const hull = new THREE.Mesh(new THREE.SphereGeometry(4.5, 20, 12), this.mat(ENEMY_ARMOR));
    hull.scale.set(1.2, 0.55, 2);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 12), this.mat(ENEMY_BODY));
    spine.position.y = 1.6;
    const parts: THREE.Object3D[] = [hull, spine];
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(11, 0.6, 5), this.mat(ENEMY_BODY));
      wing.position.set(s * 8, 0, 1);
      wing.rotation.y = s * 0.35;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(1.2, 4, 6), armor);
      tip.rotation.x = Math.PI / 2;
      tip.position.set(s * 13.5, 0, 3);
      const engine = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 3.6, 10), this.mat(ENEMY_ARMOR));
      engine.rotation.x = Math.PI / 2;
      engine.position.set(s * 4.5, -0.4, 7.5);
      const flame = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), this.engines);
      flame.position.set(s * 4.5, -0.4, 9.5);
      flame.scale.set(0.9, 0.9, 1.6);
      // Missile pods under the wings.
      for (const k of [0, 1]) {
        const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.2, 8), this.mat(ENEMY_ARMOR));
        pod.rotation.x = Math.PI / 2;
        pod.position.set(s * (6 + k * 2.4), -0.8, 0);
        parts.push(pod);
      }
      parts.push(wing, tip, engine, flame);
    }
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1.3, 14, 10), this.eye);
    eye.position.set(0, 0.6, -8.4);
    parts.push(eye);
    this.body.add(...parts);
    this.root.add(this.body);
    this.lane = new THREE.Mesh(new THREE.BoxGeometry(16, 0.1, 1), this.laneMat);
    this.lane.visible = false;
    this.lane.userData.noOutline = true;
    this.root.add(this.lane);
    addOutlines(this.body);
  }

  protected think(ctx: Ctx): void {
    const { ship, world, dt, shots, mortars } = ctx;
    const p = this.root.position;
    const s = ship.root.position;
    const dx = s.x - p.x;
    const dz = s.z - p.z;
    const dist = Math.hypot(dx, dz);
    const flyY = world.heightAt(p.x, p.z) + HOVER_HEIGHT + 3;
    const speedUp = this.phase2 ? 1.35 : 1;
    this.stateTime += dt;
    this.engines.color.set('#ff7a3a').multiplyScalar(GLOW * (this.state === 'charge' ? 2.4 : 1.2 + Math.sin(this.time * 10) * 0.2));

    if (this.state === 'move') {
      // Circle the ship at a distance, facing it.
      this.orbit += dt * 0.35;
      const tx = s.x + Math.cos(this.orbit) * 40 - p.x;
      const tz = s.z + Math.sin(this.orbit) * 40 - p.z;
      const len = Math.hypot(tx, tz);
      const sp = Math.min(len * 1.5, 30);
      const k = 1 - Math.exp(-1.5 * dt);
      this.vel.x += ((len > 0.01 ? tx / len : 0) * sp - this.vel.x) * k;
      this.vel.y += ((len > 0.01 ? tz / len : 0) * sp - this.vel.y) * k;
      this.root.rotation.y = approachAngle(this.root.rotation.y, Math.atan2(-dx, -dz), 1.5 * dt);
      this.attackTimer -= dt * speedUp;
      if (this.attackTimer <= 0 && ship.alive) this.startAttack(ctx);
    } else if (this.state === 'spiral') {
      // A rotating spiral of shots from the hull.
      this.vel.multiplyScalar(Math.exp(-3 * dt));
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.fireTimer = 0.14;
        this.spin += 0.27;
        const arms = this.phase2 ? 6 : 4;
        this.tmp.set(p.x, s.y, p.z);
        for (let i = 0; i < arms; i++) {
          const a = this.spin + (i / arms) * Math.PI * 2;
          shots.fire(this.tmp, Math.cos(a), Math.sin(a), 20, s.y, 1, 7, 5);
        }
      }
      if (this.stateTime > 3) this.toMove();
    } else if (this.state === 'aim') {
      // A wide red lane through the ship: it's about to charge.
      this.vel.multiplyScalar(Math.exp(-6 * dt));
      this.laneMat.opacity = 0.2 + 0.3 * (0.5 + 0.5 * Math.sin(this.time * 24));
      this.body.position.x = (Math.random() - 0.5) * 0.4;
      if (this.stateTime > (this.phase2 ? 0.9 : 1.2)) {
        this.state = 'charge';
        this.stateTime = 0;
        this.lane.visible = false;
        this.body.position.x = 0;
        this.dashHit = false;
        this.vel.copy(this.dashDir).multiplyScalar(95);
      }
    } else if (this.state === 'charge') {
      this.dashLeft -= 95 * dt;
      if (!this.dashHit && ship.alive && ship.invulnerable <= 0 && dist < this.radius + ship.radius) {
        ship.damage(25);
        this.dashHit = true;
      }
      if (this.dashLeft <= 0) {
        this.vel.multiplyScalar(0.2);
        this.toMove();
      }
    } else if (this.state === 'volley') {
      // Missiles from the wing pods, each landing in a warning ring around the ship.
      this.vel.multiplyScalar(Math.exp(-3 * dt));
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && this.shotsLeft > 0) {
        this.fireTimer = 0.22;
        this.shotsLeft--;
        const a = Math.random() * Math.PI * 2;
        const r = this.shotsLeft === 0 ? 0 : 6 + Math.random() * 16;
        this.tmp.set(p.x + (Math.random() - 0.5) * 12, p.y, p.z);
        mortars.fireAt(this.tmp, s.x + ship.velocity.x * 0.4 + Math.cos(a) * r, s.y, s.z + ship.velocity.y * 0.4 + Math.sin(a) * r, 9, 14, 1.3);
      }
      if (this.shotsLeft <= 0 && this.stateTime > 1.6) this.toMove();
    }
    p.x += this.vel.x * dt;
    p.z += this.vel.y * dt;
    p.y = flyY + Math.sin(this.time * 1.4) * 0.6;
    this.body.rotation.z = Math.sin(this.time * 0.9) * 0.05 - this.vel.x * 0.002;
    this.eye.color.set(ENEMY_GLOW).multiplyScalar(GLOW * (this.state === 'move' ? 1 : 2));
  }

  private startAttack(ctx: Ctx): void {
    const { ship } = ctx;
    const order = ['spiral', 'charge', 'volley', 'summon'] as const;
    const pick = order[this.next++ % order.length];
    this.stateTime = 0;
    if (pick === 'spiral') {
      this.state = 'spiral';
      this.fireTimer = 0.3;
    } else if (pick === 'charge') {
      const p = this.root.position;
      const s = ship.root.position;
      const dx = s.x - p.x;
      const dz = s.z - p.z;
      const d = Math.max(0.01, Math.hypot(dx, dz));
      this.dashDir.set(dx / d, dz / d);
      this.dashLeft = d + 35;
      this.root.rotation.y = Math.atan2(-dx, -dz);
      this.lane.scale.z = this.dashLeft;
      this.lane.position.set(0, -2.5, -this.dashLeft / 2);
      this.lane.visible = true;
      this.state = 'aim';
    } else if (pick === 'volley') {
      this.state = 'volley';
      this.shotsLeft = this.phase2 ? 8 : 5;
      this.fireTimer = 0.2;
    } else {
      // Call in helpers: a swarmer pack (and drones in phase 2), then carry on.
      if (this.adds.length < (this.phase2 ? 10 : 6)) {
        const hp = 1;
        for (let i = 0; i < 4; i++) this.summon(ctx, new Swarmer(hp), 30 + i * 2);
        if (this.phase2) this.summon(ctx, makeDrone(ctx), 34);
      }
      this.toMove(0.6);
      return;
    }
  }

  private toMove(wait?: number): void {
    this.state = 'move';
    this.stateTime = 0;
    this.attackTimer = wait ?? (this.phase2 ? 1.4 : 2.2);
  }
}

/** The plain drone lives in Enemies.ts; bosses get one through ctx.spawn's factory. */
let droneFactory: (() => Enemy) | null = null;
export function setDroneFactory(f: () => Enemy): void {
  droneFactory = f;
}
function makeDrone(_ctx: Ctx): Enemy {
  return droneFactory ? droneFactory() : new Swarmer(1);
}

// ---------------------------------------------------------------- Juggernaut (tank)

const TANK_H = 7; // hull top

export class Juggernaut extends Boss {
  readonly id = 'tank';
  readonly kind = 'ground';
  readonly radius = 9;
  readonly hitBottom = 1;
  readonly hitTop = TANK_H + 4;
  readonly aimHeight = TANK_H;
  private readonly turret = new THREE.Group();
  private readonly beamLane: THREE.Mesh;
  private readonly beamLaneMat = warnMat();
  private readonly beam: THREE.Mesh;
  private readonly beamMat = glow('#ffd0d0', { transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }, 2);
  private readonly wave: THREE.Mesh;
  private readonly waveMat = glow('#ff7a3a', { transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }, 1.6);
  private readonly coreMat = glow('#ffb03a', {}, 1);
  private readonly shieldMat = glow('#6ff7ff', { transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }, 1.2);
  private readonly shield: THREE.Mesh;
  private state: 'drive' | 'aim' | 'beam' | 'stomp' | 'barrage' = 'drive';
  private stateTime = 0;
  private aimLock = 0;
  private waveR = -1;
  private waveHit = false;
  private shotsLeft = 0;
  private fireTimer = 0;
  private next = 0;
  private summonTimer = 8;
  private readonly cannons: BossPart[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly legs: THREE.Object3D[] = [];
  private shieldFlash = 0;

  constructor(hpMul = 1) {
    super(1500 * hpMul);
    this.salvage = 150;
    this.weight = 0;
    this.dropChance = 0;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(13, 4.2, 18), this.mat(ENEMY_ARMOR));
    hull.position.y = TANK_H - 2.4;
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(15, 1.6, 20), this.mat(ENEMY_BODY));
    skirt.position.y = 2.6;
    this.root.add(hull, skirt);
    // Treads.
    for (const s of [-1, 1]) {
      const tread = new THREE.Mesh(new THREE.BoxGeometry(3, 3.2, 21), this.mat(ENEMY_BODY));
      tread.position.set(s * 8.2, 1.6, 0);
      this.legs.push(tread);
      this.root.add(tread);
    }
    // The core: armored and shielded until both side cannons are gone.
    const core = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), this.coreMat);
    core.position.set(0, TANK_H + 0.6, 3);
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(3.4, 18, 12), this.shieldMat);
    this.shield.position.copy(core.position);
    this.shield.userData.noOutline = true;
    this.root.add(core, this.shield);
    // Main turret with a long gun.
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4, 2.4, 10), this.mat(ENEMY_BODY));
    dome.position.y = 1.2;
    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 10, 10), this.mat(ENEMY_ARMOR));
    gun.rotation.x = Math.PI / 2;
    gun.position.set(0, 1.4, -6.5);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), glow(ENEMY_GLOW, {}, 1.8));
    muzzle.position.set(0, 1.4, -11.6);
    this.turret.add(dome, gun, muzzle);
    this.turret.position.set(0, TANK_H, -3);
    this.root.add(this.turret);
    // Beam telegraph lane and the beam itself (in the turret's frame, at flying height).
    const up = HOVER_HEIGHT - TANK_H;
    this.beamLane = new THREE.Mesh(new THREE.BoxGeometry(7, 0.1, 1), this.beamLaneMat);
    this.beamLane.visible = false;
    this.beam = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 1), this.beamMat);
    this.beam.visible = false;
    for (const m of [this.beamLane, this.beam]) {
      m.position.y = up;
      m.userData.noOutline = true;
      this.turret.add(m);
    }
    // Shockwave ring at flying height.
    this.wave = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64), this.waveMat);
    this.wave.rotation.x = -Math.PI / 2;
    this.wave.position.y = HOVER_HEIGHT;
    this.wave.visible = false;
    this.wave.userData.noOutline = true;
    this.root.add(this.wave);
    addOutlines(this.root);
  }

  protected setupParts(ctx: Ctx): void {
    for (const s of [-1, 1]) {
      const c = new BossPart(320 * (this.maxHp / 1500), 2.6, -1.5, 3, true);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.4, 1.6, 8), c.material(ENEMY_BODY));
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 4.2, 8), c.material(ENEMY_ARMOR));
      barrel.rotation.x = Math.PI / 2.6;
      barrel.position.set(0, 1.4, -1.6);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), glow('#ffb03a', {}, 1.8));
      eye.position.set(0, 1.2, 0.8);
      c.look.add(base, barrel, eye);
      addOutlines(c.look);
      c.data = { side: s };
      this.cannons.push(c);
      this.addPart(ctx, c);
    }
    this.placeParts();
  }

  private get exposed(): boolean {
    return this.cannons.every((c) => !c.alive);
  }

  get phase2(): boolean {
    return this.exposed || this.healthFraction < 0.5;
  }

  damage(amount: number, blast = false): void {
    if (!this.exposed) {
      this.shieldFlash = 0.12;
      return;
    }
    super.damage(amount, blast);
  }

  private placeParts(): void {
    const p = this.root.position;
    const yaw = this.root.rotation.y;
    for (const c of this.cannons) {
      const s = c.data.side as number;
      const lx = s * 7.5;
      const lz = 2;
      c.root.position.set(p.x + lx * Math.cos(yaw) + lz * Math.sin(yaw), p.y + TANK_H, p.z - lx * Math.sin(yaw) + lz * Math.cos(yaw));
      c.root.rotation.y = yaw;
    }
  }

  protected think(ctx: Ctx): void {
    const { ship, world, dt, mortars } = ctx;
    const p = this.root.position;
    const s = ship.root.position;
    const dx = s.x - p.x;
    const dz = s.z - p.z;
    const dist = Math.hypot(dx, dz);
    this.stateTime += dt;
    this.shieldFlash = Math.max(0, this.shieldFlash - dt);
    this.shield.visible = !this.exposed;
    this.shieldMat.opacity = 0.22 + (this.shieldFlash > 0 ? 0.4 : 0);
    this.coreMat.color.set('#ffb03a').multiplyScalar(GLOW * (this.exposed ? 1.6 + Math.sin(this.time * 8) * 0.4 : 0.7));

    // Drive slowly toward the ship, turning like a tank.
    this.root.rotation.y = approachAngle(this.root.rotation.y, Math.atan2(-dx, -dz), 0.45 * dt);
    if (this.state === 'drive' && dist > 28) {
      const fx = -Math.sin(this.root.rotation.y);
      const fz = -Math.cos(this.root.rotation.y);
      p.x += fx * 5 * dt;
      p.z += fz * 5 * dt;
    }
    p.y = world.heightAt(p.x, p.z);
    this.placeParts();

    // Turret tracks the ship (except while the beam is locked).
    const turretAim = Math.atan2(-dx, -dz) - this.root.rotation.y;
    if (this.state !== 'aim' || this.stateTime < this.aimLock) this.turret.rotation.y = approachAngle(this.turret.rotation.y, turretAim, 1.6 * dt);

    // Shockwave expands until it leaves the arena.
    if (this.waveR >= 0) {
      this.waveR += 30 * dt;
      this.wave.scale.setScalar(Math.max(0.01, this.waveR));
      this.waveMat.opacity = Math.max(0.2, 1 - this.waveR / 90);
      if (!this.waveHit && ship.alive && ship.invulnerable <= 0 && Math.abs(dist - this.waveR) < 2.6) {
        ship.damage(16);
        this.waveHit = true;
      }
      if (this.waveR > 90) {
        this.waveR = -1;
        this.wave.visible = false;
      }
    }

    // Helpers.
    this.summonTimer -= dt;
    if (this.summonTimer <= 0) {
      this.summonTimer = this.phase2 ? 12 : 16;
      const crawlers = this.adds.filter((a) => a.species === 'crawler').length;
      if (crawlers < (this.phase2 ? 3 : 2)) this.summon(ctx, new Crawler(1), 32);
    }

    switch (this.state) {
      case 'drive':
        this.attackTimer -= dt * (this.phase2 ? 1.4 : 1);
        if (this.attackTimer <= 0 && ship.alive) this.startAttack();
        break;
      case 'aim': {
        // Red lane along the gun: tracks, then locks, then fires.
        const len = 140;
        this.beamLane.scale.z = len;
        this.beamLane.position.z = -len / 2 - 8;
        this.beamLaneMat.opacity = this.stateTime < this.aimLock ? 0.2 : 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(this.time * 40));
        if (this.stateTime > this.aimLock + 0.55) {
          this.beamLane.visible = false;
          this.beam.visible = true;
          this.beam.scale.z = len;
          this.beam.position.z = -len / 2 - 8;
          const yaw = this.root.rotation.y + this.turret.rotation.y;
          this.turret.getWorldPosition(this.tmp);
          if (ship.alive && ship.invulnerable <= 0 && this.inLane(ship, this.tmp.x, this.tmp.z, yaw, len + 10, 3.2)) ship.damage(28);
          this.state = 'beam';
          this.stateTime = 0;
        }
        break;
      }
      case 'beam':
        this.beamMat.opacity = Math.max(0, 0.9 - this.stateTime * 2.6);
        if (this.stateTime > 0.35) {
          this.beam.visible = false;
          this.toDrive();
        }
        break;
      case 'stomp':
        // Rears up, then slams down: the shockwave rolls out.
        this.root.position.y = p.y + Math.sin(Math.min(1, this.stateTime / 0.8) * Math.PI) * 1.5;
        if (this.stateTime > 0.8) {
          this.waveR = 2;
          this.waveHit = false;
          this.wave.visible = true;
          this.toDrive();
        }
        break;
      case 'barrage': {
        // Each side cannon still standing fires bombs at and around the ship.
        this.fireTimer -= dt;
        const live = this.cannons.filter((c) => c.alive);
        if (this.fireTimer <= 0 && this.shotsLeft > 0 && live.length > 0) {
          this.fireTimer = 0.3;
          this.shotsLeft--;
          const c = live[this.shotsLeft % live.length];
          const a = Math.random() * Math.PI * 2;
          const r = this.shotsLeft < 2 ? 0 : 8 + Math.random() * 14;
          this.tmp.copy(c.root.position);
          this.tmp.y += 2;
          mortars.fireAt(this.tmp, s.x + ship.velocity.x * 0.5 + Math.cos(a) * r, s.y, s.z + ship.velocity.y * 0.5 + Math.sin(a) * r, 10, 14);
        }
        if (this.shotsLeft <= 0 || live.length === 0) this.toDrive(1);
        break;
      }
    }
  }

  private startAttack(): void {
    const options = this.exposed ? (['aim', 'stomp'] as const) : (['barrage', 'aim', 'stomp'] as const);
    const pick = options[this.next++ % options.length];
    this.stateTime = 0;
    this.state = pick;
    if (pick === 'aim') {
      this.aimLock = this.phase2 ? 0.8 : 1.1;
      this.beamLane.visible = true;
    } else if (pick === 'barrage') {
      this.shotsLeft = 6;
      this.fireTimer = 0.4;
    }
  }

  private toDrive(wait?: number): void {
    this.state = 'drive';
    this.stateTime = 0;
    this.attackTimer = wait ?? (this.phase2 ? 1.6 : 2.4);
  }
}

// ---------------------------------------------------------------- Jungle Titan (rooted plant)

const POD_R = 13;
const POD_H = 11;

interface Slam {
  x: number;
  z: number;
  t: number;
  marker: THREE.Mesh;
  vine: THREE.Mesh;
  done: boolean;
}

interface Cloud {
  x: number;
  z: number;
  t: number;
  mesh: THREE.Mesh;
  tick: number;
}

export class JungleTitan extends Boss {
  readonly id = 'titan';
  readonly kind = 'ground';
  readonly radius = 7;
  readonly hitBottom = 0;
  readonly hitTop = 24;
  readonly aimHeight = 16;
  private readonly pods: BossPart[] = [];
  private openPod = 0;
  private podTimer = 0;
  private podDamage = 0;
  private state: 'idle' | 'slam' | 'spores' | 'seeds' = 'idle';
  private stateTime = 0;
  private fireTimer = 0;
  private spin = 0;
  private next = 0;
  private summonTimer = 10;
  private readonly slams: Slam[] = [];
  private readonly clouds: Cloud[] = [];
  private readonly petals: THREE.Object3D[] = [];
  private readonly bulb = glow('#ff6fb8', {}, 1.2);
  private readonly tmp = new THREE.Vector3();
  private readonly ringGeo = new THREE.RingGeometry(6.3, 7, 40);
  private readonly vineGeo = new THREE.CylinderGeometry(1.4, 2.4, 1, 8);
  private readonly vineMat = toon('#2f7a4e');
  private readonly cloudGeo = new THREE.SphereGeometry(9, 16, 10);
  private readonly cloudMat = glow('#b6ff5a', { transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }, 1);

  constructor(hpMul = 1) {
    super(1800 * hpMul);
    this.salvage = 150;
    this.weight = 0;
    this.dropChance = 0;
    // Gnarled trunk, a crown of petals and a glowing bulb.
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 6.5, 18, 10), this.mat('#3f5a2e'));
    trunk.position.y = 9;
    const crown = new THREE.Mesh(new THREE.SphereGeometry(5.5, 16, 12), this.mat('#6a2f63'));
    crown.position.y = 20;
    crown.scale.y = 0.8;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 12), this.bulb);
    bulb.position.y = 24;
    this.root.add(trunk, crown, bulb);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const petal = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), this.mat('#e5609c'));
      petal.scale.set(2.2, 0.4, 5.5);
      petal.position.set(Math.cos(a) * 6, 21, Math.sin(a) * 6);
      petal.rotation.y = -a + Math.PI / 2;
      petal.rotation.x = -0.4;
      this.petals.push(petal);
      this.root.add(petal);
    }
    // Roots spreading over the ground.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.6, 14, 6), this.mat('#3f5a2e', false));
      root.position.set(Math.cos(a) * 7, 1.2, Math.sin(a) * 7);
      root.rotation.set(Math.PI / 2 - 0.15, 0, -a + Math.PI / 2);
      root.rotation.order = 'YXZ';
      this.root.add(root);
    }
    addOutlines(this.root);
  }

  /** The trunk itself is too tough to hurt: only the open pod is a weak spot. */
  damage(_amount: number, _blast = false): void {}

  protected setupParts(ctx: Ctx): void {
    for (let i = 0; i < 3; i++) {
      const pod = new BossPart(1, 3.2, -3, 3.5, true);
      pod.shared = this;
      const shell = new THREE.Mesh(new THREE.SphereGeometry(3, 14, 10), pod.material('#6a2f63'));
      shell.scale.y = 1.2;
      const heart = new THREE.Mesh(new THREE.SphereGeometry(1.7, 12, 10), glow('#ffd36b', {}, 1.6));
      heart.name = 'heart';
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.2, POD_H, 6), pod.material('#3f5a2e', false));
      stalk.position.y = -POD_H / 2;
      pod.look.add(shell, heart, stalk);
      addOutlines(pod.look);
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
      pod.data = { angle: a, shell };
      this.pods.push(pod);
      this.addPart(ctx, pod);
      pod.root.position.set(this.root.position.x + Math.cos(a) * POD_R, this.root.position.y + POD_H, this.root.position.z + Math.sin(a) * POD_R);
    }
    this.setOpen(0);
  }

  /** Open one pod (the weak spot); the others close up. */
  private setOpen(i: number): void {
    this.openPod = i;
    this.podTimer = 9;
    this.podDamage = 0;
    for (const [k, pod] of this.pods.entries()) {
      const open = k === i;
      pod.shielded = !open;
      const shell = pod.data.shell as THREE.Mesh;
      shell.scale.set(open ? 0.75 : 1, open ? 0.6 : 1.2, open ? 0.75 : 1);
      shell.position.y = open ? -1.2 : 0;
    }
  }

  takeShared(amount: number, blast: boolean): void {
    super.takeShared(amount, blast);
    this.podDamage += amount;
    // A pod that's taken a beating snaps shut and another one opens.
    if (this.podDamage > this.maxHp * 0.12) this.setOpen((this.openPod + 1 + Math.floor(Math.random() * 2)) % 3);
  }

  protected think(ctx: Ctx): void {
    const { ship, world, dt, shots } = ctx;
    const p = this.root.position;
    const s = ship.root.position;
    const flyY = world.heightAt(s.x, s.z) + HOVER_HEIGHT;
    this.stateTime += dt;
    for (const [i, petal] of this.petals.entries()) petal.rotation.x = -0.4 + Math.sin(this.time * 1.5 + i) * 0.12;
    this.bulb.color.set('#ff6fb8').multiplyScalar(GLOW * (1 + Math.sin(this.time * 3) * 0.3));
    for (const [k, pod] of this.pods.entries()) {
      const heart = pod.look.getObjectByName('heart') as THREE.Mesh;
      const m = heart.material as THREE.MeshBasicMaterial;
      m.color.set(k === this.openPod ? '#ffd36b' : '#5a3a2a').multiplyScalar(GLOW * (k === this.openPod ? 1.4 + Math.sin(this.time * 6) * 0.4 : 0.5));
      pod.root.position.y = p.y + POD_H + Math.sin(this.time * 1.2 + k) * 0.4;
    }
    this.podTimer -= dt;
    if (this.podTimer <= 0) this.setOpen((this.openPod + 1) % 3);

    this.updateSlams(ship, world, dt);
    this.updateClouds(ship, dt);

    this.summonTimer -= dt;
    if (this.summonTimer <= 0) {
      this.summonTimer = this.phase2 ? 11 : 15;
      if (this.adds.length < (this.phase2 ? 9 : 5)) {
        for (let i = 0; i < 4; i++) this.summon(ctx, new Swarmer(1), 28);
        if (this.phase2 && !this.adds.some((a) => a.species === 'pulsar')) this.summon(ctx, new Pulsar(1), 40);
      }
    }

    switch (this.state) {
      case 'idle':
        this.attackTimer -= dt * (this.phase2 ? 1.4 : 1);
        if (this.attackTimer <= 0 && ship.alive) this.startAttack(ship, flyY);
        break;
      case 'slam':
      case 'spores':
        if (this.stateTime > 1.8) this.toIdle();
        break;
      case 'seeds': {
        // A spiral of seeds from the open pod.
        this.fireTimer -= dt;
        if (this.fireTimer <= 0) {
          this.fireTimer = 0.16;
          this.spin += 0.31;
          const pod = this.pods[this.openPod];
          this.tmp.copy(pod.root.position);
          const arms = this.phase2 ? 5 : 3;
          for (let i = 0; i < arms; i++) {
            const a = this.spin + (i / arms) * Math.PI * 2;
            shots.fire(this.tmp, Math.cos(a), Math.sin(a), 16, s.y, 8, 6, 5);
          }
        }
        if (this.stateTime > 3) this.toIdle();
        break;
      }
    }
  }

  private startAttack(ship: Ship, flyY: number): void {
    const order = ['slam', 'spores', 'seeds', 'slam'] as const;
    const pick = order[this.next++ % order.length];
    this.state = pick;
    this.stateTime = 0;
    const s = ship.root.position;
    if (pick === 'slam') {
      // Tentacles burst up under (and around) the ship.
      const n = this.phase2 ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = i === 0 ? 0 : 9 + Math.random() * 10;
        this.addSlam(s.x + ship.velocity.x * 0.5 + Math.cos(a) * r, s.z + ship.velocity.y * 0.5 + Math.sin(a) * r, flyY, i * 0.15);
      }
    } else if (pick === 'spores') {
      const n = this.phase2 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        this.addCloud(s.x + Math.cos(a) * (6 + i * 10), s.z + Math.sin(a) * (6 + i * 10), flyY);
      }
    } else if (pick === 'seeds') {
      this.fireTimer = 0.3;
    }
  }

  private toIdle(): void {
    this.state = 'idle';
    this.stateTime = 0;
    this.attackTimer = this.phase2 ? 1.5 : 2.3;
  }

  // Slams and clouds are drawn in the titan's own (unrotated) frame, so offsets are world offsets.
  private addSlam(x: number, z: number, flyY: number, delay: number): void {
    const p = this.root.position;
    const marker = new THREE.Mesh(this.ringGeo, warnMat());
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(x - p.x, flyY - p.y - 0.6, z - p.z);
    marker.userData.noOutline = true;
    const vine = new THREE.Mesh(this.vineGeo, this.vineMat);
    vine.visible = false;
    vine.position.set(x - p.x, 0, z - p.z);
    this.root.add(marker, vine);
    this.slams.push({ x, z, t: -delay, marker, vine, done: false });
  }

  private updateSlams(ship: Ship, world: { heightAt: (x: number, z: number) => number }, dt: number): void {
    const p = this.root.position;
    for (let i = this.slams.length - 1; i >= 0; i--) {
      const sl = this.slams[i];
      sl.t += dt;
      const warn = 1.3;
      (sl.marker.material as THREE.MeshBasicMaterial).opacity = sl.t < 0 ? 0 : 0.25 + 0.4 * Math.min(1, sl.t / warn);
      if (sl.t >= warn && !sl.done) {
        sl.done = true;
        // The vine bursts up from the ground through flying height.
        const ground = world.heightAt(sl.x, sl.z);
        const top = ship.root.position.y + 6;
        sl.vine.visible = true;
        sl.vine.scale.set(1, top - ground, 1);
        sl.vine.position.y = ground - p.y + (top - ground) / 2;
        const d = Math.hypot(ship.root.position.x - sl.x, ship.root.position.z - sl.z);
        if (ship.alive && ship.invulnerable <= 0 && d < 7 + ship.radius) ship.damage(20);
      }
      if (sl.t > warn + 0.6) {
        this.root.remove(sl.marker, sl.vine);
        (sl.marker.material as THREE.Material).dispose();
        this.slams.splice(i, 1);
      }
    }
  }

  private addCloud(x: number, z: number, flyY: number): void {
    const p = this.root.position;
    const mesh = new THREE.Mesh(this.cloudGeo, this.cloudMat);
    mesh.position.set(x - p.x, flyY - p.y, z - p.z);
    mesh.scale.setScalar(0.1);
    mesh.userData.noOutline = true;
    this.root.add(mesh);
    this.clouds.push({ x, z, t: 0, mesh, tick: 0 });
  }

  private updateClouds(ship: Ship, dt: number): void {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.t += dt;
      // Puff up over a second, linger, then fade.
      const grow = Math.min(1, c.t / 1);
      c.mesh.scale.setScalar(Math.max(0.1, grow * (1 + Math.sin(c.t * 2) * 0.05)));
      c.tick -= dt;
      const d = Math.hypot(ship.root.position.x - c.x, ship.root.position.z - c.z);
      if (grow >= 1 && c.tick <= 0 && d < 9 && ship.alive && ship.invulnerable <= 0) {
        c.tick = 0.5;
        ship.damage(4);
      }
      if (c.t > 8) {
        this.root.remove(c.mesh);
        this.clouds.splice(i, 1);
      }
    }
  }
}

export function createBoss(id: BossId, hpMul: number): Boss {
  if (id === 'tank') return new Juggernaut(hpMul);
  if (id === 'titan') return new JungleTitan(hpMul);
  return new Skyreaver(hpMul);
}
