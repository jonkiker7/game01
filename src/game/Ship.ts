import * as THREE from 'three';
import type { Input } from './Input';
import { addOutlines, GLOW, glow } from './materials';
import { approachAngle, clamp, damp } from './math';
import { buildShipDesign, type ShipDesignId, type ShipParts } from './ShipDesigns';
import type { World } from './World';

// ---- Handling (tweak these to change how the ship feels) ----
const MAX_SPEED = 26; // units per second at full stick
const ACCEL = 3.6; // how quickly the ship reaches the stick's speed (higher = snappier)
const TURN_RATE = 6.5; // radians/second when turning to face the stick direction
const TURN_RATE_FIRING = 1.3; // slow turning while firing without aiming, so you can strafe
const AIM_TURN_RATE = 12; // the ship snaps quickly toward where you're aiming
const BOOST_SPEED = 80;
const BOOST_TIME = 0.38; // seconds of dash
export const BOOST_COOLDOWN = 1.3;
const BOOST_INVULNERABLE = 0.45; // dodge through enemy shots while dashing
export const HOVER_HEIGHT = 32.5; // well above the jungle canopy

// ---- Weapons ----
const GUN_SPEED = 0.85; // fly slightly slower while shooting
const CHARGE_TIME = 0.75; // seconds for a missile to reach full power
const CHARGING_SPEED = 0.5; // fly at half speed while charging a missile
export const MISSILE_MAX = 3; // missiles you can hold
export const MISSILE_RECHARGE = 5; // seconds to get one missile back (they refill one at a time)

// ---- Armor ----
export const MAX_ARMOR = 100;
const RESPAWN_TIME = 2.5;
const RESPAWN_INVULNERABLE = 2;

/**
 * The player's space helicopter. Built from simple shapes for now; it can be
 * swapped for a Blender model later without changing the flight code.
 *
 * Facing: the model points down -Z when heading = 0.
 */
export class Ship {
  readonly root = new THREE.Group(); // position + heading
  readonly velocity = new THREE.Vector2(); // (x, z) world units/second
  heading = 0;
  boostCooldown = 0;

  readonly radius = 1.7;
  readonly hitBottom = -2;
  readonly hitTop = 2;
  readonly aimHeight = 0;
  armor = MAX_ARMOR;
  alive = true;
  invulnerable = 0;

  /** True while GUN is held and the ship is alive. */
  isFiring = false;
  /** Missile charge 0..1 while MSL is held. */
  charge = 0;
  isCharging = false;
  /** Direction the missile will fire (same convention as `heading`). */
  aimHeading = 0;

  onBoost?: () => void;
  onFullCharge?: () => void;
  onMissile?: (charge: number, heading: number) => void;
  /** Pressed MSL with no missiles left. */
  onMissileEmpty?: () => void;

  /** Missiles ready to fire (0..MISSILE_MAX), and progress (0..1) on the next one recharging. */
  missiles = MISSILE_MAX;
  missileRecharge = 0;
  onHit?: (damage: number) => void;
  onDeath?: () => void;
  onRespawn?: () => void;

  private readonly tilt = new THREE.Group(); // pitch + bank
  private readonly parts: ShipParts;
  private readonly engineMat = glow('#6ff7ff');
  private readonly shadow: THREE.Mesh;
  private pitch = 0;
  private roll = 0;
  private time = 0;
  private boostTimer = 0;
  private hitFlash = 0;
  private respawnTimer = 0;
  private muzzleFlash = 0;

  constructor(scene: THREE.Scene, design: ShipDesignId = 'b') {
    this.root.add(this.tilt);
    this.parts = buildShipDesign(design, this.tilt, this.engineMat);
    addOutlines(this.tilt);
    this.root.scale.setScalar(0.85);
    this.shadow = this.buildShadow();
    scene.add(this.root, this.shadow);
  }

  get isBoosting(): boolean {
    return this.boostTimer > 0;
  }

  /** World position of engine 0 or 1 (for the boost trail). */
  getEngine(index: number, out: THREE.Vector3): THREE.Vector3 {
    return this.parts.engines[index].getWorldPosition(out);
  }

  /** World position of gun barrel 0 or 1. */
  getMuzzle(index: number, out: THREE.Vector3): THREE.Vector3 {
    return this.parts.muzzles[index].getWorldPosition(out);
  }

