/** Something to show on the radar, in world (x, z) coordinates. */
export interface Blip {
  x: number;
  z: number;
  kind: 'target' | 'home';
}

const RANGE = 110; // world units from the ship to the radar's edge (about 2-3 screens)
const SIZE = 118; // CSS pixels
const MAX_EDGE_ARROWS = 4; // only the nearest off-radar targets get an arrow, to keep the rim readable

/**
 * North-up radar in the top-right corner. The ship is the arrow in the middle; the radar
 * shows only what the current mission is about (targets to destroy, or the landing zone).
 * Anything out of range sits on the rim as an arrow pointing the way.
 */
export class Radar {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dpr = Math.min(window.devicePixelRatio || 1, 2);

  constructor(root: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'radar';
    this.canvas.width = this.canvas.height = Math.round(SIZE * this.dpr);
    this.canvas.style.width = this.canvas.style.height = `${SIZE}px`;
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  draw(shipX: number, shipZ: number, heading: number, blips: readonly Blip[], time: number): void {
    const g = this.ctx;
    const c = SIZE / 2;
    const R = c - 3;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, SIZE, SIZE);

    // Dish: dark glass with faint range rings, a crosshair and a slow sweep.
    g.save();
    g.beginPath();
    g.arc(c, c, R, 0, Math.PI * 2);
    g.clip();
    const bg = g.createRadialGradient(c, c, 0, c, c, R);
    bg.addColorStop(0, 'rgba(14, 40, 48, 0.72)');
    bg.addColorStop(1, 'rgba(8, 16, 26, 0.85)');
    g.fillStyle = bg;
    g.fillRect(0, 0, SIZE, SIZE);
    g.strokeStyle = 'rgba(111, 247, 255, 0.16)';
    g.lineWidth = 1;
    for (const k of [1 / 3, 2 / 3]) {
      g.beginPath();
      g.arc(c, c, R * k, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(c, c - R);
    g.lineTo(c, c + R);
    g.moveTo(c - R, c);
    g.lineTo(c + R, c);
    g.stroke();
    const sweep = time * 1.6;
    const wedge = g.createConicGradient?.(sweep - 0.9, c, c);
    if (wedge) {
      wedge.addColorStop(0, 'rgba(111, 247, 255, 0)');
      wedge.addColorStop(0.14, 'rgba(111, 247, 255, 0.16)');
      wedge.addColorStop(0.145, 'rgba(111, 247, 255, 0)');
      g.fillStyle = wedge;
      g.fillRect(0, 0, SIZE, SIZE);
    }
    g.restore();

    // Blips. World -Z is north (up), +X is east (right), matching the camera.
    const pulse = 0.75 + Math.sin(time * 6) * 0.25;
    const sorted = blips
      .map((b) => ({ b, dx: b.x - shipX, dz: b.z - shipZ, dist: Math.hypot(b.x - shipX, b.z - shipZ) }))
      .sort((p, q) => p.dist - q.dist);
    let arrows = 0;
    for (const { b, dx, dz, dist } of sorted) {
      const color = b.kind === 'home' ? '111, 247, 255' : '255, 61, 110';
      if (dist > RANGE * 0.9) {
        if (arrows++ >= MAX_EDGE_ARROWS) continue;
        // Off the radar: an arrow on the rim pointing toward it.
        const a = Math.atan2(dz, dx);
        const px = c + Math.cos(a) * (R - 7);
        const py = c + Math.sin(a) * (R - 7);
        g.save();
        g.translate(px, py);
        g.rotate(a);
        g.fillStyle = `rgba(${color}, ${0.6 + pulse * 0.4})`;
        g.beginPath();
        g.moveTo(5, 0);
        g.lineTo(-3, -4);
        g.lineTo(-3, 4);
        g.closePath();
        g.fill();
        g.restore();
        continue;
      }
      const px = c + (dx / RANGE) * R;
      const py = c + (dz / RANGE) * R;
      g.shadowColor = `rgba(${color}, 0.9)`;
      g.shadowBlur = 6;
      g.fillStyle = `rgba(${color}, ${0.7 + pulse * 0.3})`;
      g.beginPath();
      if (b.kind === 'home') {
        // Landing zone: a diamond.
        const s = 5 + pulse * 1.5;
        g.moveTo(px, py - s);
        g.lineTo(px + s, py);
        g.lineTo(px, py + s);
        g.lineTo(px - s, py);
        g.closePath();
      } else {
        g.arc(px, py, 3.2, 0, Math.PI * 2);
      }
      g.fill();
      g.shadowBlur = 0;
    }

    // The ship: an arrow pointing where it's facing.
    g.save();
    g.translate(c, c);
    g.rotate(-heading);
    g.fillStyle = '#fff4dc';
    g.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, -6.5);
    g.lineTo(4.5, 5);
    g.lineTo(0, 2.5);
    g.lineTo(-4.5, 5);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();

    // Rim and north marker.
    g.strokeStyle = 'rgba(242, 196, 109, 0.75)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(c, c, R, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#f2c46d';
    g.font = "700 9px 'Cinzel', Georgia, serif";
    g.textAlign = 'center';
    g.fillText('N', c, 11);
  }
}
