import { MAX_ARMOR, MISSILE_MAX, MISSILE_RECHARGE } from './Ship';

/** On-screen readouts: armor bar, targets remaining, big messages, and the red damage flash. */
export class Hud {
  private readonly armorFill: HTMLElement;
  private readonly targets: HTMLElement;
  private readonly message: HTMLElement;
  private readonly damage: HTMLElement;
  private readonly pips: { el: HTMLElement; fill: HTMLElement }[] = [];
  private readonly missileBtn: HTMLElement | null;
  private readonly rechargeArc: SVGCircleElement;
  private readonly countdown: HTMLElement;
  private lastCountdown = '';
  private lastMissiles = -1;
  private messageTimer = 0;
  private lastArmor = -1;
  private lastTargets = -1;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="armor"><span class="label">ARMOR</span><div class="bar"><div class="fill"></div></div></div>
       <div id="targets"></div>
       <div id="message"></div>
       <div id="damage"></div>`,
    );
    this.armorFill = root.querySelector('#armor .fill') as HTMLElement;
    this.targets = root.querySelector('#targets') as HTMLElement;
    this.message = root.querySelector('#message') as HTMLElement;
    this.damage = root.querySelector('#damage') as HTMLElement;

    // Missile pips: little missile shapes on an arc around the top-left of the MSL button.
    this.missileBtn = root.querySelector('#btn-missile');
    const ring = document.createElement('div');
    ring.id = 'msl-pips';
    (root.querySelector('#buttons') ?? root).appendChild(ring);

    // Recharge clock: a ring around the button that sweeps as the next missile charges.
    const r = 33;
    ring.insertAdjacentHTML(
      'beforeend',
      `<svg class="recharge" viewBox="-40 -40 80 80" aria-hidden="true">
         <circle class="track" r="${r}" />
         <circle class="arc" r="${r}" pathLength="100" stroke-dasharray="0 100" transform="rotate(-90)" />
       </svg>`,
    );
    this.rechargeArc = ring.querySelector('.arc') as SVGCircleElement;
    // Seconds until the next missile, under the MSL label.
    this.countdown = document.createElement('span');
    this.countdown.className = 'countdown';
    this.missileBtn?.appendChild(this.countdown);
    for (let i = 0; i < MISSILE_MAX; i++) {
      const angle = -150 + i * 32; // degrees, sweeping over the top of the button
      const el = document.createElement('div');
      el.className = 'pip';
      el.style.transform = `rotate(${angle}deg) translateX(46px) rotate(90deg)`;
      const fill = document.createElement('div');
      fill.className = 'pip-fill';
      el.appendChild(fill);
      ring.appendChild(el);
      this.pips.push({ el, fill });
    }
  }

  /** @param ready missiles ready; @param progress 0..1 on the next one recharging. */
  setMissiles(ready: number, progress: number): void {
    const recharging = ready < MISSILE_MAX;
    this.rechargeArc.setAttribute('stroke-dasharray', `${recharging ? progress * 100 : 0} 100`);
    this.rechargeArc.style.visibility = recharging ? 'visible' : 'hidden';
    const text = recharging ? `${((1 - progress) * MISSILE_RECHARGE).toFixed(1)}s` : '';
    if (text !== this.lastCountdown) {
      this.countdown.textContent = text;
      this.lastCountdown = text;
    }
    this.pips.forEach((p, i) => {
      const isReady = i < ready;
      const charging = i === ready;
      p.el.classList.toggle('ready', isReady);
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

  setTargets(n: number): void {
    if (n === this.lastTargets) return;
    this.lastTargets = n;
    this.targets.textContent = `TARGETS ${n}`;
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
