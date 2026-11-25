import * as THREE from 'three';
import type { Contract } from '../../base/Save';
import { type Enemy, type EnemyManager, type Species, ZONE_SPECIES } from '../Enemies';
import { SPECIES_NAMES } from '../EnemyTypes';
import { type Boss, BOSS_NAMES, type BossId } from '../Bosses';
import type { Hud } from '../Hud';
import type { Blip } from '../Radar';
import type { Ship } from '../Ship';
import type { World } from '../World';
import { type ArenaShape, blobArena, corridorArena } from '../ArenaShape';
import type { ContractTracker } from './Contracts';
import { createMission, type Mission, type MissionDeps, MISSION_RADIUS, MISSION_TITLES, type MissionKind } from './Missions';
import { type ArenaVisual, type Gate, REWARD_STYLE, type Reward } from './Arena';
import type { RunUI } from './RunUI';
import { defaultStats, PRIMARY_NAMES, rollUpgrades, rollWeapons, SECONDARY_NAMES, type Stats, type Upgrade, UPGRADES } from './Upgrades';

/** Rounds per sortie, the last one being the boss (2 rounds, then the boss). */
export const SECTORS = 3;

/** How a sortie ended. */
export interface RunResult {
  won: boolean;
  sectorsCleared: number;
  totalSectors: number;
  kills: number;
  salvage: number;
  upgrades: string[];
  /** The contract you took, and whether you finished it. */
  contract: { title: string; reward: number; done: boolean } | null;
}
/** Arena size per encounter: tower hunts are big (fly around and find them), swarms are tight. */
const ARENA_RADIUS: Record<EncounterKind, number> = { outpost: 180, survive: 110, stronghold: 110, boss: 130, ...MISSION_RADIUS };
/** Escort runs left to right through a snaking corridor about one screen tall. */
const CORRIDOR = { length: 330, halfWidth: 44 };
const SURVIVE_TIME = 40;

type EncounterKind = 'outpost' | 'survive' | 'stronghold' | 'boss' | MissionKind;
/** Encounters the rounds before the boss can be. */
const ROUND_KINDS: EncounterKind[] = ['outpost', 'survive', 'rescue', 'defend', 'escort', 'sabotage', 'hold'];
type Phase = 'fight' | 'failed' | 'reward' | 'choosing' | 'gates' | 'transition' | 'over';

const TITLES: Record<EncounterKind, string> = {
  outpost: 'DESTROY THE OUTPOST',
  survive: 'SURVIVE THE SWARM',
  stronghold: 'FINAL ASSAULT',
  boss: 'BOSS',
  ...MISSION_TITLES,
};

interface Deps {
  scene: THREE.Scene;
  effects: MissionDeps['effects'];
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
  /** Starting stats for a sortie (defaults plus permanent upgrades from home base). */
  baseStats: () => Stats;
  /** The contract taken from the board (tracked during the sortie). */
  contracts: ContractTracker;
  activeContract: () => Contract | null;
  /** The run is over (won or shot down): bank salvage and show the summary. */
  onFinish: (summary: RunResult) => void;
}

