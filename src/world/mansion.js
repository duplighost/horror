import * as THREE from 'three';
import { ColliderField } from '../collision.js';
import { CFG } from '../config.js';
import { generateMaze, farthestCell, deadEnds } from './maze.js';
import { wallpaperTexture, woodFloorTexture, softDot } from '../textures.js';
import {
  makeKey, makeDoor, makeFlame, makePortrait, makeTable, makeChair,
  makeBed, makeShelf, makeMirror, makeCouch, makeArmchair, makeRug,
  makeFireplace, makeStaircase, makeCandelabra, makeGrandPainting,
} from './props.js';

// First floor of the house: it OPENS on a grand, once-comfortable parlor — a
// seating group on a moth-eaten rug, a dead fireplace, a boarded grand
// staircase — then narrows into a braided maze of wallpapered corridors. The
// brass key sits at the farthest dead-end; a red-lit door leads down.

const CELL = 4.2, H = 3.3, TH = 0.25;
const PARLOR = 3;                          // cells [0..2]x[0..2] are one open room
const inParlor = (x, y) => x < PARLOR && y < PARLOR;

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
    // east edge — skipped entirely when both cells are inside the open parlor
    if (inParlor(x, y) && inParlor(x + 1, y)) { /* open hall */ }
    else if (!c.E) addWall(cw(x) + CELL / 2, cw(y), TH, CELL);
    else if (x < cols - 1) lintelXf.push({ x: cw(x) + CELL / 2, z: cw(y), sx: TH + 0.12, sz: CELL });
    // south edge
    if (inParlor(x, y) && inParlor(x, y + 1)) { /* open hall */ }
    else if (!c.S) addWall(cw(x), cw(y) + CELL / 2, CELL, TH);
    else if (y < rows - 1) lintelXf.push({ x: cw(x), z: cw(y) + CELL / 2, sx: CELL, sz: TH + 0.12 });
    if (x === 0 && !c.W && y !== 0) addWall(cw(x) - CELL / 2, cw(y), TH, CELL);   // (0,0) west left open for the fake wall
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
  const ends = deadEnds(maze).filter(([x, y]) => !(x === far.cell[0] && y === far.cell[1]) && !inParlor(x, y));
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

  // --- the basement door: a thing you cannot miss. Tall, ornate, set FLUSH into
  //     the wall opposite the room's only opening, with cold red light bleeding
  //     from the seam and candelabra to either side. ---
  const dpx = cw(doorCell[0]), dpz = cw(doorCell[1]);
  const dc = cells[doorCell[0]][doorCell[1]];
  const openDir = dc.N ? 'N' : dc.E ? 'E' : dc.S ? 'S' : 'W';           // the single open side
  const backDir = ({ N: 'S', S: 'N', E: 'W', W: 'E' })[openDir];        // closed wall we mount on
  let nx = 0, nz = 0, wallX = dpx, wallZ = dpz;                          // inward normal + wall centre
  if (backDir === 'N') { nz = 1; wallZ = dpz - CELL / 2; }
  else if (backDir === 'S') { nz = -1; wallZ = dpz + CELL / 2; }
  else if (backDir === 'E') { nx = -1; wallX = dpx + CELL / 2; }
  else { nx = 1; wallX = dpx - CELL / 2; }
  // assembly built in local space: local +Z points INTO the room, -Z is behind
  // the wall (the descent). Then rotated to align with the real wall.
  const dg = new THREE.Group(); dg.position.set(wallX, 0, wallZ); dg.rotation.y = Math.atan2(nx, nz); group.add(dg);
  const archMat = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.8, metalness: 0.2 });
  for (const sx of [-1, 1]) { const col = new THREE.Mesh(new THREE.BoxGeometry(0.32, 3.0, 0.5), archMat); col.position.set(sx * 1.2, 1.5, 0.05); dg.add(col); }
  const archTop = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.5, 0.5), archMat); archTop.position.set(0, 3.0, 0.05); dg.add(archTop);
  const keystone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.4, 4), archMat); keystone.rotation.y = Math.PI / 4; keystone.position.set(0, 3.3, 0.05); dg.add(keystone);
  // darkness + a few steps descending behind the wall
  for (let i = 0; i < 5; i++) { const step = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.18, 0.4), new THREE.MeshStandardMaterial({ color: 0x0a0908, roughness: 1 })); step.position.set(0, -0.1 - i * 0.18, -0.5 - i * 0.4); dg.add(step); }
  const darkOpening = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.7, 0.1), new THREE.MeshBasicMaterial({ color: 0x000000 })); darkOpening.position.set(0, 1.35, -0.18); dg.add(darkOpening);
  // the door itself, dark with a red-glowing seam
  const bDoor = makeDoor(2.0, 2.7); bDoor.position.set(-1.0, 0, 0.0); dg.add(bDoor);
  const seam = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.7), new THREE.MeshBasicMaterial({ color: 0xff1408, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  seam.position.set(0, 1.35, 0.07); dg.add(seam);
  const doorGlow = new THREE.PointLight(0xff1206, 6, 8, 2); doorGlow.position.set(0, 1.2, -0.4); dg.add(doorGlow);
  const sill = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.7), new THREE.MeshBasicMaterial({ color: 0xff1810, transparent: true, opacity: 0.6 }));
  sill.rotation.x = -Math.PI / 2; sill.position.set(0, 0.02, 0.55); dg.add(sill);
  // candelabra flanking the door (just inside the room)
  const w = (lx, lz) => [wallX + lx * nz + lz * nx, wallZ - lx * nx + lz * nz];
  for (const sx of [-1, 1]) {
    const ca = makeCandelabra(); ca.position.set(sx * 1.55, 0, 0.45); dg.add(ca);
    (ca.userData.flames || []).forEach((f) => flames.push(f));
    const [cwx, cwz] = w(sx * 1.55, 0.45); field.addCircle(cwx, cwz, 0.28);
  }
  const hx = Math.abs(nz) * 1.0 + Math.abs(nx) * 0.25, hz = Math.abs(nx) * 1.0 + Math.abs(nz) * 0.25;
  const bDoorBlocker = field.addDynamicBox(wallX - hx, wallZ - hz, wallX + hx, wallZ + hz, 2);
  const [doorWx, doorWz] = w(0, 0.4);
  ctx.interactables.push({
    object: bDoor, pos: new THREE.Vector3(doorWx, 1.35, doorWz), radius: 2.4, focusable: true,
    canUse: (state) => state.inventory.has('brasskey'),
    lockedHint: true,
    onUse: (state, c) => {
      bDoor.userData.targetAngle = -Math.PI * 0.62; bDoorBlocker.active = false;
      seam.visible = false; c.audio.doorCreak(bDoor.position);
      setTimeout(() => c.go('basement'), 1400);
    },
  });
  // a cold draft + far heartbeat as you near the door
  const [draftX, draftZ] = w(0, 1.6);
  ctx.triggers.push({ x: draftX, z: draftZ, r: 2.2, once: true, onEnter: (c) => { c.audio.whisper(new THREE.Vector3(doorWx, 1, doorWz)); c.audio.bumpHeart(0.4, 88); } });

  // --- furnish rooms & hang portraits on closed walls ---
  const portraits = [];
  let candleBudget = 7;
  for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
    if (inParlor(x, y)) continue;                 // the parlor is furnished by hand below
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

  // --- the grand parlor: a once-comfortable room you open onto ---
  const PX = cw(1), PZ = cw(1);                 // parlor centre (cells 0..2)
  const wWall = cw(0) - CELL / 2, nWall = cw(0) - CELL / 2;   // west & north house walls
  const rug = makeRug(4.2, 3.0); rug.position.set(PX, 0, PZ + 0.3); group.add(rug);
  const coffee = makeTable(1.1, 0.55, 0.42); coffee.position.set(PX, 0, PZ + 0.3); group.add(coffee); field.addCircle(PX, PZ + 0.3, 0.6);
  const couch = makeCouch(2.1); couch.position.set(PX, 0, PZ + 2.0); couch.rotation.y = Math.PI; group.add(couch); field.addBox(PX - 1.1, PZ + 1.6, PX + 1.1, PZ + 2.4, 2);
  const acL = makeArmchair(); acL.position.set(PX - 2.1, 0, PZ + 0.3); acL.rotation.y = Math.PI / 2; group.add(acL); field.addCircle(PX - 2.1, PZ + 0.3, 0.5);
  const acR = makeArmchair(); acR.position.set(PX + 2.1, 0, PZ + 0.3); acR.rotation.y = -Math.PI / 2; group.add(acR); field.addCircle(PX + 2.1, PZ + 0.3, 0.5);
  // dead fireplace on the west wall, with the last embers
  const fp = makeFireplace(); fp.position.set(wWall + 0.35, 0, PZ); fp.rotation.y = Math.PI / 2; group.add(fp);
  const fpFlame = makeFlame(0xff5a22, 0.6, 6); fpFlame.position.set(wWall + 0.55, 0.5, PZ); group.add(fpFlame); flames.push(fpFlame);
  field.addBox(wWall, PZ - 1.2, wWall + 0.7, PZ + 1.2, 2);
  // the grand staircase against the north wall — boarded at the top
  const stair = makeStaircase(7, 2.8); stair.position.set(PX, 0, nWall + 3.7); group.add(stair);
  field.addBox(PX - 1.5, nWall, PX + 1.5, nWall + 3.9, 2);
  // bookshelves flanking the staircase
  for (const sx of [-1, 1]) { const bs = makeShelf(2.4); bs.position.set(PX + sx * 3.2, 0, nWall + 0.35); group.add(bs); field.addBox(PX + sx * 3.2 - 0.6, nWall, PX + sx * 3.2 + 0.6, nWall + 0.5, 2); }
  // big gilded portraits watching the room (west wall + north wall)
  for (const gz of [PZ - 2.6, PZ + 2.6]) { const gp = makeGrandPainting(((gz | 0) % 8) + 1, 1.0, 1.45); gp.position.set(wWall + 0.1, 1.8, gz); gp.rotation.y = Math.PI / 2; group.add(gp); }
  const gpN = makeGrandPainting(6, 1.2, 1.6); gpN.position.set(PX + 4.8, 1.9, nWall + 0.1); group.add(gpN);

  // --- a collapsed passage you must crawl under (SE corner of the parlor). A
  //     faint light at the dead end lures you in; as you reach it, the world
  //     turns horrifying — then a blink, and it's just an empty nook. ---
  const CR = { x: 8.0, z0: 6.0, z1: 9.6, hw: 0.85 };
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x1a140e, roughness: 0.95 });
  const lowCeil = new THREE.Mesh(new THREE.BoxGeometry(CR.hw * 2 + 0.4, 0.35, CR.z1 - CR.z0 + 0.2), debrisMat);
  lowCeil.position.set(CR.x, 0.98, (CR.z0 + CR.z1) / 2); lowCeil.castShadow = true; group.add(lowCeil);
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.3, H, CR.z1 - CR.z0 + 0.2), debrisMat);
    w.position.set(CR.x + sx * (CR.hw + 0.15), H / 2, (CR.z0 + CR.z1) / 2); group.add(w);
    field.addBox(CR.x + sx * (CR.hw + 0.15) - 0.15, CR.z0, CR.x + sx * (CR.hw + 0.15) + 0.15, CR.z1, 2);
  }
  const crBack = new THREE.Mesh(new THREE.BoxGeometry(CR.hw * 2 + 0.4, H, 0.3), debrisMat);
  crBack.position.set(CR.x, H / 2, CR.z1); group.add(crBack);
  field.addBox(CR.x - CR.hw - 0.2, CR.z1 - 0.15, CR.x + CR.hw + 0.2, CR.z1 + 0.15, 2);
  const fallen = makeShelf(2.2); fallen.position.set(CR.x - 0.5, 1.1, CR.z0 - 0.2); fallen.rotation.set(0, 0.3, Math.PI / 2 + 0.1); group.add(fallen);
  for (let i = 0; i < 5; i++) { const r = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14 + rand() * 0.2, 0), debrisMat); r.position.set(CR.x + (rand() - 0.5) * 1.3, 0.1, CR.z0 + rand() * (CR.z1 - CR.z0)); group.add(r); }
  const lure = makeFlame(0xffb050, 0.4, 3); lure.position.set(CR.x, 0.35, CR.z1 - 0.5); group.add(lure); flames.push(lure);
  ctx.triggers.push({ x: CR.x, z: CR.z1 - 0.9, r: 1.1, once: true, onEnter: (c) => c.director.hallucinate(CR.x, CR.z1 - 0.2) });

  // --- the fake wall (NW corner). It looks like the rest of the wall but you
  //     walk straight through it into a forgotten room. Nothing is there... and
  //     when you turn to leave, IT is in the doorway, and the wall has sealed. ---
  const fwx = cw(0) - CELL / 2;                 // west boundary, cell (0,0)
  const fake = new THREE.Mesh(new THREE.BoxGeometry(TH, H, CELL), wallMat);
  fake.position.set(fwx, H / 2, cw(0)); fake.castShadow = true; fake.receiveShadow = true; group.add(fake);
  const fakeWain = new THREE.Mesh(new THREE.BoxGeometry(TH + 0.06, 0.95, CELL + 0.06), wainMat);
  fakeWain.position.set(fwx, 0.48, cw(0)); group.add(fakeWain);
  const fakeSeam = new THREE.Mesh(new THREE.PlaneGeometry(0.02, H * 0.8), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  fakeSeam.position.set(fwx - TH / 2 - 0.001, H / 2, cw(0) + 0.7); fakeSeam.rotation.y = Math.PI / 2; group.add(fakeSeam);  // a hairline crack hints at it
  const fakeBlocker = field.addDynamicBox(fwx - TH / 2, cw(0) - CELL / 2, fwx + TH / 2, cw(0) + CELL / 2, 2);
  fakeBlocker.active = false;                   // passable until the scare seals it

  // the hidden room beyond
  const aMat = new THREE.MeshStandardMaterial({ map: wallpaperTexture(), roughness: 0.95 });
  const ax0 = fwx - 3.0, ax1 = fwx, az0 = cw(0) - CELL / 2, az1 = cw(0) + CELL / 2;
  const aFloor = new THREE.Mesh(new THREE.PlaneGeometry(ax1 - ax0, az1 - az0), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.5 }));
  aFloor.rotation.x = -Math.PI / 2; aFloor.position.set((ax0 + ax1) / 2, 0, cw(0)); aFloor.receiveShadow = true; group.add(aFloor);
  const aCeil = new THREE.Mesh(new THREE.PlaneGeometry(ax1 - ax0, az1 - az0), new THREE.MeshStandardMaterial({ color: 0x0c0a09 }));
  aCeil.rotation.x = Math.PI / 2; aCeil.position.set((ax0 + ax1) / 2, H, cw(0)); group.add(aCeil);
  const back = new THREE.Mesh(new THREE.BoxGeometry(TH, H, az1 - az0), aMat); back.position.set(ax0, H / 2, cw(0)); group.add(back); field.addBox(ax0 - TH / 2, az0, ax0 + TH / 2, az1, 2);
  for (const z of [az0, az1]) { const s = new THREE.Mesh(new THREE.BoxGeometry(ax1 - ax0, H, TH), aMat); s.position.set((ax0 + ax1) / 2, H / 2, z); group.add(s); field.addBox(ax0, z - TH / 2, ax1, z + TH / 2, 2); }
  // a single chair, faced into the corner — someone sat here
  const chair = makeChair(); chair.position.set(ax0 + 0.7, 0, cw(0) - 1.0); chair.rotation.y = -Math.PI / 2 - 0.3; group.add(chair);
  const aSmear = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.7), new THREE.MeshStandardMaterial({ map: softDot('#1f0202'), transparent: true, opacity: 0.7, depthWrite: false }));
  aSmear.position.set(ax0 + 0.06, 1.1, cw(0) + 1.0); aSmear.rotation.y = Math.PI / 2; group.add(aSmear);

  // a cold draft hints the wall is wrong as you pass it
  ctx.triggers.push({ x: fwx + 0.8, z: cw(0), r: 1.6, cooldown: 12, onEnter: (c) => { c.audio.whisper(new THREE.Vector3(fwx, 1.4, cw(0))); } });
  // reach the far end -> nothing... then the seal-and-scare when you turn back
  ctx.triggers.push({ x: ax0 + 0.9, z: cw(0), r: 1.2, once: true, onEnter: (c) => {
    const ent = c.director.entity;
    ent.spawnAt(fwx - 0.2, cw(0), c.player.pos.x, c.player.pos.z, 'idle', { dwell: 4 });
    fakeBlocker.active = true; fake.material = wallMat;
    c.director.stinger('shriek');
    setTimeout(() => { fakeBlocker.active = false; ent.despawn(c.audio, true); }, 2800);
  }});

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

  // a chandelier over the parlor, another deep in the maze
  for (const cellxy of [[1, 1], [5, 4]]) {
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
    // basement door easing + its red beacon pulsing
    const ud = bDoor.userData; ud.angle += (ud.targetAngle - ud.angle) * Math.min(1, dt * 2.2); bDoor.rotation.y = ud.angle;
    doorGlow.intensity = 5 + Math.sin(t * 4) * 1.6 + Math.random() * 0.6;
    if (seam.visible) seam.material.opacity = 0.4 + Math.sin(t * 3) * 0.15;
    // crouch while inside the collapsed crawl-space
    player.crawl = player.pos.x > CR.x - CR.hw - 0.05 && player.pos.x < CR.x + CR.hw + 0.05 &&
                   player.pos.z > CR.z0 - 0.1 && player.pos.z < CR.z1;
  }

  return {
    name: 'mansion', group, field, flames,
    spawn: { x: cw(1), z: cw(1) + CELL, yaw: 0 },     // stand in the parlor, facing the grand staircase
    fog: { color: zc.fog, density: zc.fogDensity },
    ambient: { color: zc.ambient, intensity: zc.ambientI },
    sky: zc.sky, update,
  };
}
