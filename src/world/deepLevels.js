import * as THREE from 'three';
import { ColliderField } from '../collision.js';
import { CFG } from '../config.js';
import { bfs, generateMaze } from './maze.js';
import {
  barkTexture, fleshTexture, groundTexture, softDot, stoneTexture,
  stainTexture, wallpaperTexture, woodFloorTexture,
} from '../textures.js';
import {
  makeArmchair, makeBed, makeCandelabra, makeChair, makeCouch, makeDoor,
  makeFireplace, makeFlame, makeFlamePool, makeGrandPainting, makeGravestone,
  makeKey, makeMirror, makeRug, makeShelf, makeTable,
  poolifyFlames, updateFlamePool,
} from './props.js';

const CELL = 3.55;
const TH = 0.22;
const OPEN = { halfW: 14, zNear: 8, zFar: -20 };
const MAZE_Z = -24;
const CORRIDOR_W = 1.32;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Share identical decoration materials WITHIN a level so we compile ~15 shaders
// instead of ~230. Cleared per build (buildDeepLevel) so nothing leaks across
// levels or gets disposed out from under the next one. Safe because mat()
// results are never mutated at runtime (only inline-built materials are).
let _matCache = {};
function mat(color, roughness = 0.85, metalness = 0.0, emissive = 0x000000, emissiveIntensity = 0) {
  const k = `${color}|${roughness}|${metalness}|${emissive}|${emissiveIntensity}`;
  return _matCache[k] || (_matCache[k] = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity }));
}

const detailMatCache = {};
function detailMat(key, color, opacity = 0.5) {
  if (!detailMatCache[key]) {
    detailMatCache[key] = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }
  return detailMatCache[key];
}

function colliderBox(field, minx, minz, maxx, maxz, tag = 0) {
  field.addBox(Math.min(minx, maxx), Math.min(minz, maxz), Math.max(minx, maxx), Math.max(minz, maxz), tag);
}

function wall(group, field, x, z, sx, sz, h, material, tag = 2, dress = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), material);
  m.position.set(x, h / 2, z);
  m.castShadow = true; m.receiveShadow = true;
  group.add(m);
  // Dressing (trim rails, panels, per-theme art) is ~15 sub-meshes + several
  // materials PER wall. With a full maze that's thousands of objects and hundreds
  // of shaders — enough to hang the GPU on load. So only the open-room / corridor
  // "feature" walls get dressed; the maze interior stays plain textured.
  if (dress && material.userData?.detailSpec) dressWall(group, material.userData.detailSpec, x, z, sx, sz, h);
  colliderBox(field, x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2, tag);
  return m;
}

function faceBox(group, alongX, x, z, offset, len, y, h, depth, material) {
  const mesh = new THREE.Mesh(
    alongX ? new THREE.BoxGeometry(len, h, depth) : new THREE.BoxGeometry(depth, h, len),
    material,
  );
  mesh.position.set(alongX ? x : x + offset, y, alongX ? z + offset : z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function wallPanel(group, alongX, x, z, offset, len, y, h, material) {
  const mesh = new THREE.Mesh(
    alongX ? new THREE.PlaneGeometry(len, h) : new THREE.PlaneGeometry(len, h),
    material,
  );
  mesh.position.set(alongX ? x : x + offset, y, alongX ? z + offset : z);
  mesh.rotation.y = alongX ? (offset > 0 ? Math.PI : 0) : (offset > 0 ? -Math.PI / 2 : Math.PI / 2);
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function dressWall(group, spec, x, z, sx, sz, h) {
  const len = Math.max(sx, sz);
  if (len < 1.1 || h < 2.2) return;
  const alongX = sx >= sz;
  const thick = Math.min(sx, sz);
  const segs = Math.max(1, Math.min(4, Math.floor(len / 2.4)));
  const segLen = len / segs;
  const fronts = [-1, 1];
  const baseMats = {
    iron: mat(0x111719, 0.48, 0.72),
    darkWood: mat(0x1b0f08, 0.78, 0.12),
    brass: mat(0x765022, 0.52, 0.45),
    tileLine: mat(0x49616a, 0.35, 0.18),
    paper: mat(0x5b3f4c, 0.95, 0.0, 0x16060e, 0.08),
    bone: mat(0x8d806e, 0.62, 0.0),
    redWood: mat(0x2a1116, 0.84, 0.05),
  };
  const accentBySpec = {
    conservatory: baseMats.iron,
    library: baseMats.darkWood,
    nursery: baseMats.redWood,
    bathhouse: baseMats.tileLine,
    gallery: baseMats.brass,
    chapel: baseMats.bone,
  };
  const grimeColor = {
    conservatory: 0x123523,
    library: 0x1b0b07,
    nursery: 0x42162c,
    bathhouse: 0x08242d,
    gallery: 0x21091e,
    chapel: 0x3a0605,
  }[spec.name] || 0x160908;
  const grime = detailMat(`${spec.name}:wall-grime`, grimeColor, spec.surface === 'wet' ? 0.34 : 0.24);
  const lowerShadow = detailMat(`${spec.name}:lower-shadow`, 0x050304, spec.surface === 'wet' ? 0.28 : 0.20);
  // A dark water-stain/scuff, NOT a glowing decal. (It used to be painted in the
  // bright guidance colour, which made every wall segment look like a backlit
  // panel.) Kept dim so it reads as grime the torch grazes, not a light source.
  const readableAccent = detailMat(`${spec.name}:readable-accent`, 0x0a0607, spec.surface === 'wet' ? 0.18 : 0.13);
  for (const side of fronts) {
    const off = side * (thick / 2 + 0.035);
    for (let i = 0; i < segs; i++) {
      const center = -len / 2 + segLen * (i + 0.5);
      const px = alongX ? x + center : x;
      const pz = alongX ? z : z + center;
      const usable = Math.max(0.55, segLen - 0.28);
      const accent = accentBySpec[spec.name] || baseMats.darkWood;
      faceBox(group, alongX, px, pz, off + side * 0.03, usable, h * 0.12, 0.075, 0.055, accent);
      faceBox(group, alongX, px, pz, off + side * 0.03, usable, h * 0.86, 0.075, 0.055, accent);
      if (segs > 1 || i % 2 === 0) {
        faceBox(group, alongX, px, pz, off + side * 0.04, 0.055, h * 0.50, h * 0.68, 0.055, accent);
      }
      wallPanel(group, alongX, px, pz, off + side * 0.006, usable * 0.86, h * 0.38, h * 0.42, lowerShadow);
      if ((i + Math.floor(Math.abs(x + z))) % 2 === 0) {
        wallPanel(group, alongX, px, pz, off + side * 0.009, usable * 0.72, h * 0.62, h * 0.50, grime);
      } else {
        wallPanel(group, alongX, px, pz, off + side * 0.009, usable * 0.46, h * 0.55, h * 0.28, readableAccent);
      }
      if (spec.name === 'conservatory') {
        const glass = new THREE.MeshStandardMaterial({ color: 0x6fccb0, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.16, emissive: 0x0a201a, emissiveIntensity: 0.05, side: THREE.DoubleSide });
        wallPanel(group, alongX, px, pz, off, usable, h * 0.55, h * 0.68, glass);
        faceBox(group, alongX, px, pz, off + side * 0.02, usable, h * 0.88, 0.055, 0.045, baseMats.iron);
        faceBox(group, alongX, px, pz, off + side * 0.02, usable, h * 0.22, 0.055, 0.045, baseMats.iron);
        faceBox(group, alongX, px - (alongX ? usable * 0.48 : 0), pz - (!alongX ? usable * 0.48 : 0), off + side * 0.02, 0.055, h * 0.55, h * 0.68, 0.045, baseMats.iron);
        faceBox(group, alongX, px + (alongX ? usable * 0.48 : 0), pz + (!alongX ? usable * 0.48 : 0), off + side * 0.02, 0.055, h * 0.55, h * 0.68, 0.045, baseMats.iron);
        const vine = new THREE.Mesh(
          alongX ? new THREE.CapsuleGeometry(0.025, usable * 0.7, 4, 6) : new THREE.CapsuleGeometry(0.025, usable * 0.7, 4, 6),
          mat(0x163b22, 0.92, 0.0, 0x031006, 0.08),
        );
        vine.position.set(alongX ? px : px + off + side * 0.05, h * 0.54, alongX ? pz + off + side * 0.05 : pz);
        vine.rotation.set(alongX ? Math.PI / 2 : Math.PI / 2, 0, alongX ? 1.05 : 0.45);
        group.add(vine);
      } else if (spec.name === 'library') {
        faceBox(group, alongX, px, pz, off, usable, h * 0.38, 0.08, 0.06, baseMats.darkWood);
        faceBox(group, alongX, px, pz, off, usable, h * 0.62, 0.08, 0.06, baseMats.darkWood);
        for (let b = 0; b < 5; b++) {
          const bx = center - usable * 0.38 + b * usable * 0.19;
          const bookMat = mat([0x4b1d18, 0x26354b, 0x4b3b18, 0x2c4428, 0x3b2448][b % 5], 0.82, 0.02);
          faceBox(group, alongX, alongX ? x + bx : x, alongX ? z : z + bx, off + side * 0.03, usable * 0.09, h * 0.49, 0.34 + (b % 2) * 0.1, 0.08, bookMat);
        }
        if (i % 2 === 0) wallPanel(group, alongX, px, pz, off + side * 0.012, usable * 0.42, h * 0.77, h * 0.24, new THREE.MeshStandardMaterial({ color: 0x26100b, roughness: 0.9, emissive: 0x080202, emissiveIntensity: 0.08, side: THREE.DoubleSide }));
      } else if (spec.name === 'nursery') {
        wallPanel(group, alongX, px, pz, off, usable * 0.84, h * 0.58, h * 0.52, baseMats.paper);
        faceBox(group, alongX, px, pz, off + side * 0.02, usable, h * 0.28, 0.08, 0.045, baseMats.redWood);
        // a child's drawing scrawled here and there — occasional, dim, so it's a
        // wrong little detail the torch finds, not glowing wallpaper.
        if (i % 2 === 0) {
          const drawing = new THREE.MeshBasicMaterial({ color: [0xe9b9c8, 0xb9c6e2, 0xe2d49a, 0xbfe0bd][i % 4], transparent: true, opacity: 0.34, side: THREE.DoubleSide });
          wallPanel(group, alongX, px + (alongX ? usable * 0.18 : 0), pz + (!alongX ? usable * 0.18 : 0), off + side * 0.01, usable * 0.25, h * 0.62, h * 0.18, drawing);
        }
        const scratch = new THREE.MeshBasicMaterial({ color: 0x12040a, transparent: true, opacity: 0.62, side: THREE.DoubleSide });
        wallPanel(group, alongX, px - (alongX ? usable * 0.22 : 0), pz - (!alongX ? usable * 0.22 : 0), off + side * 0.012, usable * 0.18, h * 0.46, h * 0.30, scratch);
      } else if (spec.name === 'bathhouse') {
        wallPanel(group, alongX, px, pz, off + side * 0.015, usable * 0.82, h * 0.58, h * 0.58, detailMat('bathhouse:deep-wet-tile', 0x061820, 0.36));
        for (let yy = 0.35; yy < h - 0.2; yy += 0.58) faceBox(group, alongX, px, pz, off, usable, yy, 0.025, 0.035, baseMats.tileLine);
        for (let k = -1; k <= 1; k++) faceBox(group, alongX, px + (alongX ? k * usable * 0.31 : 0), pz + (!alongX ? k * usable * 0.31 : 0), off, 0.035, h * 0.52, h * 0.72, 0.035, baseMats.tileLine);
        if (i % 2 === 0) faceBox(group, alongX, px, pz, off + side * 0.04, usable * 0.66, h * 0.77, 0.08, 0.085, mat(0x20282a, 0.32, 0.76));
        if (i % 2 === 1) faceBox(group, alongX, px, pz, off + side * 0.07, usable * 0.52, h * 0.67, 0.055, 0.08, mat(0x6d8287, 0.25, 0.65));
        faceBox(group, alongX, px, pz, off + side * 0.075, 0.045, h * 0.61, h * 0.78, 0.05, mat(0x0c1115, 0.28, 0.82));
      } else if (spec.name === 'gallery') {
        const frame = baseMats.brass;
        const art = new THREE.MeshBasicMaterial({ color: [0x1b0918, 0x2a0610, 0x0c1020, 0x241207][i % 4], transparent: true, opacity: 0.82, side: THREE.DoubleSide });
        wallPanel(group, alongX, px, pz, off, usable * 0.64, h * 0.58, h * 0.58, art);
        faceBox(group, alongX, px, pz, off + side * 0.02, usable * 0.76, h * 0.88, 0.065, 0.055, frame);
        faceBox(group, alongX, px, pz, off + side * 0.02, usable * 0.76, h * 0.25, 0.065, 0.055, frame);
        faceBox(group, alongX, px - (alongX ? usable * 0.37 : 0), pz - (!alongX ? usable * 0.37 : 0), off + side * 0.04, 0.045, h * 0.58, h * 0.58, 0.045, frame);
        faceBox(group, alongX, px + (alongX ? usable * 0.37 : 0), pz + (!alongX ? usable * 0.37 : 0), off + side * 0.04, 0.045, h * 0.58, h * 0.58, 0.045, frame);
        if (i % 2 === 1) wallPanel(group, alongX, px, pz, off + side * 0.012, usable * 0.26, h * 0.60, h * 0.34, detailMat('gallery:portrait-smear', 0x5a0a2d, 0.38));
      } else if (spec.name === 'chapel') {
        wallPanel(group, alongX, px, pz, off + side * 0.012, usable * 0.70, h * 0.60, h * 0.62, detailMat('chapel:old-glass-red', 0x3a0808, 0.38));
        faceBox(group, alongX, px, pz, off, usable, h * 0.20, 0.08, 0.055, baseMats.bone);
        faceBox(group, alongX, px, pz, off + side * 0.05, 0.055, h * 0.58, h * 0.54, 0.06, mat(0x5a0806, 0.58, 0.06, 0x130101, 0.08));
        faceBox(group, alongX, px, pz, off + side * 0.055, usable * 0.38, h * 0.58, 0.055, 0.06, mat(0x5a0806, 0.58, 0.06, 0x130101, 0.08));
        const arch = new THREE.Mesh(new THREE.TorusGeometry(Math.min(usable * 0.34, 0.72), 0.035, 6, 18, Math.PI), baseMats.bone);
        arch.position.set(px, h * 0.62, pz);
        arch.rotation.set(Math.PI / 2, 0, alongX ? 0 : Math.PI / 2);
        arch.position.x += alongX ? 0 : off;
        arch.position.z += alongX ? off : 0;
        group.add(arch);
      }
    }
  }
}

function floorPlane(group, x, z, sx, sz, material, y = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), material);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  group.add(m);
  return m;
}

function ceilPlane(group, x, z, sx, sz, h, color = 0x050404) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  m.rotation.x = Math.PI / 2;
  m.position.set(x, h, z);
  group.add(m);
  return m;
}

