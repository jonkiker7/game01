# Star Rotor (working title)

A top-down "space helicopter" action game for phones, built with **Three.js** and **TypeScript**.
Fly over alien planets, boost, and fight with machine guns and missiles. The style is inspired by
classic 16-bit isometric helicopter shooters, with a painterly toon look.

## Controls

| Action | Phone | Keyboard |
| --- | --- | --- |
| Fly | Left thumb anywhere on the left half (floating stick) | WASD / arrow keys |
| Machine gun (hold) | **GUN** button | J |
| Missile | **MSL** button | K |
| Boost (dash) | **BOOST** button | L / Space |

Holding GUN slows turning so you can strafe around targets. Play in landscape.
On iPhone, use Share → **Add to Home Screen** for full-screen play.

## Development

```bash
npm install
npm run dev       # dev server; open the "Network" URL on your phone (same Wi-Fi)
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build
```

## Code layout

- `src/main.ts`: renderer, lights, and the main loop
- `src/game/Ship.ts`: ship model and flight handling (tuning constants at the top)
- `src/game/Input.ts`: touch stick, buttons, and keyboard
- `src/game/CameraRig.ts`: follow camera with look-ahead, FOV kick, and shake
- `src/game/World.ts`: test planet (terrain, rocks, crystals, map edge)
- `src/game/materials.ts`: toon and glow materials
- `src/game/math.ts`: helpers, seeded random numbers, noise

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`.
One-time setup: **Settings → Pages → Source: GitHub Actions**.

## Roadmap

1. ✅ Flying prototype: stick flight, camera, buttons, Pages deploy
2. Combat: machine gun, homing missiles, enemies, health, explosions
3. Art pass: outlines, rim light, bloom, particles, screen shake
4. Game loop: fuel, armor, ammo, pickups, objectives, minimap, HUD
5. Content: more planets, enemies, bosses
6. Polish: audio, menus, saves, offline play
