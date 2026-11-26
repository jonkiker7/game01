import type { ShipDesignId } from '../game/ShipDesigns';
import type { Stats } from '../game/run/Upgrades';
import { CONTRACT_TEMPLATES, type ContractClient, contractReward, type ContractType } from '../content/contracts';

/** A job from the contract board, tied to one sector of your next sortie. */
export interface Contract {
  id: string;
  type: ContractType;
  client: ContractClient;
  title: string;
  text: string;
  goal: string;
  sector: number;
  reward: number;
}

/** Everything that persists between runs (stored in this browser's local storage). */
export interface SaveData {
  salvage: number;
  /** Permanent upgrade levels bought from the Quartermaster. */
  perks: Record<string, number>;
  ships: ShipDesignId[];
  ship: ShipDesignId;
  suits: string[];
  suit: string;
  helmets: string[];
  helmet: string;
  /** How the last sortie went (NPCs comment on it). */
  lastRun: { won: boolean; sectors: number; kills: number } | null;
  runs: number;
  wins: number;
  /** Best sortie score. */
  best: number;
  /** Whether you've been offered the flight tutorial (asked once, on your first launch). */
  tutorialAsked: boolean;
  /** The station's leaderboard (top 10), you and other pilots. */
  leaderboard: LeaderEntry[];
  deaths: number;
  /** Conversations already heard (see src/content/dialogue.ts). */
  seen: string[];
  /** The contract board: offers on the board, the one you've taken, and how many you've finished. */
  contracts: {
    offers: Contract[];
    active: Contract | null;
    done: number;
    byClient: Record<string, number>;
  };
}

const KEY = 'star-rotor-save';
const OLD_SALVAGE_KEY = 'star-rotor-salvage';

export interface LeaderEntry {
  name: string;
  score: number;
  /** Your own entries (highlighted on the board). */
  you?: boolean;
}

/** Your name on the leaderboard until callsigns can be entered. */
export const PLAYER_NAME = 'PLAYER 1';
const BOARD_SIZE = 10;

/** Other pilots already on the board, so there's something to beat. */
const SEED_LEADERBOARD: LeaderEntry[] = [
  { name: 'VEX', score: 31300 },
  { name: 'NOVA-7', score: 27450 },
  { name: 'KITE', score: 24400 },
  { name: 'ROOK JR.', score: 21900 },
  { name: 'HALCYON', score: 19100 },
  { name: 'MOTH', score: 16800 },
  { name: 'ZERO-ONE', score: 14100 },
  { name: 'SABLE', score: 11800 },
  { name: 'PIXIE', score: 9300 },
  { name: 'GRUNT', score: 7100 },
];

/** Add a sortie's score to the leaderboard; returns your rank (1-based) or 0 if it didn't place. */
export function addToLeaderboard(save: SaveData, score: number): number {
  if (score <= 0) return 0;
  const entry: LeaderEntry = { name: PLAYER_NAME, score, you: true };
  const board = [...save.leaderboard, entry].sort((a, b) => b.score - a.score).slice(0, BOARD_SIZE);
  save.leaderboard = board;
  return board.indexOf(entry) + 1;
}

function fresh(): SaveData {
  return {
    salvage: 0,
    perks: {},
    ships: ['b'],
    ship: 'b',
    suits: ['standard'],
    suit: 'standard',
    helmets: ['dome'],
    helmet: 'dome',
    lastRun: null,
    best: 0,
    tutorialAsked: false,
    leaderboard: SEED_LEADERBOARD.map((e) => ({ ...e })),
    runs: 0,
    wins: 0,
    deaths: 0,
    seen: [],
    contracts: { offers: rollContracts(), active: null, done: 0, byClient: {} },
  };
}

/** Three fresh offers for the contract board: one from each crew member, different kinds. */
export function rollContracts(): Contract[] {
  const clients: ContractClient[] = ['rook', 'juno', 'pip'];
  const types: ContractType[] = ['retrieve', 'hunt', 'uplink'].sort(() => Math.random() - 0.5) as ContractType[];
  return clients.map((client, i) => {
    const options = CONTRACT_TEMPLATES.filter((t) => t.client === client && t.type === types[i]);
    const t = options[Math.floor(Math.random() * options.length)];
    const sector = 1 + Math.floor(Math.random() * 4); // 1–4: the missions before the boss
    return {
      id: `${t.type}-${client}-${Date.now().toString(36)}-${i}`,
      type: t.type,
      client,
      title: t.title,
      text: t.text.replaceAll('{sector}', String(sector)),
      goal: t.goal,
      sector,
      reward: contractReward(t.type, sector),
    };
  });
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const loaded = { ...fresh(), ...JSON.parse(raw) } as SaveData;
      // Keep contracts within the missions before the boss (4 of them).
      if (!loaded.contracts.offers?.length || loaded.contracts.offers.some((o) => o.sector > 4)) loaded.contracts.offers = rollContracts();
      const a = loaded.contracts.active;
      if (a && a.sector > 4) {
        a.sector = 4;
        a.text = a.text.replace(/sector \d+/, 'sector 4');
      }
      // Sorties got longer (4 missions, then the boss): rival scores on the board grow to match.
      if (loaded.leaderboard.some((e) => e.name === 'VEX' && e.score === 18420)) {
        const you = loaded.leaderboard.filter((e) => e.you);
        loaded.leaderboard = [...SEED_LEADERBOARD.map((e) => ({ ...e })), ...you].sort((x, y) => y.score - x.score).slice(0, BOARD_SIZE);
      }
      return loaded;
    }
    // Carry over salvage banked before home base existed.
    const old = Number(localStorage.getItem(OLD_SALVAGE_KEY) ?? 0) || 0;
    return { ...fresh(), salvage: old };
  } catch {
    return fresh();
  }
}

