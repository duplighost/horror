import * as THREE from 'three';
import { ColliderField } from '../collision.js';
import { Quality, CFG } from '../config.js';
import { groundTexture, barkTexture, leafTexture, softDot } from '../textures.js';
import { makeKey, makeShrine, makeGravestone, makeFlame } from './props.js';

// The opening: a black, fog-drowned wood of gnarled dead trees and drifts of
// crunching leaves. A faint trail of will-o'-wisps draws you to a shrine that
// holds the iron key. Beyond the trees, a vast house waits with lit windows.

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// concatenate several indexed geometries (already transformed) into one — used
// to bake a branchy dead-tree into a single geometry we can instance.
function mergeGeos(geos) {
  let vc = 0, ic = 0;
  for (const g of geos) { vc += g.attributes.position.count; ic += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idx = new Uint32Array(ic);
  let vo = 0, io = 0, base = 0;
  for (const g of geos) {
    const pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv;
    pos.set(pa.array, vo * 3);
    if (na) nor.set(na.array, vo * 3);
    if (ua) uv.set(ua.array, vo * 2);
    if (g.index) { const gi = g.index.array; for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + base; io += gi.length; }
    else { for (let k = 0; k < pa.count; k++) idx[io + k] = base + k; io += pa.count; }
    vo += pa.count; base += pa.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  m.setIndex(new THREE.BufferAttribute(idx, 1));
  return m;
}
function lumpTrunk(geo, seed) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const bend = Math.sin(y * 0.25 + seed) * 0.12 * (y / 9);    // leans more toward the top
    const k = 1 + Math.sin(x * 8 + y * 2.5 + seed) * 0.06;      // lumpy bark relief
    p.setXYZ(i, x * k + bend, y, z * k);
  }
  geo.computeVertexNormals(); return geo;
}
// one gnarled dead tree: a lumpy trunk with a handful of bare clawing branches
function makeTreeGeo(r) {
  const parts = [];
  const trunk = lumpTrunk(new THREE.CylinderGeometry(0.13, 0.34, 9, 8, 5), r() * 10);
  trunk.translate(0, 4.5, 0); parts.push(trunk);
  const nb = 4 + (r() * 4 | 0);
  for (let i = 0; i < nb; i++) {
    const len = 1.0 + r() * 2.2;
    const b = new THREE.CylinderGeometry(0.012, 0.055, len, 5);
    b.translate(0, len / 2, 0);
    b.rotateZ((r() < 0.5 ? 1 : -1) * (0.5 + r() * 0.85));
    b.rotateY(r() * Math.PI * 2);
    b.translate(0, 3.8 + r() * 4.6, 0);
    parts.push(b);
  }
  return mergeGeos(parts);
}

