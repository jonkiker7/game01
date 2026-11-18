import * as THREE from 'three';
import type { Input } from './Input';
import { addOutlines, GLOW, glow, rimToon } from './materials';
import { approachAngle, clamp, damp } from './math';
import type { World } from './World';

// ---- Handling (tweak these to change how the ship feels) ----
const MAX_SPEED = 17; // units per second at full stick
const ACCEL = 3.2; // how quickly the ship reaches the stick's speed (higher = snappier)
const TURN_RATE = 6.5; // radians/second when turning to face the stick direction
const TURN_RATE_FIRING = 1.3; // slow turning while firing without aiming, so you can strafe
const AIM_TURN_RATE = 12; // the ship snaps quickly toward where you're aiming
const BOOST_SPEED = 44;
const BOOST_TIME = 0.28; // seconds of dash
export const BOOST_COOLDOWN = 1.4;
const BOOST_INVULNERABLE = 0.35; // dodge through enemy shots while dashing
export const HOVER_HEIGHT = 32.5; // well above the jungle canopy

// ---- Weapons ----
const GUN_SPEED = 0.85; // fly slightly slower while shooting
const CHARGE_TIME = 0.75; // seconds for a missile to reach full power
const CHARGING_SPEED = 0.5; // fly at half speed while charging a missile

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
  onHit?: (damage: number) => void;
  onDeath?: () => void;
  onRespawn?: () => void;

  private readonly tilt = new THREE.Group(); // pitch + bank
  private readonly rotor = new THREE.Group();
  private readonly rotorRing: THREE.Mesh;
  private readonly engineMat = glow('#6ff7ff');
  private readonly engines: THREE.Mesh[] = [];
  private readonly muzzles: THREE.Mesh[] = [];
  private readonly flashMats: THREE.MeshToonMaterial[] = [];
  private readonly shadow: THREE.Mesh;
  private pitch = 0;
  private roll = 0;
  private time = 0;
  private boostTimer = 0;
  private hitFlash = 0;
  private respawnTimer = 0;
  private muzzleFlash = 0;

  constructor(scene: THREE.Scene) {
    this.root.add(this.tilt);
    this.rotorRing = this.buildModel();
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
    return this.engines[index].getWorldPosition(out);
  }

  /** World position of gun barrel 0 or 1. */
  getMuzzle(index: number, out: THREE.Vector3): THREE.Vector3 {
    return this.muzzles[index].getWorldPosition(out);
  }

  /** Called by the gun each time a bullet leaves a barrel. */
  flashMuzzle(): void {
    this.muzzleFlash = 0.05;
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

    // --- Missile: hold to charge, drag from the button to aim, release to fire ---
    if (input.consumePress('missile') && !this.isCharging) {
      this.isCharging = true;
      this.charge = 0;
      this.aimHeading = this.heading;
    }
    if (this.isCharging) {
      const before = this.charge;
      this.charge = Math.min(1, this.charge + dt / CHARGE_TIME);
      if (before < 1 && this.charge >= 1) this.onFullCharge?.();
      const aim = input.getAim('missile');
      if (aim.x !== 0 || aim.y !== 0) this.aimHeading = Math.atan2(-aim.x, aim.y);
    }
    if (input.consumeRelease('missile') && this.isCharging) {
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
    this.rotor.rotation.y += dt * (16 + speed * 0.5);
    (this.rotorRing.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(this.time * 6) * 0.08;

    const boostGlow = this.isBoosting ? 1 : 0;
    this.engineMat.color.setRGB(0.44 + boostGlow * 0.56, 0.97, 1).multiplyScalar(GLOW * (1 + boostGlow * 0.6));
    for (const e of this.engines) e.scale.setScalar(damp(e.scale.x, 1 + boostGlow * 0.9, 12, dt));

    this.muzzleFlash -= dt;
    for (const m of this.muzzles) m.visible = this.muzzleFlash > 0;

    // Red flash when hit; blink while invulnerable after respawning.
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    const f = this.hitFlash / 0.18;
    for (const m of this.flashMats) m.emissive.setRGB(f * 0.9, f * 0.1, f * 0.15);
    this.tilt.visible = this.invulnerable > 0.4 ? Math.floor(this.time * 14) % 2 === 0 : true;

    this.shadow.position.set(p.x, ground + 0.15, p.z);
    this.shadow.rotation.y = this.heading;
  }

  private buildModel(): THREE.Mesh {
    // Warm gold rim light on the hero ship, like Hades' character lighting.
    const hull = rimToon('#efe2c4', '#ffd38a', 0.55);
    const accent = rimToon('#b8233a', '#ffb070', 0.6);
    const dark = rimToon('#3a2a3f', '#ffb070', 0.5);
    this.flashMats.push(hull, accent, dark);
    const t = this.tilt;

    // Body
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), hull);
    body.scale.set(0.95, 0.75, 1.7);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 2.4), accent);
    spine.position.set(0, 0.62, 0.2);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), glow('#7ff6ff'));
    canopy.scale.set(0.9, 0.7, 1.1);
    canopy.position.set(0, 0.28, -1.05);
    t.add(body, spine, canopy);

    // Tail
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.32, 2.6, 8), hull);
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, 0.2, 2.3);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.8), accent);
    fin.position.set(0, 0.7, 3.4);
    const stab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.45), accent);
    stab.position.set(0, 0.25, 3.3);
    const tailRing = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.06, 8, 20), glow('#6ff7ff'));
    tailRing.rotation.y = Math.PI / 2;
    tailRing.position.set(0, 0.35, 3.75);
    t.add(boom, fin, stab, tailRing);

    // Side engine pods + guns
    for (const s of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.55), dark);
      strut.position.set(s * 0.8, -0.05, 0.3);
      const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.3, 4, 10), accent);
      pod.rotation.x = Math.PI / 2;
      pod.position.set(s * 1.3, -0.1, 0.35);
      const engine = new THREE.Mesh(new THREE.CircleGeometry(0.26, 14), this.engineMat);
      engine.position.set(s * 1.3, -0.1, 1.33);
      this.engines.push(engine);

      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.0, 6), dark);
      gun.rotation.x = Math.PI / 2;
      gun.position.set(s * 0.38, -0.55, -1.25);
      const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), glow('#ffe27a'));
      muzzle.scale.set(1, 1, 2.2);
      muzzle.position.set(s * 0.38, -0.55, -2.0);
      muzzle.visible = false;
      this.muzzles.push(muzzle);
      t.add(strut, pod, engine, gun, muzzle);
    }

    // Rotor: mast, three spinning blades with glowing tips, and an energy ring
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 0.55, 10), dark);
    mast.position.y = 0.95;
    t.add(mast);

    this.rotor.position.y = 1.25;
    const bladeGeo = new THREE.BoxGeometry(0.3, 0.05, 3.3);
    bladeGeo.translate(0, 0, 1.65);
    const tipMat = glow('#6ff7ff');
    for (let i = 0; i < 3; i++) {
      const arm = new THREE.Group();
      arm.rotation.y = (i / 3) * Math.PI * 2;
      const blade = new THREE.Mesh(bladeGeo, hull);
      blade.userData.noOutline = true; // spinning blades look cleaner without ink
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), tipMat);
      tip.position.z = 3.3;
      arm.add(blade, tip);
      this.rotor.add(arm);
    }
    t.add(this.rotor);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.4, 0.05, 6, 48),
      glow('#6ff7ff', { transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.25;
    t.add(ring);
    return ring;
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
