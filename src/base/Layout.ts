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
  /** Floor height (rooms down or up stairs). */
  level: number;
  /** Wall height (the concourse is taller and grander). */
  height: number;
  /** A different height for some walls (e.g. the hangar's low entrance wall, so you can see in). */
  sideHeights?: Partial<Record<Side, number>>;
  /** Openings in the floor, looking down into the depths of the station. */
  holes?: Rect[];
}

export interface Corridor {
  rect: Rect;
  /** 'ns' corridors have walls on their east/west sides; 'ew' on north/south. */
  axis: 'ns' | 'ew';
  /** Openings in a corridor's side walls (for branches). */
  gaps?: { side: Side; a: number; b: number }[];
  /** Floor height at the start (x0 / z0 end) and the end (x1 / z1 end). Default flat at 0. */
  levels?: [number, number];
  /** Where the stairs are along the corridor (between them the floor steps between levels). */
  stairs?: [number, number];
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
    rect: { x0: -18, z0: -14, x1: 18, z1: 16 },
    floor: '#d6ccb8',
    level: 0,
    height: 11,
    gaps: [
      { side: 'n', a: -4, b: 4 },
      { side: 's', a: -4, b: 4 },
      { side: 'w', a: -3, b: 3 },
      { side: 'e', a: -3, b: 3 },
    ],
    windows: [
      { side: 'n', a: -16, b: -8 },
      { side: 'n', a: 8, b: 16 },
    ],
    // Two wide openings down into the station, either side of the logo floor in the middle.
    holes: [
      { x0: -16, z0: 4, x1: -8, z1: 14 },
      { x0: 8, z0: 4, x1: 16, z1: 14 },
    ],
  },
  {
    id: 'hangar',
    name: 'HANGAR BAY',
    subtitle: "Pip's workshop · Launch deck",
    rect: { x0: -21, z0: -54, x1: 21, z1: -22 },
    floor: '#bfb6a6',
    level: -4,
    height: 16, // double height, so the ship clears the bay door
    sideHeights: { s: 8 }, // ...except the entrance wall (the stairs side), kept low so you can see in on the way out
    gaps: [
      { side: 's', a: -4, b: 4 },
      { side: 'n', a: -11, b: 11 }, // the bay door to space, lined up with the entrance and pad
    ],
    // Windows either side of Pip's workbench on the west wall.
    windows: [
      { side: 'w', a: -47, b: -41 },
      { side: 'w', a: -31, b: -26 },
    ],
    holes: [{ x0: 13, z0: -51, x1: 20, z1: -44 }], // cargo lift shaft
  },
  {
    id: 'armory',
    name: 'ARMORY',
    subtitle: "Rook's supply depot",
    rect: { x0: -46, z0: -10, x1: -26, z1: 10 },
    floor: '#c9bda6',
    level: -3,
    height: 5.2,
    gaps: [{ side: 'e', a: -3, b: 3 }],
  },
  {
    id: 'boutique',
    name: 'BOUTIQUE',
    subtitle: "Juno's wardrobe",
    rect: { x0: 26, z0: -10, x1: 46, z1: 10 },
    floor: '#d9c6cf',
    level: 0,
    height: 5.2,
    gaps: [{ side: 'w', a: -3, b: 3 }],
    windows: [{ side: 'e', a: -6, b: 6 }],
  },
  {
    id: 'quarters',
    name: 'PILOT QUARTERS',
    subtitle: 'Your bunk',
    rect: { x0: -34, z0: 15, x1: -18, z1: 31 },
    floor: '#cbbfae',
    level: -2,
    height: 5.2,
    gaps: [{ side: 'e', a: 20, b: 26 }],
    windows: [{ side: 'n', a: -30, b: -24 }],
  },
];

