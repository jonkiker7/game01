import * as THREE from 'three';
import type { Contract } from '../../base/Save';
import { type Enemy, type EnemyManager, type Species, ZONE_SPECIES } from '../Enemies';
import { type Boss, BOSS_NAMES, type BossId } from '../Bosses';
import type { Hud } from '../Hud';
import type { Blip } from '../Radar';
import type { Ship } from '../Ship';
import type { World } from '../World';
import { type ArenaShape, blobArena, corridorArena } from '../ArenaShape';
import type { ContractTracker } from './Contracts';
import { CORRIDOR_MISSIONS, createMission, type Mission, type MissionDeps, MISSION_RADIUS, MISSION_TITLES, type MissionKind } from './Missions';
import { type ArenaVisual, type Gate, REWARD_STYLE, type Reward } from './Arena';
import type { RunUI } from './RunUI';
import { audio } from '../../audio/Audio';
import { TUNING } from '../Tuning';
import { defaultStats, PRIMARY_NAMES, rollUpgrades, rollWeapons, SECONDARY_NAMES, type Stats, type Upgrade, UPGRADES } from './Upgrades';

/** Rounds per sortie, the last one being the boss (2 rounds, then the boss). */
export const SECTORS = 5;

/** How a sortie ended. */
export interface RunResult {
  won: boolean;
  /** Points scored this sortie. */
  score: number;
  /** Where the points came from. */
  tally: { damage: number; clear: number; time: number; protect: number };
  /** Lost by failing a mission (the generator or convoy was destroyed) rather than being shot down. */
  failed?: boolean;
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
/** Flight training's practice arena. */
const TRAINING_RADIUS = 90;

type EncounterKind = 'outpost' | 'survive' | 'stronghold' | 'boss' | MissionKind;
/** Encounters the rounds before the boss can be. */
const ROUND_KINDS: EncounterKind[] = ['outpost', 'survive', 'rescue', 'defend', 'escort', 'sabotage', 'hold', 'cargo'];
type Phase = 'intro' | 'fight' | 'failed' | 'reward' | 'choosing' | 'gates' | 'transition' | 'over';

/**
 * Mission clocks. `fail`: running out of time fails the mission (it ends the sortie). Without
 * it, the clock is just a par time for the time bonus. Survive and Defend already run on their
 * own timers, so they have none.
 */
const CLOCK: Partial<Record<EncounterKind, { limit: number; fail: boolean }>> = {
  outpost: { limit: 150, fail: true },
  rescue: { limit: 120, fail: true },
  sabotage: { limit: 120, fail: true },
  hold: { limit: 130, fail: true },
  cargo: { limit: 150, fail: true },
  escort: { limit: 80, fail: false },
  boss: { limit: 180, fail: false },
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** How long the mission title stays up at the start of a round (enemies arrive 1 s before it goes). */
const INTRO_TIME = 4.1;

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
  private missionFailed = false;
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

  /**
   * Flight training: a small practice arena with one drone that keeps coming back. No clock, no
   * score or salvage to bank, and being shot down just puts you back in the air.
   */
  training = false;
  private respawnTimer = 0;
  private targetTimer = 0;

  startTraining(): void {
    const { ship, enemies, world } = this.d;
    this.training = true;
    this.stats = this.d.baseStats();
    this.levels.clear();
    this.takenNames.length = 0;
    this.sector = 1;
    this.kills = 0;
    this.salvage = 0;
    this.score = 0;
    this.tally = { damage: 0, clear: 0, time: 0, protect: 0 };
    this.missionFailed = false;
    this.won = false;
    this.boss = null;
    this.pair = [];
    this.seed = 1 + Math.floor(Math.random() * 99999);
    this.d.resetRunState();
    this.d.clearField();
    enemies.reset();
    this.d.contracts.begin(null);
    this.endMission();
    this.d.arena.hideGates();
    this.d.arena.hideReward();
    this.shape = blobArena(TRAINING_RADIUS, this.seed * 10 + 1);
    world.generate(this.shape, this.seed * 10 + 1);
    this.center.set(this.shape.center.x, this.shape.center.z);
    this.radius = this.shape.radius;
    const shape = this.shape;
    enemies.configure({ x: this.center.x, z: this.center.y, r: this.radius, inside: (x, z, m) => shape.depth(x, z) > m }, 1, null);
    ship.reset(world, this.shape.entry.x, this.shape.entry.z, this.stats);
    this.d.snapCamera();
    this.targetTimer = 1.5;
    this.phase = 'intro';
    this.introTimer = 2.5;
    audio.song('sortie');
    audio.play('sectorStart');
    this.d.hud.show('FLIGHT TRAINING', 2.5, true);
  }

  /** Leave training (back to the station): clear the arena; nothing is banked. */
  exitTraining(): void {
    this.d.enemies.reset();
    this.d.clearField();
    this.d.releaseInput();
    this.training = false;
    this.phase = 'over';
    this.overTimer = -10;
  }

  private updateTraining(dt: number): void {
    const { ship, enemies, world, hud } = this.d;
    if (this.phase === 'intro') {
      this.introTimer -= dt;
      if (this.introTimer <= 0) this.phase = 'fight';
      return;
    }
    if (this.phase === 'over') {
      // Shot down: back in the air in a moment, at full armor.
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        ship.reset(world, this.center.x, this.center.y + 20, this.stats);
        this.phase = 'fight';
        hud.show('BACK IN THE AIR', 1.4);
      }
      return;
    }
    this.confineShip();
    // The practice drone: a new one shortly after the last goes down.
    if (!enemies.enemies.some((e) => e.alive)) {
      this.targetTimer -= dt;
      if (this.targetTimer <= 0) {
        const p = ship.root.position;
        const a = Math.random() * Math.PI * 2;
        const r = 30;
        let x = p.x + Math.cos(a) * r;
        let z = p.z - Math.abs(Math.sin(a)) * r; // ahead (up the screen) of the ship
        if (this.shape.depth(x, z) < 15) {
          x = this.center.x;
          z = this.center.y;
        }
        enemies.spawnDrone(x, z);
        this.targetTimer = 2;
      }
    }
  }

