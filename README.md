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
| Nova (special) | **NOVA** button, when charged | U |

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

## Home base

The game starts on **Halcyon Station**, a huge retro-futuristic station orbiting the jungle planet.
You see it from an isometric angle (like Diablo or the old Fallouts): rectangular rooms joined by
corridors, and any wall between the camera and your pilot drops down so you can always see
yourself. Many doors to the rest of the station are sealed (for now).

You wake up in your **Pilot Quarters** (south-west). Walk with the left stick; the action button
says **TALK** near someone and **LAUNCH** at your ship. The room's name shows as you walk in.

- **Concourse:** the hub in the middle, with the **information desk** run by **BOLT**, a robot.
  Ask BOLT where anyone is: picking a destination lights a green arrow at your feet that leads you
  through the doorways, and a beacon over the destination.
- **Armory** (west), **Boutique** (east), **Hangar Bay** (north, with your ship on the pad).

- **Rook, Quartermaster:** permanent upgrades bought with salvage (hull plating, gun calibration,
  an extra missile, faster Nova and boost, more salvage). They apply to every sortie.
- **Juno, Outfitter:** suits and helmets for your pilot (purely cosmetic).
- **Pip, Mechanic:** buy and choose your ship (Manta, Valkyrie, Kestrel, Atlas).

Board your ship to launch: a short cutscene flies you out of the hangar bay door into a sortie.
After the run, the summary banks your salvage and you land back in the hangar. Progress is saved in the
browser. Add `?sortie` to the URL to skip straight into a run (handy for testing).

## Conversations and portraits

Talking to the crew opens a Hades-style conversation: big portraits on both sides (your helmeted
pilot on the left, the crew member on the right), a name banner, typed-out text, expressions that
change line by line, and branching choices. A gold **!** over someone means they have something
new to say. The crew remembers what you've already talked about and picks new conversations as
your runs, wins and deaths add up.

- **Writing dialogue:** edit `src/content/dialogue.ts` (instructions at the top of the file).
  All current lines are placeholders.
- **Characters:** names, roles and colours in `src/content/characters.ts` (the player's callsign
  is a placeholder too).
- **Adding portrait art:** save PNGs as `public/portraits/<character>/<mood>.png`, e.g.
  `public/portraits/rook/happy.png`, then list the moods under `art` for that character in
  `characters.ts`. Moods: neutral, happy, annoyed, surprised, sad. Best results: transparent
  background, waist-up, about 1000–1500 px tall, consistent framing across characters. Characters
  without art use generated placeholder portraits.

## Sorties (roguelite runs)

Each run is a **sortie** of 7 sectors. Every sector is an arena around a jungle outpost, fenced
in by a glowing energy wall:

- **Destroy the outpost:** take out every turret tower while drones keep arriving.
- **Survive the swarm:** hold out for 40 seconds against heavy drone waves.
- **Final assault (sector 7):** a big stronghold. Destroy it to complete the sortie.

Clearing a sector drops a **reward orb** in the middle of the arena. Fly into it:

- **Upgrade:** pick 1 of 3 upgrades (see `src/game/run/Upgrades.ts`).
- **Armory:** pick a new weapon for one of your slots.
- **Repair:** restore 40% armor.
- **Salvage:** currency for home base (coming in a later milestone). Kills earn salvage too.

Then two **gates** open on the far side of the arena, each labelled with the reward waiting at the
end of the next sector. Fly through the one you want. Enemies get tougher every sector. If you're
shot down the run ends; the summary screen shows your progress and banks your salvage.

The radar marks whatever the current step is about (towers, drones, the reward, or the gates) and
shows the arena wall as a dashed circle.

## Weapons, upgrades and Nova

- **Gun slot:** Machine Gun (default), **Scatter Cannon** (6-pellet short-range blasts) or
  **Rail Lance** (slow, heavy bolts that pierce every enemy in a line).
- **Missile slot:** Missiles (default, charged with lock-on), **Cluster Bomb** (the blast throws
  out 5 bomblets) or **Swarm Rockets** (a volley of homing rockets; charge for more).
- **Nova:** the NOVA button charges as you deal damage. When it glows, tap it for a shockwave
  that damages everything around you and wipes out enemy shots.
- **Upgrade families** (coloured cards):
  - **Arc (lightning):** Arc Rounds, Arc Warheads, Static Field
  - **Cryo (ice):** Cryo Rounds (chill; 5 chills freeze), Cryo Warheads, Frostbite
  - **Plasma (fire):** Plasma Rounds, Plasma Warheads, Meltdown
  - **Duos** (need two families): Superconductor (Arc + Cryo), Thermal Shock (Cryo + Plasma)
- Plus core upgrades for the gun, missiles, boost, hull and Nova.

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
- `src/game/Hud.ts`: armor bar, salvage, objective, missile pips, messages, and damage/heal flashes
- `src/base/`: home base: `HomeBase.ts` (scene, crew, launch cutscene), `Layout.ts` (the floor plan: rooms, corridors, doors, key spots), `Station.ts` (builds the rooms, cutaway walls, decor and the view), `Robot.ts` (BOLT), `Pilot.ts` (the on-foot character), `BaseUI.ts` (dialogue and shops), `Save.ts` (progress, perks, outfits, ships)
- `src/game/Mortars.ts`: tower plasma mortars with landing warnings
- `src/game/Combat.ts`: every hit goes through here so elemental upgrades can react
- `src/game/run/`: the roguelite run: `Run.ts` (sectors and flow), `Upgrades.ts` (stats and upgrade pool), `Arena.ts` (wall, reward orb, gates), `RunUI.ts` (upgrade cards and summary)
- `src/game/Radar.ts`: the radar
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
4. ✅ Run structure: sectors, arenas, rewards, upgrade choices, gates, run summary, salvage
5. ✅ Upgrades and weapons: Scatter/Rail guns, Cluster/Swarm missiles, Arc/Cryo/Plasma families and duos, Nova special
6. ✅ Home base: space station hub, walkable pilot, crew with dialogue, permanent upgrades, outfits, ships, launch cutscene; multi-room isometric station with BOLT's info desk
7. Contracts: NPC missions that appear as special arenas in a sortie
8. Bosses and new enemies
9. Polish: audio, menus, saves, offline play