export const CORRIDORS: Corridor[] = [
  { rect: { x0: -4, z0: -22, x1: 4, z1: -14 }, axis: 'ns', levels: [-4, 0], stairs: [-20, -16] }, // concourse ↔ hangar
  { rect: { x0: -26, z0: -3, x1: -18, z1: 3 }, axis: 'ew', levels: [-3, 0], stairs: [-24.5, -19.5] }, // concourse ↔ armory
  { rect: { x0: 18, z0: -3, x1: 26, z1: 3 }, axis: 'ew' }, // concourse ↔ boutique
  {
    rect: { x0: -4, z0: 16, x1: 4, z1: 40 },
    axis: 'ns',
    gaps: [
      { side: 'w', a: 20, b: 26 },
      { side: 'e', a: 20, b: 26 },
    ],
  }, // south hall
  { rect: { x0: -18, z0: 20, x1: -4, z1: 26 }, axis: 'ew', levels: [-2, 0], stairs: [-14, -9] }, // south hall ↔ quarters
  { rect: { x0: 4, z0: 20, x1: 20, z1: 26 }, axis: 'ew' }, // south hall → med bay (sealed)
];

/** Doors to the rest of the (huge) station that are closed for now. */
export const SEALED: SealedDoor[] = [
  { x: 0, z: 40, axis: 'ew', label: 'DECK 4 · SEALED' },
  { x: 20, z: 23, axis: 'ns', label: 'MED BAY · OFFLINE' },
];

/** Signs over doorways (position just inside the doorway, label). */
export const SIGNS: { x: number; z: number; text: string }[] = [
  { x: -19.5, z: -1.5, text: '◀ ARMORY' },
  { x: 20, z: -1.5, text: 'BOUTIQUE ▶' },
  { x: 0, z: 19, text: '▼ QUARTERS · DECK 4' },
  { x: -7, z: 21.5, text: '◀ PILOT QUARTERS' },
];

// Key spots.
export const SPOTS = {
  /** Where you wake up when the game loads. */
  wake: { x: 0, z: 5.5 }, // on the station logo, in the middle of the Concourse
  /** Where you're standing after landing from a sortie. */
  landed: { x: 1, z: -28 },
  /** The launch pad (ship parked here). */
  pad: { x: 0, z: -40 },
  /** The ship leaves through the bay door toward here. */
  bayExit: { x: 0, z: -120 },
  bot: { x: 0, z: -5 },
  rook: { x: -36, z: -5 },
  juno: { x: 37, z: -4 },
  pip: { x: -15.5, z: -36 },
};

/** Room centres for the robot's directions. */
export const DESTINATIONS: { id: string; label: string; x: number; z: number }[] = [
  { id: 'armory', label: 'the Armory', x: -36, z: 0 },
  { id: 'boutique', label: 'the Boutique', x: 36, z: 0 },
  { id: 'hangar', label: 'the Hangar Bay', x: 0, z: -30 },
  { id: 'quarters', label: 'your quarters', x: -26, z: 23 },
];

export function inRect(r: Rect, x: number, z: number, margin = 0): boolean {
  return x > r.x0 + margin && x < r.x1 - margin && z > r.z0 + margin && z < r.z1 - margin;
}

/** All walkable rectangles (rooms and corridors). */
export const WALKABLE: Rect[] = [...ROOMS.map((r) => r.rect), ...CORRIDORS.map((c) => c.rect)];

/** Every hole in the floor. */
export const HOLES: Rect[] = ROOMS.flatMap((r) => r.holes ?? []);

/** Floor height of a corridor at a point (stairs ramp between its two levels). */
export function corridorLevel(c: Corridor, x: number, z: number): number {
  if (!c.levels) return 0;
  const [l0, l1] = c.levels;
  if (!c.stairs) return l0;
  const u = c.axis === 'ns' ? z : x;
  const [a, b] = c.stairs;
  const t = Math.min(1, Math.max(0, (u - a) / (b - a)));
  return l0 + (l1 - l0) * t;
}

/** Floor height anywhere in the station. */
export function heightAt(x: number, z: number): number {
  const room = ROOMS.find((r) => inRect(r.rect, x, z, -0.01));
  if (room) return room.level;
  const c = CORRIDORS.find((k) => inRect(k.rect, x, z, -0.01));
  return c ? corridorLevel(c, x, z) : 0;
}

export function roomAt(x: number, z: number): Room | null {
  return ROOMS.find((r) => inRect(r.rect, x, z)) ?? null;
}
