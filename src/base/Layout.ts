/**
 * The station floor plan (top-down, x = east, z = south). Rooms and corridors are rectangles;
 * doorways are gaps in a room's walls that line up with a corridor.
 *
 *                       ┌───────── HANGAR ─────────┐   (bay door to space on the north wall)
 *                       │   Pip      [ship pad]     │
 *                       └──────────┬ ┬─────────────┘
 *                                  │ │
 *        ┌── ARMORY ──┐   ┌───── CONCOURSE ─────┐   ┌── BOUTIQUE ──┐
 *        │   Rook     ├───┤   info desk + BOLT   ├───┤    Juno      │
 *        └────────────┘   └──────────┬ ┬─────────┘   └──────────────┘
 *                                    │ │
 *        ┌─ QUARTERS ─┐───────────────┤ ├────────── [MED BAY · OFFLINE]
 *        │  your bunk │               │ │
 *        └────────────┘          [DECK 4 · SEALED]
 */

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export type Side = 'n' | 's' | 'e' | 'w';

export interface Room {
  id: string;
  name: string;
  /** Shown when you walk in. */
  subtitle: string;
  rect: Rect;
  /** Floor tint. */
  floor: string;
  /** Openings in the walls: side, and the span along it (x for n/s, z for e/w). */
  gaps: { side: Side; a: number; b: number }[];
  /** Window spans (low sill + glass) instead of solid wall. */
  windows?: { side: Side; a: number; b: number }[];
}

export interface Corridor {
  rect: Rect;
  /** 'ns' corridors have walls on their east/west sides; 'ew' on north/south. */
  axis: 'ns' | 'ew';
  /** Openings in a corridor's side walls (for branches). */
  gaps?: { side: Side; a: number; b: number }[];
}

export interface SealedDoor {
  x: number;
  z: number;
  /** Which way the door faces (the wall it blocks runs across this axis). */
  axis: 'ns' | 'ew';
  label: string;
}

export const ROOMS: Room[] = [
  {
    id: 'concourse',
    name: 'CONCOURSE',
    subtitle: 'Halcyon Station · Deck 3',
    rect: { x0: -14, z0: -12, x1: 14, z1: 12 },
    floor: '#d6ccb8',
    gaps: [
      { side: 'n', a: -4, b: 4 },
      { side: 's', a: -4, b: 4 },
      { side: 'w', a: -3, b: 3 },
      { side: 'e', a: -3, b: 3 },
    ],
    windows: [
      { side: 'n', a: -12, b: -6 },
      { side: 'n', a: 6, b: 12 },
    ],
  },
  {
    id: 'hangar',
    name: 'HANGAR BAY',
    subtitle: "Pip's workshop · Launch deck",
    rect: { x0: -20, z0: -54, x1: 22, z1: -22 },
    floor: '#bfb6a6',
    gaps: [
      { side: 's', a: -4, b: 4 },
      { side: 'n', a: -9, b: 13 }, // the bay door to space
    ],
  },
  {
    id: 'armory',
    name: 'ARMORY',
    subtitle: "Rook's supply depot",
    rect: { x0: -46, z0: -10, x1: -26, z1: 10 },
    floor: '#c9bda6',
    gaps: [{ side: 'e', a: -3, b: 3 }],
  },
  {
    id: 'boutique',
    name: 'BOUTIQUE',
    subtitle: "Juno's wardrobe",
    rect: { x0: 26, z0: -10, x1: 46, z1: 10 },
    floor: '#d9c6cf',
    gaps: [{ side: 'w', a: -3, b: 3 }],
    windows: [{ side: 'e', a: -6, b: 6 }],
  },
  {
    id: 'quarters',
    name: 'PILOT QUARTERS',
    subtitle: 'Your bunk',
    rect: { x0: -34, z0: 15, x1: -18, z1: 31 },
    floor: '#cbbfae',
    gaps: [{ side: 'e', a: 20, b: 26 }],
    windows: [{ side: 'n', a: -30, b: -24 }],
  },
];

export const CORRIDORS: Corridor[] = [
  { rect: { x0: -4, z0: -22, x1: 4, z1: -12 }, axis: 'ns' }, // concourse ↔ hangar
  { rect: { x0: -26, z0: -3, x1: -14, z1: 3 }, axis: 'ew' }, // concourse ↔ armory
  { rect: { x0: 14, z0: -3, x1: 26, z1: 3 }, axis: 'ew' }, // concourse ↔ boutique
  {
    rect: { x0: -4, z0: 12, x1: 4, z1: 40 },
    axis: 'ns',
    gaps: [
      { side: 'w', a: 20, b: 26 },
      { side: 'e', a: 20, b: 26 },
    ],
  }, // south hall
  { rect: { x0: -18, z0: 20, x1: -4, z1: 26 }, axis: 'ew' }, // south hall ↔ quarters
  { rect: { x0: 4, z0: 20, x1: 20, z1: 26 }, axis: 'ew' }, // south hall → med bay (sealed)
];

/** Doors to the rest of the (huge) station that are closed for now. */
export const SEALED: SealedDoor[] = [
  { x: 0, z: 40, axis: 'ew', label: 'DECK 4 · SEALED' },
  { x: 20, z: 23, axis: 'ns', label: 'MED BAY · OFFLINE' },
];

/** Signs over doorways (position just inside the doorway, label). */
export const SIGNS: { x: number; z: number; text: string }[] = [
  { x: 0, z: -20, text: '▲ HANGAR BAY' },
  { x: -20, z: -1.5, text: '◀ ARMORY' },
  { x: 20, z: -1.5, text: 'BOUTIQUE ▶' },
  { x: 0, z: 16, text: '▼ QUARTERS · DECK 4' },
  { x: -12, z: 21.5, text: '◀ PILOT QUARTERS' },
];

// Key spots.
export const SPOTS = {
  /** Where you wake up when the game loads. */
  wake: { x: -26, z: 24 },
  /** Where you're standing after landing from a sortie. */
  landed: { x: 1, z: -28 },
  /** The launch pad (ship parked here). */
  pad: { x: 2, z: -40 },
  /** The ship leaves through the bay door toward here. */
  bayExit: { x: 2, z: -120 },
  bot: { x: 0, z: -3.5 },
  rook: { x: -36, z: -5 },
  juno: { x: 37, z: -4 },
  pip: { x: -13, z: -33 },
};

/** Room centres for the robot's directions. */
export const DESTINATIONS: { id: string; label: string; x: number; z: number }[] = [
  { id: 'armory', label: 'the Armory', x: -36, z: 0 },
  { id: 'boutique', label: 'the Boutique', x: 36, z: 0 },
  { id: 'hangar', label: 'the Hangar Bay', x: 1, z: -30 },
  { id: 'quarters', label: 'your quarters', x: -26, z: 23 },
];

export function inRect(r: Rect, x: number, z: number, margin = 0): boolean {
  return x > r.x0 + margin && x < r.x1 - margin && z > r.z0 + margin && z < r.z1 - margin;
}

/** All walkable rectangles (rooms and corridors). */
export const WALKABLE: Rect[] = [...ROOMS.map((r) => r.rect), ...CORRIDORS.map((c) => c.rect)];

export function roomAt(x: number, z: number): Room | null {
  return ROOMS.find((r) => inRect(r.rect, x, z)) ?? null;
}
