/**
 * Synthesized sound effects, in a retro-future style: analog-synth zaps and sweeps, filtered
 * noise, chorused chords and tape echo, like an 80s idea of the future.
 *
 * Each sound id can be replaced by your own file (see Audio.ts). The list below is every sound
 * the game plays, with what triggers it.
 */
import type { Bus } from './Audio';

export const SOUND_IDS = {
  // ---- Your ship
  gun: 'Machine gun shot',
  scatter: 'Scatter Cannon blast',
  rail: 'Rail Lance shot',
  hit: 'Your bullet hits an enemy',
  charge: 'Start charging a missile',
  chargeFull: 'Missile fully charged',
  lock: 'Missile locks onto a target',
  missile: 'Missile launch',
  missileEmpty: 'Out of missiles',
  boost: 'Boost',
  roll: 'Barrel roll',
  nova: 'Nova blast',
  novaReady: 'Nova charged',
  playerHit: 'Your ship takes damage',
  shipDown: 'Your ship is destroyed',
  heal: 'Healing orb collected',
  // ---- Enemies
  enemyShot: 'An enemy fires',
  mortarLaunch: 'A tower lobs a plasma bomb',
  mortarImpact: 'A plasma bomb lands',
  explosionSmall: 'Small enemy destroyed',
  explosionBig: 'Big explosion (towers, missiles, big enemies)',
  bossAppear: 'Boss arrives',
  // ---- Sortie flow
  sectorStart: 'A sector begins',
  sectorClear: 'Sector cleared',
  fail: 'Mission failed',
  powerOrb: 'Fly into the power orb',
  powerUp: 'Pick a power-up card',
  salvage: 'Salvage reward',
  repair: 'Hull repaired',
  gate: 'Fly through a gate',
  victory: 'Sortie won',
  // ---- Base and menus
  uiTap: 'Button tap',
  uiConfirm: 'Confirm / open',
  uiDeny: "Can't do that",
  door: 'Sliding door',
  talk: 'Dialogue text blip',
  buy: 'Buy something',
  launch: 'Ship launches from the hangar',
} as const;

export type SoundId = keyof typeof SOUND_IDS;

/**
 * Limits for sounds that can fire very often: `gap` = shortest time between two plays,
 * `voices` = most playing at once, `jitter` = random pitch variation so repeats don't drone.
 */
export const SOUND_RULES: Partial<Record<SoundId, { gap?: number; voices?: number; jitter?: number }>> = {
  gun: { gap: 0.035, voices: 6, jitter: 0.08 },
  scatter: { gap: 0.08, voices: 3, jitter: 0.06 },
  rail: { gap: 0.1, voices: 3, jitter: 0.04 },
  hit: { gap: 0.045, voices: 4, jitter: 0.25 },
  enemyShot: { gap: 0.07, voices: 4, jitter: 0.15 },
  mortarLaunch: { gap: 0.12, voices: 3, jitter: 0.1 },
  mortarImpact: { gap: 0.1, voices: 3, jitter: 0.1 },
  explosionSmall: { gap: 0.05, voices: 5, jitter: 0.2 },
  explosionBig: { gap: 0.08, voices: 4, jitter: 0.12 },
  playerHit: { gap: 0.12, jitter: 0.1 },
  talk: { gap: 0.055, jitter: 0.2 },
  door: { gap: 0.2 },
  lock: { gap: 0.15 },
  heal: { gap: 0.08 },
  uiTap: { gap: 0.04 },
};

// --------------------------------------------------------------------------- building blocks

interface Send {
  echo?: number;
  verb?: number;
}

interface ToneSpec extends Send {
  type?: OscillatorType;
  freq: number;
  /** Pitch at the end (glides there over the sound). */
  to?: number;
  dur: number;
  gain: number;
  attack?: number;
  /** Seconds from the start; defaults to 0. */
  at?: number;
  /** Detune a second oscillator by this many cents for a thick, chorused sound. */
  detune?: number;
  filter?: { type: BiquadFilterType; freq: number; to?: number; q?: number };
  /** Vibrato: [speed in Hz, depth in Hz]. */
  vibrato?: [number, number];
}

interface NoiseSpec extends Send {
  dur: number;
  gain: number;
  attack?: number;
  at?: number;
  filter: { type: BiquadFilterType; freq: number; to?: number; q?: number };
}

