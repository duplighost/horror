import * as THREE from 'three';
import { portraitTexture, softDot, woodFloorTexture } from '../textures.js';

// Reusable set-dressing and interactables. Kept low-poly and dark; the dread is
// in the lighting and sound, not the polygon count.

const _mat = {};
function mat(key, make) { return _mat[key] || (_mat[key] = make()); }
function wood() { return mat('wood', () => new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 })); }
function ironMat() { return mat('iron', () => new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.55, metalness: 0.7 })); }
function clothMat(c) { return new THREE.MeshStandardMaterial({ color: c, roughness: 1 }); }

// --- a findable key. Faint emissive + tiny light so the player notices it in
// the dark without a single word of UI. `tone` shifts iron/brass/bone. ---------
export function makeKey(tone = 'iron') {
  const g = new THREE.Group();
  const colors = { iron: 0x9fb0c0, brass: 0xc9a24b, bone: 0xd8cdb0 };
  const emis = { iron: 0x223344, brass: 0x4a3208, bone: 0x3a3320 };
  const m = new THREE.MeshStandardMaterial({ color: colors[tone], roughness: 0.4, metalness: tone === 'bone' ? 0.1 : 0.8, emissive: emis[tone], emissiveIntensity: 0.6 });
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 8, 16), m); g.add(bow);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), m);
  shaft.rotation.z = Math.PI / 2; shaft.position.x = 0.1; g.add(shaft);
  for (let i = 0; i < 2; i++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.035, 0.012), m);
    tooth.position.set(0.16 - i * 0.03, -0.022, 0); g.add(tooth);
  }
  const light = new THREE.PointLight(colors[tone], 9.0, 4.5, 2.0); g.add(light);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.spin = true;
  return g;
}

// --- the prize at the end: a slowly pulsing, wet, wrong little idol/heart ------
export function makeRelic() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x4a0a0e, roughness: 0.35, metalness: 0.1, emissive: 0x5a0008, emissiveIntensity: 0.8 });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 2), m);
  // lump it up so it reads as organic, not a gem
  const pos = core.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = 1 + Math.sin(x * 30) * 0.06 + Math.cos(y * 24) * 0.05;
    pos.setXYZ(i, x * n, y * n, z * n);
  }
  core.geometry.computeVertexNormals();
  g.add(core);
  const light = new THREE.PointLight(0xff1822, 12.0, 6.0, 2.0); g.add(light);
  g.userData.relic = true; g.userData.light = light; g.userData.core = core;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// --- a door on a hinge. open()/close() animate via the returned pivot. --------
export function makeDoor(w = 1.1, h = 2.2, t = 0.09) {
  const pivot = new THREE.Group();
  const m = wood();
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), m);
  slab.position.set(w / 2, h / 2, 0); slab.castShadow = true; slab.receiveShadow = true;
  pivot.add(slab);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), ironMat());
  knob.position.set(w - 0.12, h / 2, t); pivot.add(knob);
  pivot.userData.open = false; pivot.userData.targetAngle = 0; pivot.userData.angle = 0;
  return pivot;
}

// --- candle/lantern flame: additive sprite + flickering point light -----------
let _flameTex = null;
const FLAME_POWER = 16.0;  // scales author-friendly values into physical units (decay 2)
export function makeFlame(color = 0xffaa44, intensity = 1.1, dist = 7) {
  if (!_flameTex) _flameTex = softDot('#ffd089');
  const g = new THREE.Group();
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: _flameTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  spr.scale.set(0.18, 0.28, 1); g.add(spr);
  const power = intensity * FLAME_POWER;
  const light = new THREE.PointLight(color, power, dist, 2.0);
  light.castShadow = false; g.add(light);
  g.userData.flame = { base: power, light, spr, seed: Math.random() * 100 };
  return g;
}

// drive every registered flame's flicker (called from a level's update)
export function flickerFlames(list, t) {
  for (const g of list) {
    const f = g.userData.flame; if (!f) continue;
    const n = Math.sin(t * 17 + f.seed) * 0.5 + Math.sin(t * 7.3 + f.seed * 2) * 0.5;
    const k = 0.7 + n * 0.35 + Math.random() * 0.06;
    f.light.intensity = f.base * k;
    f.spr.scale.set(0.16 + n * 0.03, 0.26 + n * 0.05, 1);
  }
}

// --- a portrait whose hollow eyes resolve only when lit ------------------------
export function makePortrait(seed = 1, w = 0.7, h = 0.95) {
  const g = new THREE.Group();
  const tex = portraitTexture(seed);
  const canvas = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  g.add(canvas);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x1a1208, roughness: 0.6, metalness: 0.3 }));
  frame.position.z = -0.03; g.add(frame);
  g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  return g;
}

// --- furniture (box assemblies) -----------------------------------------------
export function makeTable(w = 1.4, d = 0.8, h = 0.78) {
  const g = new THREE.Group(); const m = wood();
  const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), m); top.position.y = h; g.add(top);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.08), m);
    leg.position.set(sx * (w / 2 - 0.08), h / 2, sz * (d / 2 - 0.08)); g.add(leg);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
export function makeChair() {
  const g = new THREE.Group(); const m = wood();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.42), m); seat.position.y = 0.46; g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.05), m); back.position.set(0, 0.7, -0.18); g.add(back);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.46, 0.05), m);
    leg.position.set(sx * 0.17, 0.23, sz * 0.17); g.add(leg);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
export function makeBed() {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 2.0), wood()); frame.position.y = 0.2; g.add(frame);
  const sheet = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.12, 1.95), clothMat(0x3a3530)); sheet.position.y = 0.38; g.add(sheet);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.4), clothMat(0x4a443c)); pillow.position.set(0, 0.45, -0.7); g.add(pillow);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
export function makeShelf(h = 2.0) {
  const g = new THREE.Group(); const m = wood();
  const side = (x) => { const s = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.3), m); s.position.set(x, h / 2, 0); g.add(s); };
  side(-0.5); side(0.5);
  for (let i = 0; i <= 3; i++) { const sh = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.3), m); sh.position.set(0, (h / 3) * i + 0.1, 0); g.add(sh); }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
export function makeMirror(w = 0.8, h = 1.4) {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.1, metalness: 0.9 }));
  g.add(glass);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, h + 0.1, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x140e06, roughness: 0.5, metalness: 0.4 }));
  frame.position.z = -0.03; g.add(frame);
  return g;
}

// --- forest props --------------------------------------------------------------
export function makeShrine() {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.95 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.5, 6), stoneMat); base.position.y = 0.25; g.add(base);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.7), stoneMat); top.position.y = 0.55; g.add(top);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
export function makeGravestone() {
  const m = new THREE.MeshStandardMaterial({ color: 0x26262a, roughness: 0.95 });
  const g = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.1), m);
  g.geometry.translate(0, 0.4, 0);
  g.rotation.z = (Math.random() - 0.5) * 0.2; g.castShadow = true; g.receiveShadow = true;
  return g;
}
