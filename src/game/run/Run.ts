import * as THREE from 'three';
import type { EnemyManager } from '../Enemies';
import type { Hud } from '../Hud';
import type { Blip } from '../Radar';
import { HOVER_HEIGHT, type Ship } from '../Ship';
import { LANDING_PAD, OUTPOSTS, type World } from '../World';
import { type ArenaVisual, type Gate, REWARD_STYLE, type Reward } from './Arena';
import type { RunUI } from './RunUI';
import { defaultStats, PRIMARY_NAMES, rollUpgrades, rollWeapons, SECONDARY_NAMES, type Stats, type Upgrade, UPGRADES } from './Upgrades';

export const SECTORS = 7;
const ARENA_RADIUS = 110;
const SURVIVE_TIME = 40;
const SALVAGE_KEY = 'star-rotor-salvage';

type EncounterKind = 'outpost' | 'survive' | 'stronghold';
type Phase = 'fight' | 'reward' | 'choosing' | 'gates' | 'transition' | 'over';

const TITLES: Record<EncounterKind, string> = {
  outpost: 'DESTROY THE OUTPOST',
  survive: 'SURVIVE THE SWARM',
  stronghold: 'FINAL ASSAULT',
};

interface Deps {
  ship: Ship;
  enemies: EnemyManager;
  world: World;
  arena: ArenaVisual;
  ui: RunUI;
  hud: Hud;
  /** Clear bullets, enemy shots, missiles and pickups (between arenas). */
  clearField: () => void;
  /** Snap the camera to the ship after a teleport. */
  snapCamera: () => void;
  /** Pause / unpause the game world (upgrade screen). */
  setPaused: (paused: boolean) => void;
  /** Let go of all held buttons (whenever a full-screen menu opens or closes). */
  releaseInput: () => void;
  /** Reset per-run state kept outside the run (special charge, etc.). */
  resetRunState: () => void;
}

/**
 * One sortie: a chain of arena encounters ending in a stronghold. Clear an encounter, collect
 * its reward (an upgrade choice, repairs or salvage), then fly through one of the gates, each
 * showing the reward waiting at the end of the next encounter.
 */
export class Run {
  stats: Stats = defaultStats();
  sector = 1;
  phase: Phase = 'fight';
  kills = 0;
  salvage = 0;
  /** How many times each upgrade has been taken this run. */
  readonly levels = new Map<string, number>();
  private readonly takenNames: string[] = [];

