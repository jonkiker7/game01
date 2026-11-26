/**
 * Settings a player can change on their device (shadow mode, glow, dev panel values, control
 * layout) are saved together with the default they replaced. When the game's default later
 * changes, the saved choice is dropped so everyone picks up the new default on their next load;
 * while the default stays the same, their choice is kept.
 */

/** Read a saved choice; returns `def` if there's none, it's invalid, or the default changed. */
export function readChoice<T extends string>(key: string, def: T, valid: readonly T[]): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return def;
    const saved = JSON.parse(raw) as { v?: T; d?: T };
    // Older saves (a bare value, no default recorded) are treated as out of date.
    if (!saved || typeof saved !== 'object' || saved.d !== def) return def;
    return saved.v !== undefined && valid.includes(saved.v) ? saved.v : def;
  } catch {
    return def;
  }
}

/** Save a choice along with today's default (choosing the default just clears it). */
export function writeChoice<T extends string>(key: string, value: T, def: T): void {
  try {
    if (value === def) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ v: value, d: def }));
  } catch {
    /* private mode */
  }
}

/** Same value? (numbers compared loosely, so 1.25 saved as text still matches). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  return JSON.stringify(a) === JSON.stringify(b);
}