function addPillar(group, field, x, z, h, material, r = 0.34) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.12, h, 10), material);
  p.position.set(x, h / 2, z);
  p.castShadow = true; p.receiveShadow = true;
  group.add(p);
  field.addCircle(x, z, r * 1.1, 2);
  return p;
}

function addLowBox(group, field, x, z, sx, sz, h, material) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), material);
  b.position.set(x, h / 2, z);
  b.castShadow = true; b.receiveShadow = true;
  group.add(b);
  colliderBox(field, x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2, 2);
  return b;
}

function addSprite(group, animated, color, x, y, z, scale, opacity = 0.55, type = 'glow') {
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDot(color),
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  spr.position.set(x, y, z);
  spr.scale.set(scale, scale, 1);
  spr.userData.anim = { type, seed: Math.random() * 100, base: scale, opacity };
  group.add(spr);
  animated.push(spr);
  return spr;
}

function addFloorStain(group, spec, x, z, sx, sz, seed, opacity = 0.42) {
  const tint = spec.name === 'conservatory' ? '#10301f'
    : spec.name === 'library' ? '#1d0e07'
    : spec.name === 'nursery' ? '#4d1c2d'
    : spec.name === 'bathhouse' ? '#0b2b35'
    : spec.name === 'gallery' ? '#281020'
    : '#4b0906';
  const mat = new THREE.MeshBasicMaterial({
    map: stainTexture(seed, tint),
    color: 0xffffff,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const stain = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), mat);
  stain.rotation.x = -Math.PI / 2;
  stain.rotation.z = seed * 0.37;
  stain.position.set(x, 0.033, z);
  stain.renderOrder = 3;
  group.add(stain);
  return stain;
}

function addCandlePool(group, flames, x, z, count, radius, color = 0xffaa44) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.25;
    const r = radius * (0.45 + Math.random() * 0.55);
    const f = makeFlame(color, 0.42, 4.5);
    f.position.set(x + Math.cos(a) * r, 0.18, z + Math.sin(a) * r);
    f.scale.setScalar(0.55 + Math.random() * 0.35);
    group.add(f); flames.push(f);
  }
}

function addHangingFlame(group, flames, x, z, y, color = 0xffaa44, intensity = 0.62, dist = 5.5) {
  const iron = mat(0x151517, 0.45, 0.75);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, Math.max(0.35, y - 0.55), 5), iron);
  chain.position.set(x, y + (y - 0.55) / 2, z);
  group.add(chain);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 6, 16), iron);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, y, z);
  group.add(ring);
  const f = makeFlame(color, intensity, dist);
  f.position.set(x, y - 0.18, z);
  group.add(f); flames.push(f);
  return f;
}

function addRunner(group, x, z, sx, sz, color = 0x2a1118) {
  const rug = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.025, sz), mat(color, 0.96, 0.0));
  rug.position.set(x, 0.018, z);
  rug.receiveShadow = true;
  group.add(rug);
  const border = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.88, 0.028, sz * 0.88), mat(color + 0x101010, 0.96, 0.0));
  border.position.set(x, 0.024, z);
  group.add(border);
}

function addTinyDebris(group, x, z, count, radius, material, rand, scale = 0.16) {
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * radius;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(scale * (0.55 + rand()), 0), material);
    rock.position.set(x + Math.cos(a) * r, scale * 0.35, z + Math.sin(a) * r);
    rock.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    rock.castShadow = true; rock.receiveShadow = true;
    group.add(rock);
  }
}

function addPathTrail(group, path, cols, spec) {
  const color = spec.name === 'chapel' ? 0x5a0805
    : spec.name === 'bathhouse' ? 0x1a5964
    : spec.name === 'gallery' ? 0x4b1438
    : spec.name === 'nursery' ? 0x6a253e
    : spec.name === 'library' ? 0x30214c
    : 0x255a4a;
  // A continuous directional sheen on the floor along the solution path — a
  // second, always-on layer of guidance under the embers so the way reads even
  // through fog or when an ember is briefly out of the lit pool. Constant
  // brightness at every depth (the maze is the backdrop, not the test).
  const trailMat = new THREE.MeshStandardMaterial({
    color,
    roughness: spec.surface === 'wet' ? 0.22 : 0.78,
    metalness: spec.surface === 'wet' ? 0.28 : 0.02,
    emissive: spec.guidance,
    emissiveIntensity: 0.06,
  });
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const x1 = wx(ax, cols), z1 = wz(ay);
    const x2 = wx(bx, cols), z2 = wz(by);
    const midX = (x1 + x2) / 2, midZ = (z1 + z2) / 2;
    const horiz = ay === by;
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(horiz ? CELL * 0.5 : 0.22, 0.018, horiz ? 0.22 : CELL * 0.5),
      trailMat,
    );
    strip.position.set(midX, 0.026, midZ);
    strip.receiveShadow = true;
    group.add(strip);
  }
}

function addPathDetail(group, flames, animated, spec, rand, x, y, cols) {
  if (rand() > 0.62) return;
  const cx = wx(x, cols) + (rand() - 0.5) * 0.72;
  const cz = wz(y) + (rand() - 0.5) * 0.72;
  if (spec.name === 'conservatory') {
    const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 1.7 + rand() * 0.9, 5), mat(0x18361f, 0.86, 0.02, 0x061108, 0.12));
    vine.position.set(cx, spec.mazeH - 0.8, cz);
    vine.rotation.z = (rand() - 0.5) * 0.8;
    group.add(vine);
    if (rand() > 0.45) addSprite(group, animated, '#6effb2', cx, 1.45, cz, 0.75, 0.13, 'glow');
  } else if (spec.name === 'library') {
    const cover = [0x4b1d18, 0x26354b, 0x3b2448, 0x4b3b18][Math.floor(rand() * 4)];
    for (let i = 0; i < 3; i++) {
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.045, 0.22), mat(cover, 0.82, 0.02));
      book.position.set(cx + (rand() - 0.5) * 0.55, 0.05 + i * 0.035, cz + (rand() - 0.5) * 0.42);
      book.rotation.y = rand() * Math.PI;
      book.castShadow = true; book.receiveShadow = true;
      group.add(book);
    }
  } else if (spec.name === 'nursery') {
    const toy = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.20, 0.28), mat([0x6e1f38, 0x304467, 0x6e5b24][Math.floor(rand() * 3)], 0.78, 0.02, 0x1c0710, 0.06));
    toy.position.set(cx, 0.11, cz);
    toy.rotation.set(rand() * 0.3, rand() * Math.PI, rand() * 0.3);
    toy.castShadow = true; toy.receiveShadow = true;
    group.add(toy);
  } else if (spec.name === 'bathhouse') {
    const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.025, 18), mat(0x0c171b, 0.28, 0.58));
    drain.position.set(cx, 0.035, cz);
    drain.rotation.x = Math.PI / 2;
    group.add(drain);
    addSprite(group, animated, '#a7f6ff', cx, 0.48, cz, 0.9, 0.11, 'steam');
  } else if (spec.name === 'gallery') {
    const placard = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.035, 0.32), mat(0x7a5a35, 0.5, 0.35, 0x1a0b12, 0.08));
    placard.position.set(cx, 0.05, cz);
    placard.rotation.y = rand() * Math.PI;
    group.add(placard);
  } else if (spec.name === 'chapel') {
    const bone = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.42, 4, 6), mat(0x918472, 0.72, 0.0));
    bone.position.set(cx, 0.08, cz);
    bone.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    group.add(bone);
    if (rand() > 0.55) {
      const f = makeFlame(0xff5533, 0.24, 2.8);
      f.position.set(cx + 0.24, 0.18, cz - 0.18);
      group.add(f); flames.push(f);
    }
  }
}

function addLinearDressing(group, flames, animated, spec, sx, sz, exit, len) {
  const steps = Math.max(5, Math.floor(len / 3.0));
  const sideX = -exit.z;
  const sideZ = exit.x;
  const longX = Math.abs(exit.x) > 0;
  const mkSidePanel = (x, z, y, w, h, material) => {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(longX ? w : 0.07, h, longX ? 0.07 : w), material);
    panel.position.set(x, y, z);
    panel.castShadow = true; panel.receiveShadow = true;
    group.add(panel);
    return panel;
  };
  for (let i = 0; i < steps; i++) {
    const t = -len / 2 + (i + 0.5) * (len / steps);
    const cx = sx + exit.x * t;
    const cz = sz + exit.z * t;
    if (spec.name === 'conservatory') {
      const glass = new THREE.MeshStandardMaterial({ color: 0x9df9d6, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.20, emissive: 0x0a2d22, emissiveIntensity: 0.22, side: THREE.DoubleSide });
      for (const side of [-1, 1]) {
        const px = cx + sideX * side * 1.08;
        const pz = cz + sideZ * side * 1.08;
        mkSidePanel(px, pz, 1.75, 1.35, 2.2, glass);
      }
      if (i % 2 === 0) {
        const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.9, 5), mat(0x17351f, 0.86, 0.02, 0x061108, 0.12));
        vine.position.set(cx, spec.mazeH - 0.75, cz);
        vine.rotation.z = (i % 3 - 1) * 0.28;
        group.add(vine);
      }
    } else if (spec.name === 'library') {
      const shelfMat = mat(0x241207, 0.76, 0.1);
      for (const side of [-1, 1]) {
        const px = cx + sideX * side * 1.03;
        const pz = cz + sideZ * side * 1.03;
        const shelf = mkSidePanel(px, pz, 1.05, 1.35, 2.1, shelfMat);
        shelf.material = shelfMat;
        for (let b = 0; b < 4; b++) {
          const book = new THREE.Mesh(new THREE.BoxGeometry(longX ? 0.18 : 0.05, 0.42, longX ? 0.05 : 0.18), mat([0x4d1c17, 0x26344d, 0x4a3814, 0x2d462b][b % 4], 0.82, 0.02));
          book.position.set(px + (longX ? -0.45 + b * 0.3 : 0), 0.62 + (b % 2) * 0.46, pz + (longX ? 0 : -0.45 + b * 0.3));
          group.add(book);
        }
      }
    } else if (spec.name === 'nursery') {
      const paper = new THREE.MeshBasicMaterial({ color: [0xffd6e7, 0xd7e5ff, 0xfff0a8][i % 3], transparent: true, opacity: 0.55, side: THREE.DoubleSide });
      for (const side of [-1, 1]) {
        const px = cx + sideX * side * 1.07;
        const pz = cz + sideZ * side * 1.07;
        mkSidePanel(px, pz, 1.42, 0.86, 0.58, paper);
      }
      if (i % 2 === 1) {
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.28), mat(0x6e253d, 0.78, 0.02, 0x14040c, 0.06));
        block.position.set(cx + sideX * 0.42, 0.12, cz + sideZ * 0.42);
        group.add(block);
      }
    } else if (spec.name === 'bathhouse') {
      const pipe = mat(0x263238, 0.34, 0.72);
      const pipeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.2, 8), pipe);
      pipeMesh.rotation.z = longX ? Math.PI / 2 : 0;
      pipeMesh.rotation.x = longX ? 0 : Math.PI / 2;
      pipeMesh.position.set(cx, 2.55, cz);
      group.add(pipeMesh);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(longX ? 1.7 : 0.08, 0.035, longX ? 0.08 : 1.7), mat(0x9df2ff, 0.18, 0.0, 0x7eefff, 0.8));
      strip.position.set(cx, spec.mazeH - 0.16, cz);
      group.add(strip);
      addSprite(group, animated, '#9ff5ff', cx, 0.65, cz, 1.0, 0.10, 'steam');
    } else if (spec.name === 'gallery') {
      const frame = mat(0x755325, 0.45, 0.55);
      const art = new THREE.MeshBasicMaterial({ color: [0x1b0918, 0x2a0610, 0x0c1020][i % 3], transparent: true, opacity: 0.78, side: THREE.DoubleSide });
      for (const side of [-1, 1]) {
        const px = cx + sideX * side * 1.06;
        const pz = cz + sideZ * side * 1.06;
        mkSidePanel(px, pz, 1.58, 0.88, 1.08, art);
        const rail = mkSidePanel(px, pz, 2.18, 1.05, 0.06, frame);
        rail.material = frame;
      }
      if (i % 2 === 0) addSprite(group, animated, '#ff86dc', cx, 1.8, cz, 0.82, 0.14, 'glow');
    } else if (spec.name === 'chapel') {
      const bone = mat(0x8e806d, 0.64, 0.0, 0x170606, 0.08);
      const arch = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.035, 6, 18, Math.PI), bone);
      arch.position.set(cx, 1.95, cz);
      arch.rotation.set(Math.PI / 2, 0, longX ? Math.PI / 2 : 0);
      group.add(arch);
      if (i % 2 === 0) {
        const f = makeFlame(0xff5533, 0.28, 3.1);
        f.position.set(cx + sideX * 0.72, 0.18, cz + sideZ * 0.72);
        group.add(f); flames.push(f);
      }
    }
  }
}

