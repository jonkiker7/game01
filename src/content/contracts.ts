/*
 * ============================================================================================
 *  CONTRACTS  (PLACEHOLDER writing: edit freely)
 * ============================================================================================
 *
 *  BOLT's contract board offers jobs from the crew. Each contract happens in one sector of
 *  your next sortie. Three kinds:
 *    retrieve: a cargo pod is down in that sector: fly over it to haul it aboard.
 *    hunt:     an elite drone leads the swarm there: destroy it (the sector isn't clear until you do).
 *    uplink:   a relay beacon is there: hover in its zone until the upload completes.
 *
 *  `{sector}` in the text becomes the sector number.
 * ============================================================================================
 */

export type ContractType = 'retrieve' | 'hunt' | 'uplink';
export type ContractClient = 'rook' | 'juno' | 'pip';

export interface ContractTemplate {
  type: ContractType;
  client: ContractClient;
  title: string;
  text: string;
  /** Short name shown on the HUD during the sortie. */
  goal: string;
}

export const CONTRACT_TEMPLATES: ContractTemplate[] = [
  // ---- Retrieve
  { type: 'retrieve', client: 'pip', title: 'Lost Parts Crate', goal: 'RECOVER THE CRATE', text: "Pip: \"A supply drop missed the station and landed in sector {sector}. My good spanners are in there!\"" },
  { type: 'retrieve', client: 'rook', title: 'Black Box Recovery', goal: 'GET THE BLACK BOX', text: 'Rook: "A scout ship went down in sector {sector}. Bring back its flight recorder."' },
  { type: 'retrieve', client: 'juno', title: 'Rare Fabric Bolt', goal: 'RECOVER THE CARGO', text: 'Juno: "There\'s a cargo pod of bloom-silk in sector {sector}. Do NOT get it scorched."' },
  // ---- Hunt
  { type: 'hunt', client: 'rook', title: 'Hunt the Alpha', goal: 'DESTROY THE ALPHA', text: 'Rook: "One big drone is leading the swarms in sector {sector}. Cut off the head."' },
  { type: 'hunt', client: 'pip', title: 'Old Stinger', goal: 'DESTROY STINGER', text: 'Pip: "The drone that clipped my wing is in sector {sector}. It has a dent shaped like ME."' },
  { type: 'hunt', client: 'juno', title: 'Gaudy Menace', goal: 'DESTROY THE ALPHA', text: 'Juno: "A huge drone with an awful paint job is in sector {sector}. Put it out of its misery."' },
  // ---- Uplink
  { type: 'uplink', client: 'pip', title: 'Relay Beacon', goal: 'UPLINK THE BEACON', text: 'Pip: "Our relay beacon in sector {sector} lost sync. Hover over it while it re-uploads."' },
  { type: 'uplink', client: 'rook', title: 'Survey Uplink', goal: 'UPLINK THE BEACON', text: 'Rook: "Survey beacon in sector {sector} has the patrol maps. Sit on it until they transfer."' },
  { type: 'uplink', client: 'juno', title: 'Broadcast Booster', goal: 'UPLINK THE BEACON', text: 'Juno: "Boost the beacon in sector {sector}. The station deserves better radio."' },
];

/** Salvage paid for a contract (later sectors pay more). */
export function contractReward(type: ContractType, sector: number): number {
  const base = { retrieve: 90, hunt: 130, uplink: 110 }[type];
  return base + sector * 25;
}
