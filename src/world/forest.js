import * as THREE from 'three';
import { ColliderField } from '../collision.js';
import { Quality, CFG } from '../config.js';
import { groundTexture, barkTexture, softDot } from '../textures.js';
import { makeKey, makeShrine, makeGravestone, makeFlame } from './props.js';

// The opening: a black, fog-drowned wood of bare trees. A faint trail of
// will-o'-wisps draws you to a shrine that holds the iron key. Beyond the trees,
// a vast house waits with two lit windows like eyes.

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

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

  // --- trees (instanced bare trunks) ---
  const bark = barkTexture();
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.32, 9, 6, 3, true);
  trunkGeo.translate(0, 4.5, 0);
  // taper/bend a touch for unease
  const trunkMat = new THREE.MeshStandardMaterial({ map: bark, roughness: 1, side: THREE.DoubleSide });
  const maxTrees = Quality.maxInstancedTrees;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, maxTrees);
  trunks.castShadow = true; trunks.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pp = new THREE.Vector3();
  let n = 0;
  function placeTree(x, z, scale, lean) {
    if (n >= maxTrees) return;
    e.set((rand() - 0.5) * lean, rand() * Math.PI * 2, (rand() - 0.5) * lean);
    q.setFromEuler(e); sc.set(scale, scale * (0.8 + rand() * 0.6), scale); pp.set(x, 0, z);
    m4.compose(pp, q, sc); trunks.setMatrixAt(n, m4); n++;
    field.addCircle(x, z, 0.45 * scale, 1);
  }
  // scatter
  let attempts = 0;
  while (n < maxTrees * 0.86 && attempts < maxTrees * 6) {
    attempts++;
    const x = X0 + rand() * (X1 - X0), z = Z0 + rand() * (Z1 - Z0);
    if (blocked(x, z)) continue;
    placeTree(x, z, 0.7 + rand() * 0.8, 0.18);
  }
  // dense boundary wall of trees (the world has no edge you can reach)
  for (let i = 0; i < 240 && n < maxTrees; i++) {
    const t = i / 240, ang = t * Math.PI * 2;
    const rx = (X1 - X0) * 0.5 + 4, rz = (Z1 - Z0) * 0.5 + 4;
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
    const x = cx + Math.cos(ang) * rx + (rand() - 0.5) * 3;
    const z = cz + Math.sin(ang) * rz + (rand() - 0.5) * 3;
    placeTree(x, z, 1.0 + rand() * 0.6, 0.08);
  }
  trunks.count = n; trunks.instanceMatrix.needsUpdate = true; group.add(trunks);
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