  /** Called by the gun each time a bullet leaves a barrel. */
  flashMuzzle(): void {
    this.muzzleFlash = 0.05;
  }

  /** Restore armor (healing pickups). */
  heal(amount: number): void {
    if (!this.alive) return;
    this.armor = Math.min(MAX_ARMOR, this.armor + amount);
  }

  damage(amount: number): void {
    if (!this.alive || this.invulnerable > 0) return;
    this.armor = Math.max(0, this.armor - amount);
    this.hitFlash = 0.18;
    this.onHit?.(amount);
    if (this.armor <= 0) {
      this.alive = false;
      this.isFiring = false;
      this.isCharging = false;
      this.charge = 0;
      this.root.visible = false;
      this.shadow.visible = false;
      this.velocity.set(0, 0);
      this.respawnTimer = RESPAWN_TIME;
      this.onDeath?.();
    }
  }

  update(dt: number, input: Input, world: World): void {
    this.time += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);

    if (!this.alive) {
      // Drain button events so nothing fires the instant we respawn.
      input.consumePress('missile');
      input.consumePress('boost');
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn(world);
      return;
    }

    const move = input.getMove();
    // Screen up = world -Z, screen right = world +X (camera looks from the south).
    const dirX = move.x;
    const dirZ = -move.y;
    const mag = Math.hypot(dirX, dirZ);

    // --- Boost: a short dash toward the stick (or straight ahead if centered) ---
    this.boostCooldown = Math.max(0, this.boostCooldown - dt);
    if (input.consumePress('boost') && this.boostCooldown <= 0) {
      let bx = -Math.sin(this.heading);
      let bz = -Math.cos(this.heading);
      if (mag > 0.2) {
        bx = dirX / mag;
        bz = dirZ / mag;
      }
      this.velocity.set(bx * BOOST_SPEED, bz * BOOST_SPEED);
      this.boostTimer = BOOST_TIME;
      this.boostCooldown = BOOST_COOLDOWN;
      this.invulnerable = Math.max(this.invulnerable, BOOST_INVULNERABLE);
      this.onBoost?.();
    }

    // --- Missile ammo: refills one at a time, each taking MISSILE_RECHARGE seconds ---
    if (this.missiles < MISSILE_MAX) {
      this.missileRecharge += dt / MISSILE_RECHARGE;
      if (this.missileRecharge >= 1) {
        this.missiles++;
        this.missileRecharge = this.missiles < MISSILE_MAX ? this.missileRecharge - 1 : 0;
      }
    }

    // --- Missile: hold to charge, drag from the button to aim, release to fire ---
    if (input.consumePress('missile') && !this.isCharging) {
      if (this.missiles > 0) {
        this.isCharging = true;
        this.charge = 0;
        this.aimHeading = this.heading;
      } else {
        this.onMissileEmpty?.();
      }
    }
    if (this.isCharging) {
      const before = this.charge;
      this.charge = Math.min(1, this.charge + dt / CHARGE_TIME);
      if (before < 1 && this.charge >= 1) this.onFullCharge?.();
      const aim = input.getAim('missile');
      if (aim.x !== 0 || aim.y !== 0) this.aimHeading = Math.atan2(-aim.x, aim.y);
    }
    if (input.consumeRelease('missile') && this.isCharging) {
      this.missiles--;
      this.onMissile?.(this.charge, this.aimHeading);
      this.isCharging = false;
      this.charge = 0;
    }

    // --- Gun: hold to fire; drag from the button to aim (twin-stick) ---
    this.isFiring = input.isHeld('gun');
    const gunAim = input.getAim('gun');
    const gunAiming = this.isFiring && (gunAim.x !== 0 || gunAim.y !== 0);

    // --- Velocity: ease toward where the stick is pointing (gives helicopter momentum) ---
    const speedScale = this.isCharging ? CHARGING_SPEED : this.isFiring ? GUN_SPEED : 1;
    if (this.boostTimer > 0) {
      this.boostTimer -= dt;
      this.velocity.multiplyScalar(Math.exp(-1.5 * dt));
    } else {
      const k = 1 - Math.exp(-ACCEL * dt);
      this.velocity.x += (dirX * MAX_SPEED * speedScale - this.velocity.x) * k;
      this.velocity.y += (dirZ * MAX_SPEED * speedScale - this.velocity.y) * k;
    }

