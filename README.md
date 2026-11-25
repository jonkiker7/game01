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
| Barrel roll left / right | **↺ ROLL** / **↻ ROLL** buttons beside BOOST | Q / E |
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

Boosting makes you briefly invulnerable, so you can dash through enemy shots. **Barrel rolls**
are a quick dodge to screen left or right, whichever way the ship is facing: a full spin with a moment of
invulnerability. They have their own short cooldown (0.9 s), separate from boost, so you can chain
boost and rolls.

**Shadows and vignette:** on HIGH quality the sun casts real shadows from trees, plants, rocks,
towers, ground enemies and ground bosses (flying things keep a simple shadow right below them, which
helps you aim). LOW skips real shadows. A soft vignette darkens the screen edges on both.

**Pause:** the ❚❚ button (top left, or P / Esc) pauses a sortie and shows your ship, its current
stats, your missions (this round's objective and your contract), upgrades taken this sortie and
your station upgrades. Switching away from the app pauses automatically.

**Dev panel:** switch it on with **DEV PANEL: ON** in the pause menu (works in the Home Screen app,
and stays on until you switch it off), or add `?dev` to the URL (e.g. `?dev&sortie`) for a **DEV** panel at the top. Its
sliders cover lighting (sun brightness/colour/direction/height, rim light), shadows (darkness and area),
glow (bloom), the vignette, canyon fog (colour, density, height), plus gameplay numbers (ship speeds and rolls, tower bombs,
swarmers). Changes apply live and are remembered on that device while `?dev` is on.
**📋 Copy settings** copies them so they can be made the game's defaults; **↺ Reset** goes back.
Gameplay defaults live in `src/game/Tuning.ts`.

**Graphics quality:** tap the fps counter at the top to switch between HIGH (with bloom glow) and
LOW (faster, for older phones). The game drops to LOW automatically if HIGH runs below 45 fps.
You can also force it with `?quality=low` or `?quality=high` in the URL. Adding `?debug` exposes
`window.__game` (ship, enemies, missiles) for tinkering and automated tests.

Play in landscape.
On iPhone, use Share → **Add to Home Screen** for full-screen play.

## Home base

The game starts on **Halcyon Station**, a huge retro-futuristic station orbiting the jungle planet.
You see it from an isometric angle (like Diablo or the old Fallouts): rectangular rooms joined by
corridors. Walls between the camera and your pilot (and the near walls of the room you are in) turn see-through, so you can always see
yourself. Doors slide open as you walk up to them. Some rooms are down flights of stairs (the
Armory, the Hangar and your quarters), and railed openings in the floor look down shafts into the
depths of the station. Many doors to the rest of the station are sealed (for now).

You wake up in your **Pilot Quarters** (south-west). Walk with the left stick; the action button
says **TALK** near someone and **LAUNCH** at your ship. The room's name shows as you walk in.

- **Concourse:** the grand hub in the middle (twice the ceiling height, columns, a balcony and a
  light well down to the reactor), with the **information desk** run by **BOLT**, a robot.
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

## Contracts

Talk to **BOLT** at the info desk and pick **CONTRACTS** to see the contract board: three jobs
posted by the crew, each tied to one sector of your next sortie. Take one at a time.

- **Retrieve:** a cargo pod is down in that sector (look for the orange light beam): fly over it.
- **Hunt:** an alpha drone (big, gold-crowned, tough) leads the swarm there. The sector isn't
  clear until it's destroyed.
- **Uplink:** a relay beacon stands there: hover inside its ring until the upload reaches 100%.

The contract shows on the radar (orange) and under it (◆). Finish it and the reward is paid when
the sortie ends, even if you're shot down afterwards. Miss it and it stays active for the next
sortie (or drop it from the board). New offers go up after every sortie. The crew members who
post contracts have things to say once you've finished one. Contract writing lives in
`src/content/contracts.ts` (placeholder text, edit freely).

## The terrain: mesas and canyons

The ground is the top of big, flat-ish rock mesas (the jungle grows on top), split by winding
**canyons** about a third of the map. Their sandstone walls step down past a ledge into dark blue
depths, with layered fog that's thickest at the bottom (colour, density and height are in the `?dev`
panel under **Canyon fog**). Decor rocks only sit where their whole footprint is on
solid ground, so nothing hangs over a cliff edge. The ship flies at a steady height over both.

- Everything that stands on the ground (towers, crawlers, pulsars, ground bosses, pylons, the
  fortress, rescue pods, landing zones, contract pods and beacons, trees and plants) is placed on a
  rock top, never over a canyon. Arena centres and the landing pad are always solid rock.
- Crawlers and the Juggernaut won't drive off cliffs; the Escort convoy crosses canyons on bridges.
- Everything is placeholder geometry for prototyping, to be replaced by Blender assets. Canyon
  shape, depth and colours are at the top of `src/game/World.ts` (`CANYON`, `CANYON_DEPTH`,
  `CANYON_WIDTH`). `world.heightAt` is the rock-top height, `world.surfaceAt` the real ground
  (down in canyons), and `world.isRock` / `world.nearestRock` keep things on solid ground.

