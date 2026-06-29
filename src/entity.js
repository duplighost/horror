import * as THREE from 'three';

// The Presence. Not a man in a suit — a starved, broken thing: a hunched
// ribcage on too-thin legs, arms that hang past its knees ending in long
// fingers, and a head wrenched to one side around a hanging, gaping jaw. It
// twitches like bad stop-motion and its eyes are too bright. It is mostly
// silhouette; the flashlight reveals the wet pale flesh and the maw.

// push vertices around by cheap trig noise so nothing reads as a clean primitive
function malform(geo, amp, seed = 1) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 7.3 + seed) * Math.cos(y * 5.1 + seed * 2.1) * Math.sin(z * 6.7 + seed * 3.3)
            + Math.sin(y * 11.0 + seed) * 0.4;
    const k = 1 + n * amp;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

export class Entity {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;
    // The Presence's two point lights live on a SEPARATE rig that is ALWAYS
    // visible (intensity 0 when dormant). If they rode on `group`, hiding the
    // creature would drop the scene's point-light count by 2 — and three.js
    // bakes that count into every shader, so it would recompile EVERY material
    // the instant the creature appears or vanishes. That recompile is the
    // multi-hundred-ms "creature things" freeze. Keep the count constant.
    this.lightRig = new THREE.Group();
    // Set while the creature is revealed purely so compileAsync can warm its
    // shaders (see loadLevel). update() skips entirely so it never animates,
    // moves, or lights up — it just sits there to be compiled.
    this._warmup = false;
    this._build();
    this.mode = 'hidden';
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.speed = 0;
    this.phase = 0;
    this.observedTime = 0;
    this.lifetime = 0;
    this.dwell = 0.5;
    this.onReach = null;
    this.vanishSound = true;
    this.height = 2.2;
    this._twitchUntil = 0;
    this._twitch = new THREE.Vector3();
    this._stepT = 0;
    this.vanishing = false;
    this._vanishT = 0;
    this._vanishDur = 0.32;
    this._hasSkittered = false;
    this.crawlMove = false;
  }

  _build() {
    const g = this.group;
    // dark, wet, dead flesh — kept low-albedo so the torch reveals form instead
    // of blowing it out to a white blob at close range
    const flesh = new THREE.MeshPhysicalMaterial({ color: 0x090606, roughness: 0.58, metalness: 0.0, clearcoat: 0.42, clearcoatRoughness: 0.74, emissive: 0x070202, emissiveIntensity: 0.08 });
    const bone = new THREE.MeshStandardMaterial({ color: 0x18130f, roughness: 0.82 });
    const cavity = new THREE.MeshBasicMaterial({ color: 0x040203 });
    this.mawMat = new THREE.MeshPhysicalMaterial({ color: 0x2a0608, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.62, emissive: 0x4a0206, emissiveIntensity: 0.0 });
    const shadowSkin = new THREE.MeshStandardMaterial({ color: 0x171014, roughness: 0.8, metalness: 0.0, transparent: true, opacity: 0.62, depthWrite: false });
    const blackVeil = new THREE.MeshBasicMaterial({ color: 0x050304, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false });
    this.veinMat = new THREE.MeshStandardMaterial({ color: 0x3a0508, roughness: 0.36, emissive: 0x140002, emissiveIntensity: 0.12 });

    // --- pelvis + gaunt, hunched torso ---
    const pelvis = new THREE.Mesh(malform(new THREE.CapsuleGeometry(0.13, 0.16, 4, 8), 0.16, 5), flesh);
    pelvis.position.y = 0.98; g.add(pelvis);
    const torso = new THREE.Mesh(malform(new THREE.CapsuleGeometry(0.17, 0.85, 5, 12), 0.2, 3), flesh);
    torso.position.set(0.02, 1.35, 0); torso.scale.set(1, 1, 0.6); torso.rotation.x = 0.14; g.add(torso);
    this.torso = torso;
    this.veins = [];
    for (let i = 0; i < 6; i++) {
      const vein = new THREE.Mesh(new THREE.CapsuleGeometry(0.006 + (i % 2) * 0.003, 0.26 + i * 0.025, 2, 5), this.veinMat);
      vein.position.set((i - 2.5) * 0.04, 1.35 + Math.sin(i * 1.7) * 0.18, 0.112);
      vein.rotation.set(0.32 + i * 0.04, 0.12 * Math.sin(i), (i - 2.5) * 0.22);
      g.add(vein); this.veins.push(vein);
    }

    // exposed ribs across the chest
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.135 - i * 0.014, 0.011, 6, 12, Math.PI), bone);
      rib.position.set(0, 1.62 - i * 0.12, 0.05); rib.rotation.set(Math.PI / 2, 0, (i % 2 ? 1 : -1) * 0.06);
      g.add(rib);
    }
    // jutting collarbone / shoulder blades
    const clav = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.34, 3, 6), bone);
    clav.position.set(0, 1.76, 0.05); clav.rotation.z = Math.PI / 2; g.add(clav);

    // a crooked rib-halo on its back; it reads as antlers for one frame, then
    // as exposed anatomy the next. The ambiguity does a lot of the work.
    this.spines = [];
    for (let i = 0; i < 7; i++) {
      const sx = (i - 3) * 0.055;
      const spine = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.48 + Math.abs(i - 3) * 0.08, 3, 6), bone);
      spine.position.set(sx, 1.73 - Math.abs(i - 3) * 0.035, -0.09);
      spine.rotation.set(0.68 + Math.abs(i - 3) * 0.08, sx * 4.5, sx * 3.0);
      g.add(spine); this.spines.push(spine);
    }

    // --- head: a pivot the behaviour rotates, with a permanent broken tilt inside ---
    this.head = new THREE.Group(); this.head.position.set(0.04, 1.92, 0.01); g.add(this.head);
    const tilt = new THREE.Group(); tilt.rotation.set(0.16, 0.05, 0.26); this.head.add(tilt);   // wrenched to one side
    const skull = new THREE.Mesh(malform(new THREE.SphereGeometry(0.15, 18, 18), 0.16, 7), flesh);
    skull.scale.set(0.78, 1.28, 0.9); skull.position.z = 0.01; tilt.add(skull);

    // deep sockets with eyes set too far back, plus a third wrong one
    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xd8e0cf, emissiveIntensity: 1.7, roughness: 1 });
    const eyePts = [[-0.06, 0.03, 0.12], [0.065, 0.02, 0.12], [0.005, 0.11, 0.115]];
    eyePts.forEach((e, i) => {
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), cavity);
      socket.position.set(e[0], e[1], e[2] - 0.03); socket.scale.set(1, 1.3, 0.5); tilt.add(socket);
      // the eye sits proud of the socket opening so it glows even in full dark
      const eye = new THREE.Mesh(new THREE.SphereGeometry(i === 2 ? 0.015 : 0.023, 10, 10), this.eyeMat);
      eye.position.set(e[0], e[1], e[2] + 0.028); tilt.add(eye);
    });
    this.eyeLight = new THREE.PointLight(0xd8ffe8, 0.0, 4.8, 2);
    this.eyeLight.position.set(0.04, 1.95, 0.22);   // on the always-visible rig, at head height
    this.lightRig.add(this.eyeLight);

    // the maw: a vertical gash, with a hanging lower jaw and thin teeth
    const maw = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), this.mawMat);
    maw.scale.set(0.62, 1.7, 0.6); maw.position.set(0, -0.07, 0.1); tilt.add(maw);
    this.jaw = new THREE.Group(); this.jaw.position.set(0, -0.04, 0.05); tilt.add(this.jaw);
    const jawMesh = new THREE.Mesh(malform(new THREE.BoxGeometry(0.11, 0.13, 0.11), 0.18, 9), flesh);
    jawMesh.position.y = -0.085; this.jaw.add(jawMesh);
    for (let i = 0; i < 6; i++) {                 // teeth ringing the maw
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.04, 4), bone);
      const a = (i / 6) * Math.PI * 2;
      tooth.position.set(Math.cos(a) * 0.04, -0.02 + Math.sin(a) * 0.05, 0.12);
      tooth.rotation.x = Math.PI; tilt.add(tooth);
    }

    // a half-formed second face tucked into the shoulder. It should not be
    // readable at a distance; it is there for the flashlight to accidentally find.
    this.sideFace = new THREE.Group();
    this.sideFace.position.set(-0.19, 1.66, 0.04);
    this.sideFace.rotation.set(0.25, -0.72, -0.15);
    g.add(this.sideFace);
    const sideSkull = new THREE.Mesh(malform(new THREE.SphereGeometry(0.075, 12, 10), 0.2, 41), flesh);
    sideSkull.scale.set(0.65, 1.0, 0.8); this.sideFace.add(sideSkull);
    const sideEye = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 8), this.eyeMat);
    sideEye.position.set(-0.018, 0.018, 0.065); this.sideFace.add(sideEye);
    const sideMaw = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.06, 0.012), this.mawMat);
    sideMaw.position.set(0.012, -0.035, 0.066); this.sideFace.add(sideMaw);

    // --- arms: too long, asymmetric, bent, with splayed fingers ---
    this.arms = [];
    [[-1, 1.0, 11], [1, 1.18, 13]].forEach(([sx, len, seed]) => {
      const pivot = new THREE.Group(); pivot.position.set(sx * 0.16, 1.74, 0); g.add(pivot);
      const upper = new THREE.Mesh(malform(new THREE.CapsuleGeometry(0.038, 0.46 * len, 3, 6), 0.12, seed), flesh);
      upper.position.y = -0.26 * len; pivot.add(upper);
      const elbow = new THREE.Group(); elbow.position.y = -0.52 * len; elbow.rotation.x = 0.55; pivot.add(elbow);
      const fore = new THREE.Mesh(malform(new THREE.CapsuleGeometry(0.03, 0.46 * len, 3, 6), 0.12, seed + 1), flesh);
      fore.position.y = -0.26 * len; elbow.add(fore);
      const hand = new THREE.Group(); hand.position.y = -0.52 * len; elbow.add(hand);
      for (let f = 0; f < 4; f++) {
        const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.016, 0.2, 5), flesh);
        finger.geometry.translate(0, -0.1, 0);
        finger.position.set((f - 1.5) * 0.022, 0, 0.01); finger.rotation.x = 0.25 + f * 0.04; hand.add(finger);
      }
      this.arms.push(pivot);
    });

    // wrong extra limbs folded against the ribs: they only read in flashes, which
    // makes the silhouette feel less like one simple humanoid.
    for (let i = 0; i < 3; i++) {
      const sx = i === 1 ? 0 : (i === 0 ? -1 : 1);
      const limb = new THREE.Mesh(malform(new THREE.CapsuleGeometry(0.022, 0.85 + i * 0.18, 3, 6), 0.18, 31 + i), flesh);
      limb.position.set(sx * (0.12 + i * 0.04), 1.34 - i * 0.08, -0.06);
      limb.rotation.set(0.9 + i * 0.25, sx * 0.35, sx * (0.65 + i * 0.2));
      g.add(limb);
    }

    // hair/veil strips that drag behind the head and twitch independently.
    this.veils = [];
    for (let i = 0; i < 7; i++) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.04 + (i % 3) * 0.018, 0.85 + Math.random() * 0.6), shadowSkin);
      strip.position.set((i - 3) * 0.035, 1.62 - Math.random() * 0.25, -0.10 - Math.random() * 0.06);
      strip.rotation.set(0.2 + Math.random() * 0.3, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.5);
      g.add(strip); this.veils.push(strip);
    }

    // ragged black negative-space around the torso. These are unlit on purpose:
    // even under the flashlight the Presence should keep a wrong silhouette.
    this.rags = [];
    for (let i = 0; i < 9; i++) {
      const rag = new THREE.Mesh(new THREE.PlaneGeometry(0.055 + (i % 3) * 0.025, 1.0 + Math.random() * 0.7), blackVeil);
      rag.position.set((i - 4) * 0.045, 1.16 + Math.random() * 0.26, 0.03 + (i % 2) * 0.035);
      rag.rotation.set((Math.random() - 0.5) * 0.22, (Math.random() - 0.5) * 0.8, (i - 4) * 0.08);
      rag.renderOrder = 2;
      g.add(rag); this.rags.push(rag);
    }

    // a second eye cluster in the chest: visible for a split second under the
    // flashlight, then lost in the ribs.
    this.chestEyes = [];
    for (let i = 0; i < 5; i++) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012 + (i % 2) * 0.006, 8, 8), this.eyeMat);
      eye.position.set((i - 2) * 0.045, 1.48 + Math.sin(i) * 0.09, 0.16);
      g.add(eye); this.chestEyes.push(eye);
    }
    this.chestLight = new THREE.PointLight(0xff2430, 0.0, 3.8, 2);
    this.chestLight.position.set(0, 1.48, 0.2);
    this.lightRig.add(this.chestLight);

    // --- legs: thin, bent ---
    this.legs = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(sx * 0.08, 0.92, 0); g.add(pivot);
      const thigh = new THREE.Mesh(malform(new THREE.CapsuleGeometry(0.05, 0.38, 3, 6), 0.1, sx + 5), flesh);
      thigh.position.y = -0.21; pivot.add(thigh);
      const knee = new THREE.Group(); knee.position.y = -0.43; knee.rotation.x = -0.2; pivot.add(knee);
      const shin = new THREE.Mesh(malform(new THREE.CapsuleGeometry(0.038, 0.42, 3, 6), 0.1, sx + 7), flesh);
      shin.position.y = -0.22; knee.add(shin);
      this.legs.push(pivot);
    }

    // The Presence does not cast shadows (the torch reveals it directly). Cheap,
    // and future-proof if shadows are ever switched on.
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
  }

  addToScene(scene) { scene.add(this.group); scene.add(this.lightRig); }

  spawnAt(x, z, faceX, faceZ, mode = 'idle', opts = {}) {
    this._warmup = false;            // a real spawn supersedes any warm-up reveal
    this.pos.set(x, 0, z);
    this.group.position.copy(this.pos);
    this.faceToward(faceX ?? x, faceZ ?? (z + 1));
    this.mode = mode;
    this.lifetime = 0;
    this.observedTime = 0;
    this._hasSkittered = false;
    // Reset the animation clock every appearance. The Presence is ONE shared
    // instance respawned dozens of times a session; if phase just kept growing,
    // the twitch/jaw/jitter timing drifted and sin() precision rotted.
    this.phase = 0;
    this._twitchUntil = 0;
    this._twitch.set(0, 0, 0);
    this._stepT = 0;
    this.dwell = opts.dwell ?? (mode === 'guard' ? 9999 : 0.55);
    this.speed = opts.speed ?? (mode === 'chase' ? 3.7 : mode === 'approach' ? 0.85 : 0);
    this.crawlMove = opts.crawl === true || mode === 'chase' || (mode === 'cross' && this.speed > 5.0);
    this.hold = opts.hold === true;     // a starer that vanishes when you look away, not when you look at it
    this._seen = false;
    this._wetStep = opts.wet !== false; // footstep surface for chase/hunt
    this.target.copy(this.pos);
    if (opts.target) this.target.set(opts.target.x, 0, opts.target.z);
    this.onReach = opts.onReach ?? null;
    this.vanishing = false;
    this.group.visible = true;
    this.group.scale.set(1, 1, 1);
    if (!this.crawlMove) this._stride(0, 1, false);
    this.eyeMat.emissiveIntensity = mode === 'guard' ? 2.4 : 1.7;
  }

  faceToward(x, z) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.0001) this.group.rotation.y = Math.atan2(dx, dz);
  }

  // Smart despawn. If you're LOOKING at it, it must not pop out of existence —
  // it convulses and folds down into the dark (see the 'vanishing' branch in
  // update). If you're not looking, hard-hide instantly so it's genuinely "gone
  // when you look back" — no animation needed, you never saw it leave.
  despawn(audio, silent = false) {
    if (!this.group.visible || this.vanishing) return;
    if (this.observedTime > 0.02) {                 // watched — fold away, don't pop
      this.vanishing = true; this._vanishT = this._vanishDur;
      if (!silent && this.vanishSound && audio) audio.whisper(this.pos);
      return;
    }
    this._hide();
    if (!silent && this.vanishSound && audio) audio.whisper(this.pos);
  }
  // instant, unconditional — for level unloads / hard resets
  hardHide() { this._hide(); }
  _hide() {
    this._warmup = false;
    this.group.visible = false;
    this.mode = 'hidden';
    this.crawlMove = false;
    this.vanishing = false;
    this.group.scale.set(1, 1, 1);
    this.group.position.copy(this.pos);
    // Lights stay in the scene (constant count) but go fully dark.
    this.eyeLight.intensity = 0;
    this.chestLight.intensity = 0;
  }

  get isVisible() { return this.group.visible; }
  distanceTo(p) { return Math.hypot(p.x - this.pos.x, p.z - this.pos.z); }

  _beingWatched(player, field) {
    const dx = this.pos.x - player.pos.x, dz = this.pos.z - player.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 40) return false;
    const fx = player.forward.x, fz = player.forward.z;
    const fl = Math.hypot(fx, fz) || 1;
    const dot = (dx * fx + dz * fz) / (dist * fl);
    if (dot < 0.86) return false;
    if (field && !field.segmentClear(player.pos.x, player.pos.z, this.pos.x, this.pos.z)) return false;
    return true;
  }

  update(dt, player, field, audio) {
    if (!this.group.visible || this._warmup) return;

    // Keep the always-visible light rig glued to the body so its eye/chest glow
    // tracks the creature (the rig never toggles visibility — see constructor).
    this.lightRig.position.copy(this.group.position);
    this.lightRig.rotation.y = this.group.rotation.y;

    // --- folding away: a convulsion, then it's pulled down into the dark ---
    if (this.vanishing) {
      this._vanishT -= dt;
      const k = Math.max(0, this._vanishT / this._vanishDur);   // 1 -> 0
      this.phase += dt * 3;                                      // animation goes frantic
      const jit = 0.06 * k + 0.01;
      this.group.position.set(this.pos.x + (Math.random() - 0.5) * jit, -(1 - k) * 0.7, this.pos.z + (Math.random() - 0.5) * jit);
      this.group.scale.set(0.55 + k * 0.45, k * k, 0.55 + k * 0.45);   // collapse straight down
      if (this.head) this.head.rotation.z += (Math.random() - 0.5) * 0.5 * (1 - k);
      if (this.eyeMat) this.eyeMat.emissiveIntensity *= 0.84;          // the eyes gutter out
      if (this.jaw) this.jaw.rotation.x += dt * 4 * (1 - k);           // jaw gapes as it goes
      if (this._vanishT <= 0) this._hide();
      return;
    }

    this.lifetime += dt;
    this.phase += dt;

    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    const watched = this._beingWatched(player, field);
    if (watched) this.observedTime += dt; else this.observedTime = Math.max(0, this.observedTime - dt * 2);

    const crawl = this.crawlMove;
    let baseY = Math.sin(this.phase * 1.7) * 0.01 - (crawl ? 0.18 : 0);

    if (this.mode === 'idle') {
      this.faceToward(player.pos.x, player.pos.z);
      if (this.hold) {
        // a starer: it does NOT run when you look at it. It just watches. It is
        // gone the instant you look away — which is far worse than fleeing, and
        // nothing like the peek-and-run tell. (Once you've actually seen it.)
        if (this.observedTime > 0.05) this._seen = true;
        if (this._seen && !watched && this.observedTime <= 0) this.despawn(audio);
        else if (this.lifetime > 8) this.despawn(audio);
      } else if (this.observedTime > this.dwell && !this._hasSkittered) {
        this._skitterAway(player, dist);
      } else if (this.lifetime > 9) {
        this.despawn(audio);
      }
    } else if (this.mode === 'approach') {
      this.faceToward(player.pos.x, player.pos.z);
      if (!watched && dist > 1.2) {
        const s = this.speed * dt;
        this.pos.x += (dx / dist) * s; this.pos.z += (dz / dist) * s;
        this._stride(dt, crawl ? 2.6 : 1.4, crawl);
      }
      if (this.observedTime > this.dwell + dist * 0.04) this.despawn(audio);
      if (dist < 1.1 && this.onReach) { this.onReach(); this.hardHide(); }   // violent catch — hard-cut behind the blink, not a slow fold
    } else if (this.mode === 'cross') {
      const tx = this.target.x - this.pos.x, tz = this.target.z - this.pos.z;
      const td = Math.hypot(tx, tz);
      if (td < 0.3) { this.despawn(audio, true); }
      else {
        const s = this.speed * dt;
        this.pos.x += (tx / td) * s; this.pos.z += (tz / td) * s;
        this.faceToward(this.target.x, this.target.z);
        this._stride(dt, crawl ? 3.5 : (this.speed > 4 ? 2.8 : 1.4), crawl);
      }
    } else if (this.mode === 'chase') {
      this.faceToward(player.pos.x, player.pos.z);
      let nx = this.pos.x + (dx / (dist || 1)) * this.speed * dt;
      let nz = this.pos.z + (dz / (dist || 1)) * this.speed * dt;
      if (field) { const r = field.resolve(nx, nz, 0.42); nx = r.x; nz = r.z; }   // wider clearance so it doesn't embed in walls
      this.pos.set(nx, 0, nz);
      this._stride(dt, this.speed > 2.6 ? 3.2 : 1.7, true);
      // footstep cadence tracks how fast it's moving — a slow stalk plods, a
      // committed chase pounds. This is the sound that tells you it's coming.
      this._stepT += dt;
      const stepGap = THREE.MathUtils.clamp(0.62 - this.speed * 0.06, 0.2, 0.6);
      if (this._stepT >= stepGap) { this._stepT -= stepGap; audio && audio.footstep(this.pos, this._wetStep, true); }   // HEAVY — you hear it coming
      if (dist < 1.0 && this.onReach) { this.onReach(); this.hardHide(); }   // hard-cut behind the caught-blink
    } else if (this.mode === 'guard') {
      this.faceToward(player.pos.x, player.pos.z);
    }

    // --- the wrongness: head twitch, gaping jaw, glowing maw, stop-motion jitter ---
    const aggro = (this.mode === 'guard' || this.mode === 'chase') ? 1
                : THREE.MathUtils.clamp(1 - dist / 7, 0, 1) + (watched ? 0.3 : 0);
    const ag = THREE.MathUtils.clamp(aggro, 0, 1);
    const crawlK = crawl ? 1 : 0;
    // a guarding Presence LOOMS: it rises and swells the closer you come, so
    // walking up to the thing it's guarding means it grows over you. Uses the
    // SAME curve as the Director's dread ramp (1-(d-1)/7) so the visual swell and
    // the audio/post dread peak together.
    const guardLoom = this.mode === 'guard' ? THREE.MathUtils.clamp(1 - (dist - 1.0) / 7, 0, 1) : 0;
    this.group.scale.set(
      1 + crawlK * 0.08 + guardLoom * 0.16,
      1 - crawlK * 0.16 + guardLoom * 0.40,
      1 + crawlK * 0.1 + guardLoom * 0.16,
    );
    this.torso.position.set(0.02, 1.35 - crawlK * 0.34, crawlK * 0.12);
    this.torso.rotation.x = 0.14 + crawlK * (0.78 + Math.sin(this.phase * 12) * 0.08);
    this.torso.rotation.z = crawlK * Math.sin(this.phase * 7.2) * 0.08;
    this.head.position.set(
      0.04 + crawlK * Math.sin(this.phase * 13) * 0.035,
      1.92 - crawlK * 0.58,
      0.01 + crawlK * 0.23,
    );

    // sharp involuntary head twitches
    if (this.phase > this._twitchUntil) {
      this._twitchUntil = this.phase + 0.25 + Math.random() * (1.4 - ag);
      this._twitch.set((Math.random() - 0.5) * (0.3 + ag * 0.5), (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4);
    }
    const tw = this._twitch, sw = 1 - Math.min(1, (this._twitchUntil - this.phase) * 4);
    const lean = this.mode === 'guard' ? -THREE.MathUtils.clamp(1 - (dist - 1.0) / 7, 0, 1) * 0.72 : 0;   // bows its broken head down at you as you near
    this.head.rotation.x = lean - crawlK * 0.38 + tw.x * sw + Math.sin(this.phase * 9) * (0.02 + crawlK * 0.035);
    this.head.rotation.y = tw.y * sw;
    this.head.rotation.z = crawlK * 0.32 + tw.z * sw + Math.sin(this.phase * 6.1) * (0.03 + crawlK * 0.08);

    // jaw hangs, drops further when aggressive; maw glows from within
    this.jaw.rotation.x = 0.25 + ag * 0.7 + Math.sin(this.phase * 5) * 0.05 * ag;
    this.mawMat.emissiveIntensity = ag * (1.2 + Math.sin(this.phase * 11) * 0.4);
    this.eyeMat.emissiveIntensity = (this.mode === 'guard' ? 2.2 : 1.5) + ag * 1.5 + Math.sin(this.phase * 13) * 0.25 * ag;
    if (this.eyeLight) this.eyeLight.intensity = (0.05 + ag * 0.52) * (this.mode === 'guard' ? 1.3 : 1);
    if (this.chestLight) this.chestLight.intensity = Math.max(0, Math.max(0, ag - 0.25) * 0.9 + Math.sin(this.phase * 17) * 0.035 * ag);
    if (this.veinMat) this.veinMat.emissiveIntensity = 0.1 + ag * 0.42;
    if (this.veins) {
      for (let i = 0; i < this.veins.length; i++) {
        this.veins[i].scale.y = 0.9 + ag * 0.3 + Math.sin(this.phase * 8 + i) * 0.045;
      }
    }

    // stop-motion micro-jitter of the whole body (more violent up close)
    const jit = 0.006 + ag * 0.02;
    const step = Math.floor(this.phase * (crawl ? 22 : 14));
    const frac = (n) => n - Math.floor(n);
    const jx = frac(Math.sin(step * 12.9898) * 43758.5453) - 0.5;
    const jz = frac(Math.sin(step * 78.233 + 9.7) * 24634.6345) - 0.5;
    this.group.position.set(this.pos.x + jx * jit, baseY, this.pos.z + jz * jit);
    if (this.veils) {
      for (let i = 0; i < this.veils.length; i++) {
        this.veils[i].rotation.z += Math.sin(this.phase * 9 + i) * 0.002 * (1 + ag);
        this.veils[i].material.opacity = 0.42 + ag * 0.26 + Math.sin(this.phase * 11 + i) * 0.08;
      }
    }
    if (this.rags) {
      for (let i = 0; i < this.rags.length; i++) {
        this.rags[i].rotation.z += Math.sin(this.phase * 6.5 + i) * 0.002 * (1 + ag);
        this.rags[i].scale.y = 0.92 + ag * 0.24 + Math.sin(this.phase * 8 + i) * 0.06;
        this.rags[i].material.opacity = 0.52 + ag * 0.22 + Math.sin(this.phase * 9 + i) * 0.08;
      }
    }
    if (this.chestEyes) {
      for (let i = 0; i < this.chestEyes.length; i++) {
        this.chestEyes[i].scale.setScalar(0.7 + ag * 0.9 + Math.sin(this.phase * 17 + i) * 0.18);
      }
    }
    if (this.spines) {
      for (let i = 0; i < this.spines.length; i++) {
        this.spines[i].rotation.z += Math.sin(this.phase * 5.5 + i) * 0.0025 * (1 + ag * 2);
        this.spines[i].rotation.x += Math.cos(this.phase * 4.2 + i) * 0.0015 * (1 + ag);
      }
    }
    if (this.sideFace) {
      this.sideFace.rotation.y = -0.72 + Math.sin(this.phase * 7.5) * 0.08 + ag * 0.18;
      this.sideFace.rotation.z = -0.15 + Math.sin(this.phase * 11.0) * 0.035;
    }
  }

  _skitterAway(player, dist) {
    const dx = this.pos.x - player.pos.x, dz = this.pos.z - player.pos.z;
    const d = dist || Math.hypot(dx, dz) || 1;
    const side = Math.random() < 0.5 ? -1 : 1;
    const px = (dz / d) * side, pz = (-dx / d) * side;
    const back = Math.random() < 0.45 ? 1.8 : 0.3;
    this.target.set(this.pos.x + px * 4.2 + (dx / d) * back, 0, this.pos.z + pz * 4.2 + (dz / d) * back);
    this.mode = 'cross';
    this.speed = 5.6 + Math.random() * 1.5;
    this.crawlMove = true;
    this._hasSkittered = true;
    this.observedTime = 0;
  }

  _stride(dt, scale = 1.4, crawl = false) {
    const sw = Math.sin(this.phase * 6 * scale);
    if (crawl) {
      const claw = Math.sin(this.phase * 13 * scale);
      if (this.legs[0]) {
        this.legs[0].rotation.set(-1.05 + claw * 0.42, 0.35, 0.86 + Math.cos(this.phase * 10 * scale) * 0.2);
        this.legs[1].rotation.set(-1.05 - claw * 0.42, -0.35, -0.86 + Math.sin(this.phase * 11 * scale) * 0.2);
      }
      if (this.arms[0]) {
        this.arms[0].rotation.set(-1.35 - claw * 0.36, -0.45, 1.1 + Math.sin(this.phase * 12 * scale) * 0.18);
        this.arms[1].rotation.set(-1.35 + claw * 0.36, 0.45, -1.1 + Math.cos(this.phase * 12 * scale) * 0.18);
      }
      return;
    }
    if (this.legs[0]) {
      this.legs[0].rotation.set(sw * 0.5, 0, 0);
      this.legs[1].rotation.set(-sw * 0.5, 0, 0);
    }
    if (this.arms[0]) {
      this.arms[0].rotation.set(-sw * 0.3 + 0.1, 0, 0);
      this.arms[1].rotation.set(sw * 0.3 + 0.1, 0, 0);
    }
  }
}
