import * as THREE from 'three';
import { ColliderField } from '../collision.js';
import { CFG } from '../config.js';
import { eyeballTexture, stoneTexture, fleshTexture, softDot } from '../textures.js';
import { makeRelic, makeFlame } from './props.js';

// a cheap candle: an additive flame sprite + a tiny wax stub, NO light. We
// scatter dozens of these and back them with only a handful of real lights.
let _candleTex = null;
function makeCandle(h = 0.12) {
  if (!_candleTex) _candleTex = softDot('#ffcf87');
  const g = new THREE.Group();
  const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, h, 6),
    new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 1, emissive: 0x140a02, emissiveIntensity: 0.3 }));
  wax.position.y = h / 2; g.add(wax);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: _candleTex, color: 0xffb24a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  spr.scale.set(0.09, 0.16, 1); spr.position.y = h + 0.05; g.add(spr);
  g.userData.candle = { spr, seed: Math.random() * 100, base: 0.16 };
  return g;
}

// The end. A long throat of a corridor opens into a chamber where the far wall
// is a single colossal EYE. It is shut. As you near the altar — and the small
// wet thing waiting on it — the eye begins to open, and everything in you says
// do not go closer. You have to anyway.

function wall(group, field, x, z, sx, sz, h, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), mat);
  m.position.set(x, h / 2, z); m.castShadow = true; m.receiveShadow = true; group.add(m);
  field.addBox(x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2, 2);
  return m;
}

function buildEye() {
  const g = new THREE.Group();
  const R = 2.8;
  const sclera = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 36),
    new THREE.MeshStandardMaterial({ map: eyeballTexture(), roughness: 0.18, metalness: 0.0, emissive: 0x180404, emissiveIntensity: 0.35 }));
  g.add(sclera);
  const look = new THREE.Group(); g.add(look);
  const iris = new THREE.Mesh(new THREE.CircleGeometry(R * 0.44, 40),
    new THREE.MeshStandardMaterial({ color: 0x4a0808, emissive: 0xc01510, emissiveIntensity: 1.4, roughness: 0.4 }));
  iris.position.z = R * 0.9; look.add(iris);
  const pupil = new THREE.Mesh(new THREE.CircleGeometry(R * 0.19, 40), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  pupil.position.z = R * 0.92; look.add(pupil);
  const glow = new THREE.PointLight(0xff1414, 0.0, 24, 2); glow.position.z = R; g.add(glow);

  // two fleshy lids that part as it opens
  const lidMat = new THREE.MeshStandardMaterial({ map: fleshTexture(), roughness: 0.8, emissive: 0x0a0000, emissiveIntensity: 0.3 });
  const lidH = R * 1.5, lidW = R * 2.8;
  const top = new THREE.Mesh(new THREE.BoxGeometry(lidW, lidH, 0.3), lidMat);
  const bot = new THREE.Mesh(new THREE.BoxGeometry(lidW, lidH, 0.3), lidMat);
  top.position.set(0, lidH / 2, R * 0.96); bot.position.set(0, -lidH / 2, R * 0.96);
  g.add(top); g.add(bot);

  g.userData = { sclera, look, iris, pupil, glow, top, bot, lidH, R, openness: 0 };
  return g;
}

