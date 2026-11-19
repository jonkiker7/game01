/**
 * The cast. Edit names, roles and colours here.
 *
 * PORTRAITS: to use your own art, put PNGs in `public/portraits/<id>/<mood>.png`
 * (e.g. `public/portraits/rook/happy.png`) and list the moods you have under `art`.
 * Any mood without art falls back to `neutral` art, and characters with no art at all use the
 * generated placeholder portraits (see src/base/Portraits.ts).
 */
export type CharacterId = 'pilot' | 'rook' | 'juno' | 'pip';
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

/** PLACEHOLDER: the player's callsign until the story is written. Used as {callsign} in lines. */
export const CALLSIGN = 'VESPER';

export const CHARACTERS: Record<CharacterId, Character> = {
  pilot: { id: 'pilot', name: CALLSIGN, role: 'PILOT', color: '#e2733a', art: [] },
  rook: { id: 'rook', name: 'ROOK', role: 'QUARTERMASTER', color: '#c0442f', art: [] },
  juno: { id: 'juno', name: 'JUNO', role: 'OUTFITTER', color: '#c84ab8', art: [] },
  pip: { id: 'pip', name: 'PIP', role: 'MECHANIC', color: '#2fa8b5', art: [] },
};