function pathTo(maze, start, goal) {
  const dist = bfs(maze, start.x, start.y);
  const dirs = [
    ['N', 0, -1], ['S', 0, 1], ['E', 1, 0], ['W', -1, 0],
  ];
  const path = [];
  let x = goal.x, y = goal.y;
  while (x !== start.x || y !== start.y) {
    path.push([x, y]);
    let moved = false;
    for (const [d, dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= maze.cols || ny < 0 || ny >= maze.rows) continue;
      if (maze.cells[x][y][d] && dist[nx][ny] === dist[x][y] - 1) {
        x = nx; y = ny; moved = true; break;
      }
    }
    if (!moved) break;
  }
  path.push([start.x, start.y]);
  path.reverse();
  return path;
}

function farthestBoundary(maze, start) {
  const dist = bfs(maze, start.x, start.y);
  let best = { x: start.x, y: start.y, dist: -1 };
  for (let x = 0; x < maze.cols; x++) for (let y = 0; y < maze.rows; y++) {
    // Exclude the entrance edge (y===0). The maze mouth is on that edge, so an
    // exit cell there makes pickExit return 'N' and the key corridor + locked
    // door get built NORTH back through the open room — overlapping its geometry,
    // the guided corridor cut off by the room's far wall. (This silently broke
    // the nursery and gallery wings.) Exits now always land on the W/E/S edges.
    const boundary = (x === 0 || x === maze.cols - 1 || y === maze.rows - 1) && y !== 0;
    if (boundary && dist[x][y] > best.dist) best = { x, y, dist: dist[x][y] };
  }
  return best;
}

function pickExit(cell, cols, rows) {
  const d = cell.y === rows - 1 ? 'S'
    : cell.x === cols - 1 ? 'E'
      : cell.x === 0 ? 'W'
        : 'N';
  if (d === 'S') return { name: 'S', x: 0, z: -1 };
  if (d === 'N') return { name: 'N', x: 0, z: 1 };
  if (d === 'E') return { name: 'E', x: 1, z: 0 };
  return { name: 'W', x: -1, z: 0 };
}

function wx(x, cols) { return (x - (cols - 1) / 2) * CELL; }
function wz(y) { return MAZE_Z - y * CELL; }

function addGuidance(group, flames, path, cols, color, depth01 = 0) {
  // Embers mark the way AND are your main light in the maze — without enough of
  // them you wander into pitch black and get lost (the flashlight only lights
  // where you aim it). The maze is meant to be the BACKDROP, not the challenge:
  // the breadcrumb chain to the key must be unmistakable in every wing, and
  // BRIGHTEST exactly where players got most lost before (deep). So the trail is
  // bright, large, and constant at all depths — never dimmed by how far down you
  // are. (All these embers are pooled afterward, so the live light count stays
  // tiny and constant — no compile stalls.)
  const scale = 0.82;
  const reach = 10.0;   // reach far enough that a lent rover grazes the corridor walls (shows their zone tint), not just the floor
  const intensity = 0.74;
  for (let i = 1; i < path.length; i++) {
    const [x, y] = path[i];
    const f = makeFlame(color, intensity, reach);
    f.position.set(wx(x, cols), 0.2, wz(y));
    f.scale.setScalar(scale);
    group.add(f); flames.push(f);
  }
}

function addObjectInteraction(ctx, group, animated, spec, x, z, kind) {
  const m = new THREE.MeshStandardMaterial({
    color: spec.focusColor,
    roughness: 0.35,
    metalness: kind === 'handle' ? 0.6 : 0.1,
    emissive: spec.focusColor,
    emissiveIntensity: 0.35,
  });
  const obj = kind === 'handle'
    ? new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 8, 18), m)
    : new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 2), m);
  obj.position.set(x, kind === 'handle' ? 1.05 : 0.92, z);
  obj.rotation.x = kind === 'handle' ? Math.PI / 2 : 0;
  obj.castShadow = true;
  obj.userData.anim = { type: 'focus', seed: Math.random() * 20, base: obj.scale.x };
  group.add(obj); animated.push(obj);
  ctx.interactables.push({
    object: obj,
    pos: new THREE.Vector3(x, obj.position.y, z),
    radius: 1.8,
    once: true,
    focusable: true,
    canUse: () => true,
    onUse: (state, c) => {
      obj.userData.touched = true;
      m.emissiveIntensity = 1.3;
      c.audio.hush(0.9);
      c.audio.whisper(new THREE.Vector3(x, 1.2, z));
      c.audio.setTension(Math.min(1, c.audio.tension + 0.16));
      c.post.kick('pulse', 0.55);
      c.director._after(() => {
        if (Math.random() < 0.55) c.director.peripheral();
        else c.director.lurk(x + (Math.random() < 0.5 ? -3 : 3), z - 3);
      }, 450);   // _after, not setTimeout, so a level change cancels it (no stray apparition next level)
    },
  });
}

function decorateConservatory(group, field, flames, animated, spec, rand, ctx, materials) {
  const glass = new THREE.MeshStandardMaterial({ color: 0x9df9d6, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.24, emissive: 0x102c24, emissiveIntensity: 0.14, side: THREE.DoubleSide });
  const iron = mat(0x111818, 0.5, 0.7);
  const bark = new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.95 });
  const leaf = mat(0x1d4a32, 0.88, 0.0, 0x082010, 0.18);
  const leafSheet = new THREE.MeshStandardMaterial({ color: 0x235e38, roughness: 0.88, metalness: 0.0, emissive: 0x06180c, emissiveIntensity: 0.18, side: THREE.DoubleSide });
  const terracotta = mat(0x5d2d1d, 0.86, 0.03, 0x110403, 0.05);
  const soil = mat(0x21180f, 0.96, 0.0);
  const stone = mat(0x31423d, 0.58, 0.16);
  for (let x = -12; x <= 12; x += 4) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.08, 5.6, 0.08), iron);
    rib.position.set(x, 2.8, -7); group.add(rib);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 5.1), glass);
    pane.position.set(x + 1.8, 3.2, -18.7); pane.rotation.y = 0; group.add(pane);
  }
  for (let z = 5.5; z >= -18; z -= 3.8) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.2), glass);
    pane.rotation.x = Math.PI / 2;
    pane.position.set(0, spec.h - 0.15, z);
    group.add(pane);
    const rib = new THREE.Mesh(new THREE.BoxGeometry(12.5, 0.06, 0.07), iron);
    rib.position.set(0, spec.h - 0.12, z - 1.75);
    group.add(rib);
  }
  for (let z = 4.6; z >= -17; z -= 3.8) {
    for (const x of [-7.8, 7.8]) {
      const table = addLowBox(group, field, x, z, 4.3, 1.0, 0.76, stone);
      table.position.y = 0.38;
      const bed = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.16, 0.72), soil);
      bed.position.set(x, 0.84, z); bed.castShadow = true; group.add(bed);
    }
  }
  for (let i = 0; i < 8; i++) {
    const x = -11 + rand() * 22, z = OPEN.zFar + 2 + rand() * 24;
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.48, 0.62, 12), terracotta);
    pot.position.set(x, 0.31, z);
    pot.castShadow = true; pot.receiveShadow = true;
    group.add(pot);
    const darkSoil = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.34, 0.04, 12), soil);
    darkSoil.position.set(x, 0.64, z);
    group.add(darkSoil);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.18, 2.2 + rand() * 2.0, 7), bark);
    trunk.position.set(x, 0.55 + trunk.geometry.parameters.height / 2, z);
    trunk.rotation.z = (rand() - 0.5) * 0.2;
    group.add(trunk); field.addCircle(x, z, 0.22);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.52 + rand() * 0.42, 10, 8), leaf);
    crown.scale.set(0.8 + rand() * 0.25, 1.2 + rand() * 0.35, 0.8 + rand() * 0.25);
    crown.position.set(x, 2.55 + rand() * 1.1, z); group.add(crown);
    for (let fr = 0; fr < 5; fr++) {
      const a = (fr / 5) * Math.PI * 2 + rand() * 0.35;
      const frond = new THREE.Mesh(new THREE.PlaneGeometry(0.34 + rand() * 0.16, 1.25 + rand() * 0.5), leafSheet);
      frond.position.set(x + Math.cos(a) * 0.36, 1.72 + rand() * 0.75, z + Math.sin(a) * 0.36);
      frond.rotation.set(0.75 + rand() * 0.3, -a, (rand() - 0.5) * 0.35);
      group.add(frond);
    }
  }
  for (let i = 0; i < 10; i++) {
    const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.028, 1.8 + rand() * 1.8, 5), bark);
    vine.position.set(-12 + rand() * 24, 4.4 - rand() * 0.6, -18 + rand() * 24);
    vine.rotation.z = (rand() - 0.5) * 0.7;
    group.add(vine);
  }
  for (let i = 0; i < 9; i++) {
    const jarMat = new THREE.MeshStandardMaterial({ color: 0xa7ffd6, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.32, emissive: 0x0b2a20, emissiveIntensity: 0.25 });
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.7, 12), jarMat);
    jar.position.set(-8 + (i % 3) * 8, 1.22, -2 - Math.floor(i / 3) * 5.0);
    group.add(jar);
    const thing = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 1), mat(0x6d352d, 0.55, 0.05, 0x160302, 0.2));
    thing.position.set(jar.position.x, 1.18, jar.position.z);
    group.add(thing);
  }
  for (let z = 3; z >= -17; z -= 5) addHangingFlame(group, flames, 0, z, 3.7, 0x7affcc, 0.58, 6.5);
  const fountain = addLowBox(group, field, 0, -6, 3.2, 3.2, 0.28, mat(0x26322d, 0.55, 0.2));
  fountain.rotation.y = Math.PI / 4;
  addSprite(group, animated, '#79ffd7', 0, 0.75, -6, 1.9, 0.34, 'steam');
  addCandlePool(group, flames, -7, -13, 7, 1.2, 0x7affcc);
  const moon = new THREE.DirectionalLight(0x8fffe0, 0.45); moon.position.set(-8, 16, 6); group.add(moon);
  const domeGlow = new THREE.PointLight(0x88ffd8, 5, 24, 2); domeGlow.position.set(0, 4.4, -8); group.add(domeGlow);
  ctx.triggers.push({ x: 0, z: -6, r: 2.4, once: true, onEnter: (c) => {
    c.audio.rustle(new THREE.Vector3(-4, 1, -9));
    c.director.darkEyes?.(new THREE.Vector3(-4, 1.55, -9), { force: true, life: 0.95, scale: 1.08 });
  } });
  ctx.triggers.push({ x: 8, z: -14, r: 2.0, once: true, onEnter: (c) => { c.audio.flutter(new THREE.Vector3(5, 3, -17)); c.director.peripheral(); } });
  addObjectInteraction(ctx, group, animated, spec, 5.7, -8.6, 'handle');
}

