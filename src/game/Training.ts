/**
 * Flight training's coach: a prompt at the top of the screen that walks you through the
 * controls one at a time ("Try a missile", "Try boosting"…), moving on when you've done each
 * one. The button for the current step pulses, an animated thumb shows how to aim, and a big
 * EXIT TRAINING button is always there.
 */

export type CoachEvent = 'move' | 'gunHit' | 'kill' | 'missile' | 'boost' | 'roll' | 'nova';

interface Step {
  text: string;
  /** Buttons to pulse (element ids). */
  glow: string[];
  /** Show the thumb demo over this button ('stick' = the movement stick's corner). */
  demo?: 'btn-gun' | 'btn-missile' | 'stick';
  /** What finishes the step. */
  done: CoachEvent[];
}

const STEPS: Step[] = [
  { text: 'Put your LEFT thumb anywhere on the left side and drag to fly around.', glow: [], demo: 'stick', done: ['move'] },
  {
    text: 'AIM: hold GUN and slide your thumb toward the drone. Your ship turns and fires wherever your thumb points. Shoot it down!',
    glow: ['btn-gun'],
    demo: 'btn-gun',
    done: ['kill'],
  },
  { text: 'Try a MISSILE: hold MSL, slide toward the drone to aim (it locks on), then let go to fire.', glow: ['btn-missile'], demo: 'btn-missile', done: ['missile'] },
  { text: 'Try BOOSTING: tap BOOST to dash. Nothing can hurt you while you boost.', glow: ['btn-boost'], done: ['boost'] },
  { text: 'Try a BARREL ROLL: tap one of the curved buttons beside BOOST to dodge left or right.', glow: ['btn-roll-l', 'btn-roll-r'], done: ['roll'] },
  { text: 'NOVA is charged: tap it to blast everything around you. It recharges over time.', glow: ['btn-special'], done: ['nova'] },
];

/** An animated thumb that shows the press-and-slide aiming gesture over a button. */
export class ThumbDemo {
  private readonly el: HTMLElement;
  private target: string | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'thumb-demo';
    this.el.innerHTML = '<div class="ring"></div><div class="thumb"></div>';
    root.appendChild(this.el);
    window.addEventListener('resize', () => this.place());
  }

  show(target: string | null): void {
    this.target = target;
    this.el.classList.toggle('show', !!target);
    this.el.classList.toggle('stick', target === 'stick');
    this.place();
  }

  /** Keep it over its button (call when the layout may have changed). */
  place(): void {
    if (!this.target) return;
    let x: number;
    let y: number;
    if (this.target === 'stick') {
      x = window.innerWidth * 0.16;
      y = window.innerHeight * 0.72;
    } else {
      const r = document.getElementById(this.target)?.getBoundingClientRect();
      if (!r || !r.width) return;
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
    this.el.style.transform = `translate(${x}px, ${y}px)`;
  }
}

