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
  }

  _build() {
    const g = this.group;
    // dark, wet, dead flesh — kept low-albedo so the torch reveals form instead
    // of blowing it out to a white blob at close range
    const flesh = new THREE.MeshStandardMaterial({ color: 0x4c3f39, roughness: 0.42, metalness: 0.0, emissive: 0x130606, emissiveIntensity: 0.1 });
    const bone = new THREE.MeshStandardMaterial({ color: 0x8f8676, roughness: 0.55 });
    const cavity = new THREE.MeshBasicMaterial({ color: 0x040203 });
    this.mawMat = new THREE.MeshStandardMaterial({ color: 0x2a0608, roughness: 0.5, emissive: 0x4a0206, emissiveIntensity: 0.0 });

    // --- pelvis + gaunt, hunched torso ---
    const pelvis = new THREE.Mesh(malform(new THREE.CapsuleGeometry(0.13, 0.16, 4, 8), 0.16, 5), flesh);
    pelvis.position.y = 0.98; g.add(pelvis);
    const torso = new THREE.Mesh(malform(new THREE.CapsuleGeometry(0.17, 0.85, 5, 12), 0.2, 3), flesh);
    torso.position.set(0.02, 1.35, 0); torso.scale.set(1, 1, 0.6); torso.rotation.x = 0.14; g.add(torso);
    this.torso = torso;

    // exposed ribs across the chest
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.135 - i * 0.014, 0.011, 6, 12, Math.PI), bone);
      rib.position.set(0, 1.62 - i * 0.12, 0.05); rib.rotation.set(Math.PI / 2, 0, (i % 2 ? 1 : -1) * 0.06);
      g.add(rib);
    }
    // jutting collarbone / shoulder blades
    const clav = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.34, 3, 6), bone);
    clav.position.set(0, 1.76, 0.05); clav.rotation.z = Math.PI / 2; g.add(clav);

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

    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  }

  addToScene(scene) { scene.add(this.group); }

  spawnAt(x, z, faceX, faceZ, mode = 'idle', opts = {}) {
    this.pos.set(x, 0, z);
    this.group.position.copy(this.pos);
    this.faceToward(faceX ?? x, faceZ ?? (z + 1));
    this.mode = mode;
    this.lifetime = 0;
    this.observedTime = 0;
    this.dwell = opts.dwell ?? (mode === 'guard' ? 9999 : 0.55);
    this.speed = opts.speed ?? (mode === 'chase' ? 3.7 : mode === 'approach' ? 0.85 : 0);
    if (opts.target) this.target.set(opts.target.x, 0, opts.target.z);
    this.onReach = opts.onReach ?? null;
    this.group.visible = true;
    this.eyeMat.emissiveIntensity = mode === 'guard' ? 2.4 : 1.7;
  }

  faceToward(x, z) {
    const dx = x - this.pos.x, dz = z - this.pos.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.0001) this.group.rotation.y = Math.atan2(dx, dz);
  }

  despawn(audio, silent = false) {
    if (!this.group.visible) return;
    this.group.visible = false;
    this.mode = 'hidden';
    if (!silent && this.vanishSound && audio) audio.whisper(this.pos);
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
    if (!this.group.visible) return;
    this.lifetime += dt;
    this.phase += dt;

    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    const watched = this._beingWatched(player, field);
    if (watched) this.observedTime += dt; else this.observedTime = Math.max(0, this.observedTime - dt * 2);

    let baseY = Math.sin(this.phase * 1.7) * 0.01;

    if (this.mode === 'idle') {
      this.faceToward(player.pos.x, player.pos.z);
      if (this.observedTime > this.dwell || this.lifetime > 9) this.despawn(audio);
    } else if (this.mode === 'approach') {
      this.faceToward(player.pos.x, player.pos.z);
      if (!watched && dist > 1.2) {
        const s = this.speed * dt;
        this.pos.x += (dx / dist) * s; this.pos.z += (dz / dist) * s;
        this._stride(dt);
      }
      if (this.observedTime > this.dwell + dist * 0.04) this.despawn(audio);
      if (dist < 1.1 && this.onReach) { this.onReach(); this.despawn(audio, true); }
    } else if (this.mode === 'cross') {
      const tx = this.target.x - this.pos.x, tz = this.target.z - this.pos.z;
      const td = Math.hypot(tx, tz);
      if (td < 0.3) { this.despawn(audio, true); }
      else {
        const s = this.speed * dt;
        this.pos.x += (tx / td) * s; this.pos.z += (tz / td) * s;
        this.faceToward(this.target.x, this.target.z);
        this._stride(dt);
      }
    } else if (this.mode === 'chase') {
      this.faceToward(player.pos.x, player.pos.z);
      let nx = this.pos.x + (dx / (dist || 1)) * this.speed * dt;
      let nz = this.pos.z + (dz / (dist || 1)) * this.speed * dt;
      if (field) { const r = field.resolve(nx, nz, 0.3); nx = r.x; nz = r.z; }
      this.pos.set(nx, 0, nz);
      this._stride(dt, 2.4);
      audio && this.lifetime % 0.3 < dt && audio.footstep(this.pos, true);
      if (dist < 1.0 && this.onReach) { this.onReach(); this.despawn(audio, true); }
    } else if (this.mode === 'guard') {
      this.faceToward(player.pos.x, player.pos.z);
    }

    // --- the wrongness: head twitch, gaping jaw, glowing maw, stop-motion jitter ---
    const aggro = (this.mode === 'guard' || this.mode === 'chase') ? 1
                : THREE.MathUtils.clamp(1 - dist / 7, 0, 1) + (watched ? 0.3 : 0);
    const ag = THREE.MathUtils.clamp(aggro, 0, 1);

    // sharp involuntary head twitches
    if (this.phase > this._twitchUntil) {
      this._twitchUntil = this.phase + 0.25 + Math.random() * (1.4 - ag);
      this._twitch.set((Math.random() - 0.5) * (0.3 + ag * 0.5), (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4);
    }
    const tw = this._twitch, sw = 1 - Math.min(1, (this._twitchUntil - this.phase) * 4);
    const lean = this.mode === 'guard' ? -Math.max(0, 1 - dist / 8) * 0.5 : 0;
    this.head.rotation.x = lean + tw.x * sw + Math.sin(this.phase * 9) * 0.02;
    this.head.rotation.y = tw.y * sw;
    this.head.rotation.z = tw.z * sw + Math.sin(this.phase * 6.1) * 0.03;

    // jaw hangs, drops further when aggressive; maw glows from within
    this.jaw.rotation.x = 0.25 + ag * 0.7 + Math.sin(this.phase * 5) * 0.05 * ag;
    this.mawMat.emissiveIntensity = ag * (1.2 + Math.sin(this.phase * 11) * 0.4);
    this.eyeMat.emissiveIntensity = (this.mode === 'guard' ? 2.2 : 1.5) + ag * 1.5 + Math.sin(this.phase * 13) * 0.25 * ag;

    // stop-motion micro-jitter of the whole body (more violent up close)
    const jit = 0.006 + ag * 0.02;
    this.group.position.set(this.pos.x + (Math.random() - 0.5) * jit, baseY, this.pos.z + (Math.random() - 0.5) * jit);
  }

  _stride(dt, scale = 1.4) {
    const sw = Math.sin(this.phase * 6 * scale);
    if (this.legs[0]) { this.legs[0].rotation.x = sw * 0.5; this.legs[1].rotation.x = -sw * 0.5; }
    if (this.arms[0]) { this.arms[0].rotation.x = -sw * 0.3 + 0.1; this.arms[1].rotation.x = sw * 0.3 + 0.1; }
  }
}
