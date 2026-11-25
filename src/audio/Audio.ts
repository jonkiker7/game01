/**
 * All game audio: synthesized retro-future sound effects, synthwave music, and slots for your
 * own sound files.
 *
 * Every sound is made in code by default (see `Sfx.ts` for effects, `Music.ts` for songs), so
 * nothing needs downloading. To use your own recording instead, put the file in `public/sfx/`
 * and name it in `public/sfx/sounds.json`, e.g. `{ "gun": "my-gun.wav" }`. Any sound id from
 * `SOUND_IDS` works, plus `music-base`, `music-sortie` and `music-boss` for looping music.
 */
import { MUSIC_IDS, MusicPlayer, type SongId } from './Music';
import { playSynth, SOUND_IDS, type SoundId, SOUND_RULES } from './Sfx';

export type { SoundId, SongId };
export { SOUND_IDS, MUSIC_IDS };

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

const VOLUME_KEY = 'star-rotor-audio';
const DEFAULT_VOLUMES: Volumes = { master: 0.8, music: 0.7, sfx: 0.85, muted: false };

function loadVolumes(): Volumes {
  try {
    const v = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? '{}') as Partial<Volumes>;
    return { ...DEFAULT_VOLUMES, ...v };
  } catch {
    return { ...DEFAULT_VOLUMES };
  }
}

export interface PlayOptions {
  /** Pitch multiplier (1 = normal). */
  pitch?: number;
  /** Volume multiplier (1 = normal). */
  volume?: number;
  /** Left (-1) to right (1). */
  pan?: number;
}

/** Shared nodes every sound and song plays through. */
export interface Bus {
  ctx: AudioContext;
  /** Sound effects go here. */
  sfx: GainNode;
  /** Sound effects' sends to the tape-style echo (retro-future shimmer) and the reverb. */
  sfxEcho: GainNode;
  sfxVerb: GainNode;
  /** Music goes here, with its own echo and reverb sends. */
  music: GainNode;
  musicEcho: GainNode;
  musicVerb: GainNode;
  /** One second of white noise, reused by every noisy sound. */
  noise: AudioBuffer;
}

class AudioEngine {
  readonly volumes = loadVolumes();
  private bus: Bus | null = null;
  private master: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private music: MusicPlayer | null = null;
  private engine: { gain: GainNode; a: OscillatorNode; b: OscillatorNode; filter: BiquadFilterNode } | null = null;
  /** Your own sound files, by sound id, once loaded. */
  private files = new Map<string, AudioBuffer>();
  private fileBytes = new Map<string, ArrayBuffer>();
  private last = new Map<SoundId, number>();
  private playing = new Map<SoundId, number>();
  private wantSong: SongId | null = null;
  private ducked = false;

  constructor() {
    // Browsers only allow sound after the player touches the screen or presses a key.
    // (iPhones only count the finger lifting, hence touchend/pointerup as well.)
    const events = ['pointerdown', 'pointerup', 'touchend', 'keydown'];
    const unlock = () => {
      this.start();
      if (this.bus?.ctx.state === 'running') for (const e of events) window.removeEventListener(e, unlock, true);
    };
    for (const e of events) window.addEventListener(e, unlock, true);
    document.addEventListener('visibilitychange', () => {
      if (!this.bus) return;
      if (document.hidden) void this.bus.ctx.suspend();
      else void this.bus.ctx.resume();
    });
    void this.loadFiles();
  }

  /** Fetch the files listed in public/sfx/sounds.json (if any). */
  private async loadFiles(): Promise<void> {
    try {
      const base = `${import.meta.env.BASE_URL}sfx/`;
      const res = await fetch(`${base}sounds.json`, { cache: 'no-cache' });
      if (!res.ok) return;
      const list = (await res.json()) as Record<string, string>;
      await Promise.all(
        Object.entries(list).map(async ([id, file]) => {
          if (typeof file !== 'string' || !file) return;
          const r = await fetch(base + file);
          if (r.ok) this.fileBytes.set(id, await r.arrayBuffer());
        }),
      );
      this.decodeFiles();
    } catch {
      /* no custom sounds: the synthesized ones play */
    }
  }

  private decodeFiles(): void {
    const ctx = this.bus?.ctx;
    if (!ctx) return;
    for (const [id, bytes] of this.fileBytes) {
      this.fileBytes.delete(id);
      ctx.decodeAudioData(bytes).then(
        (buf) => {
          this.files.set(id, buf);
          if (id.startsWith('music-')) this.music?.setFile(id.slice(6) as SongId, buf);
        },
        () => console.warn(`Couldn't read the sound file for "${id}"`),
      );
    }
  }

