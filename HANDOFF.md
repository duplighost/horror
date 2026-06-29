# MARROW — Engineering Handoff

A working brief for the next Claude Code conversation. The `README.md` covers
the player-facing pitch and controls; **this doc covers the internals, the
landmines, how to test, and where things stand.** Read it before touching code.

---

## 0. The prime directive

The user wants **the scariest horror game ever** — and means it literally. The
bar is not "atmospheric" or "well-crafted." The bar is *"I want to be scared to
death. I want to be unable to complete it — not because it's technically hard,
but because I have to do things I'm too terrified to do."*

Their design philosophy, in their words:
- **Terror comes from the player *choosing* to do the scary thing.** The
  best set-piece (the zone-3 blood-red portal) works because *you* have to run
  into it while chased. A cutscene that does it *for* you kills the dread.
  Avoid taking control away from the player at the scary moment.
- *"The player should almost know how to progress at first, but get so
  terrified they don't want to try the right direction."*
- They **love horror clichés done well.** Don't be too clever to use them.
- They will tell you bluntly when it isn't scary: *"if how to scare a player
  was validated by the design, playtesters would be scared. and they're not
  lol."* Do **not** defend a design as "validated" — go find new ways to scare.

**Scariness is the permanent open problem.** Everything else (freezes, nav,
audio) is in service of it. When those are handled, the work is *always* "make
it scarier," and that means real, surprising, unexpected mechanics — not polish.

### Delivery workflow (every iteration)
1. Develop on branch **`claude/inspiring-mayer-jc1rjf`**.
2. Commit with a descriptive message; push with `git push -u origin <branch>`.
3. **Build a fresh zip and send it to the user** via the file-send tool — they
   deploy it themselves to Netlify / qualiacology.com. They do NOT pull the
   branch to play; the zip is the deliverable. Build it with:
   ```bash
   zip -rq marrow.zip index.html src vendor assets _headers netlify.toml README.md package.json serve.mjs
   ```
4. Do **not** open a PR unless explicitly asked.
5. Never put the model identifier in commits/PRs/code.

---

## 1. Stack & constraints (hard rules)

- **Three.js r160**, vendored at `vendor/three.module.min.js`, loaded via an
  import map in `index.html`. **No build step. No npm install to run.**
- **Web Audio API**, fully procedural. **Zero binary assets** — every texture,
  wall, and scream is generated at runtime (`src/textures.js`, `src/audio.js`).
  Keep it that way; do not add image/audio files.
- Must run on **desktop (pointer-lock + WASD)** and **mobile (floating
  thumbsticks)**. `src/controls.js`, `src/config.js` (`IS_TOUCH`/`IS_MOBILE`).
- Minimal on-screen words. Follow-the-light guidance, not text.

---

## 2. How to run & test (READ THIS — the test harness is ephemeral)

### Dev server
`serve.mjs` in the repo root is a zero-dep static server:
```bash
node serve.mjs          # PORT env var overrides; default in the file
```

### The debug handle
With `?debug` in the URL, `window.__MARROW` is exposed (see end of `main.js`):
```
{ scene, player, director, go, Audio, ctx, interaction, renderer,
  getLevel: () => currentLevel, started: () => started }
```
`go(name)` teleports to any level. Level names:
`forest, mansion, basement, conservatory, library, nursery, bathhouse,
gallery, chapel, final`. This is how every automated test drives the game.

### The headless probe pattern (puppeteer)
**All verification this project does is headless-Chrome probes.** They live in
the **session scratchpad**, which is **EPHEMERAL — a fresh conversation/container
will NOT have them, nor puppeteer/chrome installed.** You will need to
re-provision. The pattern that worked:

- Puppeteer was at `/tmp/pptrtest/node_modules/puppeteer/...`
- Chromium at `/tmp/pptr-cache/chrome/linux-131.0.6778.204/chrome-linux64/chrome`
  (this remote env also ships Chromium at `/opt/pw-browsers/chromium` for
  Playwright — either works; launch with `--use-gl=swiftshader --no-sandbox
  --disable-dev-shm-usage`).
- A probe: spawn `serve.mjs`, `goto(?debug)`, wait for `window.__MARROW`,
  dispatch a pointerdown on `#boot` to start, then `pg.evaluate(() =>
  window.__MARROW.go('chapel'))`, wait, and read state back.

**Important caveat:** headless swiftshader compiles shaders fast and **cannot
reproduce a real GPU watchdog reset (TDR)** — the actual freeze/crash class.
Probes can measure *proxies* (light counts, `renderer.info.programs.length`),
but final confirmation of "no freeze" must come from the **user on real
hardware.** Always say so.

### Useful probe recipes (rebuild as needed)
- **Console-error smoke**: `go()` through all 10 levels, count `console.error`s.
  Target: 0. This is the baseline gate for any change.
