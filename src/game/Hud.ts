import { MAX_ARMOR, MISSILE_MAX } from './Ship';

/** On-screen readouts: armor bar, mission objective, big messages, missile pips, and the red damage flash. */
export class Hud {
  private readonly armorFill: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly message: HTMLElement;
  private readonly damage: HTMLElement;
  private readonly pips: { el: HTMLElement; fill: HTMLElement }[] = [];
  private readonly missileBtn: HTMLElement | null;
  private lastMissiles = -1;
  private messageTimer = 0;
  private lastArmor = -1;
  private lastObjective = '';

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="armor"><span class="label">ARMOR</span><div class="bar"><div class="fill"></div></div></div>
       <div id="objective"></div>
       <div id="message"></div>
       <div id="damage"></div>`,
    );
    this.armorFill = root.querySelector('#armor .fill') as HTMLElement;
    this.objective = root.querySelector('#objective') as HTMLElement;
    this.message = root.querySelector('#message') as HTMLElement;
    this.damage = root.querySelector('#damage') as HTMLElement;

    // Missile pips: little missile shapes on an arc around the top-left of the MSL button.
    this.missileBtn = root.querySelector('#btn-missile');
    const ring = document.createElement('div');
    ring.id = 'msl-pips';
    (root.querySelector('#buttons') ?? root).appendChild(ring);

    for (let i = 0; i < MISSILE_MAX; i++) {
      const angle = -150 + i * 32; // degrees, sweeping over the top of the button
      const el = document.createElement('div');
      el.className = 'pip';
      el.style.transform = `rotate(${angle}deg) translateX(40px) rotate(90deg)`;
      const fill = document.createElement('div');
      fill.className = 'pip-fill';
      el.appendChild(fill);
      ring.appendChild(el);
      this.pips.push({ el, fill });
    }
  }

  /** @param ready missiles ready; @param progress 0..1 on the next one recharging. */
  setMissiles(ready: number, progress: number): void {
    this.pips.forEach((p, i) => {
      const isReady = i < ready;
      const charging = i === ready;
      p.el.classList.toggle('ready', isReady);
      p.el.classList.toggle('charging', charging && ready < MISSILE_MAX);
      p.fill.style.transform = `scaleY(${isReady ? 1 : charging ? progress : 0})`;
    });
    if (ready !== this.lastMissiles) {
      // A little pop when a missile comes back.
      if (ready > this.lastMissiles && this.lastMissiles >= 0) {
        const p = this.pips[ready - 1];
        p.el.classList.remove('pop');
        void p.el.offsetWidth;
        p.el.classList.add('pop');
      }
      this.lastMissiles = ready;
      this.missileBtn?.classList.toggle('empty', ready === 0);
    }
  }

  /** Shake the MSL button when it's pressed with no missiles. */
  missileEmpty(): void {
    const b = this.missileBtn;
    if (!b) return;
    b.classList.remove('denied');
    void b.offsetWidth;
    b.classList.add('denied');
  }

  setArmor(armor: number): void {
    if (armor === this.lastArmor) return;
    this.lastArmor = armor;
    const k = armor / MAX_ARMOR;
    this.armorFill.style.transform = `scaleX(${k})`;
    this.armorFill.classList.toggle('low', k <= 0.3);
  }

  /** The current mission objective, shown under the radar. */
  setObjective(text: string): void {
    if (text === this.lastObjective) return;
    this.lastObjective = text;
    this.objective.textContent = text;
  }

  show(text: string, seconds = 2.2): void {
    this.message.textContent = text;
    this.message.classList.add('visible');
    this.messageTimer = seconds;
  }

  flashDamage(): void {
    this.damage.classList.remove('hit');
    void this.damage.offsetWidth; // restart the CSS animation
    this.damage.classList.add('hit');
  }

  update(dt: number): void {
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.message.classList.remove('visible');
    }
  }
}
