import { CALLSIGN, CHARACTERS, type CharacterId, type Mood } from '../content/characters';
import type { Line } from '../content/dialogue';
import { portraitUrl } from './Portraits';

export interface EndOption {
  label: string;
  action?: () => void;
}

const TYPE_SPEED = 55; // characters per second

/**
 * Hades-style conversation screen: big portraits on either side (the player on the left, the
 * crew member on the right), a name banner, and text that types out. Tap to finish the line or
 * move on; choices appear as buttons. Expressions change line by line.
 */
export class ConversationUI {
  private readonly el: HTMLElement;
  private readonly left: HTMLImageElement;
  private readonly right: HTMLImageElement;
  private readonly banner: HTMLElement;
  private readonly text: HTMLElement;
  private readonly choices: HTMLElement;
  private readonly hint: HTMLElement;
  private queue: Line[] = [];
  private endOptions: EndOption[] = [];
  private full = '';
  private shown = 0;
  private typing = 0;
  private waitingChoice = false;
  private lastSrc: Record<'left' | 'right', string> = { left: '', right: '' };

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="convo">
         <img class="portrait left" alt="" />
         <img class="portrait right" alt="" />
         <div class="box">
           <div class="banner"></div>
           <div class="text"></div>
           <div class="choices"></div>
           <div class="hint">▼</div>
         </div>
       </div>`,
    );
    this.el = root.querySelector('#convo') as HTMLElement;
    this.left = this.el.querySelector('.portrait.left') as HTMLImageElement;
    this.right = this.el.querySelector('.portrait.right') as HTMLImageElement;
    this.banner = this.el.querySelector('.banner') as HTMLElement;
    this.text = this.el.querySelector('.text') as HTMLElement;
    this.choices = this.el.querySelector('.choices') as HTMLElement;
    this.hint = this.el.querySelector('.hint') as HTMLElement;
    this.el.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      this.tap();
    });
  }

  /** Called with a choice's `action` (e.g. 'guide:armory') when the player picks it. */
  onAction?: (action: string) => void;

  get active(): boolean {
    return this.el.classList.contains('visible');
  }

  /**
   * Play a conversation with `partner`. When the lines run out, `endOptions` are offered as
   * buttons (e.g. "UPGRADES" / "LEAVE"); with none, the conversation just closes.
   */
  play(partner: CharacterId, lines: Line[], endOptions: EndOption[] = []): void {
    this.queue = [...lines];
    this.endOptions = endOptions;
    this.lastSrc = { left: '', right: '' };
    this.setPortrait('left', 'pilot', 'neutral');
    this.setPortrait('right', partner, 'neutral');
    this.el.classList.add('visible');
    document.body.classList.add('in-convo');
    this.next();
  }

  close(): void {
    window.clearInterval(this.typing);
    this.el.classList.remove('visible');
    document.body.classList.remove('in-convo');
  }

  private tap(): void {
    if (this.waitingChoice) return;
    if (this.shown < this.full.length) {
      // Finish the line instantly.
      this.shown = this.full.length;
      this.text.textContent = this.full;
      window.clearInterval(this.typing);
      this.hint.classList.add('show');
      return;
    }
    this.next();
  }

  private next(): void {
    const line = this.queue.shift();
    this.choices.replaceChildren();
    this.waitingChoice = false;
    this.hint.classList.remove('show');

    if (!line) {
      if (this.endOptions.length === 0) {
        this.close();
        return;
      }
      // Keep the partner's last line on screen and offer the end options.
      this.showChoices(this.endOptions.map((o) => ({ text: o.label, run: () => (this.close(), o.action?.()) })));
      return;
    }

    if ('choices' in line) {
      // Light up the pilot's portrait (it's your turn), but keep the last line and banner showing.
      this.speaker('pilot', 'neutral', false);
      this.showChoices(
        line.choices.map((c) => ({
          text: c.text,
          run: () => {
            if (c.action) this.onAction?.(c.action);
            // The pilot "says" the chosen option, then the replies follow.
            this.queue.unshift({ who: 'pilot', mood: 'neutral', text: c.text }, ...(c.reply ?? []));
            this.next();
          },
        })),
      );
      return;
    }

    this.speaker(line.who, line.mood ?? 'neutral');
    this.type(line.text.replaceAll('{callsign}', CALLSIGN));
  }

  private showChoices(options: { text: string; run: () => void }[]): void {
    this.waitingChoice = true;
    for (const o of options) {
      const b = document.createElement('button');
      b.textContent = o.text;
      b.addEventListener('pointerup', (e) => {
        e.stopPropagation();
        o.run();
      });
      this.choices.appendChild(b);
    }
  }

  /** Highlight whoever is talking, update their expression and the name banner. */
  private speaker(who: CharacterId, mood: Mood, updateBanner = true): void {
    const side = who === 'pilot' ? 'left' : 'right';
    this.setPortrait(side, who, mood);
    this.left.classList.toggle('talking', side === 'left');
    this.right.classList.toggle('talking', side === 'right');
    if (!updateBanner) return;
    const c = CHARACTERS[who];
    this.banner.innerHTML = `${c.name}<span>${c.role}</span>`;
    this.banner.style.setProperty('--who', c.color);
    this.banner.classList.toggle('right', side === 'right');
  }

  private setPortrait(side: 'left' | 'right', who: CharacterId, mood: Mood): void {
    const img = side === 'left' ? this.left : this.right;
    const src = portraitUrl(who, mood);
    if (this.lastSrc[side] === src) return;
    this.lastSrc[side] = src;
    img.src = src;
    // A little bounce when the expression changes.
    img.classList.remove('bump');
    void img.offsetWidth;
    img.classList.add('bump');
  }

  private type(text: string): void {
    window.clearInterval(this.typing);
    this.full = text;
    this.shown = 0;
    this.text.textContent = '';
    this.typing = window.setInterval(() => {
      this.shown = Math.min(this.full.length, this.shown + 2);
      this.text.textContent = this.full.slice(0, this.shown);
      if (this.shown >= this.full.length) {
        window.clearInterval(this.typing);
        this.hint.classList.add('show');
      }
    }, 2000 / TYPE_SPEED);
  }
}
