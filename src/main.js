import * as THREE from 'three';
import { Quality, CFG, IS_TOUCH } from './config.js';
import { setTextureRenderer, softDot } from './textures.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { createControls } from './controls.js';
import { Player } from './player.js';
import { Post } from './post.js';
import { Director } from './scares.js';
import { InteractionManager } from './interaction.js';
import { flickerFlames } from './world/props.js';
import { buildForest } from './world/forest.js';
import { buildMansion } from './world/mansion.js';
import { buildBasement } from './world/basement.js';
import { buildFinal } from './world/final.js';

const canvas = document.getElementById('game');

// --- renderer ---
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: false, stencil: false, powerPreference: 'high-performance',
});
renderer.setPixelRatio(Quality.pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
renderer.shadowMap.enabled = Quality.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
setTextureRenderer(renderer);

// --- core objects ---
const scene = new THREE.Scene();
const ambient = new THREE.AmbientLight(0x0a0c14, 0.14);
scene.add(ambient);

const player = new Player();
player.addToScene(scene);
// The held flashlight/hand is parented to the camera; three.js only renders a
// camera's children when the camera is part of the scene graph, so add it.
scene.add(player.camera);
const post = new Post(renderer);
const controls = createControls(canvas);
const interaction = new InteractionManager(UI, Audio);

// shared context handed to levels & the director
const ctx = {
  scene, audio: Audio, post, ui: UI, player,
  inventory: new Set(),
  interactables: [], triggers: [],
  go, endGame,
  flamesExtra: [],
};
const director = new Director(ctx);
ctx.director = director;

const builders = { forest: buildForest, mansion: buildMansion, basement: buildBasement, final: buildFinal };

// --- floating dust motes that drift through the torch beam (interiors) ---
let motes = null;
function buildMotes() {
  const n = Quality.dustMotes; if (!n) return;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = (Math.random() - 0.5) * 18;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: 0.02, map: softDot('#ccccbb'), transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending });
  motes = new THREE.Points(geo, mat); motes.frustumCulled = false; scene.add(motes);
}
function updateMotes(dt, t) {
  if (!motes) return;
  motes.position.copy(player.camera.position);
  motes.rotation.y = t * 0.02;
  const arr = motes.geometry.attributes.position.array;
  for (let i = 1; i < arr.length; i += 3) { arr[i] += Math.sin(t + i) * dt * 0.05; }
  motes.geometry.attributes.position.needsUpdate = true;
}

// --- level streaming ---
let currentLevel = null;
let levelFlames = [];
let activeTriggers = [];
let transitioning = false;

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose(); // shared canvas textures stay cached
    }
  });
}
function unloadLevel() {
  if (!currentLevel) return;
  scene.remove(currentLevel.group);
  disposeGroup(currentLevel.group);
  if (ctx.flamesExtra) ctx.flamesExtra.length = 0;
  currentLevel = null;
}

function loadLevel(name, opts = {}) {
  unloadLevel();
  ctx.interactables = []; ctx.triggers = [];
  const level = builders[name](ctx);
  currentLevel = level;
  scene.add(level.group);

  scene.fog = new THREE.FogExp2(level.fog.color, level.fog.density * Quality.fogDensityScale);
  scene.background = new THREE.Color(level.sky);
  ambient.color.setHex(level.ambient.color);
  ambient.intensity = level.ambient.intensity;

  player.field = level.field;
  player.teleport(level.spawn.x, level.spawn.z, level.spawn.yaw);
  player.pitch = 0; player.speedScale = 1; player.frozen = false; player.flashOn = true; player.crawl = false; player.releaseLook();

  director.setField(level.field);
  director.reset();
  director.enterZone(name);        // dread logic must know the real current zone
  interaction.setLevel(ctx.interactables);
  activeTriggers = ctx.triggers;
  levelFlames = level.flames || [];
  Audio.setZone(name === 'final' ? 'final' : name);

  if (level.onEnter) level.onEnter(ctx);
}