export function buildForest(ctx) {
  const group = new THREE.Group();
  const field = new ColliderField(4);
  const rand = rng(20240607);
  const flames = [];
  const wisps = [];
  const windowMats = [];

  // --- ground ---
  const gtex = groundTexture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(320, 320, 1, 1),
    new THREE.MeshStandardMaterial({ map: gtex, roughness: 0.62, metalness: 0.18 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; group.add(ground);

  // faint cold moon so silhouettes read beyond the torch
  const moon = new THREE.DirectionalLight(0x4a5a82, 0.9);
  moon.position.set(-30, 40, -20); group.add(moon);
  const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot('#33405e'), transparent: true, opacity: 0.5, depthWrite: false }));
  moonSprite.scale.set(14, 14, 1); moonSprite.position.set(-40, 38, -60); group.add(moonSprite);

  // --- bounds of the playable wood (rectangle, hidden by fog) ---
  const X0 = -62, X1 = 62, Z0 = -74, Z1 = 20;
  const mansion = { x: 0, zFront: -44, zBack: -62, halfW: 11 };
  const shrine = { x: 16, z: -18 };

  function blocked(x, z) {
    // mansion footprint
    if (x > mansion.x - mansion.halfW - 2 && x < mansion.x + mansion.halfW + 2 && z < mansion.zFront + 1 && z > mansion.zBack - 3) return true;
    // spawn clearing
    if (Math.hypot(x - 0, z - 8) < 5) return true;
    // shrine clearing
    if (Math.hypot(x - shrine.x, z - shrine.z) < 5) return true;
    // a loose corridor toward the door so the way is never fully walled
    if (Math.abs(x) < 2.2 && z < 8 && z > mansion.zFront) return true;
    return false;
  }

  // --- trees: a few gnarled dead-tree variants, each instanced ---
  const trunkMat = new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.92 });
  const maxTrees = Quality.maxInstancedTrees;
  const VARIANTS = 4;
  const variants = [];
  for (let v = 0; v < VARIANTS; v++) variants.push({ geo: makeTreeGeo(rng(1009 + v * 31)), mats: [] });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pp = new THREE.Vector3();
  let n = 0;
  function placeTree(x, z, scale, lean) {
    if (n >= maxTrees) return;
    const v = variants[(rand() * VARIANTS) | 0];
    e.set((rand() - 0.5) * lean, rand() * Math.PI * 2, (rand() - 0.5) * lean);
    q.setFromEuler(e); sc.set(scale, scale * (0.85 + rand() * 0.5), scale); pp.set(x, 0, z);
    m4.compose(pp, q, sc); v.mats.push(m4.clone());
    field.addCircle(x, z, 0.42 * scale, 1); n++;
  }
  let attempts = 0;
  while (n < maxTrees * 0.86 && attempts < maxTrees * 6) {
    attempts++;
    const x = X0 + rand() * (X1 - X0), z = Z0 + rand() * (Z1 - Z0);
    if (blocked(x, z)) continue;
    placeTree(x, z, 0.7 + rand() * 0.8, 0.16);
  }
  // dense boundary wall of trees (the world has no edge you can reach)
  for (let i = 0; i < 240 && n < maxTrees; i++) {
    const ang = (i / 240) * Math.PI * 2;
    const rx = (X1 - X0) * 0.5 + 4, rz = (Z1 - Z0) * 0.5 + 4;
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
    placeTree(cx + Math.cos(ang) * rx + (rand() - 0.5) * 3, cz + Math.sin(ang) * rz + (rand() - 0.5) * 3, 1.0 + rand() * 0.6, 0.07);
  }
  for (const v of variants) {
    if (!v.mats.length) continue;
    const im = new THREE.InstancedMesh(v.geo, trunkMat, v.mats.length);
    im.castShadow = true; im.receiveShadow = true;
    v.mats.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.instanceMatrix.needsUpdate = true; group.add(im);
  }
  // hard boundary so you truly cannot leave
  field.addBox(X0 - 3, Z0 - 3, X1 + 3, Z0 - 1, 9);
  field.addBox(X0 - 3, Z1 + 1, X1 + 3, Z1 + 3, 9);
  field.addBox(X0 - 3, Z0 - 3, X0 - 1, Z1 + 3, 9);
  field.addBox(X1 + 1, Z0 - 3, X1 + 3, Z1 + 3, 9);

  // a few leaning gravestones near the shrine
  for (let i = 0; i < 7; i++) {
    const gx = shrine.x + (rand() - 0.5) * 8, gz = shrine.z + (rand() - 0.5) * 8;
    if (Math.hypot(gx - shrine.x, gz - shrine.z) < 1.5) continue;
    const gs = makeGravestone(); gs.position.set(gx, 0, gz); gs.rotation.y = rand() * Math.PI; group.add(gs);
    field.addCircle(gx, gz, 0.4);
  }

  // --- drifts of dead leaves you wade through ---
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), roughness: 0.95 });
  function leafPile(x, z, s) {
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const k = 1 + Math.sin(vx * 5 + vz * 4) * 0.22;
      p.setXYZ(i, vx * k, Math.max(0, vy) * 0.34 * k, vz * k);   // flattened, lumpy mound
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, leafMat);
    m.scale.setScalar(s); m.position.set(x, 0, z); m.rotation.y = rand() * Math.PI;
    m.castShadow = true; m.receiveShadow = true; group.add(m);
  }
  const bigPiles = [];
  for (let i = 0; i < 48; i++) {
    const x = X0 + rand() * (X1 - X0), z = Z0 + rand() * (Z1 - Z0);
    if (blocked(x, z)) continue;
    const s = 0.5 + rand() * 0.95;
    leafPile(x, z, s);
    if (s > 1.15 && bigPiles.length < 4) bigPiles.push([x, z]);
  }
  // the bigger drifts rustle as you approach — and something might be in them
  for (const [px, pz] of bigPiles) {
    ctx.triggers.push({ x: px, z: pz, r: 3, cooldown: 9, onEnter: (c) => {
      c.audio.rustle(new THREE.Vector3(px, 0.3, pz));
      if (Math.random() < 0.4) c.director.peripheral();
    } });
  }

  // --- the opening: your abandoned campsite. A dead fire, a fallen lantern (the
  //     light you wake to), a torn tent, a bedroll. You were here. Now you're not. ---
  const charMat = new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 1 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.95 });
  const canvasMat = new THREE.MeshStandardMaterial({ color: 0x33302a, roughness: 1, side: THREE.DoubleSide });
  // fire ring (in front of spawn)
  const fcx = 0, fcz = 5;
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; const st = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12 + rand() * 0.06, 0), stoneMat); st.position.set(fcx + Math.cos(a) * 0.5, 0.08, fcz + Math.sin(a) * 0.5); group.add(st); }
  for (let i = 0; i < 3; i++) { const log = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.7, 6), charMat); log.position.set(fcx, 0.06, fcz); log.rotation.set(Math.PI / 2, 0, i * 1.0); group.add(log); }
  const ember = makeFlame(0xff3a10, 0.18, 2.2); ember.position.set(fcx, 0.12, fcz); ember.scale.setScalar(0.6); group.add(ember); flames.push(ember);
  field.addCircle(fcx, fcz, 0.55);
  // the fallen lantern — your only light when you wake
  const campLantern = makeFlame(0xffb24a, 0.7, 6); campLantern.position.set(fcx + 1.0, 0.18, fcz + 0.4); group.add(campLantern); flames.push(campLantern);
  const campLanternBody = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.18, 8), new THREE.MeshStandardMaterial({ color: 0x14140f, roughness: 0.5, metalness: 0.6 }));
  campLanternBody.position.set(fcx + 1.0, 0.09, fcz + 0.4); campLanternBody.rotation.z = 1.3; group.add(campLanternBody);
  // a log to sit on
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 1.6, 7), new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.95 }));
  seat.rotation.set(0, 0, Math.PI / 2); seat.position.set(-1.3, 0.2, fcz + 0.6); group.add(seat); field.addCircle(-1.3, fcz + 0.6, 0.5);
  // a torn tent, slumped
  const tent = new THREE.Group();
  for (const sx of [-1, 1]) { const side = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.5, 2.0), canvasMat); side.position.set(sx * 0.5, 0.62, 0); side.rotation.z = sx * 0.62; tent.add(side); }
  const tback = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.2), canvasMat); tback.position.set(0, 0.55, -1.0); tent.add(tback);
  tent.position.set(-3.0, 0, 7.2); tent.rotation.set(-0.1, 0.5, 0.16); group.add(tent);
  tent.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  field.addCircle(-3.0, 7.2, 0.9);
  // a bedroll by the fire
  const bedroll = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 1.9), new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 1 }));
  bedroll.position.set(1.4, 0.07, 7.6); bedroll.rotation.y = 0.3; group.add(bedroll);

  // --- a rusted iron fence running along the left of the approach ---
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.6, metalness: 0.7 });
  const barGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.5, 5);
  const tipGeo = new THREE.ConeGeometry(0.05, 0.18, 5);
  const fenceX = -3.2;
  for (let z = 2; z >= -16; z -= 0.32) {
    const bar = new THREE.Mesh(barGeo, ironMat); bar.position.set(fenceX, 0.75, z); group.add(bar);
    const tip = new THREE.Mesh(tipGeo, ironMat); tip.position.set(fenceX, 1.6, z); group.add(tip);
  }
  for (const ry of [0.35, 1.35]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 18.2), ironMat); rail.position.set(fenceX, ry, -7); group.add(rail);
  }
  field.addBox(fenceX - 0.15, -16, fenceX + 0.15, 2, 9);

  // --- the shrine + iron key ---
  const sh = makeShrine(); sh.position.set(shrine.x, 0, shrine.z); group.add(sh);
  field.addCircle(shrine.x, shrine.z, 0.7);
  const key = makeKey('iron'); key.position.set(shrine.x, 0.78, shrine.z); group.add(key);
  ctx.interactables.push({
    object: key, pos: new THREE.Vector3(shrine.x, 0.9, shrine.z), radius: 1.7, once: true, focusable: true,
    canUse: () => true,
    onUse: (state, c) => {
      group.remove(key);
      state.inventory.add('ironkey');
      c.director.pickupScare(new THREE.Vector3(shrine.x, 1, shrine.z));
      c.director.setObjective('mansion');
    },
  });

  // --- will-o'-wisps drifting from near spawn toward the shrine ---
  const trail = [[2, 2], [8, -2], [13, -8], [15, -13]];
  for (const [wx, wz] of trail) {
    const f = makeFlame(0x88ccbb, 0.6, 5); f.position.set(wx, 1.4, wz);
    f.userData.wisp = { x: wx, z: wz, t: Math.random() * 10 }; group.add(f); wisps.push(f); flames.push(f);
  }

  // --- the mansion, looming ---
  const mGroup = new THREE.Group(); group.add(mGroup);
  const stone = new THREE.MeshStandardMaterial({ color: 0x24242e, roughness: 0.95 });
  const W = mansion.halfW * 2, H = 11, D = mansion.zFront - mansion.zBack;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, Math.abs(D)), stone);
  body.position.set(mansion.x, H / 2, (mansion.zFront + mansion.zBack) / 2);
  body.castShadow = true; body.receiveShadow = true; mGroup.add(body);
  field.addBox(mansion.x - mansion.halfW, mansion.zBack, mansion.x + mansion.halfW, mansion.zFront, 5);
  // roof
  const roof = new THREE.Mesh(new THREE.ConeGeometry(mansion.halfW * 1.45, 6, 4), stone);
  roof.rotation.y = Math.PI / 4; roof.position.set(mansion.x, H + 3, (mansion.zFront + mansion.zBack) / 2); mGroup.add(roof);
  // gothic corner towers with spires
  for (const sx of [-1, 1]) {
    const tx = mansion.x + sx * (mansion.halfW + 0.5);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.1, H + 5, 8), stone);
    tower.position.set(tx, (H + 5) / 2, mansion.zFront - 1); mGroup.add(tower);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(2.3, 7, 8), stone);
    spire.position.set(tx, H + 5 + 3.5, mansion.zFront - 1); mGroup.add(spire);
    field.addCircle(tx, mansion.zFront - 1, 2.0, 5);
    // a single dim window high in each tower
    const tw = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xb05a1e, emissiveIntensity: 0.7 });
    const twin = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.4), tw);
    twin.position.set(tx, H + 2, mansion.zFront - 1 + 2.1); mGroup.add(twin); windowMats.push(tw);
  }
  // upper-floor row of windows
  for (let i = -1; i <= 1; i++) {
    if (i === 0) continue;
    const wm2 = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x7a4418, emissiveIntensity: 0.5 });
    const w2 = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.8), wm2);
    w2.position.set(mansion.x + i * 3, 9.5, mansion.zFront + 0.06); mGroup.add(w2); windowMats.push(wm2);
  }
  // two window-eyes that flicker
  for (const sx of [-1, 1]) {
    const wm = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xc97a2a, emissiveIntensity: 0.8 });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2, 2.6), wm);
    win.position.set(mansion.x + sx * 5.5, 6.5, mansion.zFront + 0.06); mGroup.add(win); windowMats.push(wm);
  }
  // porch + door
  const door = new THREE.Mesh(new THREE.BoxGeometry(2, 3.4, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x140d07, roughness: 0.8 }));
  door.position.set(mansion.x, 1.7, mansion.zFront + 0.12); door.castShadow = true; mGroup.add(door);
  const lantern = makeFlame(0xffaa44, 0.9, 6); lantern.position.set(mansion.x + 1.6, 2.6, mansion.zFront + 0.4); mGroup.add(lantern); flames.push(lantern);

  ctx.interactables.push({
    object: door, pos: new THREE.Vector3(mansion.x, 1.7, mansion.zFront + 0.3), radius: 2.4, focusable: true,
    canUse: (state) => state.inventory.has('ironkey'),
    lockedHint: true,
    onUse: (state, c) => {
      c.audio.doorCreak(door.position);
      c.go('mansion', { fromForest: true });
    },
  });

  // --- ambient scare triggers ---
  ctx.triggers.push({ x: 6, z: -6, r: 3, once: true, onEnter: (c) => c.audio.flutter(new THREE.Vector3(8, 4, -10)) });
  ctx.triggers.push({ x: 13, z: -12, r: 3, once: true, onEnter: (c) => { c.audio.whisper(new THREE.Vector3(shrine.x + 4, 1, shrine.z)); c.director.lurk(20, -30); } });
  ctx.triggers.push({ x: -4, z: -20, r: 4, once: true, onEnter: (c) => { c.director.peripheral(); } });
  ctx.triggers.push({ x: 0, z: -34, r: 5, once: true, onEnter: (c) => { c.audio.setTension(0.5); c.director.crossPath(-8, -40, 8, -40); } });

  // fog/atmosphere descriptors
  const z = CFG.zones.forest;

  function update(dt, t, player) {
    // key spin
    if (key.parent) { key.rotation.y += dt * 1.2; key.position.y = 0.82 + Math.sin(t * 2) * 0.04; }
    // wisp drift + bob
    for (const w of wisps) {
      const d = w.userData.wisp; d.t += dt;
      w.position.y = 1.3 + Math.sin(d.t * 1.5) * 0.25;
      w.position.x = d.x + Math.sin(d.t * 0.6) * 0.5;
      w.position.z = d.z + Math.cos(d.t * 0.5) * 0.5;
    }
    // window flicker
    for (const wm of windowMats) wm.emissiveIntensity = 0.6 + Math.sin(t * 3 + wm.id) * 0.25 + Math.random() * 0.1;
  }

  return {
    name: 'forest', group, field, flames,
    spawn: { x: 0, z: 8, yaw: 0 },
    fog: { color: z.fog, density: z.fogDensity },
    ambient: { color: z.ambient, intensity: z.ambientI },
    sky: z.sky, update,
  };
}
