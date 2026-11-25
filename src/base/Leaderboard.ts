import * as THREE from 'three';
import type { LeaderEntry } from './Save';

/**
 * The leaderboard on the concourse wall, above the hangar doorway (behind the info desk):
 * the top 10 sortie scores, yours highlighted. Drawn on a canvas, so it can be redrawn
 * whenever a new score comes in.
 */
export class LeaderboardSign {
  readonly root = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;

  constructor() {
    const W = 15;
    const H = 5;
    this.canvas.width = 1536;
    this.canvas.height = Math.round((1536 * H) / W);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    screen.userData.noOutline = true;
    screen.userData.noHalo = true;
    // A chunky frame around it, in the station's orange.
    const frameMat = new THREE.MeshToonMaterial({ color: '#e2733a' });
    const bar = (w: number, h: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.3), frameMat);
      m.position.set(x, y, -0.1);
      return m;
    };
    this.root.add(screen, bar(W + 0.6, 0.3, 0, H / 2 + 0.15), bar(W + 0.6, 0.3, 0, -H / 2 - 0.15), bar(0.3, H, -W / 2 - 0.15, 0), bar(0.3, H, W / 2 + 0.15, 0));
  }

  /** Redraw the board with these entries (best first). */
  draw(entries: LeaderEntry[]): void {
    const c = this.canvas.getContext('2d')!;
    const { width: w, height: h } = this.canvas;
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#16102a');
    g.addColorStop(1, '#0b0816');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    // Faint scanlines for a retro screen.
    c.fillStyle = 'rgba(111, 247, 255, 0.04)';
    for (let y = 0; y < h; y += 6) c.fillRect(0, y, w, 2);

    c.textBaseline = 'middle';
    c.fillStyle = '#f2c46d';
    c.font = '900 70px Georgia, serif';
    c.textAlign = 'center';
    c.fillText('★  TOP PILOTS  ★', w / 2, 70);
    c.fillStyle = 'rgba(242, 196, 109, 0.5)';
    c.fillRect(80, 120, w - 160, 3);

    // Two columns of five.
    const rowH = (h - 150) / 5;
    const colW = (w - 120) / 2;
    entries.slice(0, 10).forEach((e, i) => {
      const col = Math.floor(i / 5);
      const x0 = 60 + col * colW;
      const y = 140 + (i % 5) * rowH + rowH / 2;
      if (e.you) {
        c.fillStyle = 'rgba(111, 247, 255, 0.14)';
        c.fillRect(x0 + 6, y - rowH / 2 + 6, colW - 30, rowH - 12);
      }
      c.font = '700 50px Georgia, serif';
      c.textAlign = 'left';
      c.fillStyle = i < 3 ? '#f2c46d' : '#9a90ae';
      c.fillText(`${i + 1}.`, x0 + 20, y);
      c.fillStyle = e.you ? '#6ff7ff' : '#efe9f7';
      c.fillText(e.name, x0 + 120, y);
      c.textAlign = 'right';
      c.fillStyle = e.you ? '#6ff7ff' : '#f2c46d';
      c.fillText(e.score.toLocaleString('en-US'), x0 + colW - 40, y);
    });
    this.texture.needsUpdate = true;
  }
}
