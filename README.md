# MARROW

A first-person browser horror game. You wake in a drowned wood with a failing
flashlight. There is a house. There is something in the house. There is
something under the house — and it wants you to come and take it.

Built with **Three.js** and the **Web Audio API**. No game engine, no build
step, and **not a single image or sound file** — every texture, every wall,
every scream is generated procedurally at runtime. Runs on desktop and mobile
from a single static folder.

![forest](docs/preview-forest.png)
![mansion](docs/preview-mansion.png)
![basement](docs/preview-basement.png)
![the end](docs/preview-final.png)

> Headphones strongly recommended. The soundtrack *is* the horror.

---

## Play

Open `index.html` through any static web server (ES modules need `http://`, not
`file://`):

```bash
npm start                 # -> http://localhost:8080   (zero dependencies)
# or
python3 -m http.server 8080
```

Then open the URL and **touch / click to enter**.

### Controls

| | Desktop | Mobile |
|---|---|---|
| Move | `W A S D` / arrows | **left thumbstick** — press anywhere on the left half |
| Look | mouse (click to capture) | **right thumbstick** — press anywhere on the right half |
| Run | hold `Shift` | push the move stick to the edge |
| Interact / take | `E`, `Space`, or click | a quick **tap** |

The thumbsticks are *floating*: wherever your thumb lands becomes the stick's
centre, so you never fumble for a fixed pad. There is almost no on-screen UI —
a faint reticle swells when something can be touched, and that's it.

### What to do

There are no words telling you where to go. Follow the light. Find the key.
Open what it opens. Go down. Keep going down. When you find the thing at the
bottom — and you'll know it when you see it — you have to walk up and take it.
That's the hard part.

---

## Deploy

It's a static site. Drop the folder on any host (Netlify config included):

```bash
# Netlify: publish directory is "." — no build command.
```

---

## How it works

Everything is generated, so the whole game is ~190&nbsp;KB of source plus a
vendored copy of Three.js.

```
index.html            # shell, import-map, the few DOM overlays (fades/flash/reticle)
src/
  main.js             # renderer, scene, level streaming, the loop, perf governor
  config.js           # every feel-tuning number + runtime quality detection
  player.js           # first-person controller: movement, collision, headbob,
                       #   flashlight, and the held viewmodel
  controls.js         # desktop pointer-lock + the floating mobile thumbsticks
  collision.js        # grid-hashed circle/box collision with wall-sliding
  audio.js            # the entire soundtrack: a synthesized, reverberant,
                       #   tension-reactive drone, heartbeat, and jump-scare stingers
  entity.js           # the Presence — there when you glance, gone when you look
  scares.js           # the Director: failing torch, systemic dread, scripted beats
  post.js             # one fullscreen pass: grain, vignette, aberration, tunnel
  textures.js         # procedural canvas textures (bark, wallpaper, flesh, an eye…)
  interaction.js      # the "take it" system (no prompts, just the reticle)
  ui.js               # overlay control
  world/
    maze.js           # recursive-backtracker mazes (the looping, endless feel)
    props.js          # keys, doors, candles, furniture, the relic
    forest.js         # the wood + the looming house
    mansion.js        # the wallpapered, portrait-hung maze of halls
    basement.js       # stone giving way to flesh; reality slips
    deepLevels.js     # the deeper wings — conservatory, library, nursery,
                      #   bathhouse, gallery, chapel — each its own labyrinth
    final.js          # the ritual chamber and the eye
vendor/three.module.min.js
```

A few of the tricks used to make it big, confusing, and frightening:

- **Fog hides the edge of the world.** Draw distance is short on purpose; you
  can never see far enough to map the place, so it feels endless.
- **Real mazes.** Every level is a navigable labyrinth with braided loops, so
  you genuinely get lost — and the key always sits at the farthest dead-end. The
  descent runs ten environments deep; as you go, the mazes grow, the loops
  close into dead-ends, the fog thickens, and the guiding embers thin out until
  the house stops helping you.
- **Reality slips.** Down in the basement, a couple of corridors quietly
  teleport you somewhere you've already been.
- **The Director watches you.** Scares aren't on timers. The Presence appears in
  your periphery and vanishes the instant you look at it; the flashlight chooses
  the worst moments to die.
- **The soundtrack tracks your dread.** A single "tension" value swells the
  dissonant drone and quickens a heartbeat that rises *and* falls with the fear.
- **The Director paces the fear.** Most beats are quiet — a whisper or footsteps
  behind you, a far-off muffled scream, a moan, the torch stuttering, the
  Presence at the edge of your eye. Every so often the room holds its breath and
  *builds* — but that build only pays off with a real scream rarely (there's a
  hard cooldown); otherwise it collapses into silence. You're always braced,
  seldom actually hit, and never sure which it'll be.
- **The approach is meant to be hard.** At the end, the closer you get to the
  thing on the altar, the heavier your legs, the tighter your vision, and the
  louder everything screams. You have to push through it.

Performance scales itself: quality is guessed from the device, and a runtime
governor drops shadows, then resolution, if the frame budget slips — so the
dread never costs the framerate.

---

## Credits

Everything here — geometry, textures, music, and noise — is generated in code.
The only third-party code is [Three.js](https://threejs.org) (MIT), vendored in
`vendor/`. MIT licensed. Make something that scares people.