function go(name, opts = {}) {
  if (transitioning) return; transitioning = true;
  UI.fadeTo(1, 850); UI.showLoading(true);
  Audio.setMuffle(700, 0.5); Audio.duck(0.5, 0.5);
  setTimeout(() => {
    loadLevel(name, opts);
    UI.showLoading(false);
    setTimeout(() => {
      UI.fadeTo(0, 1500); Audio.setMuffle(20000, 1.6); Audio.duck(1.0, 1.5);
      transitioning = false;
    }, 250);
  }, 900);
}

// --- triggers ---
function updateTriggers() {
  // Don't fire world triggers while a level transition is in flight — the player
  // is being repositioned/faded, and a trigger that calls go() here would be
  // blocked by the transition guard yet still mark itself fired (consumed).
  if (transitioning) return;
  const p = player.pos, nowS = performance.now() / 1000;
  for (const t of activeTriggers) {
    const inside = Math.hypot(p.x - t.x, p.z - t.z) < t.r;
    if (inside && !t._inside) {
      const okOnce = !(t.once && t._fired);
      const okCd = !(t.cooldown && t._last && (nowS - t._last) < t.cooldown);
      if (okOnce && okCd) { t.onEnter(ctx); t._fired = true; t._last = nowS; }
    }
    t._inside = inside;
  }
}

// --- ending / restart ---
// The endcard has two possible meanings: the real ending (tap to replay) and the
// context-loss watchdog (tap to reload). One handler, switched by this flag —
// no duelling onclick/addEventListener.
let endcardReload = false;
function endGame() {
  endcardReload = false;
  UI.showEnd('it is yours now');
}
UI.endcard.addEventListener('click', () => {
  if (endcardReload) { location.reload(); return; }
  UI.hideEnd();
  // soft restart: fresh inventory, post + mix restored (the ending faded audio
  // to silence — bring it back). loadLevel resets the Director and zone.
  ctx.inventory.clear();
  post.set('dread', 0); post.set('tunnel', 0); post.set('desat', 0.25); post.set('aberration', 0.0015);
  Audio.stopCrescendo(); Audio.resetMix();
  loadLevel('forest');
  UI.fade.style.transition = 'opacity 1.6s ease';
  requestAnimationFrame(() => { UI.fade.style.opacity = '0'; });
  if (!IS_TOUCH) controls.lock();
});

// --- boot ---
let started = false, time = 0, last = performance.now();
function start() {
  if (started) return; started = true;
  Audio.start();
  UI.hideBoot();
  loadLevel('forest');
  buildMotes();
  UI.fadeTo(0, 3000);
  Audio.setTension(0.12);
  if (!IS_TOUCH) controls.lock();
  if (IS_TOUCH) showMobHint();
}
UI.boot.addEventListener('pointerdown', start);
UI.boot.addEventListener('touchstart', (e) => { e.preventDefault(); start(); }, { passive: false });

function showMobHint() {
  const W = window.innerWidth, H = window.innerHeight;
  const svg = `<svg width="100%" height="100%" viewBox="0 0 ${W} ${H}">
    <g stroke="#cfc8b8" stroke-width="1.4" fill="none" opacity="0.8">
      <circle cx="${W * 0.2}" cy="${H * 0.72}" r="46"/><circle cx="${W * 0.2}" cy="${H * 0.72}" r="18" fill="#cfc8b855"/>
      <circle cx="${W * 0.8}" cy="${H * 0.72}" r="46"/><circle cx="${W * 0.8}" cy="${H * 0.72}" r="18" fill="#cfc8b855"/>
    </g></svg>`;
  UI.showMobHint(svg);
  setTimeout(() => UI.hideMobHint(), 3500);
}

// re-lock pointer on click (desktop) if it was released
canvas.addEventListener('mousedown', () => { if (started && !IS_TOUCH && !controls.locked) controls.lock(); });
// keep audio alive across tab switches
document.addEventListener('visibilitychange', () => { if (!document.hidden && Audio.context && Audio.context.state === 'suspended') Audio.context.resume(); });

// --- resize ---
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  player.camera.aspect = w / h; player.camera.updateProjectionMatrix();
  renderer.setSize(w, h); post.setSize(w, h);
}
window.addEventListener('resize', onResize);

