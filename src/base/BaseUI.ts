export interface Speaker {
  name: string;
  role: string;
  color: string;
  icon: string;
}

export interface DialogOption {
  label: string;
  action: () => void;
}

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

/** Home base overlays: the dialogue box with a speaker portrait, and the shop panels. */
export class BaseUI {
  private readonly dialog: HTMLElement;
  private readonly shop: HTMLElement;
  private readonly salvage: HTMLElement;
  private onDialogClose: (() => void) | null = null;

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="base-salvage"></div>
       <div id="dialog"><div class="portrait"></div><div class="body"><div class="who"></div><div class="line"></div><div class="options"></div></div></div>
       <div id="shop" class="overlay"><div class="panel"><div class="head"><h2></h2><span class="wallet"></span></div><div class="rows"></div><button class="close">DONE ▸</button></div></div>`,
    );
    this.dialog = root.querySelector('#dialog') as HTMLElement;
    this.shop = root.querySelector('#shop') as HTMLElement;
    this.salvage = root.querySelector('#base-salvage') as HTMLElement;
    this.shop.querySelector('.close')!.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      this.closeShop();
    });
  }

  get busy(): boolean {
    return this.dialog.classList.contains('visible') || this.shop.classList.contains('visible');
  }

  setSalvage(n: number): void {
    this.salvage.textContent = `⬢ ${n} SALVAGE`;
    const wallet = this.shop.querySelector('.wallet');
    if (wallet) wallet.textContent = `⬢ ${n}`;
  }

  say(who: Speaker, line: string, options: DialogOption[], onClose?: () => void): void {
    const portrait = this.dialog.querySelector('.portrait') as HTMLElement;
    portrait.textContent = who.icon;
    portrait.style.setProperty('--who', who.color);
    (this.dialog.querySelector('.who') as HTMLElement).innerHTML = `${who.name} <span>${who.role}</span>`;
    const lineEl = this.dialog.querySelector('.line') as HTMLElement;
    lineEl.textContent = '';
    const opts = this.dialog.querySelector('.options') as HTMLElement;
    opts.replaceChildren();
    for (const o of options) {
      const b = document.createElement('button');
      b.textContent = o.label;
      b.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        this.closeDialog(false);
        o.action();
      });
      opts.appendChild(b);
    }
    this.onDialogClose = onClose ?? null;
    this.dialog.classList.add('visible');
    // Typewriter effect.
    let i = 0;
    const tick = () => {
      if (!this.dialog.classList.contains('visible') || i > line.length) return;
      lineEl.textContent = line.slice(0, i);
      i += 2;
      window.setTimeout(tick, 16);
    };
    tick();
  }

  closeDialog(notify = true): void {
    if (!this.dialog.classList.contains('visible')) return;
    this.dialog.classList.remove('visible');
    const cb = this.onDialogClose;
    this.onDialogClose = null;
    if (notify) cb?.();
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
