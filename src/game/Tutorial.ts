import { ThumbDemo } from './Training';

/**
 * The flight tutorial: shown over the real game screen (paused) at the start of a sortie. Each
 * tip highlights the control it's about, with an arrow pointing at it, a NEXT button and a
 * smaller EXIT TUTORIAL under it.
 */

interface Tip {
  text: string;
  /** Element ids to highlight (their combined box). Empty: a box in the bottom-left corner. */
  targets: string[];
  /** No highlight: just the tip, in the middle of the screen. */
  center?: boolean;
  /** Show the animated thumb (press and slide) over this button. */
  demo?: 'btn-gun' | 'btn-missile';
}

const TIPS: Tip[] = [
  { text: 'Use your left thumb to move.', targets: [] },
  {
    text: 'To AIM and fire: hold GUN with your right thumb and slide it the way you want to shoot. Your ship turns and fires wherever your thumb points. Let go to stop.',
    targets: ['btn-gun'],
    demo: 'btn-gun',
  },
  { text: 'Missiles aim the same way: hold MSL, slide toward an enemy (it locks on), then let go to fire.', targets: ['btn-missile'], demo: 'btn-missile' },
  { text: 'Your Nova can be blasted periodically.', targets: ['btn-special'] },
  { text: 'Boost and roll can be used to get away. The curved buttons beside BOOST barrel-roll you left or right.', targets: ['btn-roll-l', 'btn-boost', 'btn-roll-r'] },
  { text: 'You are temporarily invulnerable during a boost or a roll.', targets: ['btn-roll-l', 'btn-boost', 'btn-roll-r'] },
  { text: 'Use your radar to find objectives.', targets: ['radar'] },
  { text: 'Red targets need to be destroyed.', targets: ['radar'] },
  { text: 'Yellow targets need to be collected.', targets: ['radar'] },
  { text: 'Wrecked enemies sometimes drop green orbs. Fly into them to repair your armor.', targets: ['armor'] },
  { text: 'Your mission and its clock are here. Finish faster for a bigger time bonus.', targets: ['objective'] },
  { text: 'After each mission, grab the power orb for a reward, then fly through a gate to choose your next mission.', targets: [] , center: true },
  { text: 'Points and pause are up here.', targets: ['score', 'btn-pause'] },
];

export class Tutorial {
  private readonly el: HTMLElement;
  private readonly hole: HTMLElement;
  private readonly box: HTMLElement;
  private readonly arrow: HTMLElement;
  private step = 0;
  /** The tips for this showing (ones pointing at something hidden, like the mission box in training, are left out). */
  private tips: Tip[] = TIPS;
  private readonly demo: ThumbDemo;
  private onDone: (() => void) | null = null;
  active = false;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="tutorial">
         <div class="hole"></div>
         <div class="arrow">➜</div>
         <div class="tip">
           <div class="count"></div>
           <div class="text"></div>
           <button class="next">NEXT ▸</button>
           <button class="exit">Exit tutorial</button>
         </div>
       </div>`,
    );
    this.el = root.querySelector('#tutorial') as HTMLElement;
    this.hole = this.el.querySelector('.hole') as HTMLElement;
    this.box = this.el.querySelector('.tip') as HTMLElement;
    this.arrow = this.el.querySelector('.arrow') as HTMLElement;
    this.demo = new ThumbDemo(root);
    const tap = (sel: string, fn: () => void) =>
      this.el.querySelector(sel)!.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        fn();
      });
    tap('.next', () => (this.step + 1 >= this.tips.length ? this.finish() : this.show(this.step + 1)));
    tap('.exit', () => this.finish());
    // Swallow touches so the game underneath doesn't get them.
    for (const ev of ['pointerdown', 'pointermove', 'touchstart']) this.el.addEventListener(ev, (e) => e.stopPropagation());
    window.addEventListener('resize', () => this.active && this.show(this.step));
  }

  start(onDone: () => void): void {
    this.onDone = onDone;
    this.active = true;
    const visible = (id: string) => {
      const el = document.getElementById(id);
      return !!el && el.getBoundingClientRect().width > 0;
    };
    this.tips = TIPS.filter((t) => t.targets.length === 0 || t.targets.some(visible));
    this.el.classList.add('visible');
    this.show(0);
  }

  private finish(): void {
    this.active = false;
    this.el.classList.remove('visible');
    this.demo.show(null);
    const cb = this.onDone;
    this.onDone = null;
    cb?.();
  }

  private show(i: number): void {
    this.step = i;
    const tip = this.tips[i];
    this.demo.show(tip.demo ?? null);
    (this.el.querySelector('.count') as HTMLElement).textContent = `${i + 1} / ${this.tips.length}`;
    (this.el.querySelector('.text') as HTMLElement).textContent = tip.text;
    (this.el.querySelector('.next') as HTMLElement).textContent = i + 1 >= this.tips.length ? "LET'S FLY ▸" : 'NEXT ▸';

    // The area to highlight.
    const W = window.innerWidth;
    const H = window.innerHeight;
    let r = { x0: 12, y0: H * 0.5, x1: W * 0.32, y1: H - 12 }; // the movement stick's corner
    const rects = tip.targets.map((id) => document.getElementById(id)?.getBoundingClientRect()).filter((b): b is DOMRect => !!b && b.width > 0);
    if (rects.length) r = { x0: Math.min(...rects.map((b) => b.left)), y0: Math.min(...rects.map((b) => b.top)), x1: Math.max(...rects.map((b) => b.right)), y1: Math.max(...rects.map((b) => b.bottom)) };
    const pad = 8;
    this.hole.style.display = tip.center ? 'none' : '';
    this.arrow.style.display = tip.center ? 'none' : '';
    if (tip.center) {
      const bw = Math.min(380, W * 0.6);
      Object.assign(this.box.style, { left: `${(W - bw) / 2}px`, top: `${H * 0.3}px`, width: `${bw}px` });
      return;
    }
    Object.assign(this.hole.style, { left: `${r.x0 - pad}px`, top: `${r.y0 - pad}px`, width: `${r.x1 - r.x0 + pad * 2}px`, height: `${r.y1 - r.y0 + pad * 2}px` });

    // The tip box goes on the opposite side of the screen from the highlight, with an arrow
    // from it toward the highlight.
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const bw = Math.min(320, W * 0.42);
    const bx = cx < W / 2 ? Math.min(W - bw - 16, r.x1 + 70) : Math.max(16, r.x0 - 70 - bw);
    // Set the width first, then keep the whole box (however tall its text) on screen.
    this.box.style.width = `${bw}px`;
    const bh = this.box.offsetHeight || 200;
    const by = Math.max(12, Math.min(H - bh - 12, cy - 80));
    Object.assign(this.box.style, { left: `${bx}px`, top: `${by}px` });
    // Arrow: from the box edge toward the highlight's centre.
    const ax = cx < W / 2 ? bx - 46 : bx + bw + 8;
    const ay = by + 40;
    const angle = Math.atan2(cy - ay, cx - (ax + 19));
    Object.assign(this.arrow.style, { left: `${ax}px`, top: `${ay - 19}px`, transform: `rotate(${angle}rad)` });
  }
}