function decorateLibrary(group, field, flames, animated, spec, rand, ctx) {
  const shelfMat = mat(0x251308, 0.72, 0.08);
  for (const x of [-11.8, 11.8]) {
    for (let z = 5; z >= -17; z -= 2.4) {
      const s = makeShelf(3.0); s.position.set(x, 0, z); s.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      s.traverse((o) => { if (o.isMesh) o.material = shelfMat; });
      group.add(s); field.addCircle(x, z, 0.65);
    }
  }
  addRunner(group, 0, -6.8, 4.4, 22.5, 0x281018);
  for (const x of [-9.8, 9.8]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 24), mat(0x432612, 0.62, 0.2));
    rail.position.set(x, 2.55, -6.2); group.add(rail);
    for (let z = 4.5; z >= -17; z -= 2.2) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.1), rail.material);
      post.position.set(x, 1.9, z); group.add(post);
    }
  }
  for (let i = 0; i < 4; i++) {
    const table = makeTable(2.2, 1.1, 0.78);
    table.position.set(-5.5 + i * 3.7, 0, -4.5 - (i % 2) * 5.0);
    table.rotation.y = (rand() - 0.5) * 0.4;
    group.add(table); field.addCircle(table.position.x, table.position.z, 0.9);
    const f = makeFlame(0xffaa44, 0.62, 5.5);
    f.position.set(table.position.x, 0.95, table.position.z);
    group.add(f); flames.push(f);
  }
  for (let i = 0; i < 10; i++) {
    const pile = new THREE.Group();
    for (let b = 0; b < 4; b++) {
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.45 + rand() * 0.35, 0.055, 0.32 + rand() * 0.15), mat([0x4d1c17, 0x26344d, 0x4a3814, 0x2d462b][b % 4], 0.82, 0.03));
      book.position.set((rand() - 0.5) * 0.2, b * 0.06, (rand() - 0.5) * 0.2);
      book.rotation.y = (rand() - 0.5) * 0.4;
      pile.add(book);
    }
    pile.position.set(-8 + rand() * 16, 0.05, 4 - rand() * 19);
    group.add(pile);
  }
  for (let i = 0; i < 4; i++) {
    const ladder = new THREE.Group();
    const woodM = mat(0x3a2110, 0.72, 0.12);
    for (const sx of [-0.28, 0.28]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.055, 2.6, 0.055), woodM);
      rail.position.set(sx, 1.3, 0); ladder.add(rail);
    }
    for (let r = 0; r < 6; r++) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.04), woodM);
      rung.position.set(0, 0.35 + r * 0.36, 0); ladder.add(rung);
    }
    ladder.position.set(i % 2 ? 11.1 : -11.1, 0, 2 - i * 5.2);
    ladder.rotation.z = i % 2 ? -0.18 : 0.18;
    group.add(ladder);
  }
  const fp = makeFireplace(); fp.position.set(0, 0, OPEN.zNear - 0.25); fp.rotation.y = Math.PI; group.add(fp);
  const ember = makeFlame(0xff4a1a, 0.75, 6); ember.position.set(0, 0.45, OPEN.zNear - 0.65); group.add(ember); flames.push(ember);
  for (let i = 0; i < 9; i++) {
    const p = makeGrandPainting(i + 1, 1.0, 1.3);
    p.position.set(-8 + i * 2, 2.2, -19.84);
    group.add(p);
  }
  for (let z = 4; z >= -16; z -= 4) addHangingFlame(group, flames, 0, z, 3.2, 0xffb15a, 0.5, 6);
  ctx.triggers.push({ x: -2, z: -5, r: 2.0, once: true, onEnter: (c) => {
    c.audio.slam(new THREE.Vector3(-11, 1.5, -7));
    c.director.shadowFold?.(new THREE.Vector3(-10.6, 1.05, -7), { life: 0.82, scale: 1.15 });
  } });
  ctx.triggers.push({ x: 9, z: -12, r: 2.0, once: true, onEnter: (c) => { c.audio.hush(0.8); c.audio.whisper(new THREE.Vector3(11, 2, -15)); } });
  addObjectInteraction(ctx, group, animated, spec, -2.0, -4.5, 'token');
}

function decorateNursery(group, field, flames, animated, spec, rand, ctx) {
  const cloth = mat(0x4a2f3d, 1);
  const toyMat = mat(0x80555d, 0.9, 0.0, 0x18070b, 0.1);
  for (let i = 0; i < 5; i++) {
    const bed = makeBed();
    bed.position.set(-9 + i * 4.5, 0, -11 - (i % 2) * 4);
    bed.rotation.y = i % 2 ? 0.15 : -0.1;
    bed.traverse((o) => { if (o.isMesh && o.material.color) o.material = cloth; });
    group.add(bed); field.addBox(bed.position.x - 0.8, bed.position.z - 1.1, bed.position.x + 0.8, bed.position.z + 1.1, 2);
  }
  const rug = makeRug(6.0, 4.2); rug.position.set(0, 0, -5.5); group.add(rug);
  for (let i = 0; i < 6; i++) {
    const crib = new THREE.Group();
    const woodM = mat(0x3b2228, 0.82, 0.06);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.85), woodM); base.position.y = 0.32; crib.add(base);
    for (let b = 0; b < 7; b++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.75, 5), woodM);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(-0.62 + b * 0.21, 0.75, -0.45); crib.add(bar);
      const bar2 = bar.clone(); bar2.position.z = 0.45; crib.add(bar2);
    }
    crib.position.set(-8.5 + (i % 3) * 8.5, 0, -1.5 - Math.floor(i / 3) * 6.0);
    crib.rotation.y = (rand() - 0.5) * 0.2;
    group.add(crib); field.addCircle(crib.position.x, crib.position.z, 0.85);
  }
  for (let i = 0; i < 8; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.26 + rand() * 0.25, 0.26, 0.26 + rand() * 0.25), toyMat);
    b.position.set(-7 + rand() * 14, 0.13, -3 - rand() * 12);
    b.rotation.y = rand() * Math.PI;
    b.castShadow = true; group.add(b);
  }
  for (let i = 0; i < 8; i++) {
    const doll = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.22, 3, 8), toyMat); body.position.y = 0.26; doll.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mat(0x8a6a5c, 0.8, 0.0, 0x18080a, 0.12)); head.position.y = 0.5; doll.add(head);
    const eyeM = mat(0x050505, 0.7, 0.0, 0xc8d8ff, 0.8);
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), eyeM); e.position.set(sx * 0.03, 0.52, 0.075); doll.add(e); }
    doll.position.set(-9 + rand() * 18, 0, 3 - rand() * 17);
    doll.rotation.y = rand() * Math.PI * 2;
    doll.userData.anim = { type: 'focus', seed: rand() * 20, base: 1 };
    group.add(doll); animated.push(doll);
  }
  for (let i = 0; i < 7; i++) {
    const mobile = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.75, 5), mat(0x3b252c, 0.6, 0.4));
    stem.position.y = -0.35; mobile.add(stem);
    const star = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), toyMat);
    star.position.y = -0.78; mobile.add(star);
    mobile.position.set(-9 + i * 3, 3.1, -7 - (i % 3) * 3.0);
    mobile.userData.anim = { type: 'swing', seed: rand() * 30, base: 1 };
    group.add(mobile); animated.push(mobile);
  }
  const rocker = makeChair(); rocker.position.set(9.5, 0, -4.8); rocker.rotation.y = -1.1; rocker.userData.anim = { type: 'swing', seed: 3.7, base: 1 }; group.add(rocker); animated.push(rocker);
  for (let z = 4; z >= -16; z -= 5) addHangingFlame(group, flames, -8.8, z, 2.8, 0xff7890, 0.38, 4.8);
  addCandlePool(group, flames, 6.6, -6.6, 8, 1.0, 0xff7890);
  ctx.triggers.push({ x: 0, z: -5.5, r: 2.1, once: true, onEnter: (c) => {
    c.audio.stinger('breath');
    c.player.addShake(0.2);
    c.director.darkEyes?.(new THREE.Vector3(0.25, 1.05, -8.2), { force: true, life: 1.0, scale: 0.86, eyeGap: 0.09 });
  } });
  ctx.triggers.push({ x: -7, z: -13, r: 2.2, once: true, onEnter: (c) => { c.audio.hush(0.9); c.ui.blink(60, 210); } });
  addObjectInteraction(ctx, group, animated, spec, 0, -5.5, 'token');
}

function decorateBathhouse(group, field, flames, animated, spec, rand, ctx) {
  const tile = mat(0x172b32, 0.28, 0.22);
  const pipe = mat(0x24282a, 0.38, 0.75);
  for (const [x, z, sx, sz] of [[-6, -6, 4.8, 7.4], [6, -11, 4.2, 6.2]]) {
    const pool = addLowBox(group, field, x, z, sx, sz, 0.18, tile);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(sx - 0.3, sz - 0.3), new THREE.MeshStandardMaterial({
      color: 0x376070, roughness: 0.05, metalness: 0.55, transparent: true, opacity: 0.42,
    }));
    water.rotation.x = -Math.PI / 2; water.position.set(x, 0.22, z); group.add(water);
    addSprite(group, animated, '#96f3ff', x, 0.55, z, Math.max(sx, sz) * 0.55, 0.18, 'steam');
  }
  for (let i = 0; i < 6; i++) {
    const stall = new THREE.Group();
    const tileM = mat(0x20343a, 0.32, 0.24);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.3, 0.12), tileM); back.position.set(0, 1.15, -0.7); stall.add(back);
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.1, 1.4), tileM); left.position.set(-0.7, 1.05, 0); stall.add(left);
    const shower = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.018, 6, 12), pipe); shower.position.set(0, 1.9, -0.55); shower.rotation.x = Math.PI / 2; stall.add(shower);
    stall.position.set(-10.5 + (i % 3) * 10.5, 0, 3.5 - Math.floor(i / 3) * 7.0);
    group.add(stall); field.addCircle(stall.position.x, stall.position.z, 0.8);
    addSprite(group, animated, '#96f3ff', stall.position.x, 1.0, stall.position.z - 0.6, 0.9, 0.12, 'steam');
  }
  for (let i = 0; i < 9; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.0 + rand() * 2, 8), pipe);
    p.rotation.z = Math.PI / 2;
    p.position.set(-11 + rand() * 22, 2.6 + rand() * 1.2, -4 - rand() * 13);
    group.add(p);
  }
  for (let z = 4.8; z >= -17; z -= 3.2) {
    const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.035, 16), mat(0x111416, 0.42, 0.8));
    drain.position.set(0, 0.035, z); group.add(drain);
  }
  for (let i = 0; i < 6; i++) {
    const mirror = makeMirror(0.9, 1.5);
    mirror.position.set(-12.85, 1.6, 4 - i * 3.2);
    mirror.rotation.y = Math.PI / 2;
    group.add(mirror);
  }
  for (let z = 3; z >= -16; z -= 4) addHangingFlame(group, flames, 9.8, z, 2.95, 0x7edfff, 0.38, 4.8);
  // light the mirror wall too (staggered, dimmer) so it isn't a black void
  for (let z = 1; z >= -15; z -= 4) addHangingFlame(group, flames, -9.8, z, 2.95, 0x7edfff, 0.30, 4.4);
  ctx.triggers.push({ x: -6, z: -6, r: 2.2, once: true, onEnter: (c) => {
    c.audio.drip(new THREE.Vector3(-6, 1.2, -6));
    c.audio.slam(new THREE.Vector3(-10, 1.4, -4));
    c.director.mirrorScare?.(new THREE.Vector3(-12.55, 1.65, -5.6));
  } });
  ctx.triggers.push({ x: -12, z: -8, r: 1.8, once: true, onEnter: (c) => { c.ui.blink(50, 240); c.audio.stinger('breath'); } });
  addObjectInteraction(ctx, group, animated, spec, -6, -6, 'handle');
}

function decorateGallery(group, field, flames, animated, spec, rand, ctx) {
  const velvet = mat(0x3c102a, 0.9, 0.0, 0x16040c, 0.2);
  const gold = mat(0x7a5520, 0.45, 0.55);
  const stage = addLowBox(group, field, 0, -15.2, 11.5, 3.0, 0.45, mat(0x1a0b12, 0.8, 0.1));
  stage.position.y = 0.225;
  for (const x of [-6.2, 6.2]) {
    const curtain = new THREE.Mesh(new THREE.BoxGeometry(0.36, 4.5, 5.6), velvet);
    curtain.position.set(x, 2.25, -15.2);
    curtain.rotation.z = x < 0 ? -0.08 : 0.08;
    group.add(curtain);
  }
  for (let i = 0; i < 6; i++) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.0, 0.08), gold);
    frame.position.set(-10.8 + i * 4.3, 2.0, OPEN.zNear - 0.12);
    group.add(frame);
    addSprite(group, animated, i % 2 ? '#ff78c8' : '#ffaa55', frame.position.x, 2.0, frame.position.z - 0.12, 0.8, 0.18, 'glow');
  }
  addRunner(group, 0, -4.6, 5.2, 12.4, 0x3b1128);
  for (let i = 0; i < 7; i++) {
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.0, 6), gold);
    rope.rotation.z = Math.PI / 2;
    rope.position.set(-6 + i * 2, 0.72, -8.3);
    group.add(rope);
  }
  for (let row = 0; row < 3; row++) for (let col = 0; col < 8; col++) {
    const chair = makeChair();
    chair.position.set(-7 + col * 2, 0, 0.5 - row * 2.2);
    chair.rotation.y = Math.PI;
    group.add(chair);
  }
  for (let i = 0; i < 8; i++) {
    const man = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.8, 4, 8), mat(0x141114, 0.8, 0.0));
    body.position.y = 1.0; man.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), mat(0x2b2528, 0.7, 0.0, 0x080203, 0.25));
    head.position.y = 1.62; man.add(head);
    man.position.set(-9 + (i % 6) * 3.6, 0, -9.5 - Math.floor(i / 6) * 3.1);
    man.userData.anim = { type: 'focus', seed: rand() * 20, base: 1 };
    group.add(man); animated.push(man); field.addCircle(man.position.x, man.position.z, 0.35);
  }
  for (let z = 2; z >= -15; z -= 4.5) addHangingFlame(group, flames, -9.8, z, 3.5, 0xff78c8, 0.42, 5.2);
  // warm picture-lights down the opposite wall so the framed canvases read
  for (let z = 0; z >= -16; z -= 4.5) addHangingFlame(group, flames, 9.8, z, 3.5, 0xffb060, 0.34, 4.8);
  ctx.triggers.push({ x: 0, z: -10.5, r: 2.4, once: true, onEnter: (c) => {
    c.audio.hush(1.1);
    c.director.shadowFold?.(new THREE.Vector3(0, 1.2, -13.8), { life: 0.95, scale: 1.3 });
  } });
  ctx.triggers.push({ x: 0, z: -14.2, r: 2.2, once: true, onEnter: (c) => { c.audio.stinger('growl'); c.player.addShake(0.35); } });
  addObjectInteraction(ctx, group, animated, spec, 0, -14.2, 'handle');
}

