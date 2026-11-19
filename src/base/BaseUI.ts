export interface ShopRow {
  name: string;
  text: string;
  /** e.g. "LV 2/5", "OWNED", "EQUIPPED" */
  status: string;
  /** Button label, e.g. "⬢ 220", "EQUIP"; null for no button (maxed, equipped). */
  button: string | null;
  disabled?: boolean;
  onClick?: () => void;
}

/** Home base overlays: the salvage readout and the shop panels (conversations are in Conversation.ts). */
export class BaseUI {
  private readonly shop: HTMLElement;
  private readonly salvage: HTMLElement;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="base-salvage"></div>
       <div id="shop" class="overlay"><div class="panel"><div class="head"><h2></h2><span class="wallet"></span></div><div class="rows"></div><button class="close">DONE ▸</button></div></div>`,
    );
    this.shop = root.querySelector('#shop') as HTMLElement;
    this.salvage = root.querySelector('#base-salvage') as HTMLElement;
    this.shop.querySelector('.close')!.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      this.closeShop();
    });
  }

  get busy(): boolean {
    return this.shop.classList.contains('visible');
  }

  setSalvage(n: number): void {
    this.salvage.textContent = `⬢ ${n} SALVAGE`;
    const wallet = this.shop.querySelector('.wallet');
    if (wallet) wallet.textContent = `⬢ ${n}`;
  }

  private onShopClose: (() => void) | null = null;

  openShop(title: string, rows: () => ShopRow[], onClose?: () => void): void {
    (this.shop.querySelector('h2') as HTMLElement).textContent = title;
    this.onShopClose = onClose ?? null;
    const render = () => {
      const list = this.shop.querySelector('.rows') as HTMLElement;
      list.replaceChildren();
      for (const r of rows()) {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = `<div class="info"><b>${r.name}</b><span>${r.text}</span></div><div class="status">${r.status}</div>`;
        if (r.button) {
          const b = document.createElement('button');
          b.textContent = r.button;
          b.disabled = !!r.disabled;
          b.addEventListener('pointerup', (e) => {
            e.stopPropagation();
            if (b.disabled) return;
            r.onClick?.();
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