  /** Create the audio graph (on the first touch). */
  private start(): void {
    if (this.bus) {
      if (this.bus.ctx.state !== 'running' && !document.hidden) void this.bus.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    // A little make-up gain after the limiter so the game isn't quieter than other apps.
    const makeup = ctx.createGain();
    makeup.gain.value = 1.6;
    master.connect(limiter).connect(makeup).connect(ctx.destination);

    const sfx = ctx.createGain();
    sfx.connect(master);
    const musicFilter = ctx.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicFilter.frequency.value = 20000;
    const music = ctx.createGain();
    music.connect(musicFilter).connect(master);

    // Tape echo: a dark, slightly wobbly delay that repeats a few times.
    const echo = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.27;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    const wobble = ctx.createOscillator();
    const wobbleAmt = ctx.createGain();
    wobble.frequency.value = 0.6;
    wobbleAmt.gain.value = 0.0025;
    wobble.connect(wobbleAmt).connect(delay.delayTime);
    wobble.start();
    echo.connect(delay);
    delay.connect(tone).connect(fb).connect(delay);
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.5;
    tone.connect(echoOut).connect(master);

    // Reverb: a generated 2-second tail, like a big metal hall.
    const verb = ctx.createGain();
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    conv.buffer = ir;
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.35;
    verb.connect(conv).connect(verbOut).connect(master);

    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    const send = (to: AudioNode) => {
      const g = ctx.createGain();
      g.connect(to);
      return g;
    };
    this.bus = { ctx, sfx, music, sfxEcho: send(echo), sfxVerb: send(verb), musicEcho: send(echo), musicVerb: send(verb), noise };
    this.master = master;
    this.musicFilter = musicFilter;
    this.applyVolumes();
    this.music = new MusicPlayer(this.bus);
    for (const [id, buf] of this.files) if (id.startsWith('music-')) this.music.setFile(id.slice(6) as SongId, buf);
    this.decodeFiles();
    if (this.wantSong) this.music.play(this.wantSong);
    this.setDucked(this.ducked);
    void ctx.resume();
  }

  /** Play a sound effect (your file if there is one, otherwise the synthesized one). */
  play(id: SoundId, opts: PlayOptions = {}): void {
    const bus = this.bus;
    if (!bus || bus.ctx.state !== 'running' || this.volumes.muted) return;
    const now = bus.ctx.currentTime;
    const rule = SOUND_RULES[id];
    // Rapid-fire sounds are limited so they don't pile into noise.
    if (rule?.gap && now - (this.last.get(id) ?? -1) < rule.gap) return;
    if (rule?.voices && (this.playing.get(id) ?? 0) >= rule.voices) return;
    this.last.set(id, now);
    const pitch = (opts.pitch ?? 1) * (rule?.jitter ? 1 + (Math.random() - 0.5) * rule.jitter : 1);
    // Each sound plays into its own volume (and left/right) control.
    const out = bus.ctx.createGain();
    out.gain.value = opts.volume ?? 1;
    if (opts.pan && bus.ctx.createStereoPanner) {
      const p = bus.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      out.connect(p).connect(bus.sfx);
    } else out.connect(bus.sfx);
    const file = this.files.get(id);
    let dur: number;
    if (file) {
      const src = bus.ctx.createBufferSource();
      src.buffer = file;
      src.playbackRate.value = pitch;
      src.connect(out);
      src.start(now);
      dur = file.duration / pitch;
    } else {
      dur = playSynth(id, bus, out, now, pitch);
    }
    if (rule?.voices) {
      this.playing.set(id, (this.playing.get(id) ?? 0) + 1);
      window.setTimeout(() => this.playing.set(id, Math.max(0, (this.playing.get(id) ?? 1) - 1)), dur * 1000 + 30);
    }
  }

  /** Switch music (crossfades). null fades the music out. */
  song(id: SongId | null): void {
    this.wantSong = id;
    this.music?.play(id);
  }

  /** Muffle the music (pause menu, choosing a power-up). */
  setDucked(on: boolean): void {
    this.ducked = on;
    const f = this.musicFilter;
    if (!f || !this.bus) return;
    const t = this.bus.ctx.currentTime;
    f.frequency.cancelScheduledValues(t);
    f.frequency.setTargetAtTime(on ? 700 : 20000, t, on ? 0.08 : 0.25);
  }

  /**
   * The ship's engine hum, which rises with speed. 0 silences it (at the base, or when the
   * ship is down); `boost` adds a brighter roar.
   */
  setEngine(throttle: number, boost = false): void {
    const bus = this.bus;
    if (!bus || bus.ctx.state !== 'running') return;
    if (!this.engine) {
      if (throttle <= 0) return;
      const ctx = bus.ctx;
      const a = ctx.createOscillator();
      const b = ctx.createOscillator();
      a.type = 'sawtooth';
      b.type = 'square';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 4;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      a.connect(filter);
      b.connect(filter);
      filter.connect(gain).connect(bus.sfx);
      a.start();
      b.start();
      this.engine = { gain, a, b, filter };
    }
    const e = this.engine;
    const t = bus.ctx.currentTime;
    const k = Math.max(0, Math.min(1, throttle));
    const on = throttle > 0 && !this.volumes.muted;
    e.gain.gain.setTargetAtTime(on ? 0.035 + k * 0.03 + (boost ? 0.04 : 0) : 0, t, 0.08);
    e.a.frequency.setTargetAtTime(48 + k * 26 + (boost ? 30 : 0), t, 0.15);
    e.b.frequency.setTargetAtTime(24.3 + k * 13 + (boost ? 15 : 0), t, 0.15);
    e.filter.frequency.setTargetAtTime(260 + k * 420 + (boost ? 900 : 0), t, 0.1);
  }

  setVolumes(v: Partial<Volumes>): void {
    Object.assign(this.volumes, v);
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify(this.volumes));
    } catch {
      /* private mode */
    }
    this.applyVolumes();
  }

  private applyVolumes(): void {
    const b = this.bus;
    if (!b || !this.master) return;
    const t = b.ctx.currentTime;
    const v = this.volumes;
    // Squared so the sliders feel even (ears hear loudness roughly logarithmically).
    this.master.gain.setTargetAtTime(v.muted ? 0 : v.master * v.master, t, 0.03);
    for (const g of [b.music, b.musicEcho, b.musicVerb]) g.gain.setTargetAtTime(v.music * v.music, t, 0.03);
    for (const g of [b.sfx, b.sfxEcho, b.sfxVerb]) g.gain.setTargetAtTime(v.sfx * v.sfx, t, 0.03);
  }
}

/** The one audio engine for the whole game. */
export const audio = new AudioEngine();