function decorateChapel(group, field, flames, animated, spec, rand, ctx) {
  const pewMat = mat(0x23120c, 0.8, 0.12);
  const boneMat = mat(0x8d806e, 0.55, 0.0);
  for (let row = 0; row < 7; row++) for (const sx of [-1, 1]) {
    const pew = addLowBox(group, field, sx * 4.2, 1.6 - row * 2.7, 5.2, 0.42, 0.58, pewMat);
    pew.rotation.y = sx * 0.02;
  }
  const altar = addLowBox(group, field, 0, -17.2, 4.8, 1.5, 1.0, mat(0x2b2020, 0.72, 0.2));
  altar.position.y = 0.5;
  addCandlePool(group, flames, 0, -17.2, 20, 2.4, 0xff5533);
  addRunner(group, 0, -5.0, 3.2, 20.0, 0x331010);
  for (let z = 4.0; z >= -17.5; z -= 3.2) {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(5.4, 0.055, 6, 22, Math.PI), boneMat);
    arch.position.set(0, 3.1, z);
    arch.rotation.set(Math.PI / 2, 0, 0);
    group.add(arch);
  }
  for (let i = 0; i < 10; i++) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.2 + i * 0.22, 10), mat(0x2a2522, 0.35, 0.75));
    pipe.position.set(-5.2 + i * 0.45, 1.1 + i * 0.11, -18.6);
    group.add(pipe);
  }
  for (let i = 0; i < 4; i++) {
    const conf = new THREE.Group();
    const woodM = mat(0x1b0b08, 0.8, 0.18);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 1.0), woodM); box.position.y = 1.1; conf.add(box);
    const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ color: 0x050000, transparent: true, opacity: 0.9 }));
    slit.position.set(0, 1.35, -0.51); conf.add(slit);
    conf.position.set(i % 2 ? 11.4 : -11.4, 0, -1.5 - Math.floor(i / 2) * 8.0);
    conf.rotation.y = i % 2 ? -Math.PI / 2 : Math.PI / 2;
    group.add(conf); field.addCircle(conf.position.x, conf.position.z, 0.9);
  }
  for (let i = 0; i < 24; i++) {
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13 + rand() * 0.04, 8, 8), boneMat);
    skull.scale.y = 0.75;
    skull.position.set(-11.5 + rand() * 23, 0.16, -1 - rand() * 16);
    group.add(skull);
  }
  for (let i = 0; i < 5; i++) {
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.4), new THREE.MeshBasicMaterial({
      color: [0xff2233, 0x2266ff, 0xffcc44, 0x33ffaa, 0xaa55ff][i],
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
    }));
    glass.position.set(-8 + i * 4, 2.4, OPEN.zFar - 0.16);
    group.add(glass);
  }
  for (let z = 3; z >= -17; z -= 4) addHangingFlame(group, flames, 0, z, 4.2, 0xff5533, 0.5, 6);
  ctx.triggers.push({ x: 0, z: -6, r: 2.5, once: true, onEnter: (c) => { c.audio.moan(new THREE.Vector3(0, 3, -18)); c.audio.bumpHeart(0.45, 92); } });
  ctx.triggers.push({ x: 8, z: -11, r: 2.1, once: true, onEnter: (c) => {
    c.audio.slam(new THREE.Vector3(11, 1.5, -9));
    if (!c.director.crabSkitter?.()) c.director.darkEyes?.(new THREE.Vector3(11.2, 1.55, -9), { force: true, life: 0.9 });
  } });
  addObjectInteraction(ctx, group, animated, spec, 0, -17.2, 'token');
}

const DECOR = {
  conservatory: decorateConservatory,
  library: decorateLibrary,
  nursery: decorateNursery,
  bathhouse: decorateBathhouse,
  gallery: decorateGallery,
  chapel: decorateChapel,
};

// Give the MAZE INTERIOR its identity + baseline light. Runs on every NON-path
// cell. Two layers, both freeze-safe (emissive materials + additive sprites +
// mat()-cached shared materials — ZERO added point lights):
//   1. a dim zone-tinted floor glow on EVERY non-path cell, so dead-end corridors
//      are never the pitch black you got lost in;
//   2. a distinct SILHOUETTE motif on a fraction of cells, on a different axis per
//      zone (vertical / overhead / low-horizontal / wall-mounted) so no two wings'
//      corridors read the same.
function decorateMazeCell(group, field, flames, animated, spec, rand, x, y, cols, isPath) {
  if (isPath) return;
  const cx = wx(x, cols) + (rand() - 0.5) * 0.9;
  const cz = wz(y) + (rand() - 0.5) * 0.9;

  // (1) never-pitch-black guarantee: a faint floor pool in the zone's colour
  addSprite(group, animated, spec.floorGlow, wx(x, cols), 0.16, wz(y), 0.62, 0.14, 'glow');

  // (2) signature motif (sparse)
  if (rand() > spec.clutter) return;
  if (spec.name === 'conservatory') {
    // VERTICAL: a drowned vine dangling into the corridor from the dark ceiling
    const vine = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 1.5, 4, 6), mat(0x17351f, 0.86, 0.02, 0x0c2e18, 0.30));
    vine.position.set(cx, spec.mazeH - 0.95, cz); vine.rotation.z = (rand() - 0.5) * 0.5; group.add(vine);
    if (rand() < 0.6) addSprite(group, animated, '#7dff9a', cx, 1.5 + rand() * 0.6, cz, 0.5, 0.12, 'glow');
  } else if (spec.name === 'library') {
    // LOW/HORIZONTAL: a spilled pile of glowing amber book-spines on the floor...
    const bookMat = mat(0x2a160a, 0.8, 0.05, 0x3a1c08, 0.26);
    for (let b = 0; b < 3; b++) {
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.24), bookMat);
      book.position.set(cx + (rand() - 0.5) * 0.5, 0.05 + b * 0.055, cz + (rand() - 0.5) * 0.4);
      book.rotation.y = rand() * Math.PI; group.add(book);
    }
    // ...threaded with the signature COLD violet mote (the one thing separating library from chapel)
    addSprite(group, animated, '#b492ff', cx, 1.5 + rand() * 0.6, cz, 0.55, 0.17, 'glow');
  } else if (spec.name === 'nursery') {
    // OVERHEAD: a swaying mobile dangling into the beam (nursery's tell — NOT eyes, those are gallery's)
    const mobile = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 5), mat(0x3b252c, 0.6, 0.2));
    stem.position.y = -0.3; mobile.add(stem);
    const charmMat = mat(0x6a2338, 0.8, 0.0, 0x361016, 0.32);
    for (let c = 0; c < 2; c++) {
      const charm = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), charmMat);
      charm.position.set((c - 0.5) * 0.22, -0.62, 0); mobile.add(charm);
    }
    mobile.position.set(cx, spec.mazeH - 0.5, cz);
    mobile.userData.anim = { type: 'swing', seed: rand() * 30, base: 1 };
    group.add(mobile); animated.push(mobile);
  } else if (spec.name === 'bathhouse') {
    // LOW/HORIZONTAL: a knee-high glowing cyan grout seam + rising steam
    const seam = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.05), mat(0x1c5866, 0.3, 0.4, 0x0e414d, 0.34));
    seam.position.set(cx, 0.5, cz); seam.rotation.y = rand() * Math.PI; group.add(seam);
    addSprite(group, animated, '#8eefff', cx, 0.6, cz, 1.0, 0.14, 'steam');
  } else if (spec.name === 'gallery') {
    // WALL-MOUNTED WATCHER: a propped portrait whose hollow eyes glow at you (eyes HIGH ~1.2m)
    const portrait = new THREE.Group();
    const canvas = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.02), mat(0x160512, 0.9, 0.0, 0x24081c, 0.14));
    portrait.add(canvas);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.84, 1.24, 0.06), mat(0x6a4a1e, 0.45, 0.5));
    frame.position.z = -0.04; portrait.add(frame);
    portrait.position.set(cx, 0.86, cz); portrait.rotation.y = rand() * Math.PI * 2; group.add(portrait);
    addSprite(group, animated, '#ff86dc', cx - 0.08, 1.18, cz, 0.12, 0.6, 'glow');
    addSprite(group, animated, '#ff86dc', cx + 0.08, 1.18, cz, 0.12, 0.6, 'glow');
  } else {
    // chapel — OVERHEAD: a bone half-arch ribbing the ceiling; a SPARSE low red votive
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.04, 6, 16, Math.PI), mat(0x8d806e, 0.58, 0.0));
    arch.position.set(cx, spec.mazeH - 0.35, cz); arch.rotation.set(Math.PI / 2, 0, rand() < 0.5 ? 0 : Math.PI / 2); group.add(arch);
    if (rand() < 0.45) addSprite(group, animated, '#ff3a1e', cx + (rand() - 0.5) * 0.6, 0.28, cz + (rand() - 0.5) * 0.6, 0.55, 0.3, 'glow');
  }
}

const ROUTE_DIRS = [
  { name: 'N', dx: 0, dy: -1 },
  { name: 'S', dx: 0, dy: 1 },
  { name: 'E', dx: 1, dy: 0 },
  { name: 'W', dx: -1, dy: 0 },
];

function cellKey(x, y) { return `${x},${y}`; }

function linkCells(links, ax, ay, bx, by) {
  links.add(`${ax},${ay}:${bx},${by}`);
  links.add(`${bx},${by}:${ax},${ay}`);
}

function hasLink(links, x, y, dir) {
  return links.has(`${x},${y}:${x + dir.dx},${y + dir.dy}`);
}

function makeTwistedRoute(path, cols, rows, rand) {
  const open = new Set(path.map(([x, y]) => cellKey(x, y)));
  const pathKeys = new Set(open);
  const links = new Set();
  const pockets = [];
  for (let i = 1; i < path.length; i++) linkCells(links, path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);

  let pocketCount = 0;
  for (let i = 2; i < path.length - 2 && pocketCount < 8; i += 2 + Math.floor(rand() * 3)) {
    const [x, y] = path[i];
    const prev = path[i - 1], next = path[i + 1];
    const mx = next[0] - prev[0], my = next[1] - prev[1];
    const preferred = Math.abs(mx) > Math.abs(my)
      ? ROUTE_DIRS.filter((d) => d.dy)
      : ROUTE_DIRS.filter((d) => d.dx);
    const pool = preferred.concat(ROUTE_DIRS).filter((d, idx, arr) => arr.findIndex((v) => v.name === d.name) === idx);
    const choices = pool
      .map((d) => ({ d, r: rand() }))
      .sort((a, b) => a.r - b.r)
      .map((v) => v.d)
      .filter((d) => {
        const nx = x + d.dx, ny = y + d.dy;
        return nx >= 0 && nx < cols && ny >= 0 && ny < rows && !pathKeys.has(cellKey(nx, ny)) && !open.has(cellKey(nx, ny));
      });
    if (!choices.length) continue;
    const d = choices[0], px = x + d.dx, py = y + d.dy;
    open.add(cellKey(px, py));
    linkCells(links, x, y, px, py);
    pockets.push({ x: px, y: py, fromX: x, fromY: y });
    pocketCount++;
    if (rand() > 0.58 && pocketCount < 8) {
      const tail = ROUTE_DIRS
        .map((td) => ({ d: td, r: rand() }))
        .sort((a, b) => a.r - b.r)
        .map((v) => v.d)
        .find((td) => {
          const nx = px + td.dx, ny = py + td.dy;
          return nx >= 0 && nx < cols && ny >= 0 && ny < rows && !pathKeys.has(cellKey(nx, ny)) && !open.has(cellKey(nx, ny));
        });
      if (tail) {
        const tx = px + tail.dx, ty = py + tail.dy;
        open.add(cellKey(tx, ty));
        linkCells(links, px, py, tx, ty);
        pockets.push({ x: tx, y: ty, fromX: px, fromY: py });
        pocketCount++;
      }
    }
  }
  return { open, links, pockets };
}

function addRouteWall(group, field, wallsMade, x, y, dir, cols, h, material) {
  const cx = wx(x, cols), cz = wz(y);
  const key = dir.name === 'N' ? `H:${x}:${y}`
    : dir.name === 'S' ? `H:${x}:${y + 1}`
      : dir.name === 'W' ? `V:${x}:${y}`
        : `V:${x + 1}:${y}`;
  if (wallsMade.has(key)) return;
  wallsMade.add(key);
  // maze interior walls are NOT dressed (dress=false) — there are too many of them
  if (dir.name === 'N') wall(group, field, cx, cz + CELL / 2, CELL, TH, h, material, 2, false);
  else if (dir.name === 'S') wall(group, field, cx, cz - CELL / 2, CELL, TH, h, material, 2, false);
  else if (dir.name === 'E') wall(group, field, cx + CELL / 2, cz, TH, CELL, h, material, 2, false);
  else wall(group, field, cx - CELL / 2, cz, TH, CELL, h, material, 2, false);
}