- **Light count**: traverse `__MARROW.scene`, count `o.isPointLight`. Deep
  levels should be **~16–18 and roughly constant** (see §4).
- **Recompile-on-spawn**: in a deep level, record
  `renderer.info.programs.length`, then `director.entity.spawnAt(...)`, wait,
  re-read. **It must NOT grow.** Growth = a shader recompile = a freeze.
- **Hunt**: `director.startChase(...)` / the hunt trigger; assert distance
  closes and a catch → release cycle completes (`frozen` toggles, then clears).
- **Screenshots**: teleport the player, `pg.screenshot(...)`, then Read the PNG
  to eyeball lighting/atmosphere.

---

## 3. Architecture map

### Frame loop (`src/main.js`, the animate function — ORDER MATTERS)
```
controls → player.update → interaction.update → director.update(dt)
  → currentLevel.update(dt, time, player) → updateTriggers()
  → flickerFlames(levelFlames) (+ flamesExtra) → updateMotes → Audio.update
  → updateAtmosphere → post.render → governor
```
- `director.update` runs BEFORE level update and triggers. The director owns a
  guard `if (this.ended || this._plunging) { player.flicker = 1; return; }` so
  end/transition FX aren't stomped every frame.

### Level lifecycle (`loadLevel` in `main.js`)
`unloadLevel` (disposes geometry/materials) → build via `builders[name]` →
add to scene → set fog/ambient/sky → teleport player → `director.reset()` →
`enterZone` → wire interactables/triggers/flames → `onEnter` →
**shader warm-up** (see §4.3).

### Files
| File | Responsibility |
|---|---|
| `src/main.js` | bootstrap, renderer, frame loop, level load/unload, **shader warm-up**, FPS governor, renderer fallback |
| `src/scares.js` | **the Director** — dread timeline, all scares, **the Hunt**, guardians, endings. The heart of the fear. |
| `src/entity.js` | **the Presence** — one shared creature instance, respawned dozens of times. Modes: idle/chase/cross/guard/approach. **Light rig + warm-up flag** (§4.2). |
| `src/audio.js` | procedural Web Audio: bed voicing per zone, breathing layer, footsteps (heavy mode for the creature), stingers, positional panning. |
| `src/player.js` | movement, flashlight (2 spotlights + lens point light), headbob, stamina. |
| `src/world/deepLevels.js` | the 6 procedural maze wings (conservatory→chapel). Maze gen, decoration, guidance, **flame pooling** (§4.1). |
| `src/world/{forest,mansion,basement,final}.js` | the hand-built set-piece levels. |
| `src/world/props.js` | shared mesh factories incl. `makeFlame` + the **flame pool** helpers. |
| `src/world/maze.js`, `collision.js` | maze carving + the `ColliderField`. |
| `src/textures.js`, `src/post.js`, `src/ui.js`, `src/config.js`, `src/interaction.js` | procedural textures, post FX, HUD/fades, tunables, the use/focus system. |

### Progression
forest → mansion → basement → conservatory → library → nursery → bathhouse →
gallery → chapel → final (eye chamber). Deep-level order is chained via each
spec's `.next`; basement hands off to conservatory (§5, the portal).

---

## 4. CRITICAL GOTCHAS — the landmines (read before any rendering change)

### 4.1 The scene's point-light COUNT is the #1 performance trap
This was the root cause of the "freezes at level start / key pickup / creature
appearing" AND the `WEBGL FAILED` crash. **three.js bakes the number of visible
point lights into every shader's program-cache key**
(`getProgramCacheKey` → `numPointLights`). Consequences:
- A **high** count → enormous fragment shaders that stall on compile (a
  multi-hundred-ms hang big enough to trip the GPU's watchdog → context loss →
  the crash).
- A **changing** count → three.js **recompiles every material** the frame it
  changes. A synchronous recompile mid-game = a visible freeze.

So the rule is: **keep the live point-light count SMALL and CONSTANT within a
level.**

