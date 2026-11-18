# Star Rotor (working title)

A top-down "space helicopter" action game for phones, built with **Three.js** and **TypeScript**.
Fly over alien planets, boost, and fight with machine guns and missiles. The style is inspired by
classic 16-bit isometric helicopter shooters, with a painterly toon look.

## Controls

| Action | Phone | Keyboard |
| --- | --- | --- |
| Fly | Left thumb anywhere on the left half (floating stick) | WASD / arrow keys |
| Machine gun (hold, drag to aim) | **GUN** button, used as an aiming stick | J (fires straight ahead) |
| Missile (hold to charge, drag to aim, release to fire) | **MSL** button, used as an aiming stick | K (fires straight ahead) |
| Boost (dash) | **BOOST** button | L / Space |

Both weapon buttons are twin-stick style: hold and drag your thumb toward a target and the ship
turns to face it. Holding GUN without dragging fires straight ahead and slows turning, so you can
strafe. Bullets bend slightly toward enemies near your line of fire (aim assist).

Missiles work like a charged bow shot: hold **MSL** and an aim line grows across the ground
(cyan while charging, gold at full power). Drag your thumb away from the button to aim; the ship
turns to face that way and slows down while charging. Let go to fire. A quick tap drops a missile
just in front of the ship. Unlocked missiles fly level along the aim line and burst at its end.
Missiles explode on the first enemy they pass over on screen, and splash damage covers anything that
looks inside the blast (including tower guns below you).
If an enemy is close to your aim line and in range, the target ring snaps onto it and turns red:
the missile is locked on and will follow that enemy.

You carry **3 missiles**, shown as small missile markers around the MSL button. Used missiles refill
one at a time, 5 seconds each (fire all three and they come back at 5, 10 and 15 seconds). The recharging
missile marker glows cyan and fills up, and the button shows the seconds left. With none
left, the button dims and won't charge.

Destroyed enemies sometimes drop a **green healing orb** that floats up to flying height. Fly
into it to restore 25 armor (orbs pull toward you when you're close, and fade after 15 seconds).

Boosting makes you briefly invulnerable, so you can dash through enemy shots.

**Graphics quality:** tap the fps counter at the top to switch between HIGH (with bloom glow) and
LOW (faster, for older phones). The game drops to LOW automatically if HIGH runs below 45 fps.
You can also force it with `?quality=low` or `?quality=high` in the URL. Adding `?debug` exposes
`window.__game` (ship, enemies, missiles) for tinkering and automated tests.

Play in landscape.
On iPhone, use Share → **Add to Home Screen** for full-screen play.

## Missions and radar

The radar (top right, north up) marks whatever the current mission is about:

1. **Destroy the towers:** red dots mark the remaining turret towers; the nearest ones beyond the
   radar's range show as arrows on the rim.
2. **Return to the landing zone:** after the area is cleared, a cyan diamond (or rim arrow) marks the pad.
3. Fly over the pad to complete the mission; the next wave of towers appears.

## Ship designs

Four twin-rotor ship designs live in `src/game/ShipDesigns.ts`. See them side by side at
`designs.html` (e.g. `https://jonkiker7.github.io/game01/designs.html`), and fly one with
`?ship=a`, `?ship=b`, `?ship=c` or `?ship=d` on the game URL (B, the Manta, is the default):

- **A · Valkyrie:** armored wedge gunship with ducted fans on the wingtips
- **B · Manta (default):** flying-wing delta with big wing-mounted fans and a tail boom
- **C · Kestrel:** slim dart with open rotors on wingtip nacelles
- **D · Atlas:** heavy lifter with big fan pods and a belly turret

## Development

```bash
npm install
npm run dev       # dev server; open the "Network" URL on your phone (same Wi-Fi)
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build
```

## Code layout

- `src/main.ts`: renderer, lights, and the main loop
- `src/game/Ship.ts`: flight handling, weapons state, armor (tuning constants at the top)
- `src/game/ShipDesigns.ts`: the four twin-rotor ship models
- `designs.html` + `src/designs.ts`: ship design gallery page
- `src/game/Input.ts`: touch stick, buttons (MSL doubles as an aim stick), and keyboard
- `src/game/Missiles.ts`: missile flight, range, and splash damage
- `src/game/Projectiles.ts`: player bullets and enemy orbs (instanced, one draw call each)
- `src/game/Enemies.ts`: turret towers, drones, and spawning (enemies only fire while on screen)
- `src/game/Effects.ts`: pooled smoke, explosions, shockwaves, sparks, embers, debris, and floating motes
- `src/game/Hud.ts`: armor bar, targets counter, messages, and damage flash
- `src/game/AimIndicator.ts`: the charging aim line and target ring
- `src/game/CameraRig.ts`: follow camera with look-ahead, FOV kick, and shake
- `src/game/World.ts`: the alien jungle planet: palette, terrain, trees, plants, relics, outposts, map edge
- `src/game/materials.ts`: toon shading, rim light, HDR glow, and ink outlines
- `src/game/math.ts`: helpers, seeded random numbers, noise

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`.
One-time setup: **Settings → Pages → Source: GitHub Actions**.

## Roadmap

1. ✅ Flying prototype: stick flight, camera, buttons, Pages deploy
2. ✅ Combat: twin-stick gun and missiles, turrets, drones, armor, explosions
3. ✅ Art pass: ink outlines, rim light, bloom, painted ground, particles, hit-stop
4. Game loop: fuel, armor, ammo, pickups, objectives, minimap, HUD
5. Content: more planets, enemies, bosses
6. Polish: audio, menus, saves, offline play