function routeFrame(path, i, cols) {
  const cur = path[i];
  const prev = path[Math.max(0, i - 1)];
  const next = path[Math.min(path.length - 1, i + 1)];
  let dx = next[0] - prev[0], dy = next[1] - prev[1];
  if (!dx && !dy && i > 0) { dx = cur[0] - prev[0]; dy = cur[1] - prev[1]; }
  if (!dx && !dy && i < path.length - 1) { dx = next[0] - cur[0]; dy = next[1] - cur[1]; }
  const ux = dx, uz = -dy;
  const len = Math.hypot(ux, uz) || 1;
  const nx = ux / len, nz = uz / len;
  return {
    x: wx(cur[0], cols), z: wz(cur[1]),
    ux: nx, uz: nz,
    px: -nz, pz: nx,
    horiz: Math.abs(nx) >= Math.abs(nz),
  };
}

function addRouteBlock(group, field, frame, side, len, depth, h, material, inset = 0.9) {
  const x = frame.x + frame.px * side * inset;
  const z = frame.z + frame.pz * side * inset;
  return addLowBox(group, field, x, z, frame.horiz ? len : depth, frame.horiz ? depth : len, h, material);
}

function addCrawlGate(group, field, frame, material, crawlZones, color = '#ff8aae') {
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(frame.horiz ? 2.65 : 0.18, 0.12, frame.horiz ? 0.18 : 2.65),
    material,
  );
  beam.position.set(frame.x, 0.92, frame.z);
  beam.castShadow = true; beam.receiveShadow = true;
  group.add(beam);
  const p1 = addRouteBlock(group, field, frame, 1, 0.34, 0.34, 0.88, material, 1.28);
  const p2 = addRouteBlock(group, field, frame, -1, 0.34, 0.34, 0.88, material, 1.28);
  p1.position.y = 0.44; p2.position.y = 0.44;
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(2.15, 0.76), new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.96,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    emissive: 0x16050b,
    emissiveIntensity: 0.16,
  }));
  cloth.position.set(frame.x, 0.68, frame.z);
  cloth.rotation.y = frame.horiz ? 0 : Math.PI / 2;
  group.add(cloth);
  crawlZones.push({ x: frame.x, z: frame.z, r: 1.38 });
}

function addRouteSetpieces(group, field, flames, animated, spec, rand, route, path, cols) {
  const crawlZones = [];
  const marks = [0.08, 0.20, 0.34, 0.50, 0.68, 0.84]
    .map((m) => Math.max(1, Math.min(path.length - 2, Math.floor(path.length * m))))
    .filter((v, i, arr) => arr.indexOf(v) === i);
  const mats = {
    root: mat(0x18341f, 0.88, 0.02, 0x061208, 0.12),
    soil: mat(0x21180f, 0.96, 0.0),
    shelf: mat(0x231106, 0.76, 0.1),
    cloth: mat(0x442436, 0.98, 0.0, 0x15060d, 0.14),
    tile: mat(0x172d34, 0.28, 0.25),
    brass: mat(0x6c4c22, 0.46, 0.5),
    pew: mat(0x24110b, 0.82, 0.12),
    bone: mat(0x8d806e, 0.58, 0.0),
  };

  const entry = routeFrame(path, Math.min(1, path.length - 2), cols);
  addFloorStain(group, spec, entry.x, entry.z, 1.9, 0.9, spec.seed + 11, spec.surface === 'wet' ? 0.55 : 0.36);
  if (spec.name === 'conservatory') {
    for (let i = -1; i <= 1; i++) {
      const vine = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 2.2 + rand() * 0.9, 4, 6), mats.root);
      vine.position.set(entry.x + entry.px * i * 0.55, spec.mazeH - 1.0, entry.z + entry.pz * i * 0.55);
      vine.rotation.set(0.35 + rand() * 0.35, rand() * Math.PI, (rand() - 0.5) * 0.8);
      group.add(vine);
    }
  } else if (spec.name === 'library') {
    const fallen = makeShelf(1.55);
    fallen.position.set(entry.x + entry.px * 0.85, 0, entry.z + entry.pz * 0.85);
    fallen.rotation.y = entry.horiz ? 0.18 : Math.PI / 2 + 0.18;
    fallen.rotation.z = -0.18;
    fallen.traverse((o) => { if (o.isMesh) o.material = mats.shelf; });
    group.add(fallen); field.addCircle(fallen.position.x, fallen.position.z, 0.48);
  } else if (spec.name === 'nursery') {
    addCrawlGate(group, field, entry, mats.cloth, crawlZones, '#ff8fb1');
  } else if (spec.name === 'bathhouse') {
    for (let i = -1; i <= 1; i++) addSprite(group, animated, '#b7f8ff', entry.x + entry.px * i * 0.75, 0.72, entry.z + entry.pz * i * 0.75, 1.05, 0.15, 'steam');
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.55, 8), mats.tile);
    pipe.position.set(entry.x, 1.95, entry.z);
    pipe.rotation.set(entry.horiz ? 0 : Math.PI / 2, 0, entry.horiz ? Math.PI / 2 : 0);
    group.add(pipe);
  } else if (spec.name === 'gallery') {
    addRouteBlock(group, field, entry, 1, 1.35, 0.18, 0.22, mats.brass, 1.0).position.y = 0.72;
    addSprite(group, animated, '#ff78c8', entry.x - entry.px * 0.95, 1.15, entry.z - entry.pz * 0.95, 0.85, 0.11, 'glow');
  } else {
    const f = makeFlame(0xff5533, 0.35, 3.6);
    f.position.set(entry.x - entry.px * 0.55, 0.18, entry.z - entry.pz * 0.55);
    group.add(f); flames.push(f);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.04, 6, 20, Math.PI), mats.bone);
    arch.position.set(entry.x, 1.9, entry.z);
    arch.rotation.set(Math.PI / 2, 0, entry.horiz ? 0 : Math.PI / 2);
    group.add(arch);
  }

  marks.forEach((idx, n) => {
    const frame = routeFrame(path, idx, cols);
    const side = n % 2 ? -1 : 1;
    addFloorStain(group, spec, frame.x + frame.ux * 0.32, frame.z + frame.uz * 0.32, 1.25 + rand() * 1.2, 0.55 + rand() * 0.8, spec.seed + n * 23, spec.surface === 'wet' ? 0.52 : 0.34);
    if (spec.name === 'conservatory') {
      const planter = addRouteBlock(group, field, frame, side, 1.65, 0.58, 0.54, mats.soil);
      planter.position.y = 0.27;
      const stem = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 1.7 + rand() * 0.8, 4, 6), mats.root);
      stem.position.set(planter.position.x, 1.1, planter.position.z);
      stem.rotation.set(0.25 + rand() * 0.4, rand() * Math.PI, (rand() - 0.5) * 0.55);
      group.add(stem);
      addSprite(group, animated, '#6effb2', planter.position.x, 1.65, planter.position.z, 0.72, 0.11, 'glow');
      if (n === 2) addCrawlGate(group, field, frame, mats.root, crawlZones, '#5bffb0');
    } else if (spec.name === 'library') {
      const shelf = makeShelf(1.75);
      shelf.position.set(frame.x + frame.px * side * 0.86, 0, frame.z + frame.pz * side * 0.86);
      shelf.rotation.y = frame.horiz ? 0 : Math.PI / 2;
      shelf.traverse((o) => { if (o.isMesh) o.material = mats.shelf; });
      group.add(shelf); field.addCircle(shelf.position.x, shelf.position.z, 0.56);
      for (let b = 0; b < 5; b++) {
        const book = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.055, 0.27), mat([0x4b1d18, 0x26354b, 0x4b3b18, 0x2d462b][b % 4], 0.82, 0.03));
        book.position.set(frame.x - frame.px * side * (0.05 + b * 0.08), 0.06 + b * 0.04, frame.z - frame.pz * side * (0.05 + b * 0.08));
        book.rotation.y = rand() * Math.PI;
        group.add(book);
      }
      if (n === 3) addCrawlGate(group, field, frame, mats.shelf, crawlZones, '#27140c');
    } else if (spec.name === 'nursery') {
      if (n === 1 || n === 4) addCrawlGate(group, field, frame, mats.cloth, crawlZones, '#ff8fb1');
      else {
        const crib = addRouteBlock(group, field, frame, side, 1.45, 0.72, 0.58, mats.cloth, 0.82);
        crib.position.y = 0.29;
        for (let s = -0.45; s <= 0.45; s += 0.18) {
          const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.72, 5), mats.cloth);
          bar.rotation.x = Math.PI / 2;
          bar.position.set(crib.position.x + (frame.horiz ? s : 0), 0.78, crib.position.z + (frame.horiz ? 0 : s));
          group.add(bar);
        }
      }
    } else if (spec.name === 'bathhouse') {
      const basin = addRouteBlock(group, field, frame, side, 1.55, 0.68, 0.24, mats.tile, 0.88);
      basin.position.y = 0.12;
      const water = new THREE.Mesh(new THREE.PlaneGeometry(frame.horiz ? 1.25 : 0.48, frame.horiz ? 0.48 : 1.25), new THREE.MeshStandardMaterial({
        color: 0x498090, roughness: 0.04, metalness: 0.58, transparent: true, opacity: 0.46,
      }));
      water.rotation.x = -Math.PI / 2;
      water.position.set(basin.position.x, 0.26, basin.position.z);
      group.add(water);
      addSprite(group, animated, '#a5f7ff', basin.position.x, 0.68, basin.position.z, 0.95, 0.14, 'steam');
      if (n === 2) addCrawlGate(group, field, frame, mats.tile, crawlZones, '#9cecff');
    } else if (spec.name === 'gallery') {
      const man = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.78, 4, 8), mat(0x121015, 0.86, 0.0));
      body.position.y = 0.92; man.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mat(0x262126, 0.74, 0.0, 0x080206, 0.18));
      head.position.y = 1.55; man.add(head);
      man.position.set(frame.x + frame.px * side * 0.92, 0, frame.z + frame.pz * side * 0.92);
      man.rotation.y = rand() * Math.PI;
      man.userData.anim = { type: 'focus', seed: rand() * 40, base: 1 };
      group.add(man); animated.push(man); field.addCircle(man.position.x, man.position.z, 0.34);
      const rope = addRouteBlock(group, field, frame, -side, 1.22, 0.12, 0.18, mats.brass, 1.04);
      rope.position.y = 0.72;
      if (n === 2) addCrawlGate(group, field, frame, mats.brass, crawlZones, '#ff78c8');
    } else {
      const pew = addRouteBlock(group, field, frame, side, 1.85, 0.46, 0.52, mats.pew, 0.86);
      pew.position.y = 0.26;
      const arch = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.045, 6, 20, Math.PI), mats.bone);
      arch.position.set(frame.x, 2.05, frame.z);
      arch.rotation.set(Math.PI / 2, 0, frame.horiz ? 0 : Math.PI / 2);
      group.add(arch);
      if (n === 3) addCrawlGate(group, field, frame, mats.bone, crawlZones, '#ff6440');
    }
  });

  route.pockets.forEach((pocket, i) => {
    const x = wx(pocket.x, cols), z = wz(pocket.y);
    addFloorStain(group, spec, x, z, 1.1 + rand() * 1.4, 0.7 + rand() * 1.0, spec.seed + 200 + i * 19, spec.surface === 'wet' ? 0.48 : 0.28);
    if (spec.name === 'conservatory') {
      addSprite(group, animated, '#78ffd0', x, 1.25, z, 1.15, 0.12, 'glow');
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.48, 0.62, 12), mats.soil);
      pot.position.set(x, 0.31, z); pot.castShadow = true; group.add(pot); field.addCircle(x, z, 0.34);
    } else if (spec.name === 'library') {
      const table = makeTable(1.3, 0.85, 0.68);
      table.position.set(x, 0, z); table.rotation.y = rand() * Math.PI; group.add(table); field.addCircle(x, z, 0.58);
      if (i % 2 === 0) { const f = makeFlame(0xffaa55, 0.36, 3.8); f.position.set(x, 0.85, z); group.add(f); flames.push(f); }
    } else if (spec.name === 'nursery') {
      const doll = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mat(0x8a6870, 0.78, 0.0, 0x160407, 0.22));
      doll.scale.y = 1.35; doll.position.set(x, 0.34, z); group.add(doll); field.addCircle(x, z, 0.24);
      addSprite(group, animated, '#ff8aa8', x, 0.82, z, 0.45, 0.13, 'glow');
    } else if (spec.name === 'bathhouse') {
      addSprite(group, animated, '#b7f8ff', x, 0.62, z, 1.25, 0.16, 'steam');
      const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.035, 16), mat(0x0b1214, 0.38, 0.8));
      drain.position.set(x, 0.035, z); group.add(drain);
    } else if (spec.name === 'gallery') {
      const frame = makeGrandPainting(10 + i, 0.8, 1.05);
      frame.position.set(x, 1.55, z); frame.rotation.y = rand() * Math.PI; group.add(frame);
    } else {
      const grave = makeGravestone();
      grave.position.set(x, 0, z); grave.rotation.y = rand() * Math.PI; group.add(grave); field.addCircle(x, z, 0.34);
      if (i % 2 === 0) { const f = makeFlame(0xff5533, 0.28, 3.6); f.position.set(x + 0.3, 0.16, z - 0.25); group.add(f); flames.push(f); }
    }
  });

  return { crawlZones };
}

