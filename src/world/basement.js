import * as THREE from 'three';
import { ColliderField } from '../collision.js';
import { CFG } from '../config.js';
import { generateMaze, farthestCell, bfs } from './maze.js';
import { stoneTexture, fleshTexture } from '../textures.js';
import { makeFlame } from './props.js';

// Below the house. Lower, tighter, wetter. Stone gives way to something that
// breathes. Corridors loop back on themselves — and twice, reality slips and
// you are somewhere you have already been. A red glow far off is the only pull.

const CELL = 3.0, H = 2.4, TH = 0.2;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const cw = (i) => i * CELL;

export function buildBasement(ctx) {
  const group = new THREE.Group();
  const field = new ColliderField(CELL);
  const rand = rng(424242);
  const flames = [];
  const breathers = [];

  const cols = 6, rows = 8;
  const maze = generateMaze(cols, rows, 99, 0.55);   // very loopy
  const cells = maze.cells;
  const CELLAR = 2;                                   // cells [0..1]x[0..1] are an open cellar landing
  const inCellar = (x, y) => x < CELLAR && y < CELLAR;
  const dist = bfs(maze, 0, 0);
  const far = farthestCell(maze, 0, 0);

  // floor & ceiling
  const minX = cw(0) - CELL / 2, maxX = cw(cols - 1) + CELL / 2;
  const minZ = cw(0) - CELL / 2, maxZ = cw(rows - 1) + CELL / 2;
  const fw = maxX - minX, fd = maxZ - minZ, fcx = (minX + maxX) / 2, fcz = (minZ + maxZ) / 2;
  const stex = stoneTexture(); stex.repeat.set(fw / 2.5, fd / 2.5);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd),
    new THREE.MeshStandardMaterial({ map: stex, roughness: 0.26, metalness: 0.28 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(fcx, 0, fcz); floor.receiveShadow = true; group.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd),
    new THREE.MeshStandardMaterial({ color: 0x070506, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(fcx, H, fcz); group.add(ceil);

  // walls (stone near entrance, flesh deep)
  const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 1 });
  const fleshMat = new THREE.MeshStandardMaterial({ map: fleshTexture(), roughness: 0.7, emissive: 0x180003, emissiveIntensity: 0.5 });
  const stoneXf = [], fleshXf = [];
  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  const maxDist = far.dist || 1;
  function addWall(x, z, sx, sz, deep) {
    (deep ? fleshXf : stoneXf).push({ x, z, sx, sz });
    field.addBox(x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2, 2);
  }
  for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
    const c = cells[x][y];
    const deep = (dist[x][y] / maxDist) > 0.55;   // flesh takes over deeper in
    if (inCellar(x, y) && inCellar(x + 1, y)) { /* open cellar */ }
    else if (!c.E) addWall(cw(x) + CELL / 2, cw(y), TH, CELL, deep);
    if (inCellar(x, y) && inCellar(x, y + 1)) { /* open cellar */ }
    else if (!c.S) addWall(cw(x), cw(y) + CELL / 2, CELL, TH, deep);
    if (x === 0 && !c.W) addWall(cw(x) - CELL / 2, cw(y), TH, CELL, deep);
    if (y === 0 && !c.N) addWall(cw(x), cw(y) - CELL / 2, CELL, TH, deep);
  }
  function buildInstanced(xf, mat) {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, H, 1), mat, xf.length);
    mesh.castShadow = true; mesh.receiveShadow = true;
    xf.forEach((w, i) => { pos.set(w.x, H / 2, w.z); scl.set(w.sx, 1, w.sz); m4.compose(pos, quat, scl); mesh.setMatrixAt(i, m4); });
    mesh.instanceMatrix.needsUpdate = true; group.add(mesh); return mesh;
  }
  buildInstanced(stoneXf, stoneMat);
  buildInstanced(fleshXf, fleshMat);

  // breathing flesh growths in the deepest cells
  for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
    if ((dist[x][y] / maxDist) > 0.65 && rand() < 0.5) {
      const grow = new THREE.Mesh(new THREE.SphereGeometry(0.3 + rand() * 0.25, 10, 10), fleshMat);
      grow.position.set(cw(x) + (rand() - 0.5) * 1.4, 0.4 + rand() * 1.4, cw(y) + (rand() - 0.5) * 1.4);
      grow.castShadow = true; group.add(grow);
      grow.userData.breath = { base: grow.scale.x, seed: rand() * 10 }; breathers.push(grow);
    }
  }

  // a couple of guttering candles near the entrance only
  for (let i = 0; i < 3; i++) {
    const f = makeFlame(0xff6622, 0.7, 4); f.position.set(cw(0) + (rand() - 0.5), 0.6, cw(i) + 0.5);
    group.add(f); flames.push(f);
  }

  // --- the cellar landing: the stone steps you came down, barrels, hanging
  //     chains and a wall torch, before the maze swallows you. ---
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x241810, roughness: 0.95 });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.5, metalness: 0.7 });
  const stoneStep = new THREE.MeshStandardMaterial({ map: stoneTexture(), color: 0x9a948f, roughness: 0.6, metalness: 0.1 });
  // a flight of steps RISING toward a dark doorway in the north wall — the way
  // you came down (you can't go back up)
  const sX = cw(0) - 0.3;
  for (let i = 0; i < 6; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.16, 0.42), stoneStep); st.position.set(sX, 0.1 + i * 0.16, 0.7 - i * 0.36); st.castShadow = true; st.receiveShadow = true; group.add(st); }
  field.addBox(sX - 0.9, cw(0) - CELL / 2, sX + 0.9, 0.85, 2);
  const doorway = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.1), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  doorway.position.set(sX, 1.55, cw(0) - CELL / 2 + 0.02); group.add(doorway);
  // a wall torch over the stair for light
  const torch = makeFlame(0xff7a30, 0.9, 6.5); torch.position.set(sX + 1.4, 1.5, cw(0) - CELL / 2 + 0.2); group.add(torch); flames.push(torch);
  // barrels & a crate
  for (const b of [[cw(1) + 0.3, cw(0) + 0.2], [cw(1) + 0.5, cw(0) + 0.9], [cw(0) + 0.2, cw(1) + 0.6]]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.9, 12), woodMat);
    barrel.position.set(b[0], 0.45, b[1]); barrel.castShadow = true; group.add(barrel); field.addCircle(b[0], b[1], 0.38);
    for (const ry of [0.18, 0.72]) { const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.345, 0.018, 6, 16), ironMat); hoop.rotation.x = Math.PI / 2; hoop.position.set(b[0], ry, b[1]); group.add(hoop); }
  }
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), woodMat); crate.position.set(cw(1) + 0.2, 0.35, cw(1) + 0.3); crate.rotation.y = 0.4; crate.castShadow = true; group.add(crate); field.addCircle(cw(1) + 0.2, cw(1) + 0.3, 0.5);
  // chains hanging from the ceiling
  const chains = [];
  for (let i = 0; i < 4; i++) {
    const len = 0.8 + rand() * 0.9, cx = cw(0) + rand() * CELL, cz = cw(0) + rand() * CELL;
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, len, 5), ironMat);
    chain.position.set(cx, H - len / 2, cz); group.add(chain);
    if (i < 2) { const hook = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 10, Math.PI), ironMat); hook.position.set(cx, H - len, cz); group.add(hook); chains.push({ m: chain, x: cx, z: cz, baseY: H - len / 2, seed: rand() * 10 }); }
  }
  ctx.cellarChains = chains;

  // --- the pull: a red glowing doorway at the farthest cell. Two crossed,
  //     double-sided planes so it reads as a doorway from any approach. ---
  const ex = cw(far.cell[0]), ez = cw(far.cell[1]);
  const portalMat = new THREE.MeshBasicMaterial({ color: 0x330002, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.1), portalMat);
  portal.position.set(ex, 1.05, ez); group.add(portal);
  const portalX = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.1), portalMat);
  portalX.position.set(ex, 1.05, ez); portalX.rotation.y = Math.PI / 2; group.add(portalX);
  const portalLight = new THREE.PointLight(0xff1020, 10, 10, 2); portalLight.position.set(ex, 1.2, ez); group.add(portalLight);
  ctx.triggers.push({ x: ex, z: ez, r: 1.3, once: true, onEnter: (c) => { c.director.stopChase(); c.go('final'); } });

  // --- reality slips: one-way teleports back into the maze (cooldown'd) ---
  const slipTargets = [[1, 5], [4, 2], [2, 6]];
  function slip(c, idx) {
    const t = slipTargets[idx % slipTargets.length];
    c.ui.blink(70, 260);
    setTimeout(() => {
      c.player.teleport(cw(t[0]), cw(t[1]), c.player.yaw + Math.PI * (0.5 + rand()));
      c.audio.whisper(c.player.pos); c.audio.drip(c.player.pos);
    }, 70);
  }
  // small radius + long cooldown: a rare "reality broke" jolt, never a maze tax
  ctx.triggers.push({ x: cw(3), z: cw(3), r: 0.6, cooldown: 12, onEnter: (c) => slip(c, 0) });
  ctx.triggers.push({ x: cw(2), z: cw(5), r: 0.6, cooldown: 12, onEnter: (c) => slip(c, 1) });

  // --- scares: a lurker, then a chase toward the portal ---
  const midKey = [Math.round(far.cell[0] / 2), Math.round(far.cell[1] / 2)];
  ctx.triggers.push({ x: cw(midKey[0]), z: cw(midKey[1]), r: 1.4, once: true, onEnter: (c) => {
    c.audio.setTension(0.7); c.director.lurk(ex, ez); c.audio.stinger('breath');
  }});
  // chase begins a few cells before the portal
  const chaseStart = [Math.round((far.cell[0] + midKey[0]) / 2), Math.round((far.cell[1] + midKey[1]) / 2)];
  ctx.triggers.push({ x: cw(chaseStart[0]), z: cw(chaseStart[1]), r: 1.4, once: true, onEnter: (c) => {
    c.director.startChase(c.player.pos.x - 1, c.player.pos.z + 2);
  }});

  const zc = CFG.zones.basement;
  function update(dt, t, player) {
    portal.material.opacity = 0.8 + Math.sin(t * 3) * 0.12;
    portalLight.intensity = 9 + Math.sin(t * 5) * 3 + Math.random() * 2;
    for (const b of breathers) { const s = b.userData.breath; const k = 1 + Math.sin(t * 1.3 + s.seed) * 0.12; b.scale.setScalar(s.base * k); }
    // random drips
    if (Math.random() < dt * 1.5) ctx.audio.drip(new THREE.Vector3(player.pos.x + (Math.random() - 0.5) * 6, 1.5, player.pos.z + (Math.random() - 0.5) * 6));
  }

  return {
    name: 'basement', group, field, flames, exit: { x: ex, z: ez },
    spawn: { x: cw(0) + CELL / 2, z: cw(0) + CELL / 2, yaw: Math.PI },   // in the cellar, back to the stairs, facing the maze
    fog: { color: zc.fog, density: zc.fogDensity },
    ambient: { color: zc.ambient, intensity: zc.ambientI },
    sky: zc.sky, update,
  };
}
