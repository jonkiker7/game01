import * as THREE from 'three';
import type { Contract } from '../../base/Save';
import type { Enemy, EnemyManager } from '../Enemies';
import type { Hud } from '../Hud';
import { addOutlines, glow, toon } from '../materials';
import type { Blip } from '../Radar';
import { HOVER_HEIGHT, type Ship } from '../Ship';
import type { World } from '../World';

export const CONTRACT_COLOR = '#ff9a3c';
const PICKUP_RANGE = 7; // fly this close (on the map) to haul a cargo pod aboard
const ZONE = 11; // uplink zone radius
const UPLINK_TIME = 8; // seconds hovering in the zone to finish the upload

type Status = 'none' | 'waiting' | 'here' | 'done' | 'missed';

/**
 * The contract you took from the board, during a sortie: sets up its objective when you reach
 * its sector (a cargo pod, an alpha drone, or a relay beacon), tracks it, and reports the result.
 */
export class ContractTracker {
  contract: Contract | null = null;
  status: Status = 'none';
  private progress = 0;
  private readonly group = new THREE.Group();
  private readonly spot = new THREE.Vector3();
  private elite: Enemy | null = null;
  private beam: THREE.Mesh | null = null;
  private arc: THREE.Mesh | null = null;
  private arcShown = -1;
  private announce = 0;
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private readonly world: World,
    private readonly enemies: EnemyManager,
    private readonly hud: Hud,
  ) {
    scene.add(this.group);
  }

  /** A new sortie, with the contract you've taken (if any). */
  begin(contract: Contract | null): void {
    this.clearObjects();
    this.contract = contract;
    this.status = contract ? 'waiting' : 'none';
    this.progress = 0;
  }

  /** Entering a sector: if it's the contract's, set up the objective in this arena. */
  enterSector(sector: number, cx: number, cz: number, radius: number): void {
    const c = this.contract;
    if (!c || this.status !== 'waiting' || sector !== c.sector) return;
    this.status = 'here';
    this.progress = 0;
    this.announce = 2.9; // after the sector's own banner
    if (c.type === 'hunt') {
      this.elite = this.enemies.spawnElite();
      return;
    }
    // Somewhere away from the middle of the arena (where the towers cluster).
    const a = Math.random() * Math.PI * 2;
    const r = radius * (0.3 + Math.random() * 0.3);
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    const ground = this.world.heightAt(x, z);
    this.spot.set(x, ground, z);
    if (c.type === 'retrieve') this.buildPod(ground);
    else this.buildBeacon(ground);
  }

  /** Is the contract holding the encounter open? (The alpha must die before the sector is clear.) */
  get blocking(): boolean {
    return this.status === 'here' && this.contract?.type === 'hunt' && !!this.elite?.alive;
  }

  update(dt: number, ship: Ship): void {
    this.time += dt;
    if (this.announce > 0 && (this.announce -= dt) <= 0 && this.contract) this.hud.show(`◆ ${this.contract.goal}`, 2.6);
    if (this.status !== 'here' || !this.contract) return;
    const p = ship.root.position;
    const d = Math.hypot(p.x - this.spot.x, p.z - this.spot.z);
    if (this.beam) {
      const m = this.beam.material as THREE.MeshBasicMaterial;
      m.opacity = 0.25 + 0.12 * Math.sin(this.time * 4);
    }
    if (this.contract.type === 'retrieve') {
      if (ship.alive && d < PICKUP_RANGE) this.complete('CARGO SECURED');
    } else if (this.contract.type === 'uplink') {
      if (ship.alive && d < ZONE) {
        this.progress = Math.min(1, this.progress + dt / UPLINK_TIME);
        if (this.progress >= 1) this.complete('UPLINK COMPLETE');
      }
      this.drawArc();
    }
  }

  onKill(e: Enemy): void {
    if (e.elite && this.status === 'here' && e === this.elite) this.complete('ALPHA DESTROYED');
  }

  /** Leaving the sector (through a gate): an unfinished objective is missed for this sortie. */
  leaveSector(): void {
    if (this.status === 'here') this.status = 'missed';
    this.clearObjects();
  }

  /** The line under the objective on the HUD. */
  objectiveLine(sector: number): string | null {
    const c = this.contract;
    if (!c) return null;
    switch (this.status) {
      case 'waiting':
        return sector < c.sector ? `◆ CONTRACT: SECTOR ${c.sector}` : null;
      case 'here':
        if (c.type === 'uplink') return `◆ UPLINK ${Math.floor(this.progress * 100)}%`;
        return `◆ ${c.goal}`;
      case 'done':
        return '◆ CONTRACT DONE';
      case 'missed':
        return '◆ CONTRACT MISSED';
      default:
        return null;
    }
  }

  blip(out: Blip[]): void {
    if (this.status !== 'here' || !this.contract) return;
    if (this.contract.type === 'hunt') {
      if (this.elite?.alive) out.push({ x: this.elite.root.position.x, z: this.elite.root.position.z, kind: 'reward', color: CONTRACT_COLOR });
    } else out.push({ x: this.spot.x, z: this.spot.z, kind: 'reward', color: CONTRACT_COLOR });
  }

  /** For the end-of-sortie summary. */
  result(): { title: string; reward: number; done: boolean } | null {
    if (!this.contract) return null;
    return { title: this.contract.title, reward: this.contract.reward, done: this.status === 'done' };
  }

  private complete(message: string): void {
    this.status = 'done';
    this.hud.show(`◆ ${message}`, 2.4);
    this.hud.flashHeal();
    this.clearObjects();
  }

  // ---------------------------------------------------------------- objects in the world

  private clearObjects(): void {
    this.group.clear();
    this.beam = null;
    this.arc = null;
    this.arcShown = -1;
    this.elite = null;
  }

  /** A light beam from the ground up past flying height, so it's easy to spot. */
  private addBeam(ground: number): void {
    const h = HOVER_HEIGHT + 14;
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 2.2, h, 16, 1, true),
      glow(CONTRACT_COLOR, { transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }, 1.2),
    );
    this.beam.position.set(this.spot.x, ground + h / 2, this.spot.z);
    this.group.add(this.beam);
  }

  private buildPod(ground: number): void {
    const pod = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 2.6, 6, 14), toon('#e8dfcc'));
    shell.rotation.z = Math.PI / 2;
    shell.position.y = 1.6;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.8, 16), toon(CONTRACT_COLOR));
    band.rotation.z = Math.PI / 2;
    band.position.y = 1.6;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), glow(CONTRACT_COLOR, {}, 2));
    lamp.position.y = 3.3;
    pod.add(shell, band, lamp);
    pod.position.set(this.spot.x, ground, this.spot.z);
    pod.rotation.set(0.15, Math.random() * Math.PI, 0.2); // crash-landed at a tilt
    addOutlines(pod);
    this.group.add(pod);
    this.addBeam(ground);
  }

  private buildBeacon(ground: number): void {
    const beacon = new THREE.Group();
    const h = HOVER_HEIGHT - 8;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, h, 8), toon('#3a4260'));
    mast.position.y = h / 2;
    const dish = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), toon('#e8dfcc', { side: THREE.DoubleSide }));
    dish.position.y = h + 0.4;
    dish.rotation.x = Math.PI;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), glow(CONTRACT_COLOR, {}, 2));
    tip.position.y = h + 1.4;
    beacon.add(mast, dish, tip);
    beacon.position.set(this.spot.x, ground, this.spot.z);
    addOutlines(beacon);
    this.group.add(beacon);
    // The uplink zone, drawn at flying height.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ZONE - 0.5, ZONE, 64),
      glow(CONTRACT_COLOR, { transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }, 1.3),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(this.spot.x, ground + HOVER_HEIGHT - 1, this.spot.z);
    this.group.add(ring);
    this.addBeam(ground);
  }

  /** The upload's progress, as an arc filling around the zone. */
  private drawArc(): void {
    if (Math.abs(this.progress - this.arcShown) < 0.01) return;
    this.arcShown = this.progress;
    if (this.arc) {
      this.arc.geometry.dispose();
      this.group.remove(this.arc);
    }
    if (this.progress <= 0) return;
    this.arc = new THREE.Mesh(
      new THREE.RingGeometry(ZONE - 2.2, ZONE - 0.9, 64, 1, Math.PI / 2, -this.progress * Math.PI * 2),
      glow('#fff1c0', { transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }, 1.4),
    );
    this.arc.rotation.x = -Math.PI / 2;
    this.arc.position.set(this.spot.x, this.spot.y + HOVER_HEIGHT - 0.9, this.spot.z);
    this.group.add(this.arc);
  }
}