    // --- Heading: missile aim > gun aim > stick direction ---
    if (this.isCharging) {
      this.heading = approachAngle(this.heading, this.aimHeading, AIM_TURN_RATE * dt);
    } else if (gunAiming) {
      this.heading = approachAngle(this.heading, Math.atan2(-gunAim.x, gunAim.y), AIM_TURN_RATE * dt);
    } else if (mag > 0.15) {
      const target = Math.atan2(-dirX, -dirZ);
      this.heading = approachAngle(this.heading, target, (this.isFiring ? TURN_RATE_FIRING : TURN_RATE) * dt);
    }

    // --- Position, kept inside the map ---
    const p = this.root.position;
    p.x += this.velocity.x * dt;
    p.z += this.velocity.y * dt;
    const limit = world.halfSize - 4;
    if (Math.abs(p.x) > limit) {
      p.x = clamp(p.x, -limit, limit);
      this.velocity.x = 0;
    }
    if (Math.abs(p.z) > limit) {
      p.z = clamp(p.z, -limit, limit);
      this.velocity.y = 0;
    }
    const ground = world.heightAt(p.x, p.z);
    p.y = damp(p.y, ground + HOVER_HEIGHT + Math.sin(this.time * 2.1) * 0.18, 6, dt);
    this.root.rotation.y = this.heading;

    // --- Tilt: nose dips when flying forward, banks when sliding sideways ---
    const fx = -Math.sin(this.heading);
    const fz = -Math.cos(this.heading);
    const forwardSpeed = this.velocity.x * fx + this.velocity.y * fz;
    const sideSpeed = this.velocity.x * -fz + this.velocity.y * fx;
    this.pitch = damp(this.pitch, clamp(-forwardSpeed * 0.022, -0.55, 0.55), 6, dt);
    this.roll = damp(this.roll, clamp(-sideSpeed * 0.03, -0.6, 0.6), 6, dt);
    this.tilt.rotation.set(this.pitch, 0, this.roll);

    this.updateVisuals(dt, ground);
  }

  private respawn(world: World): void {
    this.alive = true;
    this.armor = MAX_ARMOR;
    this.missiles = MISSILE_MAX;
    this.missileRecharge = 0;
    this.invulnerable = RESPAWN_INVULNERABLE;
    this.velocity.set(0, 0);
    this.heading = 0;
    this.root.position.set(0, world.heightAt(0, 0) + HOVER_HEIGHT, 0);
    this.root.visible = true;
    this.shadow.visible = true;
    this.onRespawn?.();
  }

  private updateVisuals(dt: number, ground: number): void {
    const p = this.root.position;
    const speed = this.velocity.length();
    for (const s of this.parts.spinners) s.obj.rotation.y += s.dir * dt * (16 + speed * 0.5);
    for (const m of this.parts.pulses) m.opacity = 0.22 + Math.sin(this.time * 6) * 0.07;

    const boostGlow = this.isBoosting ? 1 : 0;
    this.engineMat.color.setRGB(0.44 + boostGlow * 0.56, 0.97, 1).multiplyScalar(GLOW * (1 + boostGlow * 0.6));
    for (const e of this.parts.engines) e.scale.setScalar(damp(e.scale.x, 1 + boostGlow * 0.9, 12, dt));

    this.muzzleFlash -= dt;
    for (const m of this.parts.muzzles) m.visible = this.muzzleFlash > 0;

    // Red flash when hit; blink while invulnerable after respawning.
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    const f = this.hitFlash / 0.18;
    for (const m of this.parts.flashMats) m.emissive.setRGB(f * 0.9, f * 0.1, f * 0.15);
    this.tilt.visible = this.invulnerable > 0.4 ? Math.floor(this.time * 14) % 2 === 0 : true;

    this.shadow.position.set(p.x, ground + 0.15, p.z);
    this.shadow.rotation.y = this.heading;
  }

  /** A soft dark blob under the ship (cheap, and it helps you judge position). */
  private buildShadow(): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(10,0,25,0.7)');
    grad.addColorStop(0.55, 'rgba(10,0,25,0.45)');
    grad.addColorStop(1, 'rgba(10,0,15,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
    );
    mesh.geometry.rotateX(-Math.PI / 2);
    mesh.scale.set(6, 1, 7.5);
    mesh.renderOrder = 1;
    return mesh;
  }
}