// --- WebGL context loss / restore -----------------------------------------
// Under heavy GPU/VRAM pressure the browser can drop the WebGL context. If we
// don't preventDefault() here, it is NEVER restored — the canvas dies (white)
// while audio keeps playing, exactly the failure that bites when a lot is
// running at once. We pause rendering, hold a soft black veil over the frozen
// frame, and rebuild GPU resources when the context comes back.
let glLost = false, glLostAt = 0;
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  glLost = true; glLostAt = performance.now();
  UI.fade.style.transition = 'opacity 250ms ease';
  UI.fade.style.opacity = '0.92';
  UI.showLoading(true);
}, false);
canvas.addEventListener('webglcontextrestored', () => {
  glLost = false;
  endcardReload = false; UI.hideEnd();        // dismiss any watchdog "wake" prompt
  post.onContextRestored();
  renderer.shadowMap.enabled = Quality.shadows && degradeStep < 1;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  onResize();
  UI.showLoading(false);
  UI.fade.style.transition = 'opacity 1400ms ease';
  UI.fade.style.opacity = '0';
}, false);
// safety net: if a lost context never comes back, let the player wake it
function glWatchdog() {
  if (glLost && performance.now() - glLostAt > 7000 && !endcardReload) {
    endcardReload = true;
    UI.showEnd('the dark swallowed the light', '↻ wake');
  }
}

// --- adaptive performance governor ---
let fpsAccum = 0, fpsFrames = 0, degradeStep = 0;
function governor(dt) {
  fpsAccum += dt; fpsFrames++;
  if (fpsAccum >= 1.0) {
    const fps = fpsFrames / fpsAccum; fpsAccum = 0; fpsFrames = 0;
    if (fps < 38 && degradeStep < 3) {
      degradeStep++;
      if (degradeStep === 1 && renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; player.flashlight.castShadow = false; }
      else if (degradeStep === 2) { const pr = Math.max(0.75, renderer.getPixelRatio() * 0.8); renderer.setPixelRatio(pr); post.setSize(window.innerWidth, window.innerHeight); }
      else if (degradeStep === 3) {
        Quality.fogDensityScale = 1.15;
        if (scene.fog && currentLevel) scene.fog.density = currentLevel.fog.density * Quality.fogDensityScale;
        if (motes) { scene.remove(motes); motes = null; }
      }
    }
  }
}

// Player body audio: footsteps cadenced by distance travelled (so they speed up
// when you run), plus a soft thud when you walk into something. player.update()
// returns this movement summary each frame.
let stepDist = 0, lastThud = 0;
function playerFeedback(info, dt) {
  if (!info) return;
  const zone = currentLevel ? currentLevel.name : 'forest';
  const surface = zone === 'forest' ? 'leaf' : (zone === 'basement' || zone === 'final') ? 'wet' : 'dry';
  if (info.moving && info.horizSpeed > 0.5) {
    stepDist += info.horizSpeed * dt;        // cadence by distance travelled
    const stride = info.running ? 1.5 : 2.0;
    if (stepDist >= stride) { stepDist = 0; Audio.footstep(player.pos, surface); }
  }
  if (info.hitWall && info.horizSpeed > 1.2 && time - lastThud > 0.45) {
    lastThud = time; Audio.footstep(player.pos, true);   // a soft body thud
  }
}

// --- main loop ---
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  if (!started) return;
  time += dt;

  controls.update(dt);
  playerFeedback(player.update(dt, controls), dt);

  interaction.update(player);
  if (controls.consumeInteract()) interaction.tryUse(ctx);

  director.update(dt);
  if (currentLevel && currentLevel.update) currentLevel.update(dt, time, player);
  updateTriggers();

  flickerFlames(levelFlames, time);
  if (ctx.flamesExtra && ctx.flamesExtra.length) flickerFlames(ctx.flamesExtra, time);
  updateMotes(dt, time);

  Audio.update(dt, player.pos, player.forward);
  if (glLost) { glWatchdog(); return; }   // keep sound + sim alive, skip GL until restored
  post.render(scene, player.camera, dt);
  governor(dt);
}
requestAnimationFrame(frame);

// expose a little for debugging / automated testing
window.__MARROW = { scene, player, director, go, Audio, ctx, interaction, getLevel: () => currentLevel, started: () => started };