export function writeSave(s: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: progress just isn't saved */
  }
}

// ---------------------------------------------------------------- Quartermaster perks

export interface Perk {
  id: string;
  name: string;
  text: string;
  costs: number[]; // one cost per level
  apply(stats: Stats, level: number): void;
}

/** Permanent upgrades: bought with salvage, applied at the start of every sortie. */
export const PERKS: Perk[] = [
  {
    id: 'plating',
    name: 'Hull Plating',
    text: '+15 max armor per level.',
    costs: [120, 220, 350, 520, 750],
    apply: (s, n) => (s.maxArmor += 15 * n),
  },
  {
    id: 'calibration',
    name: 'Gun Calibration',
    text: '+8% gun damage per level.',
    costs: [100, 180, 300, 450, 650],
    apply: (s, n) => (s.gunDamage *= 1 + 0.08 * n),
  },
  {
    id: 'rack',
    name: 'Expanded Rack',
    text: 'Start every sortie with +1 missile capacity.',
    costs: [400],
    apply: (s, n) => (s.missileMax += n),
  },
  {
    id: 'capacitor',
    name: 'Nova Capacitor',
    text: 'Nova charges 15% faster per level.',
    costs: [150, 300, 500],
    apply: (s, n) => (s.specialChargeMul *= 1 + 0.15 * n),
  },
  {
    id: 'thrusters',
    name: 'Tuned Thrusters',
    text: 'Boost recharges 10% faster per level.',
    costs: [140, 260, 420],
    apply: (s, n) => (s.boostCooldown *= Math.pow(0.9, n)),
  },
  {
    id: 'scavenger',
    name: 'Scavenger Protocol',
    text: '+15% salvage earned per level.',
    costs: [200, 400, 700],
    apply: (s, n) => (s.salvageMul *= 1 + 0.15 * n),
  },
];

export function applyPerks(stats: Stats, save: SaveData): void {
  for (const p of PERKS) {
    const n = save.perks[p.id] ?? 0;
    if (n > 0) p.apply(stats, n);
  }
}

// ---------------------------------------------------------------- Mechanic: ships

export const SHIP_PRICES: Record<ShipDesignId, number> = { b: 0, a: 400, c: 600, d: 800 };

// ---------------------------------------------------------------- Outfitter: suits & helmets

export interface SuitStyle {
  id: string;
  name: string;
  price: number;
  suit: string; // main fabric
  armor: string; // plates
  accent: string; // stripes, lights
  dark: string; // joints, boots, gloves
}

export const SUITS: SuitStyle[] = [
  { id: 'standard', name: 'Standard Issue', price: 0, suit: '#ece4d4', armor: '#e2733a', accent: '#6ff7ff', dark: '#3a3448' },
  { id: 'arctic', name: 'Arctic Ops', price: 180, suit: '#f2f6fb', armor: '#3d7fd8', accent: '#bff4ff', dark: '#2b3a52' },
  { id: 'jungle', name: 'Jungle Ranger', price: 200, suit: '#8d9a5c', armor: '#5a6b3a', accent: '#d8ff7a', dark: '#2f3524' },
  { id: 'crimson', name: 'Crimson Vanguard', price: 260, suit: '#3b2a33', armor: '#b8233a', accent: '#ffd36b', dark: '#1d1520' },
  { id: 'midnight', name: 'Midnight Spectre', price: 300, suit: '#2a3150', armor: '#1b2036', accent: '#ff5fd2', dark: '#11131f' },
];

export interface HelmetStyle {
  id: string;
  name: string;
  price: number;
}

export const HELMETS: HelmetStyle[] = [
  { id: 'dome', name: 'Classic Dome', price: 0 },
  { id: 'tactical', name: 'Tactical Visor', price: 220 },
  { id: 'fishbowl', name: 'Fishbowl', price: 260 },
];
