/**
 * Synthwave music, played live by a small step sequencer: pads, an arpeggiator, bass and drum
 * machine, run through tape echo and reverb. Three songs:
 *
 * - base:   slow and dreamy, for walking around the station
 * - sortie: driving, for missions
 * - boss:   same pace as the sortie song, lower and darker, for boss fights
 *
 * Each song can be replaced by your own looping file (`music-base`, `music-sortie`,
 * `music-boss` in public/sfx/sounds.json).
 */
import type { Bus } from './Audio';

export const MUSIC_IDS = {
  'music-base': 'Station music (loops)',
  'music-sortie': 'Sortie music (loops)',
  'music-boss': 'Boss fight music (loops)',
} as const;

export type SongId = 'base' | 'sortie' | 'boss';

interface Song {
  bpm: number;
  /** Chord tones in semitones from A4 (lowest first). */
  chords: number[][];
  /** Bars each chord lasts. */
  barsPerChord: number;
  /** 16 steps per bar. Bass: x = root, o = root an octave up, 5 = fifth, - = hold, . = rest. */
  bass: string;
  /** Arpeggio: digits pick chord tones (0 = lowest), . = rest. */
  arp: string;
  arpOctave: number;
  arpWave: OscillatorType;
  arpGain: number;
  kick: string;
  snare: string;
  hat: string;
  pad: number;
  level: number;
}

const SONGS: Record<SongId, Song> = {
  base: {
    bpm: 84,
    chords: [
      [-12, -9, -5, -2, 2], // Am9
      [-16, -12, -9, -5, -2], // Fmaj7(9)
      [-9, -5, -2, 2, 5], // Cmaj7
      [-14, -10, -7, -5, 0], // G6
    ],
    barsPerChord: 2,
    bass: 'x---------------',
    arp: '0.2.4.3.1.3.2.4.',
    arpOctave: 12,
    arpWave: 'triangle',
    arpGain: 0.035,
    kick: 'x.........x.....',
    snare: '................',
    hat: '....x.......x...',
    pad: 0.016,
    level: 1.3,
  },
  sortie: {
    bpm: 118,
    chords: [
      [-7, -4, 0, 5], // Dm
      [-11, -7, -4, 1], // Bb
      [-16, -12, -9, -4], // F
      [-9, -5, -2, 3], // C
    ],
    barsPerChord: 1,
    bass: 'x.xox.xox.xox.5o',
    arp: '0123210301232103',
    arpOctave: 12,
    arpWave: 'square',
    arpGain: 0.022,
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: '..x...x...x...xx',
    pad: 0.011,
    level: 1.25,
  },
  boss: {
    // Same tempo as the sortie song, but an octave lower, in a dark minor key with a sparse,
    // creeping pattern: more serious, not faster.
    bpm: 118,
    chords: [
      [-12, -9, -5, 0], // Am
      [-11, -7, -4, 1], // Bb (the half-step up is what makes it ominous)
      [-12, -9, -5, 0], // Am
      [-17, -13, -10, -5], // E
    ],
    barsPerChord: 1,
    bass: 'x.x.x.x.x.x.x.x.',
    arp: '0..1..2.3..2..1.',
    arpOctave: 0,
    arpWave: 'square',
    arpGain: 0.03,
    kick: 'x.......x.......',
    snare: '....x.......x...',
    hat: '..x...x...x...x.',
    pad: 0.013,
    level: 1.3,
  },
};

const hz = (semitones: number) => 440 * Math.pow(2, semitones / 12);
const LOOKAHEAD = 0.15;

/** One song playing: its own output (for crossfades) and sequencer position. */
interface Playing {
  id: SongId;
  out: GainNode;
  echo: GainNode;
  verb: GainNode;
  step: number;
  next: number;
  file: AudioBufferSourceNode | null;
}

export class MusicPlayer {
  private current: Playing | null = null;
  private files = new Map<SongId, AudioBuffer>();
  private timer = 0;

  constructor(private readonly bus: Bus) {}

  /** Use a recording instead of the built-in song. */
  setFile(id: SongId, buf: AudioBuffer): void {
    this.files.set(id, buf);
    if (this.current?.id === id) {
      this.play(null);
      this.play(id);
    }
  }

  play(id: SongId | null): void {
    if (this.current?.id === id) return;
    const ctx = this.bus.ctx;
    const t = ctx.currentTime;
    // Fade out what's playing.
    const old = this.current;
    if (old) {
      for (const g of [old.out, old.echo, old.verb]) {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + 1.2);
      }
      old.file?.stop(t + 1.3);
      window.setTimeout(() => {
        old.out.disconnect();
        old.echo.disconnect();
        old.verb.disconnect();
      }, 1500);
    }
    this.current = null;
    window.clearInterval(this.timer);
    if (!id) return;

