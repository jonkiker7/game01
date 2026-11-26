import { audio } from '../audio/Audio';
export interface ShopRow {
  name: string;
  text: string;
  /** e.g. "LV 2/5", "OWNED", "EQUIPPED" */
  status: string;
  /** Button label, e.g. "⬢ 220", "EQUIP"; null for no button (maxed, equipped). */
  button: string | null;
  disabled?: boolean;
  onClick?: () => void;
  /** Tapping the row (not its button) shows it in the shop's preview, if it has one. */
  preview?: () => void;
  /** Highlighted as the one being previewed. */
  selected?: boolean;
}

/** Home base overlays: the salvage readout and the shop panels (conversations are in Conversation.ts). */
export class BaseUI {
  private readonly shop: HTMLElement;
  private readonly salvage: HTMLElement;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="base-salvage"></div>
       <div id="room-toast"><h3></h3><span></span></div>
       <div id="guide-tag"></div>
       <div id="shop" class="overlay"><div class="panel"><div class="head"><h2></h2><span class="wallet"></span><button class="x" aria-label="Close">✕</button></div><div class="body"><div class="rows"></div></div><button class="close">DONE ▸</button></div></div>`,
    );
    this.shop = root.querySelector('#shop') as HTMLElement;
    this.salvage = root.querySelector('#base-salvage') as HTMLElement;
    // Close with DONE, the ✕, or by tapping outside the panel.
    for (const sel of ['.close', '.x']) {
      this.shop.querySelector(sel)!.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.closeShop();
      });
    }
    this.shop.addEventListener('pointerup', (e) => {
      if (e.target === this.shop) this.closeShop();
    });
  }

  get busy(): boolean {
    return this.shop.classList.contains('visible');
  }

  private toastTimer = 0;

  /** Big room name that fades in when you walk into a room. */
  toast(title: string, sub: string): void {
    const t = document.getElementById('room-toast')!;
    t.querySelector('h3')!.textContent = title;
    t.querySelector('span')!.textContent = sub;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 2200);
  }

  /** "Guiding to …" readout while BOLT's waypoint is active (null hides it). */
  setGuide(text: string | null): void {
    const g = document.getElementById('guide-tag')!;
    g.textContent = text ?? '';
    g.classList.toggle('show', !!text);
  }

  setSalvage(n: number): void {
    this.salvage.textContent = `⬢ ${n} SALVAGE`;
    const wallet = this.shop.querySelector('.wallet');
    if (wallet) wallet.textContent = `⬢ ${n}`;
  }

  private onShopClose: (() => void) | null = null;

  /**
   * Open a shop. `side` is an optional panel shown to the right of the list (the Outfitter's
   * pilot preview); rows with `preview` show themselves there when tapped.
   */
  openShop(title: string, rows: () => ShopRow[], onClose?: () => void, side?: HTMLElement): void {
    (this.shop.querySelector('h2') as HTMLElement).textContent = title;
    this.onShopClose = onClose ?? null;
    const body = this.shop.querySelector('.body') as HTMLElement;
    body.querySelector('.preview')?.remove();
    if (side) body.appendChild(side);
    this.shop.classList.toggle('with-preview', !!side);
    const render = () => {
      const list = this.shop.querySelector('.rows') as HTMLElement;
      list.replaceChildren();
      for (const r of rows()) {
        const row = document.createElement('div');
        row.className = r.selected ? 'row selected' : 'row';
        if (r.preview) {
          row.classList.add('tappable');
          row.addEventListener('pointerup', (e) => {
            e.stopPropagation();
            audio.play('uiTap');
            r.preview!();
            render();
          });
        }
        row.innerHTML = `<div class="info"><b>${r.name}</b><span>${r.text}</span></div><div class="status">${r.status}</div>`;
        if (r.button) {
          const b = document.createElement('button');
          b.textContent = r.button;
          b.disabled = !!r.disabled;
          b.addEventListener('pointerup', (e) => {
            e.stopPropagation();
            if (b.disabled) return void audio.play('uiDeny');
            audio.play(r.button?.startsWith('⬢') ? 'buy' : 'uiConfirm');
            r.onClick?.();
            r.preview?.();
            render();
          });
          row.appendChild(b);
        }
        list.appendChild(row);
      }
    };
    render();
    this.shop.classList.add('visible');
  }

  closeShop(): void {
    this.shop.classList.remove('visible');
    const cb = this.onShopClose;
    this.onShopClose = null;
    cb?.();
  }
}