function addOpenRoom(group, field, flames, animated, spec, rand, ctx, materials) {
  const w = OPEN.halfW * 2;
  const d = OPEN.zNear - OPEN.zFar;
  const zc = (OPEN.zNear + OPEN.zFar) / 2;
  floorPlane(group, 0, zc, w, d, materials.floor);
  ceilPlane(group, 0, zc, w, d, spec.h, spec.ceiling);
  wall(group, field, -OPEN.halfW, zc, TH, d, spec.h, materials.wall);
  wall(group, field, OPEN.halfW, zc, TH, d, spec.h, materials.wall);
  wall(group, field, 0, OPEN.zNear, w, TH, spec.h, materials.wall);
  wall(group, field, -9, OPEN.zFar, 10, TH, spec.h, materials.wall);
  wall(group, field, 9, OPEN.zFar, 10, TH, spec.h, materials.wall);
  for (const x of [-10.8, 10.8]) for (const z of [4.0, -5.5, -15]) addPillar(group, field, x, z, spec.h, materials.trim, 0.26);
  const decor = DECOR[spec.name];
  if (decor) decor(group, field, flames, animated, spec, rand, ctx, materials);
}

function addMazeAndExit(group, field, flames, animated, spec, rand, ctx, materials) {
  const cols = spec.cols, rows = spec.rows;
  const start = { x: Math.floor(cols / 2), y: 0 };
  const maze = generateMaze(cols, rows, spec.seed, spec.braid);
  const exitCell = farthestBoundary(maze, start);
  const exit = pickExit(exitCell, cols, rows);
  const path = pathTo(maze, start, exitCell);
  const pathSet = new Set(path.map(([x, y]) => `${x},${y}`));
  const route = makeTwistedRoute(path, cols, rows, rand);
  const minX = wx(0, cols) - CELL / 2, maxX = wx(cols - 1, cols) + CELL / 2;
  const minZ = wz(rows - 1) - CELL / 2, maxZ = wz(0) + CELL / 2;
  floorPlane(group, (minX + maxX) / 2, (minZ + maxZ) / 2, maxX - minX, maxZ - minZ, materials.mazeFloor);
  ceilPlane(group, (minX + maxX) / 2, (minZ + maxZ) / 2, maxX - minX, maxZ - minZ, spec.mazeH, spec.ceiling);
  wall(group, field, -CORRIDOR_W, -21.2, TH, 2.4, spec.h, materials.trim);
  wall(group, field, CORRIDOR_W, -21.2, TH, 2.4, spec.h, materials.trim);

  // Build walls for the WHOLE grid from the real maze, not just the solution
  // path. Every cell becomes a junction, dead-end, or branch you can wander
  // into — so these levels are actual labyrinths you can get lost in, not a lit
  // corridor through empty floor. addRouteWall dedupes shared walls.
  const wallsMade = new Set();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      for (const dir of ROUTE_DIRS) {
        if (x === start.x && y === start.y && dir.name === 'N') continue;   // entrance
        if (x === exitCell.x && y === exitCell.y && dir.name === exit.name) continue; // exit to key corridor
        if (!maze.cells[x][y][dir.name]) addRouteWall(group, field, wallsMade, x, y, dir, cols, spec.mazeH, materials.wall);
      }
      const isMainPath = pathSet.has(`${x},${y}`);
      if (isMainPath) addPathDetail(group, flames, animated, spec, rand, x, y, cols);
      else decorateMazeCell(group, field, flames, animated, spec, rand, x, y, cols, false);
    }
  }

  const traversal = addRouteSetpieces(group, field, flames, animated, spec, rand, route, path, cols);
  addGuidance(group, flames, path, cols, spec.guidance, THREE.MathUtils.clamp((spec.index - 4) / 5, 0, 1));
  addPathTrail(group, path, cols, spec);

  // The threshold guardian stands on EITHER the key or the door (alternating, so
  // it's never the same beat two wings running). You can see your objective — the
  // Presence is standing on it, looming larger the nearer you come — and you have
  // to walk up to it anyway.
  const guardKey = spec.index % 2 === 0;
  const guardType = ['shriek', 'shriekHard', 'growl'][spec.index % 3];

  const key = makeKey(spec.keyTone);
  const kx = wx(exitCell.x, cols), kz = wz(exitCell.y);
  key.position.set(kx, 0.92, kz);
  group.add(key);
  const plinth = addLowBox(group, field, kx, kz, 0.8, 0.8, 0.55, materials.trim);
  plinth.position.y = 0.275;
  ctx.interactables.push({
    object: key,
    pos: new THREE.Vector3(kx, 0.95, kz),
    radius: 1.75,
    once: true,
    focusable: true,
    canUse: () => true,
    onUse: (state, c) => {
      group.remove(key);
      state.inventory.add(spec.key);
      if (guardKey) c.director.dismissGuardian(guardType);   // it was standing right here
      else c.director.pickupScare(new THREE.Vector3(kx, 1, kz));
      c.audio.setTension(Math.min(1, 0.62 + spec.index * 0.035));
    },
  });

  const len = spec.linear;
  const sx = kx + exit.x * (CELL / 2 + len / 2);
  const sz = kz + exit.z * (CELL / 2 + len / 2);
  if (exit.z) {
    floorPlane(group, sx, sz, CORRIDOR_W * 2.25, len, materials.linearFloor);
    ceilPlane(group, sx, sz, CORRIDOR_W * 2.25, len, spec.mazeH, spec.ceiling);
    wall(group, field, sx - CORRIDOR_W, sz, TH, len + TH, spec.mazeH, materials.trim);
    wall(group, field, sx + CORRIDOR_W, sz, TH, len + TH, spec.mazeH, materials.trim);
  } else {
    floorPlane(group, sx, sz, len, CORRIDOR_W * 2.25, materials.linearFloor);
    ceilPlane(group, sx, sz, len, CORRIDOR_W * 2.25, spec.mazeH, spec.ceiling);
    wall(group, field, sx, sz - CORRIDOR_W, len + TH, TH, spec.mazeH, materials.trim);
    wall(group, field, sx, sz + CORRIDOR_W, len + TH, TH, spec.mazeH, materials.trim);
  }
  addLinearDressing(group, flames, animated, spec, sx, sz, exit, len);
  const fakeX = kx + exit.x * (CELL / 2 + len * 0.32);
  const fakeZ = kz + exit.z * (CELL / 2 + len * 0.32);
  const ghostX = kx + exit.x * (CELL / 2 + len * 0.72) - exit.z * 0.72;
  const ghostZ = kz + exit.z * (CELL / 2 + len * 0.72) + exit.x * 0.72;
  ctx.triggers.push({ x: fakeX, z: fakeZ, r: 1.4, once: true, onEnter: (c) => {
    c.audio.hush(0.95);
    c.audio.bumpHeart(0.35, 88);
    c.director._after(() => c.director.witness?.(ghostX, ghostZ, {
      life: 3.8,
      dwell: 0.24,
      intensity: 0.58 + spec.index * 0.025,
      hush: false,
    }), 420);   // _after so a level change cancels it
  } });
  for (let i = 1; i <= 5; i++) {
    const lx = kx + exit.x * (CELL / 2 + i * (len / 6));
    const lz = kz + exit.z * (CELL / 2 + i * (len / 6));
    const f = makeFlame(i % 2 ? spec.guidance : 0xff7a32, 0.34 + i * 0.02, 3.8);
    f.position.set(lx + (exit.z ? (i % 2 ? -0.85 : 0.85) : 0), 0.35, lz + (exit.x ? (i % 2 ? -0.85 : 0.85) : 0));
    group.add(f); flames.push(f);
    if (i === 3) ctx.triggers.push({ x: lx, z: lz, r: 1.25, once: true, onEnter: (c) => {
      c.audio.hush(0.8); c.director.crossPath(lx - exit.z * 1.2, lz + exit.x * 1.2, lx + exit.z * 1.2, lz - exit.x * 1.2);
    } });
  }

  const dx = exit.x, dz = exit.z;
  const doorX = kx + dx * (CELL / 2 + len - 0.25);
  const doorZ = kz + dz * (CELL / 2 + len - 0.25);
  const door = makeDoor(1.9, 2.55, 0.12);
  door.position.set(doorX - (dz ? 0.95 : 0), 0, doorZ - (dx ? 0.95 : 0));
  door.rotation.y = dz ? 0 : -Math.PI / 2;
  door.userData.baseRot = door.rotation.y;
  group.add(door);
  const blocker = dz
    ? field.addDynamicBox(doorX - 1.05, doorZ - 0.12, doorX + 1.05, doorZ + 0.12, 2)
    : field.addDynamicBox(doorX - 0.12, doorZ - 1.05, doorX + 0.12, doorZ + 1.05, 2);
  ctx.interactables.push({
    object: door,
    pos: new THREE.Vector3(doorX - dx * 0.55, 1.25, doorZ - dz * 0.55),
    radius: 2.35,
    focusable: true,
    canUse: (state) => state.inventory.has(spec.key),
    lockedHint: true,
    onUse: (state, c) => {
      blocker.active = false;
      door.userData.targetAngle = -Math.PI * 0.55;
      c.audio.doorCreak(new THREE.Vector3(doorX, 1, doorZ));
      if (!guardKey) c.director.dismissGuardian(guardType);   // it was barring the door
      c.ui.blink(90, 420);
      setTimeout(() => c.go(spec.next), 360);
    },
  });

  // raise the guardian as you close on its post (the key, or the door it bars)
  const gx = guardKey ? kx : doorX - dx * 0.7;
  const gz = guardKey ? kz : doorZ - dz * 0.7;
  ctx.triggers.push({ x: gx, z: gz, r: 4.3, once: true, onEnter: (c) => { c.director.sentinelAt(gx, gz); } });

  return { key, door, exit, exitCell, cols, rows, crawlZones: traversal.crawlZones, nextAmbientAt: 0 };
}

const SPECS = {
  conservatory: {
    index: 4, name: 'conservatory', next: 'library', seed: 5017, cols: 7, rows: 5, braid: 0.55,
    key: 'glasskey', keyTone: 'glass', guidance: 0x7affcc, focusColor: 0x68ffc4, h: 5.4, mazeH: 3.6,
    wall: 0x426e60, trim: 0x162520, floor: 'stone', mazeFloor: 'stone', linearFloor: 'stone',
    ceiling: 0x05130d, clutter: 0.46, linear: 18, surface: 'wet',
    // maze-interior identity: yellow-green self-glow (kept distinct from bathhouse cyan)
    wallEmis: 0x123a1a, wallEmisI: 0.20, floorEmis: 0x0a2c18, floorEmisI: 0.13, floorGlow: '#4bd98a', poolSize: 12,
  },
  library: {
    index: 5, name: 'library', next: 'nursery', seed: 6129, cols: 7, rows: 6, braid: 0.60,
    key: 'inkkey', keyTone: 'ink', guidance: 0xb492ff, focusColor: 0x9783ff, h: 4.4, mazeH: 3.2,
    wall: 0x2a1710, trim: 0x1b0f08, floor: 'wood', mazeFloor: 'wood', linearFloor: 'wood',
    ceiling: 0x0a0604, clutter: 0.44, linear: 19, surface: 'dry',
    // maze-interior identity: warm rotting-amber walls + cold violet motes (the only warm zone with a cold accent)
    wallEmis: 0x3a1c08, wallEmisI: 0.22, floorEmis: 0x1a0c04, floorEmisI: 0.13, floorGlow: '#b48a3a', poolSize: 14,
  },
  nursery: {
    index: 6, name: 'nursery', next: 'bathhouse', seed: 7031, cols: 7, rows: 7, braid: 0.64,
    key: 'rosekey', keyTone: 'rose', guidance: 0xff7aa5, focusColor: 0xff83aa, h: 4.0, mazeH: 3.0,
    wall: 0x2b1724, trim: 0x211018, floor: 'wood', mazeFloor: 'wood', linearFloor: 'wood',
    ceiling: 0x1a0810, clutter: 0.40, linear: 18, surface: 'dry',
    // maze-interior identity: warm peach-rose (deliberately WARMER than gallery's cold violet) + overhead swaying mobiles
    wallEmis: 0x36121a, wallEmisI: 0.22, floorEmis: 0x220a10, floorEmisI: 0.11, floorGlow: '#d98aa0', poolSize: 14,
  },
  bathhouse: {
    index: 7, name: 'bathhouse', next: 'gallery', seed: 8843, cols: 7, rows: 7, braid: 0.68,
    key: 'porcelainkey', keyTone: 'porcelain', guidance: 0x8eefff, focusColor: 0x9df2ff, h: 4.3, mazeH: 2.85,
    wall: 0x14272f, trim: 0x0e1b21, floor: 'stone', mazeFloor: 'stone', linearFloor: 'stone',
    ceiling: 0x061c22, clutter: 0.32, linear: 20, surface: 'wet',
    // maze-interior identity: pure cyan (pushed off conservatory's green) + low horizontal grout glow + steam
    wallEmis: 0x08313f, wallEmisI: 0.21, floorEmis: 0x08313d, floorEmisI: 0.15, floorGlow: '#5ad0e0', poolSize: 14,
  },
  gallery: {
    index: 8, name: 'gallery', next: 'chapel', seed: 9451, cols: 7, rows: 7, braid: 0.72,
    key: 'silverkey', keyTone: 'silver', guidance: 0xff86dc, focusColor: 0xff79d4, h: 4.7, mazeH: 3.4,
    wall: 0x251226, trim: 0x130812, floor: 'wood', mazeFloor: 'wood', linearFloor: 'wood',
    ceiling: 0x0a0410, clutter: 0.42, linear: 20, surface: 'dry',
    // maze-interior identity: cold violet-magenta + framed portraits whose hollow eyes glow at you (eyes HIGH, ~1.2m)
    wallEmis: 0x2a0a24, wallEmisI: 0.22, floorEmis: 0x1a0612, floorEmisI: 0.12, floorGlow: '#c060b0', poolSize: 14,
  },
  chapel: {
    index: 9, name: 'chapel', next: 'final', seed: 10007, cols: 7, rows: 7, braid: 0.76,
    key: 'blackkey', keyTone: 'black', guidance: 0xff5330, focusColor: 0xff2c24, h: 5.8, mazeH: 3.6,
    wall: 0x2a1515, trim: 0x190b0b, floor: 'stone', mazeFloor: 'stone', linearFloor: 'flesh',
    ceiling: 0x0c0203, clutter: 0.46, linear: 22, surface: 'wet',
    // maze-interior identity: blood-red stone + overhead bone half-arches + SPARSE low red votives (kept sparse so cells still alternate lit/black — dread)
    wallEmis: 0x2a0806, wallEmisI: 0.20, floorEmis: 0x1a0604, floorEmisI: 0.12, floorGlow: '#d04030', poolSize: 14,
  },
};