## Sorties (roguelite runs)

Each run is a **sortie**: 2 rounds, then a **boss**. Every round is an arena around a jungle
outpost, fenced in by a glowing energy wall:

- **Destroy the outpost:** hunt down every tower in a big arena (the radar points the way).
- **Survive the swarm:** hold out for 40 seconds against heavy waves in a tight arena.
- **Rescue the crew:** fly over stranded escape pods (gold beams) to pick up crew, 2 at a time,
  and drop them at the landing zone (green ring). Save all 4.
- **Defend the generator:** keep it alive for 45 seconds. Saboteurs fly straight for it and
  drill in; shoot them off.
- **Escort the convoy:** guard a crawler crossing the arena. Saboteurs latch on and stall it.
- **Sabotage the fortress:** destroy 3 power pylons to drop its shield (it shells you meanwhile),
  then destroy the fortress.
- **Hold the zones:** stay inside each of 3 gold rings until it's captured (8 s; progress drains
  slowly if you leave).
- **Boss (round 3):** one of three bosses (below). Destroy it to complete the sortie.

Each round before the boss is one of these at random (never the same type twice in a row). If you lose the generator or the convoy,
the round ends without its reward: what you were protecting has a health bar across the top, and
if it reaches zero it blows up, a red MISSION FAILED banner holds for a few seconds, no reward orb
appears, and then the gates open. To test one, add `?sortie&mission=rescue` (or `defend`,
`escort`, `sabotage`, `hold`, `outpost`, `survive`) to the URL.

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

## Bosses

A health bar shows across the top. Every attack has a tell, and below half health each boss enters
**phase 2**: faster attacks and more helpers.

- **Skyreaver** (flying gunship): rotating bullet spirals; paints a wide red lane and charges down
  it; missile volleys that land in warning rings; calls in swarmers (and drones in phase 2).
- **Juggernaut** (giant tank): shoot the two **side cannons** (marked with spinning gold reticles,
  and gold on the radar); they fire bomb barrages. While they stand, the core's shield lets only
  15% of your damage through; once both are gone the core is exposed. The main gun paints a red lane, locks, then fires a beam; it stomps out
  expanding **shockwave rings** (roll or boost through them); brings Shield Crawlers.
- **Jungle Titan** (rooted plant colossus): its **open pod** (glowing gold) is the weak spot and
  takes 150% damage; the trunk and closed pods only take 35%. The weak spot moves between three pods. Tentacles burst up through red rings; spore clouds
  linger and hurt while you're inside; seed spirals from the open pod; calls in swarmers (and a
  Pulsar in phase 2).

To test a boss right away, add `?sortie&boss=flyer` (or `tank`, `titan`; plain `?boss` picks one
at random) to the URL.

## Enemies

Each zone uses **two enemy types**, picked at random (towers don't count: they're the objective).
The pair is shown under the radar ("VS SWARMERS + SNIPERS").

| Enemy | Where | What it does / how to beat it |
| --- | --- | --- |
| **Drone** | air | Circles you and fires 3-shot bursts. |
| **Tower** | ground | Lobs plasma bombs; a red ring marks where they'll land. |
| **Swarmer** | air | Packs of 5 small bugs. One at a time they stop and glow hot (almost a second), then dive and explode on contact. Keep moving. |
| **Lancer** | air | Paints a red lane, shudders, then dashes down it. Dodge sideways (barrel rolls are great here). |
| **Shield Crawler** | ground | Tank with a front energy shield that blocks gunfire. Flank it, or use missiles (they get through). |
| **Sniper** | air | Hangs back, tracks you with a laser, then the laser freezes and flickers: move before it fires. |
| **Mine Layer** | air | Loops around you dropping mines that arm after a second (red halo). Shoot them or steer around. |
| **Pulsar** | ground | Pylon that sprays rotating spirals of slow shots. Weave through the gaps, or kill it between spirals. |

For testing, `?enemies=swarmer,sniper` forces a zone's pair (or one type: `?enemies=lancer`). Names:
drone, swarmer, lancer, crawler, sniper, minelayer, pulsar. On a very slow test machine,
`?dtmax=0.3` lets the game keep real time (it runs the logic in small steps per frame).

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
- `src/base/`: home base: `HomeBase.ts` (scene, crew, launch cutscene), `Layout.ts` (the floor plan: rooms, corridors, levels, stairs, floor holes, doors, key spots), `Station.ts` (builds the rooms, cutaway walls, decor and the view), `Robot.ts` (BOLT), `Pilot.ts` (the on-foot character), `BaseUI.ts` (dialogue and shops), `Save.ts` (progress, perks, outfits, ships)
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
7. ✅ Contracts: BOLT's contract board, retrieve / hunt / uplink objectives in sorties
8. ✅ Bosses and new enemies: six enemy types (two per zone), three bosses, 2-round sorties
9. Polish: audio, menus, saves, offline play