export class TrainingCoach {
  private readonly panel: HTMLElement;
  private readonly exitBtn: HTMLElement;
  private readonly demo: ThumbDemo;
  private step = -1;
  private moved = 0;
  private lastX = NaN;
  private lastZ = NaN;
  active = false;
  /** Leave training (the EXIT TRAINING button). */
  onExit?: () => void;
  /** A step began (e.g. the Nova step charges Nova so you can try it). */
  onStep?: (index: number, done: CoachEvent[]) => void;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="coach"><div class="count"></div><div class="text"></div>
         <div class="row"><button class="min">▾ TAP TO MINIMIZE</button><button class="skip">skip step ›</button></div>
         <span class="expand">▸ tap to expand</span></div>
       <button id="btn-exit-training">✕ EXIT TRAINING</button>`,
    );
    this.panel = root.querySelector('#coach') as HTMLElement;
    this.exitBtn = root.querySelector('#btn-exit-training') as HTMLElement;
    this.demo = new ThumbDemo(root);
    const tap = (el: Element, fn: () => void) =>
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        fn();
      });
    tap(this.exitBtn, () => this.onExit?.());
    tap(this.panel.querySelector('.skip')!, () => this.next());
    tap(this.panel.querySelector('.min')!, () => this.minimize());
    // Tapping the one-line (minimized) prompt opens it again.
    this.panel.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.panel.classList.contains('minimized')) this.expand();
    });
  }

  /** True while the prompt is open: the game waits for you to read it. */
  holding = false;
  /** The game should pause (true) or carry on (false). */
  onHold?: (on: boolean) => void;

  private expand(): void {
    this.panel.classList.remove('minimized');
    this.place();
    this.setHold(true);
  }

  private minimize(): void {
    this.panel.classList.add('minimized');
    this.setHold(false);
  }

  private setHold(on: boolean): void {
    if (this.holding === on) return;
    this.holding = on;
    this.onHold?.(on);
  }

  /** Show the EXIT button (from the moment training starts). */
  begin(): void {
    this.active = true;
    this.step = -1;
    this.moved = 0;
    this.lastX = NaN;
    document.body.classList.add('training');
  }

  /** Start the step-by-step prompts (after the overview tips). */
  startSteps(): void {
    if (!this.active) return;
    this.step = -1;
    this.next();
  }

  stop(): void {
    this.active = false;
    this.step = -1;
    this.setGlow([]);
    this.demo.show(null);
    this.panel.classList.remove('show', 'finished', 'minimized');
    this.setHold(false);
    document.body.classList.remove('training');
  }

  /** Something happened in the game (a missile fired, a boost…). */
  notify(e: CoachEvent): void {
    if (!this.active || this.step < 0 || this.step >= STEPS.length) return;
    if (STEPS[this.step].done.includes(e)) this.next();
  }

  /** Stretch the prompt across the top: from the armor bar to the mission box (or the radar). */
  private place(): void {
    const armor = document.getElementById('armor')?.getBoundingClientRect();
    const box = document.getElementById('objective')?.getBoundingClientRect();
    const radar = document.getElementById('radar')?.getBoundingClientRect();
    const end = box && box.width ? box : radar;
    if (!armor || !end || !end.width) return;
    const left = armor.right + 14;
    const right = end.left - 12;
    Object.assign(this.panel.style, { left: `${left}px`, width: `${Math.max(200, right - left)}px` });
  }

  /** Track how far the ship has flown (for the first step), and keep the demo in place. */
  update(x: number, z: number): void {
    if (!this.active) return;
    this.place();
    if (!Number.isNaN(this.lastX)) this.moved += Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x;
    this.lastZ = z;
    if (this.moved > 45) {
      this.moved = -1e9; // only once
      this.notify('move');
    }
    this.demo.place();
  }

  private next(): void {
    this.step++;
    const count = this.panel.querySelector('.count') as HTMLElement;
    const text = this.panel.querySelector('.text') as HTMLElement;
    const skip = this.panel.querySelector('.skip') as HTMLElement;
    // Each new step opens full size and pauses the game until you minimize it.
    this.panel.classList.add('show');
    this.panel.classList.remove('minimized');
    this.place();
    this.setHold(true);
    this.panel.classList.remove('pop');
    void this.panel.offsetWidth;
    this.panel.classList.add('pop');
    if (this.step >= STEPS.length) {
      // All done: practise as long as you like.
      count.textContent = 'TRAINING COMPLETE ✓';
      text.textContent = 'Nice flying! Keep practising on the drone as long as you like, then tap EXIT TRAINING (top left, next to pause) to head back to the station.';
      skip.style.display = 'none';
      this.panel.classList.add('finished');
      this.exitBtn.classList.add('pulse');
      this.setGlow([]);
      this.demo.show(null);
      return;
    }
    const s = STEPS[this.step];
    count.textContent = `STEP ${this.step + 1} OF ${STEPS.length}`;
    text.textContent = s.text;
    skip.style.display = '';
    this.panel.classList.remove('finished');
    this.exitBtn.classList.remove('pulse');
    this.setGlow(s.glow);
    this.demo.show(s.demo ?? null);
    this.onStep?.(this.step, s.done);
  }

  private glowing: string[] = [];
  private setGlow(ids: string[]): void {
    for (const id of this.glowing) document.getElementById(id)?.classList.remove('coach-target');
    this.glowing = ids;
    for (const id of ids) document.getElementById(id)?.classList.add('coach-target');
  }
}