    const song = SONGS[id];
    const mk = (to: AudioNode) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(song.level, t + 0.5); // in quickly, so music is heard right away
      g.connect(to);
      return g;
    };
    const p: Playing = { id, out: mk(this.bus.music), echo: mk(this.bus.musicEcho), verb: mk(this.bus.musicVerb), step: 0, next: t + 0.1, file: null };
    this.current = p;
    const file = this.files.get(id);
    if (file) {
      const src = ctx.createBufferSource();
      src.buffer = file;
      src.loop = true;
      src.connect(p.out);
      src.start(t);
      p.file = src;
      return;
    }
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  private schedule(): void {
    const p = this.current;
    if (!p || p.file) return;
    const song = SONGS[p.id];
    const stepDur = 60 / song.bpm / 4;
    const ctx = this.bus.ctx;
    // If we fell far behind (the app was in the background), skip ahead instead of catching up.
    if (p.next < ctx.currentTime - 0.5) p.next = ctx.currentTime + 0.05;
    while (p.next < ctx.currentTime + LOOKAHEAD) {
      this.playStep(p, song, p.step, p.next, stepDur);
      p.step++;
      p.next += stepDur;
    }
  }

  private playStep(p: Playing, s: Song, step: number, t: number, sd: number): void {
    const i = step % 16;
    const bar = Math.floor(step / 16);
    const chordIndex = Math.floor(bar / s.barsPerChord) % s.chords.length;
    const chord = s.chords[chordIndex];
    const root = chord[0] - 24;

    // Pad: a slow chord at the start of each chord change.
    if (i === 0 && bar % s.barsPerChord === 0) {
      const len = sd * 16 * s.barsPerChord;
      for (const n of chord) this.padNote(p, hz(n), t, len, s.pad);
    }
    // Bass.
    const b = s.bass[i];
    if (b && b !== '.' && b !== '-') {
      let hold = 1;
      while (s.bass[i + hold] === '-') hold++;
      const note = b === 'o' ? root + 12 : b === '5' ? root + 7 : root;
      this.bassNote(p, hz(note), t, sd * Math.max(0.9, hold * 0.95));
    }
    // Arpeggio.
    const a = s.arp[i];
    if (a && a !== '.') {
      const n = chord[Number(a) % chord.length] + s.arpOctave;
      this.pluck(p, hz(n), t, sd * 1.6, s.arpWave, s.arpGain);
    }
    // Drums.
    if (s.kick[i] === 'x') this.kick(p, t);
    if (s.snare[i] === 'x') this.snare(p, t);
    if (s.hat[i] === 'x') this.hat(p, t, i % 4 === 2 ? 1 : 0.6);
  }

  // ------------------------------------------------------------------ instruments

  private voice(p: Playing, node: AudioNode, echo = 0, verb = 0): void {
    node.connect(p.out);
    const ctx = this.bus.ctx;
    if (echo) {
      const g = ctx.createGain();
      g.gain.value = echo;
      node.connect(g).connect(p.echo);
    }
    if (verb) {
      const g = ctx.createGain();
      g.gain.value = verb;
      node.connect(g).connect(p.verb);
    }
  }

  private padNote(p: Playing, f: number, t: number, len: number, gain: number): void {
    const ctx = this.bus.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.8, len * 0.3));
    g.gain.setValueAtTime(gain, t + len * 0.85);
    g.gain.linearRampToValueAtTime(0, t + len + 0.4);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.linearRampToValueAtTime(1400, t + len * 0.5);
    filter.frequency.linearRampToValueAtTime(700, t + len);
    for (const d of [-9, 9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = d;
      o.connect(g);
      o.start(t);
      o.stop(t + len + 0.5);
    }
    g.connect(filter);
    this.voice(p, filter, 0.15, 0.5);
  }

  private bassNote(p: Playing, f: number, t: number, len: number): void {
    const ctx = this.bus.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.006);
    g.gain.setTargetAtTime(0.06, t + 0.02, 0.08);
    g.gain.setTargetAtTime(0.0001, t + len, 0.03);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(1400, t);
    filter.frequency.exponentialRampToValueAtTime(220, t + Math.min(0.25, len));
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = f;
    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = f / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.4;
    saw.connect(filter);
    sub.connect(subGain).connect(filter);
    filter.connect(g);
    for (const o of [saw, sub]) {
      o.start(t);
      o.stop(t + len + 0.2);
    }
    this.voice(p, g);
  }

  private pluck(p: Playing, f: number, t: number, len: number, wave: OscillatorType, gain: number): void {
    const ctx = this.bus.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(4200, t);
    filter.frequency.exponentialRampToValueAtTime(900, t + len);
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.value = f;
    o.connect(filter).connect(g);
    o.start(t);
    o.stop(t + len + 0.05);
    this.voice(p, g, 0.45, 0.15);
  }

  private kick(p: Playing, t: number): void {
    const ctx = this.bus.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.32);
    this.voice(p, g);
  }

  private noiseHit(p: Playing, t: number, type: BiquadFilterType, freq: number, gain: number, dur: number, verb: number): void {
    const ctx = this.bus.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.bus.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    const offset = Math.random() * 0.8;
    src.start(t, offset);
    src.stop(t + dur + 0.02);
    this.voice(p, g, 0, verb);
  }

  private snare(p: Playing, t: number): void {
    this.noiseHit(p, t, 'bandpass', 1900, 0.2, 0.2, 0.5);
    const ctx = this.bus.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.12);
    this.voice(p, g);
  }

  private hat(p: Playing, t: number, accent: number): void {
    this.noiseHit(p, t, 'highpass', 8000, 0.05 * accent, 0.045, 0);
  }
}
