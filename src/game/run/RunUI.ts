import type { Upgrade, UpgradeCategory } from './Upgrades';

const CATEGORY: Record<UpgradeCategory, { icon: string; color: string; name: string }> = {
  gun: { icon: '✦', color: '#ffd36b', name: 'MACHINE GUN' },
  missile: { icon: '➶', color: '#ff8a5c', name: 'MISSILES' },
  boost: { icon: '»', color: '#6ff7ff', name: 'BOOST' },
  hull: { icon: '⬡', color: '#7dff9a', name: 'HULL' },
};

export interface RunSummary {
  won: boolean;
  sectorsCleared: number;
  totalSectors: number;
  kills: number;
  salvage: number;
  totalSalvage: number;
  upgrades: string[];
}

/** Full-screen run overlays: the 1-of-3 upgrade cards, the end-of-run summary, and fades. */
export class RunUI {
  private readonly fadeEl: HTMLElement;
  private readonly cardsEl: HTMLElement;
  private readonly endEl: HTMLElement;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="fade"></div>
       <div id="upgrade-screen" class="overlay"><h2>CHOOSE AN UPGRADE</h2><div class="cards"></div></div>
       <div id="end-screen" class="overlay"></div>`,
    );
    this.fadeEl = root.querySelector('#fade') as HTMLElement;
    this.cardsEl = root.querySelector('#upgrade-screen') as HTMLElement;
    this.endEl = root.querySelector('#end-screen') as HTMLElement;
  }

  /** Fade to black, run `swap` while the screen is dark, then fade back in. */
  fade(swap: () => void): void {
    this.fadeEl.classList.add('on');
    window.setTimeout(() => {
      swap();
      window.setTimeout(() => this.fadeEl.classList.remove('on'), 80);
    }, 380);
  }

  /** Show three upgrade cards; calls `pick` with the chosen one. */
  chooseUpgrade(options: Upgrade[], levels: Map<string, number>, pick: (u: Upgrade) => void): void {
    const list = this.cardsEl.querySelector('.cards') as HTMLElement;
    list.replaceChildren();
    for (const u of options) {
      const cat = CATEGORY[u.category];
      const level = levels.get(u.id) ?? 0;
      const card = document.createElement('button');
      card.className = 'card';
      card.style.setProperty('--cat', cat.color);
      card.innerHTML = `<div class="icon">${cat.icon}</div>
        <div class="cat">${cat.name}</div>
        <div class="name">${u.name}</div>
        <div class="text">${u.text}</div>
        <div class="level">${level > 0 ? `LEVEL ${level} → ${level + 1}` : 'NEW'}</div>`;
      card.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.cardsEl.classList.remove('visible');
        pick(u);
      });
      list.appendChild(card);
    }
    this.cardsEl.classList.add('visible');
  }

  showEnd(s: RunSummary, restart: () => void): void {
    this.endEl.innerHTML = `
      <h1 class="${s.won ? 'won' : 'lost'}">${s.won ? 'SORTIE COMPLETE' : 'SHOT DOWN'}</h1>
      <div class="stats">
        <div><b>${s.sectorsCleared}/${s.totalSectors}</b><span>SECTORS CLEARED</span></div>
        <div><b>${s.kills}</b><span>ENEMIES DESTROYED</span></div>
        <div><b>⬢ ${s.salvage}</b><span>SALVAGE EARNED</span></div>
      </div>
      <div class="upgrades">${s.upgrades.length ? s.upgrades.map((u) => `<span>${u}</span>`).join('') : '<em>No upgrades taken</em>'}</div>
      <div class="total">Salvage banked: ⬢ ${s.totalSalvage} <small>(spend it at home base, coming soon)</small></div>
      <button class="again">NEW SORTIE ▸</button>`;
    this.endEl.querySelector('.again')!.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      this.endEl.classList.remove('visible');
      restart();
    });
    this.endEl.classList.add('visible');
  }
}