**Flame pooling** (`src/world/props.js`, wired in `deepLevels.js`): maze embers
used to be a full `PointLight` each — **49–92 per deep level (chapel: 92).** Now
`poolifyFlames()` strips the per-ember light (keeping its glowing *sprite*, so
the trail is still visible and the maze isn't pitch black), `makeFlamePool(12)`
creates a fixed pool, and `updateFlamePool()` lends those 12 rovers to the
nearest embers each frame. **Deep levels now hold ~18 lights, constant.** If you
add lights, respect this budget — never one-light-per-prop at scale.

### 4.2 The creature's lights must never change the count
`src/entity.js`: the Presence's `eyeLight` + `chestLight` live on a **separate
`this.lightRig`** that is **always in the scene and always visible** (intensity
driven to 0 when dormant), synced to the body each frame. If they rode on the
creature's `group` (which toggles `visible`), spawning the creature would change
the light count → recompile → the "creature appears → freeze." Don't move them
back onto the group.

### 4.3 `compileAsync` skips invisible objects (`traverseVisible`)
`renderer.compile/compileAsync` use **`traverseVisible`**, so a hidden creature
is NOT pre-compiled — its physical-material shader then compiles on first
sighting (a freeze). Fix in `loadLevel` (`main.js`): briefly **reveal the
creature, parked at y = -60, with `entity._warmup = true`** (which makes
`entity.update` early-return so it stays inert and doesn't pop to the floor),
let `compileAsync` warm it for *this level's exact lighting*, then hard-hide it
on resolve. Verified: spawning now compiles **0** new programs in every level.
If you add a new always-on material that only appears mid-game, it needs the
same warm-up treatment.

### 4.4 Other perf notes
- **Neither flashlight casts shadows** (`castShadow = false` in `player.js`) —
  shadows are effectively off, so shadow-map cost is moot. Don't reintroduce
  `castShadow` casually.
- Deep-level **maze interior walls are undressed** (`addRouteWall` passes
  `dress=false`) and materials are shared via a per-level `_matCache`
  (conservatory went 2109→1060 meshes, 452→138 materials). Keep mesh/material
  counts down.
- `main.js` has an **FPS governor** (drops pixelRatio, then effects, if FPS<46)
  and a **renderer fallback** (`high-performance` → `default` → `showFatal`).

---

## 5. The fear systems (where to make it scarier)

- **The Director (`scares.js`)** runs a dread timeline (`_updateDread`) that
  spaces incidental scares, gated by tension and quiet windows. Scares:
  `darkEyes`, `shadowFold`, `peripheral`, `crossPath`, `behindYou`, `witness`,
  `lurk`, `hallucinate`, stingers. `darkEyes/shadowFold` allocate small
  geometries with **cached MeshBasicMaterial shaders** (light-independent — not
  a freeze risk).
- **The Hunt** (`_updateHunt`, `_beginStalk`, `_repositionHunter`,
  `_caughtByHunter`): a persistent predator with per-zone intensity
  (`mansion 0.30 … chapel 0.92`). It stalks, commits to a chase when it sees you
  or gets close, loses you past ~22 units, and — because there's **no
  pathfinding** (it wall-slides) — **repositions behind you within ~1.6s** when
  it clips a wall (the user liked the wall-clipping sound but it shouldn't be
  its whole behavior). Catch → freeze → release, no progress loss.
- **The Presence (`entity.js`)** animates a vanish (folds into the dark) when
  watched, hard-hides when unwatched (so it's "gone when you look back"). Guard
  mode **looms** (grows + bows its head as you near).
- **Guardians**: a creature barring the key or the door (alternates by wing
  index). `sentinelAt` / `dismissGuardian` / `_updateSentinel`.
- **Audio (`audio.js`)**: per-zone bed voicing, a breathing layer (gasps fire
  immediately), and **heavy footsteps** for the creature (3.4× louder + a low
  body-weight impact + wet drag) so you hear it coming when chased. The user has
  said audio *"gets muddy and not scary after a while"* — the soundtrack is
  supposed to evolve; watch for it going flat.
- **Guidance** (`deepLevels.js addGuidance` + the per-maze approach trail): the
  ember trail is both decoration AND the player's main light. The user gets lost
  in the dark easily — *"a lot of it the flashlight doesn't work in, just pitch
  black, I get off course."* Fog/ambient were eased in `config.js` for the deep
  levels. Don't over-darken; balance dread vs. "I'm lost and bored."

---

## 6. What the last session changed (commit `fc65df4`)
- **Fixed the freezes** via §4.1–4.3 (flame pooling, entity light rig,
  per-level shader warm-up). Chapel 92→18 lights; 0 recompiles on spawn.
- **Hunter audibility & nav**: heavy footsteps; ~1.6s reposition when wall-stuck;
  wider clearance; denser ember + approach trails; eased deep-level fog/ambient.
- **Restored the zone-3 ending** (`basement.js`): reverted the `plungeInto`
  cutscene back to the original **`director.stopChase(); ctx.go('conservatory')`**
  — you run into the blood-red portal yourself while chased. `plungeInto` still
  exists in `scares.js` but is now **unused** (left as a reusable transition).

## 6b. This session — navigation, a real freeze fix, scare consistency
Goal from the user: *polish every level, no weird freezes, and stop the maze
navigation from being the hard part — the hard part is pushing forward while
scared, not finding the way.* Verified headless (Playwright/Chromium probe):
**0 console errors across all 10 levels + the full ending; 0 program recompiles
on key/relic pickup.**
- **Navigation is now the backdrop, not the test.** The difficulty used to be
  *inverted* — it got harder to see/navigate the deeper you went. Fixed:
  - `addGuidance` (deepLevels): the ember breadcrumb chain is now **bright, large,
    constant at every depth** (was dimmed by `depth01`). Still pooled → light count
    unchanged.
  - `addPathTrail`: the floor sheen is now **continuous and constant** (was
    every-other-segment and dimmed with depth) — a second always-on guide layer.
  - `config.js`: softened the punishing deep fog-up/ambient-down ramp (basement→
    chapel, + a touch on mansion/final). Darkness stays as *mood*; no corridor is
    an unnavigable void. The FEAR escalates with depth now, not the blindness.
  - **Braid inverted**: deep specs + mansion are now *more* braided the deeper you
    go (conservatory 0.55 → chapel 0.76; mansion 0.5), so dead-end traps — the real
    time-wasters — are rarer late, not commoner. Chapel trimmed 7×8 → 7×7.
- **Freeze fix (the "freeze when I grab the key" class).** `makeKey()` and
  `makeRelic()` each held a live `PointLight`; pickup did `group.remove(...)`,
  which dropped the scene's light count mid-game → three.js recompiles **every**
  shader that frame → a hard stutter (and, on the relic, right as the ending
  fires). Fix: **keys carry no PointLight** (strong emissive + an additive halo
  sprite; the guidance trail lands you on them); the **relic keeps its light**
  (hidden + driven to 0 on pickup, never removed). Verified: `programs.length`
  delta **0** on nursery/forest key and the final relic. Only mid-level light
  events left are scares using cached light-independent `MeshBasicMaterial`.
- **Chapel Hunt was silently dead.** `chapel.onEnter` called `director.guard(0,-19)`,
  leaving the single shared Presence permanently visible — and `_updateHunt` only
  begins a stalk when the Presence is free. So the deepest level (hunt intensity
  0.92) never actually hunted you during traversal. Removed; verified a chase now
  begins (`hidden → chase`).
- **Audio: breath leaked through the ending hush.** Breathing bypasses the master
  bus (so gasps stay crisp under muffle), so `fadeOut()` missed it and the player
  kept gasping through the climactic silence. Added a `breath._fading` latch:
  `fadeOut` silences breath and the per-frame drive stops fighting it; `resetMix`
  clears it for replay.
- **Audited clean** (subagent, cross-checked): `collision.js`, `controls.js`
  (incl. mobile sticks / touchcancel / blur resets), `post.js`, `textures.js`, and
  every `Audio.*`/`post.*` call site — no missing methods, no leaks, no NaN.
- **Cache token bumped** `graphics-terror-detail` → `nav-fear-polish` (the
  versioned entry-module chain) so returning players get the new code.
- **Re-provisioned the probe**: `playwright-core` (system Chromium at
  `/opt/pw-browsers/...`, `--use-gl=swiftshader`). Scripts were in the session
  scratchpad (ephemeral). Swiftshader still can't reproduce a real GPU watchdog —
  *the user's hardware is the only true freeze test.* Mansion remains the heaviest
  level (~22 constant point lights, compiled once in the load fade); not a
  mid-game freeze, but the next candidate if load-stutter is ever reported (pool
  its flames like the deep levels).

---

## 7. Open issues / what the user may ask next
- **"Still not scary enough"** is the recurring ask. Bring *new, surprising*
  mechanics, not polish. They specifically want: the mirror creature in zone 2
  (conservatory area) to pay off; unexpected scares; and the feeling of being
  too terrified to take the obviously-correct path.
- **Confirm the freezes are actually gone on their hardware** — the headless
  fix is well-evidenced but a real GPU is the only true test. Ask.
- The **guardian regression probe reads 4/6** but that's a known test-navigator
  artifact (the navigator matches a radius-1.8 decor interactable over the
  radius-1.75 key); guardians fire correctly in real play (verified 6/6 via a
  trigger-level test). Don't chase the 4/6 as a real bug without re-confirming.
- Audio going "muddy after a while" — keep an ear on the evolving soundtrack.
- The **probe scripts and puppeteer/chrome are gone** in a fresh container
  (§2) — re-provision before testing.

---

## 8. Working with this user
- They give **specific, playtest-driven feedback** ("zone 4 is directionless,"
  "you can't hear its footsteps," "it freezes when I pick up a key"). Treat each
  item as a concrete bug/task and address them all.
- They **reject hand-waving.** If you can't verify something, say so. If a test
  is a proxy and the real proof needs their hardware, say that too.
- They are the **judge of scariness and atmosphere** — show them (zip every
  iteration), don't tell them it's good.
- Be willing to **revert your own "improvements"** when they preferred the
  original (the portal cutscene is the precedent).