  /** Start a brand new sortie from the landing zone. */
  start(): void {
    const { ship, enemies, world } = this.d;
    this.training = false;
    this.stats = this.d.baseStats();
    this.levels.clear();
    this.takenNames.length = 0;
    this.sector = 1;
    this.lastRoundKind = null;
    this.usedKinds.clear();
    this.kills = 0;
    this.salvage = 0;
    this.score = 0;
    this.tally = { damage: 0, clear: 0, time: 0, protect: 0 };
    this.missionFailed = false;
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
      CORRIDOR_MISSIONS.includes(this.kind as MissionKind)
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

  /**
   * Begin this round in the freshly built arena: the mission's title shows big for a few
   * seconds, and the enemies (and the mission itself) only arrive a second before it fades,
   * so nothing attacks while the text is up.
   */
  private enter(): void {
    const boss = this.kind === 'boss';
    // Everything for the round is set up now, while the big title covers the screen (so any
    // loading hitch is hidden), and the game stays frozen until the title goes away.
    this.beginFight();
    this.phase = 'intro';
    this.introTimer = INTRO_TIME;
    audio.song(boss ? 'boss' : 'sortie');
    audio.play(boss ? 'bossAppear' : 'sectorStart');
    this.d.hud.show(TITLES[this.kind], INTRO_TIME, true); // just the mission (which sector doesn't matter)
  }

  /** True while the mission title is up: the game holds still. */
  get frozen(): boolean {
    return this.phase === 'intro';
  }

  private introTimer = 0;
  /** Points this sortie, and seconds spent on the current mission. */
  score = 0;
  private elapsed = 0;

  /** Damage dealt to enemies scores points (only while a mission is on). */
  addDamage(amount: number): void {
    if (this.phase !== 'fight') return;
    const pts = amount * TUNING.score.perDamage;
    this.score += pts;
    this.missionDamage += pts;
    this.tally.damage += pts;
  }

  /** Damage points this mission, and the sortie's points by kind (for the end-of-sortie breakdown). */
  private missionDamage = 0;
  tally = { damage: 0, clear: 0, time: 0, protect: 0 };

  /** Seconds left on this mission's clock (null if it has none). */
  private timeLeft(): number | null {
    const c = CLOCK[this.kind];
    return c ? Math.max(0, c.limit - this.elapsed) : null;
  }

  /** The enemies, objective and contract for this round arrive. */
  private beginFight(): void {
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
    this.elapsed = 0;
    this.missionDamage = 0;
    void hud;
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
  /** Mission types already flown this sortie: no repeats within a run. */
  private usedKinds = new Set<EncounterKind>();

  private randomRoundKind(): EncounterKind {
    let options = ROUND_KINDS.filter((k) => !this.usedKinds.has(k));
    if (!options.length) options = ROUND_KINDS.filter((k) => k !== this.lastRoundKind); // (more missions than types)
    const kind = options[Math.floor(Math.random() * options.length)];
    this.lastRoundKind = kind;
    this.usedKinds.add(kind);
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
    if (this.training) {
      this.phase = 'over';
      this.respawnTimer = 2;
      return;
    }
    this.phase = 'over';
    this.won = false;
    this.overTimer = 2.5;
  }

  update(dt: number): void {
    if (this.training) {
      this.d.hud.setBoss(null);
      this.updateTraining(dt);
      return;
    }
    const { ship, enemies, arena } = this.d;
    if (this.phase !== 'over' && this.phase !== 'transition') this.confineShip();
    if (this.phase !== 'transition' && this.phase !== 'intro') this.d.contracts.update(dt, ship);
    // Health bar across the top: the boss, or what a mission has you protecting.
    const guard = this.phase === 'fight' ? this.mission?.healthBar() : null;
    if (this.boss && this.boss.alive && this.phase === 'fight') this.d.hud.setBoss(this.boss.name, this.boss.healthFraction);
    else if (guard) this.d.hud.setBoss(guard.name, guard.fraction);
    else this.d.hud.setBoss(null);

    switch (this.phase) {
      case 'intro':
        this.introTimer -= dt;
        if (this.introTimer <= 0) {
          this.phase = 'fight';
          if (this.boss) this.d.hud.show(this.boss.name, 2.2, true);
        }
        break;
      case 'fight': {
        this.elapsed += dt;
        const c = CLOCK[this.kind];
        if (c?.fail && this.elapsed >= c.limit) {
          this.failEncounter('OUT OF TIME · MISSION FAILED');
          break;
        }
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
        // Failing a mission ends the sortie, just like being shot down.
        if (this.failTimer <= 0) {
          this.phase = 'over';
          this.won = false;
          this.missionFailed = true;
          this.overTimer = -10;
          this.finish();
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

  /** Bonus points for finishing a mission: clear, time left, and health of what you protected. */
  private awardBonus(): void {
    const S = TUNING.score;
    const clear = this.boss ? S.bossClear : S.clear;
    const lines: [string, number][] = [
      ['DAMAGE DEALT', this.missionDamage],
      [this.boss ? 'BOSS DEFEATED' : 'MISSION COMPLETE', clear],
    ];
    this.tally.clear += clear;
    const left = this.timeLeft();
    if (left !== null && left > 0) {
      lines.push([`TIME BONUS · ${clock(left)}`, left * S.perSecond]);
      this.tally.time += left * S.perSecond;
    }
    const guard = this.mission?.healthBar();
    if (guard && guard.fraction > 0) {
      lines.push([`${guard.name} ${Math.round(guard.fraction * 100)}%`, guard.fraction * S.protect]);
      this.tally.protect += guard.fraction * S.protect;
    }
    // Damage was already counted as it happened; add the bonuses now.
    let mission = 0;
    for (const [label, pts] of lines) {
      mission += pts;
      if (label !== 'DAMAGE DEALT') this.score += pts;
    }
    this.d.hud.showScore(lines, [
      ['THIS MISSION', mission],
      ['TOTAL SCORE', this.score],
    ]);
  }

  private clearEncounter(): void {
    const { enemies, hud } = this.d;
    this.awardBonus();
    enemies.stopDrones();
    enemies.destroyAll();
    if (this.sector === SECTORS) {
      hud.show(this.boss ? `${this.boss.name} DESTROYED` : 'STRONGHOLD DESTROYED', 3);
      audio.play('victory');
      this.won = true;
      this.phase = 'over';
      this.overTimer = 2.5;
      return;
    }
    hud.show('SECTOR CLEARED', 2.2);
    audio.play('sectorClear');
    // The reward floats in the middle of the arena at flying height. In the left-to-right
    // corridor it goes three-quarters of the way along instead, on the way to the gates.
    const y = this.d.ship.root.position.y;
    const path = this.shape.path;
    if (path && path.length > 1) {
      const p = path[Math.round((path.length - 1) * 0.72)];
      this.d.arena.showReward(this.reward, this.tmp.set(p.x, y, p.z));
    } else if (this.kind === 'defend') {
      // The generator stands in the middle: put the reward halfway up toward the exit gates.
      const [g1, g2] = this.shape.exits;
      const mx = (g1.x + g2.x) / 2;
      const mz = (g1.z + g2.z) / 2;
      this.d.arena.showReward(this.reward, this.tmp.set(this.center.x + (mx - this.center.x) * 0.5, y, this.center.y + (mz - this.center.y) * 0.5));
    } else {
      this.d.arena.showReward(this.reward, this.tmp.set(this.center.x, y, this.center.y));
    }
    this.phase = 'reward';
  }

  /**
   * A mission was failed (generator or convoy destroyed): it blows up, a red banner holds for
   * a few seconds, and then the sortie ends, just like being shot down.
   */
  private failEncounter(text?: string): void {
    const { enemies, hud } = this.d;
    enemies.stopDrones();
    enemies.destroyAll();
    if (!text) this.mission?.onFail();
    hud.show(text ?? this.mission?.failText ?? 'OBJECTIVE FAILED', 3.4);
    audio.play('fail');
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
    audio.play('powerOrb');
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
          audio.play('powerUp');
          this.openGates();
        }, isWeapon ? 'ARMORY · CHOOSE A WEAPON' : 'CHOOSE A POWER-UP');
        return;
      }
    } else if (this.reward === 'repair') {
      ship.heal(this.stats.maxArmor * 0.4);
      hud.flashHeal();
      hud.show('HULL REPAIRED', 1.6);
      audio.play('repair');
    } else if (this.reward === 'salvage') {
      const amount = Math.round((50 + 10 * this.sector) * this.stats.salvageMul);
      this.salvage += amount;
      hud.show(`+${amount} SALVAGE`, 1.6);
      audio.play('salvage');
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
    audio.play('gate');
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
      score: Math.round(this.score),
      tally: { ...this.tally },
      failed: this.missionFailed,
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
    if (this.training) return 'FLIGHT TRAINING\nPRACTICE ON THE DRONE';
    const line = this.d.contracts.objectiveLine(this.sector);
    let text = this.baseObjective();
    // The mission clock (a hard limit, or the time bonus counting down).
    const left = this.phase === 'fight' ? this.timeLeft() : null;
    if (left !== null) text += `\n${CLOCK[this.kind]!.fail ? '⏱' : '⏱ BONUS'} ${clock(left)}`;
    return line && this.phase !== 'over' ? `${text}\n${line}` : text;
  }

  private baseObjective(): string {
    // The mission's name, then what's left to do (missions write both lines themselves).
    const head = this.boss ? this.boss.name : this.mission ? this.mission.title : TITLES[this.kind];
    switch (this.phase) {
      case 'fight':
        if (this.boss) return `${head}\n${this.boss.objectiveLine()}`;
        if (this.mission) return this.mission.objective();
        if (this.kind === 'survive') {
          if (this.timer <= 0 && this.d.contracts.blocking) return `${head}\nDESTROY THE ALPHA`;
          return `${head}\n${Math.ceil(Math.max(0, this.timer))}s LEFT`;
        }
        if (this.d.enemies.turretsLeft === 0 && this.d.contracts.blocking) return `${head}\nDESTROY THE ALPHA`;
        return `${head}\n${this.d.enemies.turretsLeft} TOWERS LEFT`;
      case 'reward':
        return `${head}\nCOLLECT ${REWARD_STYLE[this.reward].label.slice(2)}`;
      case 'choosing':
        return `${head}\nCHOOSE A POWER-UP`;
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
    if (this.training) {
      for (const e of this.d.enemies.enemies) if (e.alive) out.push({ x: e.root.position.x, z: e.root.position.z, kind: 'target' });
      return;
    }
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