/** Route a voice to the sound's output and its echo/reverb sends. */
function connect(bus: Bus, out: GainNode, node: AudioNode, s: Send): void {
  node.connect(out);
  const vol = out.gain.value;
  for (const [amount, dest] of [
    [s.echo, bus.sfxEcho],
    [s.verb, bus.sfxVerb],
  ] as const) {
    if (!amount) continue;
    const g = bus.ctx.createGain();
    g.gain.value = amount * vol;
    node.connect(g).connect(dest);
  }
}

/** Fast attack, then an exponential fade to silence over `dur`. */
function envelope(g: AudioParam, t: number, peak: number, attack: number, dur: number): void {
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.exponentialRampToValueAtTime(0.0001, t + dur);
}

function glide(p: AudioParam, t: number, from: number, to: number | undefined, dur: number): void {
  p.setValueAtTime(from, t);
  if (to !== undefined && to !== from) p.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
}

function tone(bus: Bus, out: GainNode, t0: number, pitch: number, s: ToneSpec): number {
  const ctx = bus.ctx;
  const t = t0 + (s.at ?? 0);
  const g = ctx.createGain();
  envelope(g.gain, t, s.gain, s.attack ?? 0.003, s.dur);
  let last: AudioNode = g;
  if (s.filter) {
    const f = ctx.createBiquadFilter();
    f.type = s.filter.type;
    f.Q.value = s.filter.q ?? 1;
    glide(f.frequency, t, s.filter.freq, s.filter.to, s.dur);
    g.connect(f);
    last = f;
  }
  const oscs = s.detune ? [-s.detune / 2, s.detune / 2] : [0];
  for (const cents of oscs) {
    const o = ctx.createOscillator();
    o.type = s.type ?? 'square';
    o.detune.value = cents;
    glide(o.frequency, t, s.freq * pitch, s.to !== undefined ? s.to * pitch : undefined, s.dur);
    if (s.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = s.vibrato[0];
      depth.gain.value = s.vibrato[1] * pitch;
      lfo.connect(depth).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + s.dur + 0.05);
    }
    o.connect(g);
    o.start(t);
    o.stop(t + s.dur + 0.05);
  }
  connect(bus, out, last, s);
  return (s.at ?? 0) + s.dur;
}

