import { MAX_ARMOR } from './Ship';

/** On-screen readouts: armor bar, targets remaining, big messages, and the red damage flash. */
export class Hud {
  private readonly armorFill: HTMLElement;
  private readonly targets: HTMLElement;
  private readonly message: HTMLElement;
  private readonly damage: HTMLElement;
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