/**
 * One sortie: a chain of arena encounters ending in a boss fight. Clear an encounter, collect
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
  /** Last round's type (so the next one is different). */
  private lastRoundKind: EncounterKind | null = null;
  /** This zone's two enemy types. */
  pair: Species[] = [];
  /** The boss, during the final round. */
  boss: Boss | null = null;
  /** The current round's mission (rescue, defend, …), if it's one of those. */
  mission: Mission | null = null;
  private radius = ARENA_RADIUS.outpost;
  private center = new THREE.Vector2();
  /** This round's arena shape (a fresh level every round). */
  shape: ArenaShape = blobArena(150, 1);
  /** The sortie's level seed (`?seed=` to replay one); each round adds its sector number. */
  seed = 1;
  private timer = 0;
  private overTimer = 0;
  private failTimer = 0;
  private won = false;
  private reward: Reward = 'upgrade';
  private gates: Gate[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly d: Deps) {}

  get arenaCenter(): THREE.Vector2 {
    return this.center;
  }

  get arenaRadius(): number {
    return this.radius;
  }

  /** Start a brand new sortie from the landing zone. */
  start(): void {
    const { ship, enemies, world } = this.d;
    this.stats = this.d.baseStats();
    this.levels.clear();
    this.takenNames.length = 0;
    this.sector = 1;
    this.lastRoundKind = null;
    this.kills = 0;
    this.salvage = 0;
    this.won = false;
    this.reward = 'upgrade';
    const fixed = Number(new URLSearchParams(location.search).get('seed'));
    this.seed = Number.isFinite(fixed) && fixed > 0 ? Math.floor(fixed) : 1 + Math.floor(Math.random() * 99999);
    this.d.resetRunState();
    this.d.clearField();
    enemies.reset();
    this.d.contracts.begin(this.d.activeContract());
    this.endMission();
    this.d.arena.hideGates();
    this.d.arena.hideReward();
    // `?boss=flyer|tank|titan` (or `?boss`) skips straight to a boss fight, for testing.
    if (new URLSearchParams(location.search).has('boss')) this.sector = SECTORS;
    this.kind = this.pickKind();
    this.buildArena();
    ship.reset(world, this.shape.entry.x, this.shape.entry.z, this.stats);
    this.d.snapCamera();
    this.enter();
  }

  /** Generate this round's level: an organic arena shaped for the mission, fresh terrain. */
  private buildArena(): void {
    const seed = this.seed * 10 + this.sector;
    this.shape =
      this.kind === 'escort'
        ? corridorArena(CORRIDOR.length, CORRIDOR.halfWidth, seed)
        : blobArena(ARENA_RADIUS[this.kind] * 0.92, seed);
    this.d.world.generate(this.shape, seed);
    this.center.set(this.shape.center.x, this.shape.center.z);
    this.radius = this.shape.radius;
  }

  /**
   * Where the camera should look. In the corridor it leans toward the corridor's middle, so
   * both edges (and the fade beyond them) stay in view.
   */
  cameraTarget(ship: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    out.copy(ship);
    const cz = this.shape.centreZ?.(ship.x);
    if (cz !== undefined) out.z = ship.z * 0.75 + cz * 0.25;
    return out;
  }

  /** Keep the ship inside the arena's (organic) edge: a soft wall. */
  private confineShip(): void {
    const { ship } = this.d;
    const p = ship.root.position;
    const margin = 3;
    const d = this.shape.depth(p.x, p.z);
    if (d >= margin) return;
    const e = 1;
    let gx = this.shape.depth(p.x + e, p.z) - this.shape.depth(p.x - e, p.z);
    let gz = this.shape.depth(p.x, p.z + e) - this.shape.depth(p.x, p.z - e);
    const g = Math.hypot(gx, gz) || 1;
    gx /= g;
    gz /= g;
    p.x += gx * (margin - d);
    p.z += gz * (margin - d);
    const into = ship.velocity.x * gx + ship.velocity.y * gz; // < 0 = heading out
    if (into < 0) {
      ship.velocity.x -= gx * into;
      ship.velocity.y -= gz * into;
    }
  }

  /** Begin this round's encounter in the freshly built arena. */
  private enter(): void {
    const { enemies, hud } = this.d;
    const cx = this.center.x;
    const cz = this.center.y;
    const R = this.radius;
    const s = this.sector;
    const shape = this.shape;
    const bounds = { x: cx, z: cz, r: R, inside: (x: number, z: number, m: number) => shape.depth(x, z) > m };
    const hpMul = 1 + 0.15 * (s - 1);
    const types = (this.pair = this.kind === 'boss' ? [] : this.pickPair());
    this.boss = null;
    if (this.kind === 'boss') {
      // No waves: the boss calls in its own helpers.
      enemies.configure(bounds, hpMul, null);
      this.boss = enemies.spawnBoss(this.pickBoss(), cx, cz);
    } else if (this.kind in MISSION_TITLES) {
      // Missions: their own objective, with lighter waves of the zone's pair.
      enemies.configure(bounds, hpMul, { types, max: 2 + Math.floor(s / 2), interval: 4.5 });
      const { scene, world, enemies: em, hud: h, ship, effects } = this.d;
      this.mission = createMission(this.kind as MissionKind, { scene, effects, world, enemies: em, hud: h, ship });
      this.mission.begin(cx, cz, R, hpMul);
    } else if (this.kind === 'outpost') {
      enemies.configure(bounds, hpMul, { types, max: 2 + Math.floor(s / 2), interval: Math.max(3.5, 7 - s * 0.4) });
      // Spread across the big arena: you have to hunt them down (the radar points the way).
      enemies.spawnTurrets(cx, cz, Math.min(4 + s, 9), 30, R - 25);
    } else if (this.kind === 'survive') {
      enemies.configure(bounds, hpMul, { types, max: 3 + Math.floor(s / 2), interval: 2.4 });
      enemies.spawnTurrets(cx, cz, 3, 14, 36);
      this.timer = SURVIVE_TIME;
    } else {
      enemies.configure(bounds, hpMul, { types, max: 4, interval: 4 });
      enemies.spawnTurrets(cx, cz, 6, 8, 20);
      enemies.spawnTurrets(cx, cz, 8, 32, 50);
    }
    this.d.contracts.enterSector(s, cx, cz, R);
    this.phase = 'fight';
    hud.show(this.boss ? `BOSS · ${this.boss.name}` : `SECTOR ${s} · ${TITLES[this.kind]}`, 2.6);
  }

  /**
   * Two enemy types for this zone, at random (towers don't count: they're the objective).
   * For testing, `?enemies=swarmer,sniper` in the URL forces a pair (or a single type).
   */
  private pickPair(): Species[] {
    const forced = new URLSearchParams(location.search).get('enemies');
    if (forced) {
      const list = forced.split(',').filter((x): x is Species => ZONE_SPECIES.includes(x as Species));
      if (list.length > 0) return list;
    }
    const pool = [...ZONE_SPECIES];
    const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const b = pool[Math.floor(Math.random() * pool.length)];
    return [a, b];
  }

  /** A random round type, never the same as the previous round's. */
  private randomRoundKind(): EncounterKind {
    const options = ROUND_KINDS.filter((k) => k !== this.lastRoundKind);
    const kind = options[Math.floor(Math.random() * options.length)];
    this.lastRoundKind = kind;
    return kind;
  }

  /** Which boss: `?boss=flyer|tank|titan` for testing, otherwise one at random. */
  private pickBoss(): BossId {
    const forced = new URLSearchParams(location.search).get('boss') as BossId | null;
    if (forced && forced in BOSS_NAMES) return forced;
    const ids = Object.keys(BOSS_NAMES) as BossId[];
    return ids[Math.floor(Math.random() * ids.length)];
  }

  /** What the next encounter will be (sets the arena size too). */
  private pickKind(): EncounterKind {
    const s = this.sector;
    const forced = new URLSearchParams(location.search).get('mission') as EncounterKind | null;
    const kind: EncounterKind =
      s === SECTORS
        ? 'boss'
        : forced && ROUND_KINDS.includes(forced)
          ? forced
          : this.randomRoundKind();
    this.radius = ARENA_RADIUS[kind];
    return kind;
  }

  /** Called when the player destroys an enemy. */
  onKill(_kind: Enemy['kind'], enemy: Enemy): void {
    this.kills++;
    this.d.contracts.onKill(enemy);
    this.salvage += Math.round(enemy.salvage * this.stats.salvageMul);
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
    if (this.phase !== 'over' && this.phase !== 'transition') this.confineShip();
    if (this.phase !== 'transition') this.d.contracts.update(dt, ship);
    // Health bar across the top: the boss, or what a mission has you protecting.
    const guard = this.phase === 'fight' ? this.mission?.healthBar() : null;
    if (this.boss && this.boss.alive && this.phase === 'fight') this.d.hud.setBoss(this.boss.name, this.boss.healthFraction);
    else if (guard) this.d.hud.setBoss(guard.name, guard.fraction);
    else this.d.hud.setBoss(null);

    switch (this.phase) {
      case 'fight': {
        if (this.mission) {
          this.mission.update(dt);
          if (this.mission.failed) {
            this.failEncounter();
            break;
          }
        }
        const done = this.boss
          ? !this.boss.alive
          : this.mission
            ? this.mission.done
            : this.kind === 'survive'
            ? (this.timer -= dt) <= 0
            : enemies.turretsLeft === 0;
        if (done && !this.d.contracts.blocking) this.clearEncounter();
        break;
      }
      case 'failed':
        this.failTimer -= dt;
        if (this.failTimer <= 0) {
          this.openGates();
          this.d.hud.show('NO REWARD · CHOOSE YOUR PATH', 2.2);
        }
        break;
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
      hud.show(this.boss ? `${this.boss.name} DESTROYED` : 'STRONGHOLD DESTROYED', 3);
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

  /** A mission was failed (generator or convoy destroyed): no reward, straight to the gates. */
  /**
   * A mission was failed (generator or convoy destroyed): it blows up, a red banner holds for
   * a few seconds, no reward orb appears, and then the gates open.
   */
  private failEncounter(): void {
    const { enemies, hud } = this.d;
    enemies.stopDrones();
    enemies.destroyAll();
    this.mission?.onFail();
    hud.show(this.mission?.failText ?? 'OBJECTIVE FAILED', 3.4);
    hud.flashDamage();
    this.phase = 'failed';
    this.failTimer = 3.6;
  }

  private endMission(): void {
    this.mission?.cleanup();
    this.mission = null;
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
    const [g1, g2] = this.shape.exits;
    if (this.sector + 1 === SECTORS) {
      this.gates = [{ x: (g1.x + g2.x) / 2, z: (g1.z + g2.z) / 2, reward: 'final' }];
    } else {
      const pool: Reward[] = ['upgrade', 'upgrade', 'upgrade', 'weapon', 'salvage', 'repair'];
      const a = pool[Math.floor(Math.random() * pool.length)];
      let b = pool[Math.floor(Math.random() * pool.length)];
      while (b === a) b = pool[Math.floor(Math.random() * pool.length)];
      this.gates = [
        { x: g1.x, z: g1.z, reward: a },
        { x: g2.x, z: g2.z, reward: b },
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
      this.endMission();
      this.d.contracts.leaveSector();
      this.d.clearField();
      enemies.reset();
      this.sector++;
      // A brand new level for the next round, built behind the fade.
      this.kind = this.pickKind();
      this.buildArena();
      ship.teleport(world, this.shape.entry.x, this.shape.entry.z);
      ship.invulnerable = Math.max(ship.invulnerable, 1.5);
      this.d.snapCamera();
      this.enter();
    });
  }

  private finish(): void {
    this.d.releaseInput();
    this.d.onFinish({
      won: this.won,
      sectorsCleared: this.won ? SECTORS : this.sector - 1,
      totalSectors: SECTORS,
      kills: this.kills,
      salvage: this.salvage,
      upgrades: [...this.takenNames],
      contract: this.d.contracts.result(),
    });
  }

  /** What the HUD should say under the radar. */
  objective(): string {
    const line = this.d.contracts.objectiveLine(this.sector);
    let text = this.baseObjective();
    if (this.phase === 'fight' && this.pair.length) text += `\nVS ${this.pair.map((p) => SPECIES_NAMES[p]).join(' + ')}`;
    return line && this.phase !== 'over' ? `${text}\n${line}` : text;
  }

  private baseObjective(): string {
    const head = this.sector === SECTORS ? 'FINAL SECTOR' : `SECTOR ${this.sector}/${SECTORS}`;
    switch (this.phase) {
      case 'fight':
        if (this.boss) return `${head}\n${this.boss.objectiveLine()}`;
        if (this.mission) return `${head}\n${this.mission.objective()}`;
        if (this.kind === 'survive') {
          if (this.timer <= 0 && this.d.contracts.blocking) return `${head}\nDESTROY THE ALPHA`;
          return `${head}\nSURVIVE · ${Math.ceil(Math.max(0, this.timer))}s`;
        }
        if (this.d.enemies.turretsLeft === 0 && this.d.contracts.blocking) return `${head}\nDESTROY THE ALPHA`;
        return `${head}\nDESTROY THE TOWERS · ${this.d.enemies.turretsLeft} LEFT`;
      case 'reward':
        return `${head}\nCOLLECT ${REWARD_STYLE[this.reward].label.slice(2)}`;
      case 'choosing':
        return `${head}\nCHOOSE AN UPGRADE`;
      case 'gates':
        return `${head}\nCHOOSE YOUR PATH`;
      case 'failed':
        return `${head}\nMISSION FAILED`;
      default:
        return head;
    }
  }

  /** What the radar should mark right now. */
  blips(out: Blip[]): void {
    out.length = 0;
    if (this.phase === 'fight' && this.boss) {
      if (this.boss.alive) this.boss.blips(out);
    } else if (this.phase === 'fight' && this.mission) {
      this.mission.blips(out);
    } else if (this.phase === 'fight') {
      for (const e of this.d.enemies.enemies) {
        if (!e.alive) continue;
        if (!e.elite && e.species !== 'mine' && (e.kind === 'turret' || this.kind === 'survive')) out.push({ x: e.root.position.x, z: e.root.position.z, kind: 'target' });
      }
    } else if (this.phase === 'reward') {
      const r = this.d.arena.rewardPosition;
      out.push({ x: r.x, z: r.z, kind: 'reward', color: REWARD_STYLE[this.reward].color });
    } else if (this.phase === 'gates') {
      for (const g of this.gates) out.push({ x: g.x, z: g.z, kind: 'reward', color: REWARD_STYLE[g.reward].color });
    }
    if (this.phase !== 'over' && this.phase !== 'transition') this.d.contracts.blip(out);
  }
}

// Keep the full upgrade list reachable for debugging (?debug).
export const ALL_UPGRADES = UPGRADES;
