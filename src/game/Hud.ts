/** On-screen readouts: armor bar, salvage, mission objective, big messages, missile pips, and the red damage flash. */
export class Hud {
  private readonly armorFill: HTMLElement;
  private readonly objective: HTMLElement;
  private readonly message: HTMLElement;
  private readonly damage: HTMLElement;
  private readonly pips: { el: HTMLElement; fill: HTMLElement }[] = [];
  private readonly missileBtn: HTMLElement | null;
  private readonly pipRing: HTMLElement;
  private readonly salvage: HTMLElement;
  private lastSalvage = -1;
  private lastMissiles = -1;
  private messageTimer = 0;
  private lastArmor = -1;
  private lastMaxArmor = -1;
  private lastObjective = '';

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="armor"><span class="label">ARMOR</span><div class="bar"><div class="fill"></div></div></div>
       <div id="salvage"></div>
       <div id="objective"></div>
       <div id="message"></div>
       <div id="damage"></div>
       <div id="boss-bar"><div class="name"></div><div class="bar"><div class="fill"></div></div></div>`,
    );
    this.armorFill = root.querySelector('#armor .fill') as HTMLElement;
    this.objective = root.querySelector('#objective') as HTMLElement;
    this.message = root.querySelector('#message') as HTMLElement;
    this.damage = root.querySelector('#damage') as HTMLElement;
    this.salvage = root.querySelector('#salvage') as HTMLElement;

    // Missile pips: little missile shapes on an arc around the top-left of the MSL button.
    this.missileBtn = root.querySelector('#btn-missile');
    const ring = document.createElement('div');
    ring.id = 'msl-pips';
    (root.querySelector('#buttons') ?? root).appendChild(ring);
    this.pipRing = ring;
    this.buildPips(3);
  }

  /** One pip per missile slot, on an arc over the top-left of the MSL button. */
  private buildPips(count: number): void {
    this.pipRing.replaceChildren();
    this.pips.length = 0;
    const step = count > 3 ? 26 : 32;
    for (let i = 0; i < count; i++) {
      const angle = -150 + i * step; // degrees, sweeping over the top of the button
      const el = document.createElement('div');
      el.className = 'pip';
      el.style.transform = `rotate(${angle}deg) translateX(40px) rotate(90deg)`;
      const fill = document.createElement('div');
      fill.className = 'pip-fill';
      el.appendChild(fill);
      this.pipRing.appendChild(el);
      this.pips.push({ el, fill });
    }
    this.lastMissiles = -1;
  }

  /**
   * @param ready missiles ready; @param progress 0..1 on the next one recharging;
   * @param max missile capacity (upgrades can raise it).
   */
  setMissiles(ready: number, progress: number, max: number): void {
    if (max !== this.pips.length) this.buildPips(max);
    const MISSILE_MAX = max;
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

  setArmor(armor: number, max: number): void {
    if (armor === this.lastArmor && max === this.lastMaxArmor) return;
    this.lastArmor = armor;
    this.lastMaxArmor = max;
    const k = armor / max;
    this.armorFill.style.transform = `scaleX(${k})`;
    this.armorFill.classList.toggle('low', k <= 0.3);
  }

  setSalvage(amount: number): void {
    if (amount === this.lastSalvage) return;
    this.lastSalvage = amount;
    this.salvage.textContent = `⬢ ${amount}`;
  }

  /** The current mission objective, shown under the radar. */
  private bossShown = '';

  /** The boss's name and health bar across the top (null hides it). */
  setBoss(name: string | null, fraction = 1): void {
    const el = document.getElementById('boss-bar')!;
    if ((name ?? '') !== this.bossShown) {
      this.bossShown = name ?? '';
      el.classList.toggle('visible', !!name);
      (el.querySelector('.name') as HTMLElement).textContent = name ?? '';
    }
    if (name) (el.querySelector('.fill') as HTMLElement).style.transform = `scaleX(${Math.max(0, fraction)})`;
  }

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

  /** Brief green glow at the screen edges when armor is restored. */
  flashHeal(): void {
    this.damage.classList.remove('hit', 'heal');
    void this.damage.offsetWidth;
    this.damage.classList.add('heal');
  }

  flashDamage(): void {
    this.damage.classList.remove('hit', 'heal');
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