function noise(bus: Bus, out: GainNode, t0: number, pitch: number, s: NoiseSpec): number {
  const ctx = bus.ctx;
  const t = t0 + (s.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = bus.noise;
  src.loop = true;
  src.loopStart = Math.random() * 0.5;
  const f = ctx.createBiquadFilter();
  f.type = s.filter.type;
  f.Q.value = s.filter.q ?? 1;
  glide(f.frequency, t, s.filter.freq * pitch, s.filter.to !== undefined ? s.filter.to * pitch : undefined, s.dur);
  const g = ctx.createGain();
  envelope(g.gain, t, s.gain, s.attack ?? 0.003, s.dur);
  src.connect(f).connect(g);
  src.start(t, src.loopStart);
  src.stop(t + s.dur + 0.05);
  connect(bus, out, g, s);
  return (s.at ?? 0) + s.dur;
}

/** Several notes one after another (`step` seconds apart). */
function arp(bus: Bus, out: GainNode, t: number, pitch: number, notes: number[], step: number, s: Omit<ToneSpec, 'freq' | 'at'>): number {
  let end = 0;
  notes.forEach((n, i) => (end = Math.max(end, tone(bus, out, t, pitch, { ...s, freq: n, at: i * step }))));
  return end;
}

/** A note's frequency: `semitones` above A4 (440 Hz). */
const hz = (semitones: number) => 440 * Math.pow(2, semitones / 12);

function boom(bus: Bus, out: GainNode, t: number, p: number, size: number): number {
  const d = 0.35 + size * 0.75;
  return Math.max(
    noise(bus, out, t, p, { dur: d, gain: 0.3 + size * 0.15, attack: 0.002, filter: { type: 'lowpass', freq: 3200, to: 140, q: 0.7 }, verb: 0.4 * size }),
    tone(bus, out, t, p, { type: 'sine', freq: 140 - size * 40, to: 32, dur: d * 0.9, gain: 0.42 }),
    tone(bus, out, t, p, { type: 'sawtooth', freq: 90, to: 30, dur: d * 0.5, gain: 0.12 + size * 0.1, filter: { type: 'lowpass', freq: 900, to: 120 } }),
  );
}

// --------------------------------------------------------------------------- the sounds

type Synth = (bus: Bus, out: GainNode, t: number, p: number) => number;

const SYNTHS: Record<SoundId, Synth> = {
  gun: (b, o, t, p) =>
    Math.max(
      tone(b, o, t, p, { type: 'square', freq: 1100, to: 260, dur: 0.07, gain: 0.11, filter: { type: 'lowpass', freq: 4000, to: 900 } }),
      noise(b, o, t, p, { dur: 0.03, gain: 0.08, filter: { type: 'highpass', freq: 3000 } }),
    ),
  scatter: (b, o, t, p) =>
    Math.max(
      noise(b, o, t, p, { dur: 0.16, gain: 0.28, filter: { type: 'bandpass', freq: 2200, to: 380, q: 0.8 } }),
      tone(b, o, t, p, { type: 'square', freq: 320, to: 80, dur: 0.14, gain: 0.12, filter: { type: 'lowpass', freq: 1600 } }),
    ),
  rail: (b, o, t, p) =>
    Math.max(
      tone(b, o, t, p, { type: 'sawtooth', freq: 2600, to: 180, dur: 0.38, gain: 0.16, detune: 18, filter: { type: 'lowpass', freq: 6000, to: 600, q: 6 }, echo: 0.35 }),
      tone(b, o, t, p, { type: 'sine', freq: 180, to: 60, dur: 0.25, gain: 0.18 }),
    ),
  hit: (b, o, t, p) => tone(b, o, t, p, { type: 'triangle', freq: 1500, to: 900, dur: 0.04, gain: 0.07 }),
  charge: (b, o, t, p) => tone(b, o, t, p, { type: 'sawtooth', freq: 180, to: 720, dur: 0.6, gain: 0.07, attack: 0.08, detune: 14, filter: { type: 'lowpass', freq: 500, to: 3000, q: 5 } }),
  chargeFull: (b, o, t, p) => arp(b, o, t, p, [hz(15), hz(22)], 0.06, { type: 'square', dur: 0.09, gain: 0.08, echo: 0.3 }),
  lock: (b, o, t, p) => arp(b, o, t, p, [hz(27), hz(27)], 0.07, { type: 'square', dur: 0.045, gain: 0.07, filter: { type: 'lowpass', freq: 5000 } }),
  missile: (b, o, t, p) =>
    Math.max(
      noise(b, o, t, p, { dur: 0.5, gain: 0.3, attack: 0.02, filter: { type: 'bandpass', freq: 500, to: 2400, q: 1.5 }, echo: 0.2 }),
      tone(b, o, t, p, { type: 'sawtooth', freq: 160, to: 520, dur: 0.35, gain: 0.08, detune: 20, filter: { type: 'lowpass', freq: 1800 } }),
    ),
  missileEmpty: (b, o, t, p) => arp(b, o, t, p, [110, 98], 0.08, { type: 'square', dur: 0.07, gain: 0.08, filter: { type: 'lowpass', freq: 700 } }),
  boost: (b, o, t, p) =>
    Math.max(
      noise(b, o, t, p, { dur: 0.55, gain: 0.32, attack: 0.03, filter: { type: 'bandpass', freq: 300, to: 3600, q: 1.2 }, echo: 0.25 }),
      tone(b, o, t, p, { type: 'sawtooth', freq: 90, to: 420, dur: 0.45, gain: 0.1, detune: 25, filter: { type: 'lowpass', freq: 600, to: 3000, q: 4 } }),
    ),
  roll: (b, o, t, p) => noise(b, o, t, p, { dur: 0.38, gain: 0.4, attack: 0.08, filter: { type: 'bandpass', freq: 700, to: 2600, q: 2.5 } }),
  nova: (b, o, t, p) =>
    Math.max(
      tone(b, o, t, p, { type: 'sine', freq: 90, to: 28, dur: 1.4, gain: 0.55 }),
      tone(b, o, t, p, { type: 'sawtooth', freq: 2400, to: 90, dur: 1.1, gain: 0.18, detune: 30, filter: { type: 'lowpass', freq: 8000, to: 300, q: 8 }, echo: 0.4, verb: 0.5 }),
      noise(b, o, t, p, { dur: 1.2, gain: 0.35, filter: { type: 'lowpass', freq: 5000, to: 200 }, verb: 0.5 }),
    ),
  novaReady: (b, o, t, p) => arp(b, o, t, p, [hz(3), hz(7), hz(10), hz(15)], 0.07, { type: 'square', dur: 0.14, gain: 0.06, filter: { type: 'lowpass', freq: 3500 }, echo: 0.45 }),
  playerHit: (b, o, t, p) =>
    Math.max(
      tone(b, o, t, p, { type: 'square', freq: 240, to: 70, dur: 0.22, gain: 0.2, filter: { type: 'lowpass', freq: 2000, to: 300 } }),
      noise(b, o, t, p, { dur: 0.2, gain: 0.3, filter: { type: 'bandpass', freq: 1400, to: 300, q: 1 } }),
    ),
  shipDown: (b, o, t, p) =>
    Math.max(
      boom(b, o, t, p, 1.2),
      tone(b, o, t, p, { type: 'sawtooth', freq: 700, to: 40, dur: 1.6, gain: 0.15, detune: 30, filter: { type: 'lowpass', freq: 3000, to: 200 }, echo: 0.4 }),
    ),
  heal: (b, o, t, p) => arp(b, o, t, p, [hz(15), hz(19), hz(22), hz(27)], 0.05, { type: 'triangle', dur: 0.22, gain: 0.1, echo: 0.4 }),
  enemyShot: (b, o, t, p) => tone(b, o, t, p, { type: 'triangle', freq: 420, to: 1100, dur: 0.11, gain: 0.11, filter: { type: 'lowpass', freq: 2500 } }),
  mortarLaunch: (b, o, t, p) =>
    Math.max(
      tone(b, o, t, p, { type: 'sine', freq: 200, to: 55, dur: 0.28, gain: 0.35 }),
      noise(b, o, t, p, { dur: 0.15, gain: 0.15, filter: { type: 'lowpass', freq: 1200 } }),
      tone(b, o, t, p, { type: 'sawtooth', freq: 300, to: 900, dur: 0.5, gain: 0.035, at: 0.05, filter: { type: 'lowpass', freq: 1500 }, echo: 0.3 }),
    ),
  mortarImpact: (b, o, t, p) => boom(b, o, t, p * 0.8, 0.8),
  explosionSmall: (b, o, t, p) => boom(b, o, t, p, 0.35),
  explosionBig: (b, o, t, p) => boom(b, o, t, p, 0.9),
  bossAppear: (b, o, t, p) =>
    Math.max(
      tone(b, o, t, p, { type: 'sawtooth', freq: 55, dur: 2.2, gain: 0.3, attack: 0.3, detune: 22, filter: { type: 'lowpass', freq: 200, to: 1600, q: 8 }, verb: 0.5 }),
      tone(b, o, t, p, { type: 'square', freq: 440, dur: 1.6, gain: 0.05, attack: 0.05, vibrato: [3, 110], filter: { type: 'lowpass', freq: 2000 }, echo: 0.4 }),
    ),
  sectorStart: (b, o, t, p) =>
    Math.max(
      tone(b, o, t, p, { type: 'sawtooth', freq: hz(-5), dur: 0.9, gain: 0.09, attack: 0.02, detune: 20, filter: { type: 'lowpass', freq: 400, to: 3500, q: 3 }, verb: 0.3 }),
      tone(b, o, t, p, { type: 'sawtooth', freq: hz(2), dur: 0.9, gain: 0.07, attack: 0.02, detune: 20, filter: { type: 'lowpass', freq: 400, to: 3500, q: 3 }, verb: 0.3 }),
      tone(b, o, t, p, { type: 'sawtooth', freq: hz(7), dur: 0.9, gain: 0.06, attack: 0.02, detune: 20, filter: { type: 'lowpass', freq: 400, to: 3500, q: 3 }, echo: 0.3 }),
    ),
  sectorClear: (b, o, t, p) => arp(b, o, t, p, [hz(3), hz(7), hz(10), hz(15), hz(19)], 0.08, { type: 'sawtooth', dur: 0.4, gain: 0.07, detune: 16, filter: { type: 'lowpass', freq: 3500 }, echo: 0.45 }),
  fail: (b, o, t, p) => arp(b, o, t, p, [hz(3), hz(-2), hz(-6), hz(-9)], 0.16, { type: 'sawtooth', dur: 0.5, gain: 0.08, detune: 20, filter: { type: 'lowpass', freq: 2000, to: 300 }, verb: 0.4 }),
  powerOrb: (b, o, t, p) => arp(b, o, t, p, [hz(3), hz(10), hz(15), hz(22), hz(27)], 0.045, { type: 'triangle', dur: 0.5, gain: 0.08, echo: 0.5, verb: 0.3 }),
  powerUp: (b, o, t, p) =>
    Math.max(
      tone(b, o, t, p, { type: 'sawtooth', freq: 220, to: 880, dur: 0.3, gain: 0.07, detune: 20, filter: { type: 'lowpass', freq: 800, to: 5000, q: 4 } }),
      arp(b, o, t + 0.2, p, [hz(7), hz(14), hz(19)], 0.01, { type: 'square', dur: 0.6, gain: 0.05, filter: { type: 'lowpass', freq: 3000 }, echo: 0.4 }),
    ),
  salvage: (b, o, t, p) => arp(b, o, t, p, [hz(14), hz(19)], 0.07, { type: 'square', dur: 0.16, gain: 0.07, echo: 0.3 }),
  repair: (b, o, t, p) =>
    Math.max(
      tone(b, o, t, p, { type: 'sine', freq: 330, to: 880, dur: 0.6, gain: 0.12, echo: 0.3 }),
      arp(b, o, t + 0.3, p, [hz(3), hz(7), hz(12)], 0.06, { type: 'triangle', dur: 0.4, gain: 0.07, echo: 0.4 }),
    ),
  gate: (b, o, t, p) =>
    Math.max(
      noise(b, o, t, p, { dur: 0.9, gain: 0.4, attack: 0.25, filter: { type: 'bandpass', freq: 400, to: 4000, q: 2 }, verb: 0.4 }),
      tone(b, o, t, p, { type: 'sawtooth', freq: 110, to: 440, dur: 0.9, gain: 0.07, attack: 0.2, detune: 25, filter: { type: 'lowpass', freq: 500, to: 3000 }, echo: 0.3 }),
    ),
  victory: (b, o, t, p) =>
    Math.max(
      arp(b, o, t, p, [hz(3), hz(7), hz(10), hz(15), hz(10), hz(15), hz(19), hz(22)], 0.11, { type: 'sawtooth', dur: 0.5, gain: 0.07, detune: 18, filter: { type: 'lowpass', freq: 3500 }, echo: 0.4 }),
      tone(b, o, t + 0.9, p, { type: 'sawtooth', freq: hz(-9), dur: 1.6, gain: 0.08, attack: 0.05, detune: 25, filter: { type: 'lowpass', freq: 600, to: 2500 }, verb: 0.5 }),
    ),
  uiTap: (b, o, t, p) => tone(b, o, t, p, { type: 'sine', freq: 1300, to: 1100, dur: 0.05, gain: 0.08 }),
  uiConfirm: (b, o, t, p) => arp(b, o, t, p, [hz(10), hz(17)], 0.055, { type: 'square', dur: 0.08, gain: 0.05, filter: { type: 'lowpass', freq: 3500 }, echo: 0.25 }),
  uiDeny: (b, o, t, p) => arp(b, o, t, p, [180, 150], 0.09, { type: 'square', dur: 0.08, gain: 0.06, filter: { type: 'lowpass', freq: 900 } }),
  door: (b, o, t, p) =>
    Math.max(
      noise(b, o, t, p, { dur: 0.45, gain: 0.12, attack: 0.02, filter: { type: 'highpass', freq: 3500, to: 1800 }, verb: 0.2 }),
      tone(b, o, t, p, { type: 'sawtooth', freq: 85, to: 130, dur: 0.4, gain: 0.05, filter: { type: 'lowpass', freq: 400 } }),
    ),
  talk: (b, o, t, p) => tone(b, o, t, p, { type: 'square', freq: 620 + Math.random() * 180, dur: 0.03, gain: 0.06, filter: { type: 'lowpass', freq: 2200 } }),
  buy: (b, o, t, p) =>
    Math.max(
      arp(b, o, t, p, [hz(15), hz(22), hz(27)], 0.06, { type: 'square', dur: 0.15, gain: 0.06, echo: 0.35 }),
      noise(b, o, t, p, { dur: 0.25, gain: 0.05, at: 0.12, filter: { type: 'highpass', freq: 6000 } }),
    ),
  launch: (b, o, t, p) =>
    Math.max(
      tone(b, o, t, p, { type: 'sawtooth', freq: 45, to: 260, dur: 3.2, gain: 0.14, attack: 0.6, detune: 25, filter: { type: 'lowpass', freq: 250, to: 2400, q: 3 }, verb: 0.5 }),
      noise(b, o, t + 1.2, p, { dur: 2.2, gain: 0.3, attack: 0.6, filter: { type: 'bandpass', freq: 300, to: 2000, q: 1 }, verb: 0.4 }),
    ),
};

/** Play a synthesized sound into `out`; returns how long it lasts in seconds. */
export function playSynth(id: SoundId, bus: Bus, out: GainNode, t: number, pitch: number): number {
  return SYNTHS[id](bus, out, t, pitch);
}
