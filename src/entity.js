import * as THREE from 'three';

// The Presence. A too-tall, too-thin figure. It is mostly silhouette; the
// flashlight reveals a gaunt grey face, and two cold points where eyes should
// be glow faintly even in full dark. Its whole horror is behavioural: it
// appears in the corner of the world and is gone the instant you look straight
// at it — so you can never be sure it was ever there.

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
    this.dwell = 0.5;           // how long it tolerates being looked at
    this.onReach = null;        // callback when it touches the player (chase)
    this.vanishSound = true;
    this.height = 2.18;
  }

  _build() {
    const dark = new THREE.MeshStandardMaterial({ color: 0x060607, roughness: 1.0, metalness: 0.0 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x171410, roughness: 0.95, metalness: 0.0 });
    const g = this.group;

    // torso — elongated, narrow
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.95, 4, 10), dark);
    torso.position.y = 1.35; torso.scale.set(1, 1, 0.7); g.add(torso);

    // neck + head (face toward +Z)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), skin);
    head.position.y = 2.02; head.scale.set(0.82, 1.1, 0.85); g.add(head);
    this.head = head;

    // sunken eyes — emissive so they catch no light yet still glimmer
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xaecbe0, emissiveIntensity: 1.4, roughness: 1 });
    this.eyeMat = eyeMat;
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), eyeMat);
      eye.position.set(sx * 0.05, 2.04, 0.12); g.add(eye);
    }

    // a faint maw
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.09),
      new THREE.MeshBasicMaterial({ color: 0x000000 }));
    mouth.position.set(0, 1.95, 0.135); g.add(mouth);

    // arms — far too long, nearly to the floor
    this.arms = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(sx * 0.17, 1.78, 0);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 1.15, 3, 6), dark);
      arm.position.y = -0.6; pivot.add(arm); g.add(pivot); this.arms.push(pivot);
    }
    // legs
    this.legs = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(sx * 0.08, 0.92, 0);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.85, 3, 6), dark);
      leg.position.y = -0.45; pivot.add(leg); g.add(pivot); this.legs.push(pivot);
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
    this.eyeMat.emissiveIntensity = mode === 'guard' ? 2.2 : 1.4;
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

  // is the player looking roughly at me, with line of sight?
  _beingWatched(player, field) {
    const dx = this.pos.x - player.pos.x, dz = this.pos.z - player.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 40) return false;
    const fx = player.forward.x, fz = player.forward.z;
    const fl = Math.hypot(fx, fz) || 1;
    const dot = (dx * fx + dz * fz) / (dist * fl);
    if (dot < 0.86) return false;                     // not within ~30° of center
    if (field && !field.segmentClear(player.pos.x, player.pos.z, this.pos.x, this.pos.z)) return false;
    return true;
  }

  update(dt, player, field, audio) {
    if (!this.group.visible) return;
    this.lifetime += dt;
    this.phase += dt;

    // eyes drift toward you, head tracks slightly
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    const watched = this._beingWatched(player, field);
    if (watched) this.observedTime += dt; else this.observedTime = Math.max(0, this.observedTime - dt * 2);

    // breathing idle
    this.group.position.y = Math.sin(this.phase * 1.7) * 0.01;

    if (this.mode === 'idle') {
      this.faceToward(player.pos.x, player.pos.z);
      // vanish if stared at, or after it has loomed long enough
      if (this.observedTime > this.dwell || this.lifetime > 9) { this.despawn(audio); }
    }
    else if (this.mode === 'approach') {
      // creeps closer, but FREEZES when watched (you only ever see it still)
      this.faceToward(player.pos.x, player.pos.z);
      if (!watched && dist > 1.2) {
        const s = this.speed * dt;
        this.pos.x += (dx / dist) * s; this.pos.z += (dz / dist) * s;
        this.group.position.set(this.pos.x, this.group.position.y, this.pos.z);
        this._stride(dt);
      }
      if (this.observedTime > this.dwell + dist * 0.04) this.despawn(audio); // looked at too long -> gone
      if (dist < 1.1 && this.onReach) { this.onReach(); this.despawn(audio, true); }
    }
    else if (this.mode === 'cross') {
      // walks A->B regardless of being watched, then is gone
      const tx = this.target.x - this.pos.x, tz = this.target.z - this.pos.z;
      const td = Math.hypot(tx, tz);
      if (td < 0.3) { this.despawn(audio, true); }
      else {
        const s = this.speed * dt;
        this.pos.x += (tx / td) * s; this.pos.z += (tz / td) * s;
        this.group.position.set(this.pos.x, this.group.position.y, this.pos.z);
        this.faceToward(this.target.x, this.target.z);
        this._stride(dt);
      }
    }
    else if (this.mode === 'chase') {
      // relentless. Faster than a walk; the player must reach a goal.
      this.faceToward(player.pos.x, player.pos.z);
      let nx = this.pos.x + (dx / (dist || 1)) * this.speed * dt;
      let nz = this.pos.z + (dz / (dist || 1)) * this.speed * dt;
      if (field) { const r = field.resolve(nx, nz, 0.3); nx = r.x; nz = r.z; }
      this.pos.set(nx, 0, nz);
      this.group.position.set(nx, this.group.position.y, nz);
      this._stride(dt, 2.4);
      audio && this.lifetime % 0.3 < dt && audio.footstep(this.pos, true);
      if (dist < 1.0 && this.onReach) { this.onReach(); this.despawn(audio, true); }
    }
    else if (this.mode === 'guard') {
      // stands over the prize, head lifting to regard you as you near
      this.faceToward(player.pos.x, player.pos.z);
      const lean = Math.max(0, 1 - dist / 8);
      this.head.rotation.x = -lean * 0.5 + Math.sin(this.phase * 2) * 0.02 * lean;
      this.eyeMat.emissiveIntensity = 2.0 + lean * 2.5 + Math.sin(this.phase * 9) * lean;
    }
  }

  _stride(dt, scale = 1.4) {
    const sw = Math.sin(this.phase * 6 * scale);
    if (this.legs[0]) { this.legs[0].rotation.x = sw * 0.5; this.legs[1].rotation.x = -sw * 0.5; }
    if (this.arms[0]) { this.arms[0].rotation.x = -sw * 0.35; this.arms[1].rotation.x = sw * 0.35; }
  }
}