const WITNESS_SPOTS = {
  conservatory: { trigger: [0, 1.5], spawn: [9.5, -14.8], intensity: 0.45 },
  library:      { trigger: [-2.5, -1.0], spawn: [-10.8, -14.6], intensity: 0.52 },
  nursery:      { trigger: [1.5, -1.0], spawn: [8.6, -13.8], intensity: 0.58 },
  bathhouse:    { trigger: [-2.0, -2.0], spawn: [10.2, -15.0], intensity: 0.62 },
  gallery:      { trigger: [0, -5.5], spawn: [-6.4, -15.0], intensity: 0.66 },
  chapel:       { trigger: [0, -4.0], spawn: [0, -18.7], intensity: 0.72 },
};

function materialSet(spec) {
  const floorTex = spec.floor === 'ground' ? groundTexture() : spec.floor === 'stone' ? stoneTexture() : woodFloorTexture();
  const mazeTex = spec.mazeFloor === 'ground' ? groundTexture() : spec.mazeFloor === 'stone' ? stoneTexture() : woodFloorTexture();
  const linearTex = spec.linearFloor === 'flesh' ? fleshTexture() : spec.linearFloor === 'stone' ? stoneTexture() : woodFloorTexture();
  const wallTex = spec.name === 'conservatory' ? groundTexture() : (spec.name === 'chapel' || spec.name === 'bathhouse') ? stoneTexture() : wallpaperTexture();
  const floorBump = spec.surface === 'wet' ? 0.065 : spec.floor === 'ground' ? 0.078 : 0.042;
  const mazeBump = spec.surface === 'wet' ? 0.072 : spec.mazeFloor === 'ground' ? 0.082 : 0.046;
  const linearBump = spec.linearFloor === 'flesh' ? 0.095 : spec.surface === 'wet' ? 0.076 : 0.044;
  const wallBump = spec.name === 'conservatory' ? 0.09
    : spec.name === 'bathhouse' ? 0.07
    : spec.name === 'chapel' ? 0.06
    : 0.038;
  // Per-spec maze-interior self-glow: makes the undressed corridor walls read in
  // the zone's own colour WITHOUT a flashlight — this is what gives each maze its
  // identity and keeps corridors from going pure black off-aim. Emissive costs
  // zero lights. Values live on each SPEC (wallEmis/wallEmisI).
  const wallEmissive = spec.wallEmis ?? 0x000000;
  const wallMaterial = new THREE.MeshStandardMaterial({
    map: wallTex,
    bumpMap: wallTex,
    bumpScale: wallBump,
    color: spec.wall,
    roughness: spec.name === 'conservatory' ? 0.32 : spec.name === 'bathhouse' ? 0.42 : 0.88,
    metalness: spec.name === 'conservatory' ? 0.18 : spec.name === 'bathhouse' ? 0.18 : 0.06,
    emissive: wallEmissive,
    emissiveIntensity: spec.wallEmisI ?? 0.07,
  });
  wallMaterial.userData.detailSpec = spec;
  const trimMaterial = mat(spec.trim, 0.72, 0.18);
  trimMaterial.userData.detailSpec = spec;
  const floorEmissive = spec.surface === 'wet' ? 0x061417 : spec.name === 'library' ? 0x080407 : spec.name === 'nursery' ? 0x0b0308 : spec.name === 'gallery' ? 0x090308 : 0x000000;
  return {
    floor: new THREE.MeshStandardMaterial({ map: floorTex, bumpMap: floorTex, bumpScale: floorBump, color: 0xffffff, roughness: spec.floor === 'stone' ? 0.24 : 0.68, metalness: spec.floor === 'stone' ? 0.24 : 0.04, emissive: floorEmissive, emissiveIntensity: spec.surface === 'wet' ? 0.08 : 0.035 }),
    mazeFloor: new THREE.MeshStandardMaterial({ map: mazeTex, bumpMap: mazeTex, bumpScale: mazeBump, color: 0xffffff, roughness: spec.mazeFloor === 'stone' ? 0.28 : 0.66, metalness: spec.mazeFloor === 'stone' ? 0.24 : 0.04, emissive: spec.floorEmis ?? floorEmissive, emissiveIntensity: spec.floorEmisI ?? (spec.surface === 'wet' ? 0.10 : 0.04) }),
    linearFloor: new THREE.MeshStandardMaterial({ map: linearTex, bumpMap: linearTex, bumpScale: linearBump, color: 0xffffff, roughness: 0.30, metalness: spec.linearFloor === 'wood' ? 0.06 : 0.26, emissive: spec.linearFloor === 'flesh' ? 0x160002 : floorEmissive, emissiveIntensity: spec.linearFloor === 'flesh' ? 0.35 : spec.surface === 'wet' ? 0.11 : 0.045 }),
    wall: wallMaterial,
    trim: trimMaterial,
  };
}

function buildDeepLevel(spec, ctx) {
  _matCache = {};                    // fresh shared-material cache for this level
  const group = new THREE.Group();
  const field = new ColliderField(CELL);
  const rand = rng(spec.seed * 17);
  const flames = [];
  const animated = [];
  const materials = materialSet(spec);

  addOpenRoom(group, field, flames, animated, spec, rand, ctx, materials);
  // An approach trail down the centre of the open room to the maze mouth, so you
  // can SEE where to go from the moment you arrive — the open rooms had no
  // guidance and you'd wander them lost (zone 4 especially).
  for (const z of [4, -1.5, -7, -12.5, -18]) {
    const f = makeFlame(spec.guidance, 0.6, 7.5);
    f.position.set(0, 0.22, z); f.scale.setScalar(0.78);
    group.add(f); flames.push(f);
  }
  const dynamic = addMazeAndExit(group, field, flames, animated, spec, rand, ctx, materials);

  // Collapse this level's 40-90 ember lights onto a small shared pool. Every
  // ember keeps its sprite glow (the followable trail); only the nearest dozen
  // cast real light, which follows the player. Keeps the scene's point-light
  // count tiny and CONSTANT so shaders compile once, in the load fade — no
  // mid-level recompile stalls. (See poolifyFlames in props.js.)
  const flamePool = makeFlamePool(spec.poolSize ?? 12);   // per-spec: 14 for the big wings, 12 for conservatory (its domeGlow keeps it <=18 lights)
  group.add(flamePool);
  const pooledFlames = poolifyFlames(flames);

  const zone = CFG.zones[spec.name];
  const witnessSpot = WITNESS_SPOTS[spec.name];

  ctx.triggers.push({ x: 0, z: -17.5, r: 2.0, once: true, onEnter: (c) => {
    c.audio.setTension(Math.min(1, 0.48 + spec.index * 0.035));
    c.audio.whisper(new THREE.Vector3(0, 1.4, -19));
  } });
  if (witnessSpot) ctx.triggers.push({ x: witnessSpot.trigger[0], z: witnessSpot.trigger[1], r: 2.25, once: true, onEnter: (c) => {
    c.audio.hush(0.85);
    c.director._after(() => c.director.witness?.(witnessSpot.spawn[0], witnessSpot.spawn[1], {
      life: 5.2,
      dwell: 0.34,
      intensity: witnessSpot.intensity,
      hush: false,
    }), 320);   // _after so a level change cancels it
  } });
  ctx.triggers.push({ x: wx(Math.floor(spec.cols / 2), spec.cols), z: MAZE_Z, r: 1.5, once: true, onEnter: (c) => {
    c.audio.hush(0.9);
    c.director._after(() => c.director.peripheral(), 650);   // _after so a level change cancels it
  } });

  function update(dt, t, player) {
    updateFlamePool(pooledFlames, flamePool.userData.poolLights, player.pos.x, player.pos.z, t);
    player.crawl = dynamic.crawlZones.some((z) => Math.hypot(player.pos.x - z.x, player.pos.z - z.z) < z.r);
    if (dynamic.key.parent) {
      dynamic.key.rotation.y += dt * (1.0 + spec.index * 0.02);
      dynamic.key.position.y = 0.94 + Math.sin(t * 2.1 + spec.seed) * 0.04;
    }
    if (dynamic.door.userData && dynamic.door.userData.targetAngle !== undefined) {
      dynamic.door.userData.angle += (dynamic.door.userData.targetAngle - dynamic.door.userData.angle) * Math.min(1, dt * 2.5);
      dynamic.door.rotation.y = dynamic.door.userData.baseRot + dynamic.door.userData.angle;
    }
    for (const obj of animated) {
      const a = obj.userData.anim; if (!a) continue;
      if (a.type === 'steam') {
        obj.position.y += Math.sin(t * 0.7 + a.seed) * dt * 0.06;
        const k = a.base * (0.85 + Math.sin(t * 0.9 + a.seed) * 0.18);
        obj.scale.set(k * 1.2, k, 1);
        obj.material.opacity = a.opacity * (0.72 + Math.sin(t * 1.2 + a.seed) * 0.22);
      } else if (a.type === 'swing') {
        obj.rotation.z = Math.sin(t * 0.9 + a.seed) * 0.18;
        obj.rotation.y = Math.sin(t * 0.5 + a.seed) * 0.25;
      } else if (a.type === 'focus') {
        const k = 1 + Math.sin(t * 2.1 + a.seed) * 0.035;
        obj.scale.setScalar(k);
      } else if (a.type === 'glow') {
        obj.material.opacity = a.opacity * (0.8 + Math.sin(t * 1.8 + a.seed) * 0.2);
      }
    }
    if (t > dynamic.nextAmbientAt) {
      dynamic.nextAmbientAt = t + (spec.surface === 'wet' ? 5.8 + rand() * 7.5 : 7.5 + rand() * 9.5);
      const p = player.pos;
      if (spec.surface === 'wet') ctx.audio.drip(new THREE.Vector3(p.x + (Math.random() - 0.5) * 8, 1.8, p.z + (Math.random() - 0.5) * 8));
      else ctx.audio.creak(new THREE.Vector3(p.x + (Math.random() - 0.5) * 10, 1.5, p.z + (Math.random() - 0.5) * 10));
    }
  }

  return {
    name: spec.name,
    group,
    field,
    flames,
    surface: spec.surface,
    spawn: { x: 0, z: 5.8, yaw: 0 },
    fog: { color: zone.fog, density: zone.fogDensity },
    ambient: { color: zone.ambient, intensity: zone.ambientI },
    sky: zone.sky,
    update,
    onEnter: (c) => {
      c.audio.setTension(Math.min(1, 0.34 + spec.index * 0.035));
      // NB: chapel used to call director.guard(0,-19) here, which left the single
      // shared Presence permanently visible at the maze mouth — and _updateHunt
      // only begins a stalk when the Presence is free. That silently suppressed
      // the chapel's whole Hunt (its highest intensity, 0.92) for the entire
      // traversal. Removed so the deepest level actually hunts you; the threshold
      // guardian on the key/door still delivers the "walk up to it" dread.
    },
  };
}

export function buildConservatory(ctx) { return buildDeepLevel(SPECS.conservatory, ctx); }
export function buildLibrary(ctx) { return buildDeepLevel(SPECS.library, ctx); }
export function buildNursery(ctx) { return buildDeepLevel(SPECS.nursery, ctx); }
export function buildBathhouse(ctx) { return buildDeepLevel(SPECS.bathhouse, ctx); }
export function buildGallery(ctx) { return buildDeepLevel(SPECS.gallery, ctx); }
export function buildChapel(ctx) { return buildDeepLevel(SPECS.chapel, ctx); }
