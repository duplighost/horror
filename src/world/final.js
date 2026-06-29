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
  const eyeTex = eyeballTexture();
  const sclera = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 36),
    new THREE.MeshStandardMaterial({ map: eyeTex, bumpMap: eyeTex, bumpScale: 0.045, roughness: 0.18, metalness: 0.0, emissive: 0x180404, emissiveIntensity: 0.35 }));
  g.add(sclera);
  const look = new THREE.Group(); g.add(look);
  const iris = new THREE.Mesh(new THREE.CircleGeometry(R * 0.44, 40),
    new THREE.MeshStandardMaterial({ color: 0x4a0808, emissive: 0xc01510, emissiveIntensity: 1.4, roughness: 0.4 }));
  iris.position.z = R * 0.9; look.add(iris);
  const pupil = new THREE.Mesh(new THREE.CircleGeometry(R * 0.19, 40), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  pupil.position.z = R * 0.92; look.add(pupil);
  const glow = new THREE.PointLight(0xff1414, 0.0, 24, 2); glow.position.z = R; g.add(glow);

  // two fleshy lids that part as it opens
  const lidTex = fleshTexture();
  const lidMat = new THREE.MeshStandardMaterial({ map: lidTex, bumpMap: lidTex, bumpScale: 0.075, roughness: 0.8, emissive: 0x0a0000, emissiveIntensity: 0.3 });
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
  const wetFloorTex = stoneTexture();
  const wallFleshTex = fleshTexture();
  const wetFloorMat = new THREE.MeshStandardMaterial({ map: wetFloorTex, bumpMap: wetFloorTex, bumpScale: 0.075, color: 0x4a4044, roughness: 0.16, metalness: 0.35 });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallFleshTex, bumpMap: wallFleshTex, bumpScale: 0.095, color: 0x6a5a5a, roughness: 0.7, emissive: 0x0a0001, emissiveIntensity: 0.25 });

  const H = 4.0;
  // The final opens wide before it tightens: a ritual antechamber, a rib-maze,
  // then the straight throat to the altar. It mirrors the whole game in one room.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 40), wetFloorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -14); floor.receiveShadow = true; group.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(16, 40), new THREE.MeshStandardMaterial({ color: 0x050203 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H, -14); group.add(ceil);

  // antechamber + rib-maze side walls
  wall(group, field, -7, -5, 0.4, 22, H, wallMat);
  wall(group, field, 7, -5, 0.4, 22, H, wallMat);
  wall(group, field, 0, 6, 14, 0.4, H, wallMat);
  // alternating baffles make a simple, readable final maze: one path, strong silhouettes.
  const ribTex = fleshTexture();
  const ribMat = new THREE.MeshStandardMaterial({ map: ribTex, bumpMap: ribTex, bumpScale: 0.09, color: 0x4c363a, roughness: 0.72, emissive: 0x160002, emissiveIntensity: 0.3 });
  for (let i = 0; i < 5; i++) {
    const z = 0.8 - i * 3.0;
    if (i % 2 === 0) wall(group, field, 1.45, z, 10.7, 0.28, H, ribMat);
    else wall(group, field, -1.45, z, 10.7, 0.28, H, ribMat);
  }
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

  // The antechamber holds nine mute memories of the places behind you.
  const memoryLights = [];
  const memoryColors = [0x7affcc, 0xffaa44, 0xff2020, 0x80ffd8, 0xb492ff, 0xff7aa5, 0x8eefff, 0xff86dc, 0xff5330];
  for (let i = 0; i < 9; i++) {
    const side = i % 2 ? 1 : -1;
    const row = Math.floor(i / 2);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x130b0c, roughness: 0.7, metalness: 0.25 });
    const glowMat = new THREE.MeshBasicMaterial({ color: memoryColors[i], transparent: true, opacity: 0.0, side: THREE.DoubleSide });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.4, 1.25), frameMat);
    frame.position.set(side * 6.75, 1.2, 3.0 - row * 2.0);
    group.add(frame);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.1), glowMat);
    pane.position.set(side * 6.52, 1.25, 3.0 - row * 2.0);
    pane.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(pane);
    memoryLights.push({ pane, glowMat, seed: i * 0.7 });
  }

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
  for (let z = 4.5; z >= -15; z -= 1.3) { candleAt(-5.65, 0, z); candleAt(5.65, 0, z); }       // antechamber / maze walls
  for (let i = 0; i < 5; i++) {                                                                 // candles in the real baffle gaps
    const z = -0.7 - i * 3.0;
    const x = i % 2 === 0 ? -5.15 : 5.15;
    candleAt(x, 0, z); candleAt(x * 0.82, 0, z - 0.55);
  }
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
    onUse: (state, c) => {
      if (ended) return; ended = true;
      // Hide the relic but KEEP its PointLight in the scene (driven to 0 in
      // update once taken). Removing the light here would drop the scene's
      // light count and force a full shader recompile right as the ending
      // detonates — a freeze at the worst possible moment.
      relic.userData.taken = true;
      relic.userData.light.intensity = 0;
      relic.traverse((o) => { if (o.isMesh) o.visible = false; });
      c.director.dismissGuardian('shriekHard');   // the altar guardian folds away AS the ending detonates — one event
      c.director.beginEnding(relicPos.clone(), eye);
    },
  });

  // the guardian stands right on the altar/relic, so the loom and the eye's
  // proximity dread climb on the SAME target as you make the final approach.
  const guardPos = { x: 0, z: -25.6 };

  eye.userData.memoryLights = memoryLights;
  eye.userData.endBloom = 0;

  const zc = CFG.zones.final;
  let crescendoFired = false;
  let midBeatFired = false;

  function update(dt, t, player) {
    // candle flicker (cheap — just sprite scale/opacity)
    for (const c of candles) {
      const cd = c.userData.candle;
      const n = Math.sin(t * 14 + cd.seed) * 0.5 + Math.sin(t * 6.1 + cd.seed * 2) * 0.5;
      cd.spr.scale.set(0.08 + n * 0.02, 0.15 + n * 0.04, 1);
      cd.spr.material.opacity = 0.75 + n * 0.25;
    }
    // relic pulse (stops once taken; the light object stays at 0 so the count
    // never changes)
    if (relic.parent && !relic.userData.taken) {
      const k = 1 + Math.sin(t * 2.4) * 0.12;
      relic.scale.setScalar(k); relic.rotation.y += dt * 0.4;
      relic.userData.light.intensity = 10 + Math.sin(t * 6) * 3;
    }
    // proximity dread — the whole point. 0 (far) .. 1 (at the altar)
    const dz = player.pos.x - relicPos.x, dx2 = player.pos.z - relicPos.z;
    const dRelic = Math.hypot(dz, dx2);
    const near = THREE.MathUtils.clamp(1 - (dRelic - 1.2) / 12, 0, 1);

    // the eye opens as you near, pupil fixes on you, glow swells. Once the
    // ending sequence begins (endBloom>0) the Director's scripted beats OWN the
    // eye and the post FX — so we stop driving them from proximity here, or the
    // two fight each other every frame.
    const ud = eye.userData;
    const ending = ud.endBloom > 0;
    if (!ending) ud.openness += (Math.pow(near, 1.3) - ud.openness) * Math.min(1, dt * 1.5);
    // the lids always follow openness (whoever set it)
    ud.top.position.y = ud.lidH / 2 + ud.openness * ud.lidH * 1.05;
    ud.bot.position.y = -ud.lidH / 2 - ud.openness * ud.lidH * 1.05;
    if (!ending) {
      // a faint breathing under-glow even while SHUT, so the eye looms red
      // through the fog as a thing to approach long before it opens.
      const breath = 2.6 + Math.sin(t * 0.85) * 1.3;
      ud.glow.intensity = Math.max(breath, ud.openness * 55 + Math.sin(t * 9) * ud.openness * 10);
      ud.pupil.scale.setScalar(0.7 + ud.openness * 0.6 + Math.sin(t * 3) * 0.05);
    }
    // iris/pupil track the player (kept running through the ending — it keeps staring)
    const epos = new THREE.Vector3(); eye.getWorldPosition(epos);
    const ang = Math.atan2(player.pos.x - epos.x, (player.pos.z - epos.z));
    const pitch = Math.atan2(player.camera.position.y - epos.y, Math.hypot(player.pos.x - epos.x, player.pos.z - epos.z));
    ud.look.rotation.y = THREE.MathUtils.clamp(ang, -0.6, 0.6);
    ud.look.rotation.x = THREE.MathUtils.clamp(-pitch, -0.4, 0.4);

    if (!ending) {
      // drive the global dread from proximity
      ctx.post.set('dread', near * 0.85);
      ctx.post.set('tunnel', Math.pow(near, 1.5) * 0.8);
      ctx.post.set('desat', 0.25 + near * 0.4);
      ctx.audio.setTension(Math.max(ctx.audio.tension, near));
      ctx.audio.bumpHeart(near, 70 + near * 70);
      if (near > 0.18) player.addShake(near * 0.05);
      // it gets physically harder to move the closer you get
      player.speedScale = 1 - near * 0.55;

      // a mid-approach lurch: the lids crack a sliver and the iris snaps to you,
      // a single heavy beat — the "almost too scary to take" threshold before the
      // real open. Fires once.
      if (!midBeatFired && near > 0.52) {
        midBeatFired = true;
        ud.openness = Math.max(ud.openness, 0.16);
        ud.glow.intensity = 26;
        ctx.audio.hush(0.7); ctx.audio.bumpHeart(0.85, 104);
        ctx.post.kick('pulse', 0.4); player.addShake(0.3);
      }
      if (!crescendoFired && near > 0.25) { crescendoFired = true; ctx.audio.crescendo(16); }
    }

    if (eye.userData.endBloom > 0) {
      eye.userData.endBloom = Math.min(1, eye.userData.endBloom + dt * 0.18);
      const b = eye.userData.endBloom;
      for (const m of eye.userData.memoryLights) {
        m.glowMat.opacity = Math.min(0.85, b * (0.35 + Math.sin(t * 4 + m.seed) * 0.18 + 0.5));
      }
      wallMat.emissiveIntensity = 0.25 + b * (0.8 + Math.sin(t * 5) * 0.2);
      wetFloorMat.emissive.setHex(0x220006);
      wetFloorMat.emissiveIntensity = b * 0.22;
    }
  }

  return {
    name: 'final', group, field, flames: [],
    spawn: { x: 0, z: 5.2, yaw: 0 },       // facing -Z, through the antechamber toward the eye
    fog: { color: zc.fog, density: zc.fogDensity },
    ambient: { color: zc.ambient, intensity: zc.ambientI },
    sky: zc.sky, update,
    onEnter: (c) => { c.director.sentinelAt(guardPos.x, guardPos.z); },   // a real sentinel so the breath/dread ramp as you cross to the altar
  };
}