  private kind: EncounterKind = 'outpost';
  private center = new THREE.Vector2();
  private timer = 0;
  private overTimer = 0;
  private won = false;
  private reward: Reward = 'upgrade';
  private gates: Gate[] = [];
  private readonly used = new Set<number>();
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly d: Deps) {}

  get arenaCenter(): THREE.Vector2 {
    return this.center;
  }

  get arenaRadius(): number {
    return ARENA_RADIUS;
  }

  /** Start a brand new sortie from the landing zone. */
  start(): void {
    const { ship, enemies, world } = this.d;
    this.stats = defaultStats();
    this.levels.clear();
    this.takenNames.length = 0;
    this.sector = 1;
    this.kills = 0;
    this.salvage = 0;
    this.won = false;
    this.used.clear();
    this.reward = 'upgrade';
    this.d.resetRunState();
    this.d.clearField();
    enemies.reset();
    this.d.arena.hideGates();
    this.d.arena.hideReward();
    ship.reset(world, LANDING_PAD.x, LANDING_PAD.z, this.stats);
    this.d.snapCamera();
    // The first arena is the outpost nearest the landing zone.
    this.enter(0);
  }

  /** Begin the encounter at OUTPOSTS[index] for the current sector. */
  private enter(index: number): void {
    const { enemies, arena, hud } = this.d;
    this.used.add(index);
    const [cx, cz] = OUTPOSTS[index];
    this.center.set(cx, cz);
    arena.setArena(cx, cz, ARENA_RADIUS, this.d.world.heightAt(cx, cz) + HOVER_HEIGHT);

    const s = this.sector;
    this.kind = s === SECTORS ? 'stronghold' : s === 1 ? 'outpost' : Math.random() < 0.6 ? 'outpost' : 'survive';
    const bounds = { x: cx, z: cz, r: ARENA_RADIUS };
    const hpMul = 1 + 0.15 * (s - 1);
    if (this.kind === 'outpost') {
      enemies.configure(bounds, hpMul, { max: 1 + Math.floor(s / 2), interval: Math.max(3.5, 7 - s * 0.4) });
      enemies.spawnTurrets(cx, cz, Math.min(3 + s, 9), 12, 44);
    } else if (this.kind === 'survive') {
      enemies.configure(bounds, hpMul, { max: 3 + Math.floor(s / 2), interval: 2.4 });
      enemies.spawnTurrets(cx, cz, 3, 14, 36);
      this.timer = SURVIVE_TIME;
    } else {
      enemies.configure(bounds, hpMul, { max: 4, interval: 4 });
      enemies.spawnTurrets(cx, cz, 6, 8, 20);
      enemies.spawnTurrets(cx, cz, 8, 32, 50);
    }
    this.phase = 'fight';
    hud.show(s === SECTORS ? `FINAL SECTOR · ${TITLES[this.kind]}` : `SECTOR ${s} · ${TITLES[this.kind]}`, 2.6);
  }

  /** Called when the player destroys an enemy. */
  onKill(kind: 'turret' | 'drone'): void {
    this.kills++;
    this.salvage += Math.round((kind === 'turret' ? 6 : 3) * this.stats.salvageMul);
  }

  /** Called when the ship is destroyed: the run is over. */
  onDeath(): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.won = false;
    this.overTimer = 2.5;
  }

  update(dt: number): void {
    const { ship, enemies, arena } = this.d;
    if (this.phase !== 'over' && this.phase !== 'transition') ship.confine(this.center.x, this.center.y, ARENA_RADIUS - 3);

    switch (this.phase) {
      case 'fight': {
        const done = this.kind === 'survive' ? (this.timer -= dt) <= 0 : enemies.turretsLeft === 0;
        if (done) this.clearEncounter();
        break;
      }
      case 'reward': {
        const p = ship.root.position;
        const r = arena.rewardPosition;
        if (ship.alive && Math.hypot(p.x - r.x, p.z - r.z) < 5) this.collectReward();
        break;
      }
      case 'gates': {
        const p = ship.root.position;
        const gate = this.gates.find((g) => Math.hypot(p.x - g.x, p.z - g.z) < 6);
        if (gate && ship.alive) this.takeGate(gate);
        break;
      }
      case 'over':
        this.overTimer -= dt;
        if (this.overTimer <= 0 && this.overTimer > -1) {
          this.overTimer = -10; // only once
          this.finish();
        }
        break;
    }
  }

  private clearEncounter(): void {
    const { enemies, hud } = this.d;
    enemies.stopDrones();
    enemies.destroyAll();
    if (this.sector === SECTORS) {
      hud.show('STRONGHOLD DESTROYED', 3);
      this.won = true;
      this.phase = 'over';
      this.overTimer = 2.5;
      return;
    }
    hud.show('SECTOR CLEARED', 2.2);
    // The reward floats in the middle of the arena at flying height.
    const y = this.d.ship.root.position.y;
    this.d.arena.showReward(this.reward, this.tmp.set(this.center.x, y, this.center.y));
    this.phase = 'reward';
  }

  private collectReward(): void {
    const { ship, hud, arena, ui } = this.d;
    arena.hideReward();
    if (this.reward === 'upgrade' || this.reward === 'weapon') {
      const isWeapon = this.reward === 'weapon';
      const options = isWeapon ? this.weaponOptions() : rollUpgrades(this.levels, this.stats);
      if (options.length > 0) {
        this.phase = 'choosing';
        this.d.setPaused(true);
        this.d.releaseInput();
        ui.chooseUpgrade(options, this.levels, (u) => {
          this.levels.set(u.id, (this.levels.get(u.id) ?? 0) + 1);
          this.takenNames.push(isWeapon ? `⚔ ${u.name}` : u.name);
          u.apply(this.stats);
          u.onTake?.({ heal: (n) => ship.heal(n) });
          // Keep current values sensible after stat changes.
          ship.armor = Math.min(ship.armor, this.stats.maxArmor);
          this.d.setPaused(false);
          this.d.releaseInput();
          hud.show(u.name.toUpperCase(), 1.6);
          this.openGates();
        }, isWeapon ? 'ARMORY · CHOOSE A WEAPON' : 'CHOOSE AN UPGRADE');
        return;
      }
    } else if (this.reward === 'repair') {
      ship.heal(this.stats.maxArmor * 0.4);
      hud.flashHeal();
      hud.show('HULL REPAIRED', 1.6);
    } else if (this.reward === 'salvage') {
      const amount = Math.round((50 + 10 * this.sector) * this.stats.salvageMul);
      this.salvage += amount;
      hud.show(`+${amount} SALVAGE`, 1.6);
    }
    this.openGates();
  }

  /** Armory options, with the card text saying which weapon each one replaces. */
  private weaponOptions(): Upgrade[] {
    return rollWeapons(this.stats).map((w) => {
      const primary = ['w-machinegun', 'w-scatter', 'w-rail'].includes(w.id);
      const current = primary ? PRIMARY_NAMES[this.stats.primary] : SECONDARY_NAMES[this.stats.secondary];
      return { ...w, text: `${w.text} Replaces your ${current}.` };
    });
  }

  /** Two gates on the far side of the arena, each showing the next encounter's reward. */
  private openGates(): void {
    const y = this.d.ship.root.position.y;
    const edge = ARENA_RADIUS - 24;
    if (this.sector + 1 === SECTORS) {
      this.gates = [{ x: this.center.x, z: this.center.y - edge, reward: 'final' }];
    } else {
      const pool: Reward[] = ['upgrade', 'upgrade', 'upgrade', 'weapon', 'salvage', 'repair'];
      const a = pool[Math.floor(Math.random() * pool.length)];
      let b = pool[Math.floor(Math.random() * pool.length)];
      while (b === a) b = pool[Math.floor(Math.random() * pool.length)];
      this.gates = [
        { x: this.center.x - 18, z: this.center.y - edge, reward: a },
        { x: this.center.x + 18, z: this.center.y - edge, reward: b },
      ];
    }
    this.d.arena.showGates(this.gates, y);
    this.phase = 'gates';
    this.d.hud.show('CHOOSE YOUR PATH', 2);
  }

  private takeGate(gate: Gate): void {
    this.phase = 'transition';
    this.reward = gate.reward;
    this.d.ui.fade(() => {
      const { arena, enemies, ship, world } = this.d;
      arena.hideGates();
      this.d.clearField();
      enemies.reset();
      this.sector++;
      // Next arena: one of the unused outposts closest to this one.
      const next = OUTPOSTS.map((o, i) => ({ i, d: Math.hypot(o[0] - this.center.x, o[1] - this.center.y) }))
        .filter((o) => !this.used.has(o.i))
        .sort((p, q) => p.d - q.d)
        .slice(0, 3);
      const pick = next[Math.floor(Math.random() * next.length)].i;
      const [cx, cz] = OUTPOSTS[pick];
      // Enter from the south edge of the new arena, facing north.
      ship.teleport(world, cx, cz + ARENA_RADIUS - 14);
      ship.invulnerable = Math.max(ship.invulnerable, 1.5);
      this.d.snapCamera();
      this.enter(pick);
    });
  }

  private finish(): void {
    this.d.releaseInput();
    let total = this.salvage;
    try {
      total += Number(localStorage.getItem(SALVAGE_KEY) ?? 0) || 0;
      localStorage.setItem(SALVAGE_KEY, String(total));
    } catch {
      /* private mode: salvage just isn't saved */
    }
    const cleared = this.won ? SECTORS : this.sector - 1;
    this.d.ui.showEnd(
      {
        won: this.won,
        sectorsCleared: cleared,
        totalSectors: SECTORS,
        kills: this.kills,
        salvage: this.salvage,
        totalSalvage: total,
        upgrades: this.takenNames,
      },
      () => this.start(),
    );
  }

  /** What the HUD should say under the radar. */
  objective(): string {
    const head = this.sector === SECTORS ? 'FINAL SECTOR' : `SECTOR ${this.sector}/${SECTORS}`;
    switch (this.phase) {
      case 'fight':
        if (this.kind === 'survive') return `${head}\nSURVIVE · ${Math.ceil(Math.max(0, this.timer))}s`;
        return `${head}\nDESTROY THE TOWERS · ${this.d.enemies.turretsLeft} LEFT`;
      case 'reward':
        return `${head}\nCOLLECT ${REWARD_STYLE[this.reward].label.slice(2)}`;
      case 'choosing':
        return `${head}\nCHOOSE AN UPGRADE`;
      case 'gates':
        return `${head}\nCHOOSE YOUR PATH`;
      default:
        return head;
    }
  }

  /** What the radar should mark right now. */
  blips(out: Blip[]): void {
    out.length = 0;
    if (this.phase === 'fight') {
      for (const e of this.d.enemies.enemies) {
        if (!e.alive) continue;
        if (e.kind === 'turret' || this.kind === 'survive') out.push({ x: e.root.position.x, z: e.root.position.z, kind: 'target' });
      }
    } else if (this.phase === 'reward') {
      const r = this.d.arena.rewardPosition;
      out.push({ x: r.x, z: r.z, kind: 'reward', color: REWARD_STYLE[this.reward].color });
    } else if (this.phase === 'gates') {
      for (const g of this.gates) out.push({ x: g.x, z: g.z, kind: 'reward', color: REWARD_STYLE[g.reward].color });
    }
  }
}

// Keep the full upgrade list reachable for debugging (?debug).
export const ALL_UPGRADES = UPGRADES;
