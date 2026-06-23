import * as THREE from 'three';
import { ColliderField } from '../collision.js';
import { CFG } from '../config.js';
import { generateMaze, farthestCell, deadEnds } from './maze.js';
import { wallpaperTexture, woodFloorTexture, softDot } from '../textures.js';
import {
  makeKey, makeDoor, makeFlame, makePortrait, makeTable, makeChair,
  makeBed, makeShelf, makeMirror,
} from './props.js';

// First floor of the house: a braided maze of low, wallpapered corridors and
// furnished rooms. Looping passages + heavy fog make it impossible to map. The
// brass key sits at the farthest dead-end; the basement stair waits behind a
// locked door.

const CELL = 4.2, H = 3.0, TH = 0.25;

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const cw = (i) => i * CELL;  // cell index -> world coord

export function buildMansion(ctx) {
  const group = new THREE.Group();
  const field = new ColliderField(CELL);
  const rand = rng(7771);
  const flames = [];

  const cols = 7, rows = 7;
  const maze = generateMaze(cols, rows, 13, 0.35);   // braided -> loops
  const cells = maze.cells;

  // --- floor & ceiling ---
  const minX = cw(0) - CELL / 2, maxX = cw(cols - 1) + CELL / 2;
  const minZ = cw(0) - CELL / 2, maxZ = cw(rows - 1) + CELL / 2;
  const fw = maxX - minX, fd = maxZ - minZ, fcx = (minX + maxX) / 2, fcz = (minZ + maxZ) / 2;
  const floorTex = woodFloorTexture(); floorTex.repeat.set(fw / 2, fd / 2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.34, metalness: 0.2 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(fcx, 0, fcz); floor.receiveShadow = true; group.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd),
    new THREE.MeshStandardMaterial({ color: 0x0c0a09, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(fcx, H, fcz); group.add(ceil);

  // --- walls (collected then instanced) ---
  const wallTex = wallpaperTexture();
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 });
  const wallXf = [];           // {x,z,sx,sz}
  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  function addWall(x, z, sx, sz, noCollide = false) {
    wallXf.push({ x, z, sx, sz });
    if (!noCollide) field.addBox(x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2, 2);
  }
  const lintelXf = []; // arch frames over open passages
  for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
    const c = cells[x][y];
    if (!c.E) addWall(cw(x) + CELL / 2, cw(y), TH, CELL);
    else if (x < cols - 1) lintelXf.push({ x: cw(x) + CELL / 2, z: cw(y), sx: TH + 0.12, sz: CELL });
    if (!c.S) addWall(cw(x), cw(y) + CELL / 2, CELL, TH);
    else if (y < rows - 1) lintelXf.push({ x: cw(x), z: cw(y) + CELL / 2, sx: CELL, sz: TH + 0.12 });
    if (x === 0 && !c.W) addWall(cw(x) - CELL / 2, cw(y), TH, CELL);
    if (y === 0 && !c.N) addWall(cw(x), cw(y) - CELL / 2, CELL, TH);
  }
  const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, H, 1), wallMat, wallXf.length);
  wallMesh.castShadow = true; wallMesh.receiveShadow = true;
  wallXf.forEach((w, i) => {
    pos.set(w.x, H / 2, w.z); scl.set(w.sx, 1, w.sz);
    m4.compose(pos, quat, scl); wallMesh.setMatrixAt(i, m4);
  });
  wallMesh.instanceMatrix.needsUpdate = true; group.add(wallMesh);

  // dark wood wainscoting along the bottom of every wall
  const wainMat = new THREE.MeshStandardMaterial({ color: 0x1c130b, roughness: 0.7, metalness: 0.05 });
  const wainMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.95, 1), wainMat, wallXf.length);
  wainMesh.castShadow = true; wainMesh.receiveShadow = true;
  wallXf.forEach((w, i) => {
    pos.set(w.x, 0.48, w.z); scl.set(w.sx + 0.06, 1, w.sz + 0.06);
    m4.compose(pos, quat, scl); wainMesh.setMatrixAt(i, m4);
  });
  wainMesh.instanceMatrix.needsUpdate = true; group.add(wainMesh);

  // arch lintels framing each open passage like a doorway
  if (lintelXf.length) {
    const lintelMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.7, 1), wainMat, lintelXf.length);
    lintelMesh.castShadow = true;
    lintelXf.forEach((w, i) => { pos.set(w.x, H - 0.35, w.z); scl.set(w.sx, 1, w.sz); m4.compose(pos, quat, scl); lintelMesh.setMatrixAt(i, m4); });
    lintelMesh.instanceMatrix.needsUpdate = true; group.add(lintelMesh);
  }

  // corner pillars seal the seams
  const pillarXf = [];
  for (let x = 0; x <= cols; x++) for (let y = 0; y <= rows; y++) pillarXf.push([cw(x) - CELL / 2, cw(y) - CELL / 2]);
  const pillarMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, H, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x100c08, roughness: 0.9 }), pillarXf.length);
  pillarMesh.castShadow = true;
  pillarXf.forEach(([px, pz], i) => { pos.set(px, H / 2, pz); m4.compose(pos, quat, new THREE.Vector3(1, 1, 1)); pillarMesh.setMatrixAt(i, m4); });
  pillarMesh.instanceMatrix.needsUpdate = true; group.add(pillarMesh);

  // --- key & door placement via maze distance ---
  const start = { x: 0, y: 0 };
  const far = farthestCell(maze, start.x, start.y);          // brass key here
  const ends = deadEnds(maze).filter(([x, y]) => !(x === far.cell[0] && y === far.cell[1]) && !(x === 0 && y === 0));
  // basement door at a different far-ish dead-end
  let doorCell = ends.length ? ends[(rand() * ends.length) | 0] : [cols - 1, rows - 1];

  // brass key
  const keyPos = new THREE.Vector3(cw(far.cell[0]), 0.95, cw(far.cell[1]));
  const brass = makeKey('brass'); brass.position.copy(keyPos); group.add(brass);
  // a little table under it
  const kt = makeTable(0.8, 0.8, 0.8); kt.position.set(keyPos.x, 0, keyPos.z); group.add(kt);
  field.addCircle(keyPos.x, keyPos.z, 0.6);
  ctx.interactables.push({
    object: brass, pos: keyPos.clone(), radius: 1.7, once: true, focusable: true, canUse: () => true,
    onUse: (state, c) => {
      group.remove(brass);
      state.inventory.add('brasskey');
      c.director.basementKeyScare(keyPos.clone());
      c.director.setObjective('basement');
    },
  });
  // a candle by the key so you can find it
  const kc = makeFlame(0xffaa44, 1.0, 6); kc.position.set(keyPos.x + 0.5, 0.95, keyPos.z); group.add(kc); flames.push(kc);

  // basement door + stairwell
  const dpx = cw(doorCell[0]), dpz = cw(doorCell[1]);
  const stairHole = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x000000 }));
  stairHole.position.set(dpx, 0.02, dpz); group.add(stairHole);
  // a few descending steps into black
  for (let i = 0; i < 5; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x0a0908, roughness: 1 }));
    step.position.set(dpx, -0.1 - i * 0.18, dpz - 0.6 - i * 0.4); group.add(step);
  }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.6, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x0c0805, roughness: 0.9 }));
  frame.position.set(dpx, 1.3, dpz - 1.0); group.add(frame);
  const bDoor = makeDoor(1.8, 2.4); bDoor.position.set(dpx - 0.9, 0, dpz - 1.0); group.add(bDoor);
  const bDoorBlocker = field.addDynamicBox(dpx - 1.0, dpz - 1.2, dpx + 1.0, dpz - 0.8, 2);
  ctx.interactables.push({
    object: bDoor, pos: new THREE.Vector3(dpx, 1.3, dpz - 1.0), radius: 2.2, focusable: true,
    canUse: (state) => state.inventory.has('brasskey'),
    lockedHint: true,
    onUse: (state, c) => {
      bDoor.userData.targetAngle = -Math.PI * 0.62; bDoorBlocker.active = false;
      c.audio.doorCreak(bDoor.position);
      setTimeout(() => c.go('basement'), 1400);
    },
  });

  // --- furnish rooms & hang portraits on closed walls ---
  const portraits = [];
  let candleBudget = 7;
  for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
    if (x === 0 && y === 0) continue;
    if (x === far.cell[0] && y === far.cell[1]) continue;
    const c = cells[x][y];
    const wx = cw(x), wz = cw(y);
    const open = (c.N ? 1 : 0) + (c.E ? 1 : 0) + (c.S ? 1 : 0) + (c.W ? 1 : 0);
    // furniture
    const roll = rand();
    if (roll < 0.16) { const t = makeTable(); t.position.set(wx, 0, wz); t.rotation.y = rand() * Math.PI; group.add(t); field.addCircle(wx, wz, 0.7);
      if (rand() < 0.6) { const ch = makeChair(); ch.position.set(wx + 1, 0, wz); ch.rotation.y = Math.PI; group.add(ch); } }
    else if (roll < 0.26) { const b = makeBed(); b.position.set(wx, 0, wz - 0.6); group.add(b); field.addBox(wx - 0.7, wz - 1.6, wx + 0.7, wz + 0.4, 2); }
    else if (roll < 0.34) { const s = makeShelf(); s.position.set(wx, 0, wz - CELL / 2 + 0.3); group.add(s); field.addBox(wx - 0.6, wz - CELL / 2 + 0.1, wx + 0.6, wz - CELL / 2 + 0.5); }
    else if (roll < 0.40) { const mi = makeMirror(); mi.position.set(wx, 1.4, wz - CELL / 2 + 0.15); group.add(mi); }
    // portrait on a closed side
    if (rand() < 0.5) {
      const sides = [];
      if (!c.N) sides.push('N'); if (!c.S) sides.push('S'); if (!c.E) sides.push('E'); if (!c.W) sides.push('W');
      if (sides.length) {
        const side = sides[(rand() * sides.length) | 0];
        const p = makePortrait((x * 7 + y) % 9 + 1);
        const off = CELL / 2 - 0.12;
        if (side === 'N') { p.position.set(wx, 1.6, wz - off); p.rotation.y = 0; }
        if (side === 'S') { p.position.set(wx, 1.6, wz + off); p.rotation.y = Math.PI; }
        if (side === 'E') { p.position.set(wx + off, 1.6, wz); p.rotation.y = -Math.PI / 2; }
        if (side === 'W') { p.position.set(wx - off, 1.6, wz); p.rotation.y = Math.PI / 2; }
        group.add(p); portraits.push(p);
      }
    }
    // sparse candles to pool light in rooms
    if (candleBudget > 0 && rand() < 0.22) {
      const f = makeFlame(0xffaa44, 0.9, 5.5); f.position.set(wx + (rand() - 0.5), 0.85, wz + (rand() - 0.5));
      group.add(f); flames.push(f); candleBudget--;
    }
  }

  // --- chandeliers + blood, for that old-blood-and-dust grandeur ---
  const bloodTex = softDot('#1f0202');
  function blood(x, z, s = 1) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s),
      new THREE.MeshStandardMaterial({ map: bloodTex, transparent: true, opacity: 0.8, roughness: 0.3, metalness: 0.2, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * Math.PI; m.position.set(x, 0.02, z); group.add(m);
  }
  for (let i = 0; i < 7; i++) blood(cw((rand() * cols) | 0) + (rand() - 0.5) * 2, cw((rand() * rows) | 0) + (rand() - 0.5) * 2, 0.8 + rand() * 1.6);
  // a smear down one wall near the key
  const smear = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.6),
    new THREE.MeshStandardMaterial({ map: bloodTex, transparent: true, opacity: 0.7, depthWrite: false }));
  smear.position.set(keyPos.x - CELL / 2 + 0.12, 1.1, keyPos.z); smear.rotation.y = Math.PI / 2; group.add(smear);

  // two chandeliers over the larger junctions
  for (const cellxy of [[2, 2], [4, 5]]) {
    const cx = cw(cellxy[0]), cz = cw(cellxy[1]);
    const ch = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 6, 16),
      new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.5, metalness: 0.7 }));
    ring.rotation.x = Math.PI / 2; ch.add(ring);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 4), ring.material);
    chain.position.y = 0.3; ch.add(chain);
    const cf = makeFlame(0xffaa44, 0.7, 6); cf.position.y = 0; ch.add(cf); flames.push(cf);
    for (let a = 0; a < 6; a++) {
      const cs = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot('#ffcf87'), color: 0xffb24a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      cs.position.set(Math.cos(a / 6 * Math.PI * 2) * 0.35, 0.05, Math.sin(a / 6 * Math.PI * 2) * 0.35); cs.scale.set(0.08, 0.14, 1); ch.add(cs);
    }
    ch.position.set(cx, H - 0.7, cz); group.add(ch);
  }

  // candles at the entrance so you spawn into a dim, breathing room
  for (const off of [[1.3, 0.4], [-1.0, 1.2]]) {
    const sc = makeFlame(0xffaa44, 1.0, 6.5); sc.position.set(cw(0) + off[0], 0.85, cw(0) + off[1]); group.add(sc); flames.push(sc);
  }

  // --- scripted scares along the way ---
  // a door slams + something crosses a far hallway as you go deeper
  const mid = [(cols / 2) | 0, (rows / 2) | 0];
  ctx.triggers.push({ x: cw(mid[0]), z: cw(mid[1]), r: 2.4, once: true, onEnter: (c) => {
    c.audio.slam(new THREE.Vector3(cw(0), 1.5, cw(rows - 1)));
    c.director.crossPath(cw(far.cell[0]) - 2, cw(far.cell[1]), cw(far.cell[0]) + 2, cw(far.cell[1]));
  }});
  // a peripheral lurker midway to the key
  let midKey = [Math.round((start.x + far.cell[0]) / 2), Math.round((start.y + far.cell[1]) / 2)];
  ctx.triggers.push({ x: cw(midKey[0]), z: cw(midKey[1]), r: 2.2, once: true, onEnter: (c) => {
    c.director.lurk(cw(far.cell[0]), cw(far.cell[1])); c.audio.setTension(0.55);
  }});
  // a breath-on-your-neck when you near the brass key
  ctx.triggers.push({ x: keyPos.x, z: keyPos.z + CELL, r: 2.0, once: true, onEnter: (c) => {
    c.audio.stinger('breath'); c.player.addShake(0.4);
  }});

  const zc = CFG.zones.mansion;

  function update(dt, t, player) {
    if (brass.parent) { brass.rotation.y += dt * 1.0; brass.position.y = 0.95 + Math.sin(t * 2) * 0.03; }
    // door easing
    const ud = bDoor.userData; ud.angle += (ud.targetAngle - ud.angle) * Math.min(1, dt * 2.2); bDoor.rotation.y = ud.angle;
    // portrait eyes catch a flicker as the torch sweeps past (subtle)
    for (const p of portraits) { const m = p.children[0].material; if (m) m.emissiveIntensity = 0; }
  }

  // face an open passage out of the entrance cell, never a wall
  const c00 = cells[0][0];
  const spawnYaw = c00.E ? -Math.PI / 2 : (c00.S ? Math.PI : (c00.N ? 0 : Math.PI / 2));

  return {
    name: 'mansion', group, field, flames,
    spawn: { x: cw(0), z: cw(0), yaw: spawnYaw },
    fog: { color: zc.fog, density: zc.fogDensity },
    ambient: { color: zc.ambient, intensity: zc.ambientI },
    sky: zc.sky, update,
  };
}
