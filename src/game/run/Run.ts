import * as THREE from 'three';
import type { Contract } from '../../base/Save';
import { type Enemy, type EnemyManager, type Species, ZONE_SPECIES } from '../Enemies';
import { SPECIES_NAMES } from '../EnemyTypes';
import { type Boss, BOSS_NAMES, type BossId } from '../Bosses';
import type { Hud } from '../Hud';
import type { Blip } from '../Radar';
import { HOVER_HEIGHT, type Ship } from '../Ship';
import { LANDING_PAD, OUTPOSTS, type World } from '../World';
import type { ContractTracker } from './Contracts';
import { createMission, type Mission, MISSION_RADIUS, MISSION_TITLES, type MissionKind } from './Missions';
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
const MAP_EDGE = 354; // keep arenas inside the playable map
const SURVIVE_TIME = 40;

type EncounterKind = 'outpost' | 'survive' | 'stronghold' | 'boss' | MissionKind;
/** Encounters the rounds before the boss can be. */
const ROUND_KINDS: EncounterKind[] = ['outpost', 'survive', 'rescue', 'defend', 'escort', 'sabotage', 'hold'];
type Phase = 'fight' | 'reward' | 'choosing' | 'gates' | 'transition' | 'over';

const TITLES: Record<EncounterKind, string> = {
  outpost: 'DESTROY THE OUTPOST',
  survive: 'SURVIVE THE SWARM',
  stronghold: 'FINAL ASSAULT',
  boss: 'BOSS',
  ...MISSION_TITLES,
};

interface Deps {
  scene: THREE.Scene;
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
  /** This zone's two enemy types. */
  pair: Species[] = [];
  /** The boss, during the final round. */
  boss: Boss | null = null;
  /** The current round's mission (rescue, defend, …), if it's one of those. */
  mission: Mission | null = null;
  private radius = ARENA_RADIUS.outpost;
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
    return this.radius;
  }

  /** Start a brand new sortie from the landing zone. */
  start(): void {
    const { ship, enemies, world } = this.d;
    this.stats = this.d.baseStats();
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
    this.d.contracts.begin(this.d.activeContract());
    this.endMission();
    this.d.arena.hideGates();
    this.d.arena.hideReward();
    ship.reset(world, LANDING_PAD.x, LANDING_PAD.z, this.stats);
    this.d.snapCamera();
    // `?boss=flyer|tank|titan` (or `?boss`) skips straight to a boss fight, for testing.
    const bossTest = new URLSearchParams(location.search).has('boss');
    if (bossTest) this.sector = SECTORS;
    // The first arena is the outpost nearest the landing zone.
    this.kind = this.pickKind();
    this.enter(0);
    if (bossTest) {
      ship.teleport(world, this.center.x, this.center.y + this.radius - 14);
      this.d.snapCamera();
    }
  }

  /** Begin the encounter at OUTPOSTS[index] for the current sector. */
  private enter(index: number): void {
    const { enemies, arena, hud } = this.d;
    this.used.add(index);
    const [cx, cz] = this.arenaAt(index);
    const R = this.radius;
    this.center.set(cx, cz);
    arena.setArena(cx, cz, R, this.d.world.heightAt(cx, cz) + HOVER_HEIGHT);

    const s = this.sector;
    const bounds = { x: cx, z: cz, r: R };
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
      const { scene, world, enemies: em, hud: h, ship } = this.d;
      this.mission = createMission(this.kind as MissionKind, { scene, world, enemies: em, hud: h, ship });
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
          : ROUND_KINDS[Math.floor(Math.random() * ROUND_KINDS.length)];
    this.radius = ARENA_RADIUS[kind];
    return kind;
  }

  /** The arena's centre for an outpost, nudged inward so the whole arena fits on the map. */
  private arenaAt(index: number): [number, number] {
    const lim = MAP_EDGE - this.radius;
    const [x, z] = OUTPOSTS[index];
    return [THREE.MathUtils.clamp(x, -lim, lim), THREE.MathUtils.clamp(z, -lim, lim)];
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
    if (this.phase !== 'over' && this.phase !== 'transition') ship.confine(this.center.x, this.center.y, this.radius - 3);
    if (this.phase !== 'transition') this.d.contracts.update(dt, ship);
    const showBoss = this.boss && this.boss.alive && this.phase === 'fight';
    this.d.hud.setBoss(showBoss ? this.boss!.name : null, this.boss?.healthFraction ?? 0);

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
  private failEncounter(): void {
    const { enemies, hud } = this.d;
    enemies.stopDrones();
    enemies.destroyAll();
    hud.show('OBJECTIVE FAILED · NO REWARD', 2.6);
    this.openGates();
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
    const edge = this.radius - 24;
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
      this.endMission();
      this.d.contracts.leaveSector();
      this.d.clearField();
      enemies.reset();
      this.sector++;
      // Next arena: one of the unused outposts closest to this one.
      const next = OUTPOSTS.map((o, i) => ({ i, d: Math.hypot(o[0] - this.center.x, o[1] - this.center.y) }))
        .filter((o) => !this.used.has(o.i))
        .sort((p, q) => p.d - q.d)
        .slice(0, 3);
      const pick = next[Math.floor(Math.random() * next.length)].i;
      this.kind = this.pickKind();
      const [cx, cz] = this.arenaAt(pick);
      // Enter from the south edge of the new arena, facing north.
      ship.teleport(world, cx, cz + this.radius - 14);
      ship.invulnerable = Math.max(ship.invulnerable, 1.5);
      this.d.snapCamera();
      this.enter(pick);
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
        if (this.boss) return `${head}\nDESTROY ${this.boss.name}`;
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
      default:
        return head;
    }
  }

  /** What the radar should mark right now. */
  blips(out: Blip[]): void {
    out.length = 0;
    if (this.phase === 'fight' && this.mission) {
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
