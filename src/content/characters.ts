/**
 * The cast. Edit names, roles and colours here.
 *
 * PORTRAITS: to use your own art, put PNGs in `public/portraits/<id>/<mood>.png`
 * (e.g. `public/portraits/rook/happy.png`) and list the moods you have under `art`.
 * Any mood without art falls back to `neutral` art, and characters with no art at all use the
 * generated placeholder portraits (see src/base/Portraits.ts).
 */
export type CharacterId = 'pilot' | 'bot' | 'rook' | 'juno' | 'pip';
export type Mood = 'neutral' | 'happy' | 'annoyed' | 'surprised' | 'sad';

export interface Character {
  id: CharacterId;
  name: string;
  role: string;
  /** Banner / placeholder colour. */
  color: string;
  /** Moods that have real art in public/portraits/<id>/<mood>.png. Empty = placeholder. */
  art: Mood[];
}

/** Longest name that fits on the leaderboard (10 typical letters fit at full size). */
export const NAME_MAX = 10;

/** Tidy a typed name: capitals, digits, spaces and . - _ only, single spaces, NAME_MAX long. */
export function cleanName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9 .\-_]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, NAME_MAX);
}

/** What you're called until you tell BOLT your name. */
export const DEFAULT_PILOT_NAME = 'PLAYER 1';
let pilotName = DEFAULT_PILOT_NAME;

/** The pilot's name (shown as {callsign} in lines, on the name banner and the leaderboard). */
export function getPilotName(): string {
  return pilotName;
}
export function setPilotName(name: string | undefined): void {
  pilotName = cleanName(name ?? '').trim() || DEFAULT_PILOT_NAME;
  CHARACTERS.pilot.name = pilotName;
}

export const CHARACTERS: Record<CharacterId, Character> = {
  pilot: { id: 'pilot', name: DEFAULT_PILOT_NAME, role: 'PILOT', color: '#e2733a', art: [] },
  bot: { id: 'bot', name: 'BOLT', role: 'INFORMATION DESK', color: '#2fb5a0', art: [] },
  rook: { id: 'rook', name: 'ROOK', role: 'QUARTERMASTER', color: '#c0442f', art: [] },
  juno: { id: 'juno', name: 'JUNO', role: 'OUTFITTER', color: '#c84ab8', art: [] },
  pip: { id: 'pip', name: 'PIP', role: 'MECHANIC', color: '#2fa8b5', art: [] },
};