export function buildFinal(ctx) {
  const group = new THREE.Group();
  const field = new ColliderField(4);

  // materials — wet, near-black
  const wetFloorMat = new THREE.MeshStandardMaterial({ map: stoneTexture(), color: 0x4a4044, roughness: 0.16, metalness: 0.35 });
  const wallMat = new THREE.MeshStandardMaterial({ map: fleshTexture(), color: 0x6a5a5a, roughness: 0.7, emissive: 0x0a0001, emissiveIntensity: 0.25 });

  const H = 4.0;
  // corridor: z 2 -> -16, width 3
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 40), wetFloorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -14); floor.receiveShadow = true; group.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(16, 40), new THREE.MeshStandardMaterial({ color: 0x050203 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H, -14); group.add(ceil);

  // corridor walls
  wall(group, field, -1.8, -7, 0.4, 18, H, wallMat);
  wall(group, field, 1.8, -7, 0.4, 18, H, wallMat);
  // chamber (x -6..6, z -16..-30)
  wall(group, field, -6, -23, 0.4, 14, H, wallMat);   // left
  wall(group, field, 6, -23, 0.4, 14, H, wallMat);    // right
  wall(group, field, 0, -30, 12, 0.4, H, wallMat);    // back (eye is set into this)
  // front wall of chamber with corridor gap
  wall(group, field, -4, -16, 4, 0.4, H, wallMat);
  wall(group, field, 4, -16, 4, 0.4, H, wallMat);

  // the EYE, set into the back wall
  const eye = buildEye(); eye.position.set(0, 2.5, -29.4); group.add(eye);

  // altar + relic
  const altar = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.0, 8),
    new THREE.MeshStandardMaterial({ map: stoneTexture(), color: 0x3a3438, roughness: 0.9 }));
  altar.position.set(0, 0.5, -25); altar.castShadow = true; altar.receiveShadow = true; group.add(altar);
  field.addCircle(0, -25, 0.72);
  const relic = makeRelic(); const relicPos = new THREE.Vector3(0, 1.2, -25); relic.position.copy(relicPos); group.add(relic);

  // two braziers framing the approach + a few real lights for the wet sheen
  ctx.flamesExtra = ctx.flamesExtra || [];
  for (const sx of [-1, 1]) {
    const f = makeFlame(0xff3311, 0.8, 7); f.position.set(sx * 4, 1.2, -20); group.add(f); ctx.flamesExtra.push(f);
    const f2 = makeFlame(0xff5522, 0.6, 6); f2.position.set(sx * 4.8, 0.4, -28); group.add(f2); ctx.flamesExtra.push(f2);
  }
  const altarGlow = makeFlame(0xff7733, 0.7, 5); altarGlow.position.set(0, 1.6, -25); group.add(altarGlow); ctx.flamesExtra.push(altarGlow);

  // a SEA of candles flanking the throat and ringing the altar (sprites only)
  const candles = [];
  function candleAt(x, y, z) { const c = makeCandle(0.08 + Math.random() * 0.1); c.position.set(x, y, z); group.add(c); candles.push(c); }
  for (let z = 1; z >= -15; z -= 1.3) { candleAt(-1.55, 0, z); candleAt(1.55, 0, z); }       // corridor walls
  for (let z = -16.5; z >= -24; z -= 1.4) { candleAt(-2.4 - Math.random(), 0, z); candleAt(2.4 + Math.random(), 0, z); } // chamber sides
  for (let i = 0; i < 14; i++) {                                                                // scattered pools near altar
    const a = Math.random() * Math.PI * 2, r = 1.4 + Math.random() * 2.2;
    candleAt(Math.cos(a) * r, 0, -25 + Math.sin(a) * r);
  }
  for (const sx of [-1, 1]) { candleAt(sx * 0.6, 1.0, -24.6); candleAt(sx * 0.35, 1.0, -25.0); } // on the altar itself

  // twisted roots clawing down the chamber walls (reference: the ritual hall)
  const rootMat = new THREE.MeshStandardMaterial({ color: 0x1a0f0a, roughness: 0.95 });
  for (let i = 0; i < 10; i++) {
    const sx = i % 2 ? 1 : -1;
    const pts = [];
    const baseZ = -17 - Math.random() * 12, topY = 1.5 + Math.random() * 2;
    for (let s = 0; s <= 6; s++) pts.push(new THREE.Vector3(sx * (5.9 - Math.sin(s) * 0.3), (s / 6) * topY, baseZ + Math.sin(s * 1.5) * 0.8));
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.04 + Math.random() * 0.05, 5, false);
    const root = new THREE.Mesh(tube, rootMat); root.castShadow = true; group.add(root);
  }

  // raise the altar on two stone steps
  for (let s = 0; s < 2; s++) {
    const step = new THREE.Mesh(new THREE.CylinderGeometry(1.6 - s * 0.4, 1.8 - s * 0.4, 0.2, 12),
      new THREE.MeshStandardMaterial({ map: stoneTexture(), color: 0x4a4448, roughness: 0.5, metalness: 0.2 }));
    step.position.set(0, 0.1 + s * 0.2, -25); step.receiveShadow = true; group.add(step);
  }

  let ended = false;
  ctx.interactables.push({
    object: relic, pos: relicPos.clone(), radius: 1.9, focusable: true, once: true,
    canUse: () => true,
    onUse: (state, c) => { if (ended) return; ended = true; group.remove(relic); c.director.beginEnding(relicPos.clone(), eye); },
  });

  // place the guardian over the altar the moment we arrive
  const guardPos = { x: 0, z: -27 };

  const zc = CFG.zones.final;
  let crescendoFired = false;

  function update(dt, t, player) {
    // candle flicker (cheap — just sprite scale/opacity)
    for (const c of candles) {
      const cd = c.userData.candle;
      const n = Math.sin(t * 14 + cd.seed) * 0.5 + Math.sin(t * 6.1 + cd.seed * 2) * 0.5;
      cd.spr.scale.set(0.08 + n * 0.02, 0.15 + n * 0.04, 1);
      cd.spr.material.opacity = 0.75 + n * 0.25;
    }
    // relic pulse
    if (relic.parent) {
      const k = 1 + Math.sin(t * 2.4) * 0.12;
      relic.scale.setScalar(k); relic.rotation.y += dt * 0.4;
      relic.userData.light.intensity = 10 + Math.sin(t * 6) * 3;
    }
    // proximity dread — the whole point. 0 (far) .. 1 (at the altar)
    const dz = player.pos.x - relicPos.x, dx2 = player.pos.z - relicPos.z;
    const dRelic = Math.hypot(dz, dx2);
    const near = THREE.MathUtils.clamp(1 - (dRelic - 1.2) / 12, 0, 1);

    // the eye opens as you near, pupil fixes on you, glow swells
    const ud = eye.userData;
    ud.openness += (Math.pow(near, 1.3) - ud.openness) * Math.min(1, dt * 1.5);
    ud.top.position.y = ud.lidH / 2 + ud.openness * ud.lidH * 1.05;
    ud.bot.position.y = -ud.lidH / 2 - ud.openness * ud.lidH * 1.05;
    ud.glow.intensity = ud.openness * 55 + Math.sin(t * 9) * ud.openness * 10;
    ud.pupil.scale.setScalar(0.7 + ud.openness * 0.6 + Math.sin(t * 3) * 0.05);
    // iris/pupil track the player
    const epos = new THREE.Vector3(); eye.getWorldPosition(epos);
    const ang = Math.atan2(player.pos.x - epos.x, (player.pos.z - epos.z));
    const pitch = Math.atan2(player.camera.position.y - epos.y, Math.hypot(player.pos.x - epos.x, player.pos.z - epos.z));
    ud.look.rotation.y = THREE.MathUtils.clamp(ang, -0.6, 0.6);
    ud.look.rotation.x = THREE.MathUtils.clamp(-pitch, -0.4, 0.4);

    // drive the global dread from proximity
    ctx.post.set('dread', near * 0.85);
    ctx.post.set('tunnel', Math.pow(near, 1.5) * 0.8);
    ctx.post.set('desat', 0.25 + near * 0.4);
    ctx.audio.setTension(Math.max(ctx.audio.tension, near));
    ctx.audio.bumpHeart(near, 70 + near * 70);
    if (near > 0.18) player.addShake(near * 0.05);
    // it gets physically harder to move the closer you get
    player.speedScale = 1 - near * 0.55;

    if (!crescendoFired && near > 0.25) { crescendoFired = true; ctx.audio.crescendo(16); }
  }

  return {
    name: 'final', group, field, flames: [],
    spawn: { x: 0, z: 0, yaw: 0 },         // facing -Z, down the throat toward the eye
    fog: { color: zc.fog, density: zc.fogDensity },
    ambient: { color: zc.ambient, intensity: zc.ambientI },
    sky: zc.sky, update,
    onEnter: (c) => { c.director.guard(guardPos.x, guardPos.z); },
  };
}
