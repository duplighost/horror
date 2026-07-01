import * as THREE from 'three';
import { Entity } from './entity.js';
import { Audio } from './audio.js?v=distinct-mazes';
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// The Director decides when to frighten you. It owns the Presence, runs the
// flashlight's failing nerve, sprinkles systemic dread that scales with the
// soundtrack's tension, and stages the scripted beats (key pickups, the chase,
// the ending). Almost nothing here is on a fixed timer — it watches where you
// look and waits for the worst moment.

export class Director {
  constructor(ctx) {
    this.ctx = ctx;
    this.entity = new Entity();
    this.entity.addToScene(ctx.scene);
    this.field = null;
    this.player = ctx.player;

    this.flickering = false; this.flickT = 0; this.flickerSeed = Math.random() * 20;
    this.dreadTimer = 4 + Math.random() * 4;
    this.lastLoud = -999;          // seconds; loud scares are gated by LOUD_GAP
    this.LOUD_GAP = 26;            // minimum seconds between full jump-scares
    this.quietUntil = 0;           // after a hit, let silence do some work
    this.witnessState = null;      // quiet apparition that pays off only when seen
    this.ephemera = [];            // eyes / dark shapes that vanish without using the Presence
    this.lastCreatureCross = -999;
    this.lastSkitter = -999;
    this.lastEyeCue = -999;
    this.chaseActive = false;
    this.ended = false;
    this.zone = 'forest';         // the level you are ACTUALLY in (set on load)
    this._timers = new Set();     // every scripted-beat setTimeout, so reset() can kill them
    this._halluTok = 0;
    this._plunging = false;
    this._sentinel = null;        // the threshold guardian standing on your objective
    this._hunting = false;        // a stalk/chase is in progress
    this._huntTimer = 16;         // seconds until the next hunt
    this._huntLost = 0;           // how long you've been out of its reach
  }

  _nowS() { return performance.now() / 1000; }

  // Scripted beats schedule their payoff on a delay. If the player changes level
  // mid-beat, those timers must NOT fire into the next level (a stray flash, a
  // despawn that yanks the new level's Presence). Route every delayed beat
  // through here so reset() can cancel the lot.
  _after(fn, ms) {
    const id = setTimeout(() => { this._timers.delete(id); fn(); }, ms);
    this._timers.add(id);
    return id;
  }
  _clearTimers() { for (const id of this._timers) clearTimeout(id); this._timers.clear(); }
  _canLoud() { return this._nowS() - this.lastLoud > this.LOUD_GAP && Audio.tension > 0.4; }
  _wet() { return this.zone === 'basement' || this.zone === 'bathhouse' || this.zone === 'chapel' || this.zone === 'final'; }   // wet footsteps below ground

  // called by main on every level load so dread logic knows where you are
  enterZone(name) { this.zone = name; }

  setField(f) { this.field = f; }

  // Full reset for a clean replay — clears the Presence, every timer, and any
  // leftover player state (frozen / forced-look / dimmed torch). The zone is set
  // separately by enterZone() on level load, so it's not forced here.
  reset() {
    this._clearTimers();
    this.entity.hardHide();
    this.chaseActive = false;
    this._plunging = false;
    this._sentinel = null;
    this._hunting = false;
    this._huntTimer = 14 + Math.random() * 8;
    this._huntLost = 0;
    this.ended = false;
    this.flickering = false; this.flickT = 0; this.flickerSeed = Math.random() * 20;
    this.dreadTimer = 4 + Math.random() * 4;
    this.lastLoud = -999;
    this.quietUntil = 0;
    this.witnessState = null;
    this.lastCreatureCross = -999;
    this.lastSkitter = -999;
    this.lastEyeCue = -999;
    this._clearEphemera();
    this.player.flicker = 1; this.player.flashOn = true;
    this.player.frozen = false; this.player.speedScale = 1; this.player.releaseLook();
  }

  // a key was taken — nudge the tension up for the next leg of the descent
  setObjective(name) {
    if (name === 'mansion') Audio.setTension(0.35);
    if (name === 'basement') Audio.setTension(0.6);
  }

  // ---- entity placement primitives (called by level triggers) --------------
  // a still figure that appears off to the side and vanishes when you look
  lurk(x, z) {
    if (this.entity.isVisible || this.ended) return;
    this.entity.spawnAt(x, z, this.player.pos.x, this.player.pos.z, 'idle', { dwell: 0.28 + Math.random() * 0.22, hold: Math.random() < 0.45 });
  }
  // appear at the EDGE of your vision (not fully behind) so you actually catch a
  // glimpse of it standing in the fog — then it's gone the moment you look at it.
  peripheral() {
    if (this.entity.isVisible || this.ended) return;
    if (Math.random() < 0.58) { this.darkEyes(); return; }
    const p = this.player.pos;
    const fwd = this.player.yaw + Math.PI;                                  // world-angle of forward (atan2(x,z))
    const off = (Math.random() < 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.7); // ~35-75° off centre
    const ang = fwd + off, d = 8 + Math.random() * 6;
    this.entity.spawnAt(p.x + Math.sin(ang) * d, p.z + Math.cos(ang) * d, p.x, p.z, 'idle', { dwell: 0.24, hold: Math.random() < 0.4 });
    Audio.bumpHeart(0.45, 88);
  }
  crossPath(ax, az, bx, bz) {
    if (this.ended) return;
    this.entity.spawnAt(ax, az, bx, bz, 'cross', { speed: 4.7, target: { x: bx, z: bz }, crawl: true });
  }
  // It is suddenly standing DIRECTLY BEHIND you. No stinger, no flash — just a
  // breath at the back of your neck. You only find out if you turn around, and
  // because it holds, it's right there, looming, when you do.
  behindYou() {
    if (this.entity.isVisible || this.ended) return;
    const p = this.player, f = p.forward;
    const bx = p.pos.x - f.x * 1.45, bz = p.pos.z - f.z * 1.45;
    if (this.field && !this.field.segmentClear(p.pos.x, p.pos.z, bx, bz)) return;   // not inside a wall
    this.entity.spawnAt(bx, bz, p.pos.x, p.pos.z, 'idle', { dwell: 0.55, hold: true });
    Audio.bumpBreath?.(0.6);
    Audio.bumpHeart(0.4, 92);
    // breath at your neck, nudged off to one side (the right vector) so it's not
    // dead-centre — a directional cue that pulls you to turn toward it.
    const side = Math.random() < 0.5 ? -1 : 1;
    Audio.whisper(new THREE.Vector3(bx + (-f.z) * 0.6 * side, 1.55, bz + (f.x) * 0.6 * side));
  }
  witness(x, z, opts = {}) {
    if (this.entity.isVisible || this.ended) return false;
    const p = this.player.pos;
    this.entity.spawnAt(x, z, p.x, p.z, 'idle', { dwell: opts.dwell ?? 0.42 });
    this.witnessState = {
      expires: this._nowS() + (opts.life ?? 4.8),
      armed: false,
      intensity: opts.intensity ?? 0.42,
      hush: opts.hush ?? 0.65,
    };
    if (opts.hush !== false) Audio.hush(this.witnessState.hush);
    return true;
  }
  rushPast() {
    return this.crabSkitter();
  }

  crabSkitter() {
    if (this.entity.isVisible || this.ended) return false;
    const now = this._nowS();
    if (now - this.lastSkitter < 38 || now - this.lastCreatureCross < 34) return false;
    this.lastSkitter = now;
    this.lastCreatureCross = now;
    const p = this.player.pos;
    const fwd = this.player.yaw + Math.PI;
    const side = Math.random() < 0.5 ? -1 : 1;
    const ahead = 3.8 + Math.random() * 2.0;
    const width = 4.8 + Math.random() * 2.0;
    const cx = p.x + Math.sin(fwd) * ahead;
    const cz = p.z + Math.cos(fwd) * ahead;
    const sx = cx + Math.sin(fwd + side * Math.PI / 2) * width;
    const sz = cz + Math.cos(fwd + side * Math.PI / 2) * width;
    const ex = cx + Math.sin(fwd - side * Math.PI / 2) * width;
    const ez = cz + Math.cos(fwd - side * Math.PI / 2) * width;
    this.entity.spawnAt(sx, sz, ex, ez, 'cross', { speed: 6.8, target: { x: ex, z: ez }, crawl: true });
    Audio.skitter(new THREE.Vector3(cx, 1, cz), this.zone === 'forest' || this.zone === 'conservatory' ? 'leaf' : this._wet() ? 'wet' : 'dry');
    Audio.bumpHeart(0.55, 96);
    this._torchStutter();
    return true;
  }

  darkEyes(pos = null, opts = {}) {
    if (this.ended) return false;
    const now = this._nowS();
    if (!opts.force && now - this.lastEyeCue < 2.2) return false;
    const spot = pos?.isVector3 ? pos.clone() : this._eyeSpot(opts);
    if (!spot) return false;
    this.lastEyeCue = now;

    const g = new THREE.Group();
    g.position.set(spot.x, spot.y ?? 1.55, spot.z);
    g.rotation.y = Math.atan2(this.player.pos.x - spot.x, this.player.pos.z - spot.z);

    const mats = [];
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x010101, transparent: true, opacity: opts.shadowOpacity ?? 0.62,
      depthWrite: false, side: THREE.DoubleSide,
    });
    mats.push(shadowMat);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(opts.w ?? 0.82, opts.h ?? 1.65), shadowMat);
    shadow.position.set(0, 0.05, 0.025);
    g.add(shadow);

    for (let i = 0; i < (opts.count ?? 2); i++) {
      const eyeMat = new THREE.MeshBasicMaterial({ color: opts.color ?? 0xd8e0cf, transparent: true, opacity: opts.opacity ?? 0.95 });
      mats.push(eyeMat);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(i === 2 ? 0.022 : 0.034, 10, 8), eyeMat);
      const pair = i < 2 ? (i === 0 ? -1 : 1) : 0;
      eye.position.set(pair * (opts.eyeGap ?? 0.12) + (i === 2 ? 0.02 : 0), 0.22 + (i === 2 ? 0.15 : 0) + (Math.random() - 0.5) * 0.035, 0.055);
      eye.scale.y = 0.48;
      g.add(eye);
    }

    g.userData.ephemeral = { age: 0, life: opts.life ?? 0.82, mats, baseScale: opts.scale ?? 1 };
    g.scale.setScalar(g.userData.ephemeral.baseScale);
    this.ctx.scene.add(g);
    this.ephemera.push(g);
    if (opts.sound !== false) {
      Audio.eyeGlimpse(spot);
      if (Math.random() < 0.32) Audio.hush(0.45);
      Audio.bumpHeart(opts.heart ?? 0.28, opts.bpm ?? 82);
    }
    return true;
  }

  shadowFold(pos = null, opts = {}) {
    if (this.ended) return false;
    const spot = pos?.isVector3 ? pos.clone() : this._eyeSpot({ ...opts, dist: opts.dist ?? 5.8 });
    if (!spot) return false;

    const g = new THREE.Group();
    g.position.set(spot.x, spot.y ?? 1.05, spot.z);
    g.rotation.y = Math.atan2(this.player.pos.x - spot.x, this.player.pos.z - spot.z);
    const mats = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.MeshBasicMaterial({
        color: 0x020102, transparent: true, opacity: 0.55 - i * 0.05,
        depthWrite: false, side: THREE.DoubleSide,
      });
      mats.push(m);
      const veil = new THREE.Mesh(new THREE.PlaneGeometry(0.12 + i * 0.05, 1.1 + Math.random() * 0.8), m);
      veil.position.set((i - 2) * 0.11, 0.35 + Math.random() * 0.25, 0.03 + i * 0.005);
      veil.rotation.z = (i - 2) * 0.18;
      g.add(veil);
    }

    g.userData.ephemeral = { age: 0, life: opts.life ?? 0.62, mats, baseScale: opts.scale ?? 1 };
    this.ctx.scene.add(g);
    this.ephemera.push(g);
    Audio.shadowShift(spot);
    Audio.hush(0.55);
    if (Math.random() < 0.45) this._torchStutter();
    return true;
  }

  // The mirror. Your reflection is wrong: the Presence stands in the glass where
  // you should be, facing you, three eyes lit. It holds — and it's gone the
  // instant you turn to look straight at it. (If the Presence is busy elsewhere,
  // fall back to the eyes-in-the-glass flash.)
  mirrorScare(pos = null) {
    if (this.ended) return false;
    const spot = pos?.isVector3 ? pos.clone() : this._eyeSpot({ dist: 4.5, off: 0 });
    if (!spot) return false;
    Audio.hush(1.15);
    Audio.mirrorSting(spot);
    Audio.bumpHeart(0.65, 98);
    this.player.addShake(0.24);
    this.ctx.post.kick('pulse', REDUCED_MOTION ? 0.12 : 0.35);
    if (!this.entity.isVisible) {
      // the real Presence stands in the glass, staring back out of it
      this.entity.spawnAt(spot.x, spot.z, this.player.pos.x, this.player.pos.z, 'idle', { dwell: 0.34, hold: true });
      this.witnessState = { expires: this._nowS() + 3.4, armed: false, intensity: 0.62, hush: false };
    } else {
      this.darkEyes(spot, { force: true, life: 1.15, scale: 1.18, count: 3, sound: false, shadowOpacity: 0.78, eyeGap: 0.15 });
    }
    this._after(() => {
      if (this.ended) return;
      this.ctx.ui.blink(55, 220);
      this._torchStutter();
    }, 240);
    this._after(() => { if (!this.ended) Audio.whisper(this._behind(0.85)); }, 520);
    this.quietUntil = Math.max(this.quietUntil, this._nowS() + 2.2);
    return true;
  }

  // creeps toward you and freezes whenever watched
  approach(x, z) {
    if (this.ended) return;
    this.entity.spawnAt(x, z, this.player.pos.x, this.player.pos.z, 'approach', { speed: 1.0, dwell: 0.8 });
  }
  guard(x, z) {
    this.entity.spawnAt(x, z, this.player.pos.x, this.player.pos.z, 'guard', { dwell: 99999 });
  }

  // --- the threshold guardian: the heart of the game's fear ----------------
  // The Presence stands ON the thing you need (a key, a door, the way down) and
  // does not move. To progress you have to walk up to it — and it LOOMS larger
  // and more agitated the nearer you get. You know exactly where to go. Going
  // there is the hard part. Call dismissGuardian() the instant you commit (grab
  // the key / open the door) and it pays off.
  sentinelAt(x, z, opts = {}) {
    if (this.ended) return;
    // Take sole ownership of the Presence. A stale witnessState from an earlier
    // glimpse would otherwise expire and despawn the guardian out from under you.
    this.witnessState = null;
    this.entity.spawnAt(x, z, this.player.pos.x, this.player.pos.z, 'guard', { dwell: 9999999 });
    this._sentinel = { x, z };
    Audio.hush(0.8);
    Audio.bumpHeart(0.3, 78);
  }
  dismissGuardian(type = 'shriek') {
    if (!this._sentinel) return;
    this._sentinel = null;
    if (this.entity.isVisible && this.entity.mode === 'guard') {
      this.stinger(type);
      // it was real, and now it's folding away right in your face
      this.entity.despawn(Audio);
    }
    this.player.speedScale = 1;            // RELEASE the dread-walk on the same beat — you can flee now
    this.ctx.post.set('dread', 0.2);
    this.ctx.post.set('tunnel', 0.0);
  }
  // per-frame: dread, heart and breath climb as you near the guardian — the
  // approach should get physically harder to make.
  _updateSentinel() {
    if (!this._sentinel || !this.entity.isVisible) return;
    const p = this.player.pos;
    const d = Math.hypot(p.x - this._sentinel.x, p.z - this._sentinel.z);
    const near = THREE.MathUtils.clamp(1 - (d - 1.0) / 7, 0, 1);
    this.ctx.post.set('dread', Math.max(this.ctx.post.target.dread || 0, near * 0.8));
    this.ctx.post.set('tunnel', Math.pow(near, 1.6) * 0.55);
    Audio.setTension(Math.max(Audio.tension, 0.5 + near * 0.5));
    Audio.bumpBreath?.(near * 0.7);
    if (near > 0.25) this.player.addShake(near * 0.045);
    this.player.speedScale = Math.min(this.player.speedScale, 1 - near * 0.4);   // dread-walk into it
  }

  // ---- THE HUNT: a predator in the dark ------------------------------------
  // Not a spook that pops and vanishes. A thing that comes for you — you hear it
  // closing in (its footsteps, your own heart), it commits to a chase when it
  // catches sight of you, and if it reaches you it HAS you. This is the fear the
  // whole game hangs on; it grows the deeper you go.
  _huntIntensity() {
    // The forest is the quiet opening — it establishes the dread before the
    // predator arrives. From the house on, something is hunting you, and it gets
    // worse the deeper you go. (The basement keeps its own scripted chase.)
    return {
      mansion: 0.30,
      conservatory: 0.40, library: 0.48, nursery: 0.58,
      bathhouse: 0.68, gallery: 0.80, chapel: 0.92,
    }[this.zone] || 0;
  }
  _updateHunt(dt) {
    const intensity = this._huntIntensity();
    if (intensity <= 0 || this.ended || this._plunging) return;
    const e = this.entity;

    if (!this._hunting) {
      this._huntTimer -= dt;
      // only begin a hunt when the Presence is free (no guardian / scripted beat)
      if (this._huntTimer <= 0 && !e.isVisible && !this._sentinel) this._beginStalk(intensity);
      return;
    }

    // a hunt is live. If a scripted beat or the guardian stole the entity, end it.
    if (!e.isVisible || e.mode !== 'chase') { this._endHunt(); return; }

    const d = e.distanceTo(this.player.pos);
    const near = THREE.MathUtils.clamp(1 - d / 15, 0, 1);
    // a low sound FROM the creature now and then, so you can place it in the dark
    // — a wet drag, a breath. The closer it is, the more often you hear it.
    this._huntSoundT -= dt;
    if (this._huntSoundT <= 0) {
      this._huntSoundT = (3.4 - near * 1.8) + Math.random() * 2;
      const cp = new THREE.Vector3(e.pos.x, 1.3, e.pos.z);
      if (Math.random() < 0.5) Audio.moan(cp); else Audio.whisper(cp);
    }
    // the sustained dread: it gets louder, your heart and breath climb, the
    // picture tightens — all keyed to how close the thing actually is.
    Audio.setTension(Math.max(Audio.tension, 0.42 + near * 0.5));
    if (near > 0.28) { Audio.bumpHeart(near * 0.32, 78 + near * 62); Audio.bumpBreath?.(near * 0.5); }
    this.ctx.post.set('dread', Math.max(this.ctx.post.target.dread || 0, near * 0.55));
    this.ctx.post.set('aberration', 0.0015 + near * near * 0.004);

    // it stalks slowly until it has eyes on you and is close — then it COMMITS
    const sees = e.observedTime > 0.04 || d < 3.5;
    e.speed = (sees && d < 9) ? (3.3 + intensity * 1.4) : (1.4 + intensity * 0.8);

    // If maze walls stall it (no pathfinding, it just slides), and you can't see
    // it, it "finds another way in" FAST — relocate closer, behind you, out of
    // sight — so it isn't left grinding into a wall. Quick, so the clipping the
    // user saw is at most a brief glimpse, not its whole behaviour.
    if (d < this._huntLastD - 0.12) this._huntStuckT = 0; else this._huntStuckT += dt;
    this._huntLastD = d;
    if (this._huntStuckT > 1.6 && !sees && d > 3.5) { this._repositionHunter(7.5); this._huntStuckT = 0; }

    // put real distance between you and it loses you — a held breath of relief
    if (d > 22) { this._huntLost += dt; if (this._huntLost > 3.2) { Audio.hush(1.3); this._endHunt(); } }
    else this._huntLost = 0;
  }
  _repositionHunter(dist) {
    const p = this.player;
    let sx = p.pos.x - p.forward.x * dist, sz = p.pos.z - p.forward.z * dist;
    if (this.field && !this.field.segmentClear(p.pos.x, p.pos.z, sx, sz)) {
      for (let a = 0; a < 7; a++) {
        const ang = Math.random() * Math.PI * 2, dd = dist * 0.85 + Math.random() * 3;
        const tx = p.pos.x + Math.cos(ang) * dd, tz = p.pos.z + Math.sin(ang) * dd;
        if (this.field.segmentClear(p.pos.x, p.pos.z, tx, tz)) { sx = tx; sz = tz; break; }
      }
    }
    this.entity.pos.set(sx, 0, sz);
    Audio.footstep(this.entity.pos, this._wet());   // a step from its new, nearer position
  }
  _beginStalk(intensity) {
    const p = this.player;
    let sx = p.pos.x - p.forward.x * 13, sz = p.pos.z - p.forward.z * 13;   // from behind, in the dark
    if (this.field && !this.field.segmentClear(p.pos.x, p.pos.z, sx, sz)) {
      let found = false;
      for (let a = 0; a < 7; a++) {
        const ang = Math.random() * Math.PI * 2, dd = 10 + Math.random() * 4;
        const tx = p.pos.x + Math.cos(ang) * dd, tz = p.pos.z + Math.sin(ang) * dd;
        if (this.field.segmentClear(p.pos.x, p.pos.z, tx, tz)) { sx = tx; sz = tz; found = true; break; }
      }
      if (!found) { this._huntTimer = 4; return; }    // nowhere clear — try again soon
    }
    this.entity.spawnAt(sx, sz, p.pos.x, p.pos.z, 'chase', {
      speed: 1.4 + intensity * 0.8, wet: this._wet(), onReach: () => this._caughtByHunter(),
    });
    this._hunting = true; this._huntLost = 0;
    this._huntLastD = Math.hypot(sx - p.pos.x, sz - p.pos.z); this._huntStuckT = 0; this._huntSoundT = 1.6;
    Audio.hush(0.7);                          // a beat of silence — then you hear it move
    Audio.distantScream(this._near(22, 2));   // something woke up, somewhere back there
  }
  _endHunt() {
    if (this.entity.isVisible && this.entity.mode === 'chase') this.entity.despawn(Audio, true);
    this._hunting = false; this._huntLost = 0;
    const intensity = this._huntIntensity() || 0.4;
    this._huntTimer = (20 - intensity * 11) + Math.random() * (16 - intensity * 9);   // cooldown, shorter when deeper
  }
  // IT HAS YOU. Not a death — a violation, then it throws you down and recedes,
  // and your light is gone for a moment in the dark where it just was.
  _caughtByHunter() {
    if (this.ended) { this._hunting = false; return; }
    const p = this.player, post = this.ctx.post, ui = this.ctx.ui;
    this._hunting = false;
    this.stinger('shriekHard');
    // the screen is its face, right on you
    this.entity.spawnAt(p.pos.x - p.forward.x * 0.85, p.pos.z - p.forward.z * 0.85, p.pos.x, p.pos.z, 'guard', { dwell: 9 });
    post.set('dread', 1); post.set('tunnel', 1); post.set('desat', 0.7); post.set('aberration', 0.03);
    p.addShake(1.9); p.frozen = true;
    Audio.setMuffle(380, 0.08); Audio.bumpHeart(1, 152); Audio.bumpBreath?.(1);
    ui.buzz([120, 60, 220]);
    this._after(() => { if (!this.ended) { ui.blink(160, 520); Audio.stinger('growl'); p.addShake(1.2); } }, 300);
    this._after(() => {
      if (this.ended) return;
      this.entity.hardHide();
      p.frozen = false;
      p.flashOn = false;                  // thrown down in the dark — the torch is gone for a beat (watchdog brings it back)
      post.set('dread', 0.35); post.set('tunnel', 0.25); post.set('desat', 0.35); post.set('aberration', 0.0015);
      Audio.setMuffle(20000, 1.8);
      this._endHunt();
      this._huntTimer += 9;               // a longer reprieve after it's had you
    }, 1450);
  }

  // ---- scripted beats ------------------------------------------------------
  // One call lands a full jump-scare: audio stinger, white flash, post pulse,
  // camera shake, a heartbeat punch, and a haptic buzz on mobile.
  stinger(type, pos) {
    this.lastLoud = this._nowS();      // any full stinger resets the loud cooldown
    this.quietUntil = Math.max(this.quietUntil, this.lastLoud + (type === 'breath' ? 1.8 : 3.2));
    const hard = type === 'shriekHard';
    Audio.stinger(type);
    this.ctx.ui.flashWhite(hard ? 0.95 : (type === 'breath' ? 0.35 : 0.7), REDUCED_MOTION ? 120 : 220);
    this.ctx.post.kick('pulse', REDUCED_MOTION ? 0.2 : 0.7);
    this.player.addShake(hard ? 1.2 : 0.7);
    Audio.bumpHeart(1, 110);
    Audio.bumpBreath?.(hard ? 0.95 : 0.7);    // the breath catches and quickens
    this.ctx.ui.buzz(hard ? [70, 50, 140] : (type === 'breath' ? 30 : 60));
  }

  pickupScare(pos) {
    this.stinger('shriek', pos);
    // it is suddenly very close, then gone
    const p = this.player.pos, a = this.player.yaw + Math.PI; // behind
    this.entity.spawnAt(p.x + Math.sin(a) * 2.2, p.z + Math.cos(a) * 2.2, p.x, p.z, 'idle', { dwell: 0.12 });
    Audio.setTension(Math.min(1, Audio.tension + 0.25));
  }

  basementKeyScare(pos) {
    // the lights die, a breath, then the house exhales something at you
    this.player.flashOn = false;
    this.ctx.ui.flashWhite(0.2, 120);
    Audio.stinger('breath');
    Audio.bumpHeart(0.8, 100);
    this._after(() => { this.player.flashOn = true; this.stinger('shriek'); this.approach(pos.x, pos.z + 3); }, 1400);
    Audio.setTension(0.7);
  }

  // A waking nightmare: something horrifying is RIGHT THERE — then a blink, and
  // it was never there at all. No white flash; this one creeps and crushes.
  hallucinate(x, z) {
    if (this.ended || this.entity.isVisible) return;
    const p = this.player;
    const tok = ++this._halluTok;                                       // claim this hallucination
    this.entity.spawnAt(x, z, p.pos.x, p.pos.z, 'idle', { dwell: 9 });   // looms, won't auto-vanish
    Audio.stinger('growl'); Audio.bumpHeart(0.9, 110);
    this.ctx.post.set('dread', 0.75); this.ctx.post.set('tunnel', 0.5); this.ctx.post.set('desat', 0.55);
    p.addShake(0.7); this.ctx.ui.buzz([60, 40, 110]);
    this._after(() => {
      this.ctx.post.set('dread', 0); this.ctx.post.set('tunnel', 0); this.ctx.post.set('desat', 0.25);
      if (this.ended || tok !== this._halluTok) return;                 // something else took the Presence — leave it be
      this.ctx.ui.blink(90, 360);
      this.entity.despawn(Audio, true);
    }, 1150);
  }

  startChase(x, z) {
    if (this.ended) return;
    this.chaseActive = true;
    this.entity.spawnAt(x, z, this.player.pos.x, this.player.pos.z, 'chase', {
      speed: 3.4, onReach: () => this.caught(),
    });
    this.entity.onReach = () => this.caught();
    Audio.setTension(0.95);
    Audio.duck(0.3, 0.2);
    this.ctx.post.set('aberration', 0.004);
  }
  stopChase() {
    if (!this.chaseActive) return;
    this.chaseActive = false;
    this.entity.despawn(Audio, true);
    this.ctx.post.set('aberration', 0.0015);
    Audio.setTension(0.55);
    Audio.duck(1.0, 0.6);   // startChase ducked the ambient bed — restore it
  }
  caught() {
    // not a death — a violent blink, then the Presence is flung back a few
    // metres so you get a moment to keep fleeing. (We do NOT teleport the
    // player: a blind shove could push you through a wall into the void.)
    this.stinger('shriekHard');
    this.ctx.ui.blink(120, 400);
    Audio.setMuffle(500, 0.1);
    this._after(() => Audio.setMuffle(20000, 1.5), 600);
    this._after(() => {
      if (!this.chaseActive || this.ended) return;
      const p = this.player, a = p.yaw;          // behind the player, in the maze
      this.entity.spawnAt(p.pos.x + Math.sin(a) * 7, p.pos.z + Math.cos(a) * 7, p.pos.x, p.pos.z, 'chase', { speed: 3.4, onReach: () => this.caught() });
    }, 250);
  }

  // A level-end PLUNGE: you flee the chase into the glowing doorway expecting
  // escape — and the Presence is already there, filling it. Shriek, lunge,
  // tunnel-crush, black. You didn't get out. You went deeper. (Used at the end
  // of the basement, which once dropped you straight at the eye.)
  plungeInto(next) {
    if (this.ended || this._plunging) return;
    this._plunging = true;
    this.stopChase();
    const p = this.player, post = this.ctx.post, ui = this.ctx.ui;
    p.frozen = true; p.speedScale = 0.12;
    const fwd = p.yaw + Math.PI;                                   // the doorway you're walking INTO
    // it fills the doorway, leaning into you, eyes up
    this.entity.spawnAt(p.pos.x + Math.sin(fwd) * 1.55, p.pos.z + Math.cos(fwd) * 1.55, p.pos.x, p.pos.z, 'guard', { dwell: 999 });
    this.stinger('shriekHard');
    Audio.bumpHeart(1, 142);
    Audio.crescendo(2.4);
    post.set('dread', 1); post.set('tunnel', 0.96); post.set('desat', 0.6); post.set('aberration', 0.02);
    p.addShake(1.5);
    this._after(() => { if (this._plunging) { ui.blink(110, 320); Audio.stinger('growl'); p.addShake(1.1); } }, 540);
    // Snap to true black FIRST, so there's no lit gap — the blink's flash reopens
    // before the handoff, and go()'s slow 850ms fade would otherwise start from a
    // lit screen. Black it out fast, THEN hand off, so you really go dark.
    this._after(() => {
      if (!this._plunging) return;
      ui.fade.style.transition = 'opacity 200ms ease';
      ui.fade.style.opacity = '1';
    }, 980);
    this._after(() => {
      this._plunging = false;
      this.entity.hardHide();          // hard-cut behind the black, not a slow fold
      Audio.stopCrescendo();
      post.set('dread', 0.2); post.set('tunnel', 0.2); post.set('desat', 0.3); post.set('aberration', 0.0015);
      p.frozen = false; p.speedScale = 1;
      this.ctx.go(next);                                           // go() keeps holding the black we're already in
    }, 1180);
  }

  // ---- the ending ----------------------------------------------------------
  beginEnding(relicPos, eye) {
    if (this.ended) return; this.ended = true;
    const p = this.player, ui = this.ctx.ui, post = this.ctx.post;
    p.frozen = true;
    p.speedScale = 0.18;
    p.forceLook(new THREE.Vector3(0, 2.5, -29.4), 0.92);   // wrench your gaze to the eye

    if (eye) {
      eye.userData.endBloom = 0.01;
      eye.userData.openness = 0.35;
      eye.userData.glow.intensity = 36;
    }
    Audio.hush(1.6);
    Audio.stopCrescendo();   // retire the approach rise so the climax swell starts clean, not stacked
    Audio.crescendo(9);
    Audio.bumpHeart(1, 132);
    post.set('dread', 1);
    post.set('tunnel', 0.72);
    post.set('aberration', 0.012);
    p.addShake(0.85);

    this._after(() => {
      if (eye) { eye.userData.openness = 1; eye.userData.glow.intensity = 105; eye.userData.pupil.scale.setScalar(1.9); }
      this.entity.spawnAt(p.pos.x + Math.sin(p.yaw + Math.PI) * 1.25, p.pos.z + Math.cos(p.yaw + Math.PI) * 1.25, p.pos.x, p.pos.z, 'idle', { dwell: 99 });
      this.stinger('shriekHard');
      post.set('tunnel', 1);
      p.addShake(1.4);
    }, 900);

    this._after(() => {
      ui.blink(80, 520);
      Audio.whisper(this._behind(0.9));
      p.flashOn = false;
    }, 1850);

    this._after(() => {
      p.flashOn = true;
      // IN FRONT (yaw+PI is forward) — your gaze is locked on the eye, so a reveal
      // behind you would be invisible. It's right there between you and the eye.
      this.entity.spawnAt(p.pos.x + Math.sin(p.yaw + Math.PI) * 1.2, p.pos.z + Math.cos(p.yaw + Math.PI) * 1.2, p.pos.x, p.pos.z, 'idle', { dwell: 99 });
      this.stinger('growl');
      post.set('aberration', 0.026);
      p.addShake(1.6);
    }, 3000);

    this._after(() => {
      ui.fade.style.transition = 'opacity 500ms ease';
      ui.fade.style.opacity = '1';
      Audio.stopCrescendo();
      Audio.fadeOut(1.2);
    }, 5200);

    this._after(() => { this.ctx.endGame(); }, 7700);   // black holds before the card
  }

  // ---- per-frame: failing torch + systemic dread ---------------------------
  update(dt) {
    // entity behaviour
    this.entity.update(dt, this.player, this.field, Audio);
    this._updateWitness(dt);
    this._updateEphemera(dt);

    // During the ending OR the basement plunge, a scripted beat OWNS the post FX
    // and the torch. Bail before the per-frame base writes below, or they stomp
    // the plunge's dread=1/tunnel=0.96 down to 0.42 every single frame.
    if (this.ended || this._plunging) { this.player.flicker = 1; return; }

    this._updateFearWeight(dt);
    this._updateTorch(dt);
    this._updateDread(dt);

    // picture pressure creeps with tension; final/ending levels can still
    // override these later in the frame.
    const t = Audio.tension;
    this.ctx.post.set('aberration', 0.0015 + t * 0.0028);
    this.ctx.post.set('vignette', 0.92 + t * 0.16);
    this.ctx.post.set('desat', 0.18 + t * 0.18);
    this.ctx.post.set('dread', Math.min(0.42, t * 0.34));

    this._updateHunt(dt);     // a stalking predator overrides the ambient dread
    this._updateSentinel();   // overrides dread/tunnel/speed when a guardian is up
  }

  // ---- the failing torch (mostly cosmetic; an occasional longer stutter) ----
  _updateTorch(dt) {
    if (REDUCED_MOTION) { this.flickering = false; this.player.flicker = 1; return; }
    const t = this._nowS() + this.flickerSeed;
    if (this.flickering) {
      this.flickT -= dt;
      const wave = 0.5 + 0.5 * Math.sin(t * 41.0) * Math.sin(t * 17.0 + 1.7);
      const drop = Math.random() < 0.16 ? 0.12 + Math.random() * 0.22 : 0.42 + wave * 0.54;
      this.player.flicker = THREE.MathUtils.clamp(drop, 0.08, 1.0);
      if (this.flickT <= 0) { this.flickering = false; this.player.flicker = 1; }
    } else {
      this.player.flicker = 0.982 + Math.sin(t * 5.1) * 0.009 + Math.sin(t * 13.7) * 0.005 - Audio.tension * 0.018;
    }
  }
  _torchStutter() { if (REDUCED_MOTION) return; this.flickering = true; this.flickT = 0.2 + Math.random() * 0.4; }

  _updateFearWeight(dt) {
    // A subtle heavy-limbed feel at high dread. It never becomes a mechanic:
    // no new rule to learn, just a tiny physical unease outside chases.
    const target = this.chaseActive ? 1 : 1 - Audio.tension * 0.045;
    this.player.speedScale += (target - this.player.speedScale) * Math.min(1, dt * 0.8);
  }

  _updateWitness(dt) {
    if (!this.witnessState) return;
    if (this.ended || !this.entity.isVisible) { this.witnessState = null; return; }
    if (this._nowS() > this.witnessState.expires) {
      this.entity.despawn(Audio, true);
      this.witnessState = null;
      return;
    }
    if (!this.witnessState.armed && this.entity.observedTime > 0.045) {
      this.witnessState.armed = true;
      Audio.stinger('breath');
      Audio.bumpHeart(0.65, 102);
      Audio.setTension(Math.min(1, Audio.tension + 0.18 + this.witnessState.intensity * 0.12));
      this.ctx.post.kick('pulse', REDUCED_MOTION ? 0.15 : 0.45);
      this.player.addShake(0.35 + this.witnessState.intensity * 0.25);
      this.ctx.ui.buzz([25, 35]);
      this._torchStutter();
      this.entity.dwell = Math.min(this.entity.dwell, 0.18);
      this.quietUntil = Math.max(this.quietUntil, this._nowS() + 1.4);
    }
  }

  // ---- the dread scheduler -------------------------------------------------
  // Most beats are quiet. Now and then the room "builds" — and that build pays
  // off with a real scare only if the loud cooldown allows; otherwise it
  // collapses into silence. So you're always braced, rarely actually hit.
  _updateDread(dt) {
    // While a predator is actively hunting you, the ambient spook scheduler goes
    // quiet — the hunt IS the dread, and random pops on top of it would only
    // dilute it. The held quiet between hunts is what makes the next one land.
    if (this._hunting) { this.dreadTimer = Math.max(this.dreadTimer, 2.0); return; }
    if (this._nowS() < this.quietUntil) {
      this.dreadTimer = Math.max(this.dreadTimer, 1.0);
      return;
    }
    this.dreadTimer -= dt;
    if (this.dreadTimer > 0) return;
    const t = Audio.tension;
    // Beats are RARER now — long stretches of quiet unease, so each cue carries
    // weight instead of becoming wallpaper you tune out.
    this.dreadTimer = (11.0 + Math.random() * 11) - t * 3.2;

    const sinceLoud = this._nowS() - this.lastLoud;
    if (Math.random() < 0.76 || sinceLoud < this.LOUD_GAP * 0.5) this._softBeat(t);
    else this._buildBeat(t);

    // tension simmers down between beats so it has room to rise again — but it
    // simmers down to a HIGHER floor the deeper you are, so the back half of the
    // game is heavier even at rest. The dread genuinely escalates.
    Audio.setTension(Math.max(this._zoneFloor(), Audio.tension - 0.06));
  }

  _zoneFloor() {
    return {
      forest: 0.12, mansion: 0.24, basement: 0.40,
      conservatory: 0.34, library: 0.42, nursery: 0.48,
      bathhouse: 0.54, gallery: 0.58, chapel: 0.66, final: 0.74,
    }[this.zone] ?? 0.34;
  }

  _behind(dist = 3) {
    const a = this.player.yaw + Math.PI;
    return new THREE.Vector3(this.player.pos.x + Math.sin(a) * dist, 1.4, this.player.pos.z + Math.cos(a) * dist);
  }
  _near(radius = 9, y = 2) {
    const p = this.player.pos;
    return new THREE.Vector3(p.x + (Math.random() - 0.5) * radius, y, p.z + (Math.random() - 0.5) * radius);
  }

  _eyeSpot(opts = {}) {
    const p = this.player.pos;
    const forward = this.player.yaw + Math.PI;
    const side = Math.random() < 0.5 ? -1 : 1;
    const distances = [opts.dist ?? 6.5, 4.6, 8.4, 10.5];
    const offsets = [opts.off ?? 0.64, 1.08, -0.72, 0.22].map((o) => o * side);
    for (const d of distances) {
      for (const off of offsets) {
        const a = forward + off;
        const x = p.x + Math.sin(a) * d;
        const z = p.z + Math.cos(a) * d;
        if (!this.field || this.field.segmentClear(p.x, p.z, x, z)) {
          return new THREE.Vector3(x, opts.y ?? (1.3 + Math.random() * 0.45), z);
        }
      }
    }
    const a = forward + side * 0.8;
    return new THREE.Vector3(p.x + Math.sin(a) * 4.2, opts.y ?? 1.45, p.z + Math.cos(a) * 4.2);
  }

  _updateEphemera(dt) {
    for (let i = this.ephemera.length - 1; i >= 0; i--) {
      const g = this.ephemera[i];
      const e = g.userData.ephemeral;
      if (!e) { this.ephemera.splice(i, 1); continue; }
      e.age += dt;
      const k = THREE.MathUtils.clamp(1 - e.age / e.life, 0, 1);
      const pulse = 1 + Math.sin(e.age * 38) * 0.035;
      g.scale.setScalar(e.baseScale * (0.92 + k * 0.08) * pulse);
      for (const m of e.mats) m.opacity = (m.userData.baseOpacity ??= m.opacity) * k * k;
      if (e.age >= e.life) {
        g.parent?.remove(g);
        g.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        this.ephemera.splice(i, 1);
      }
    }
  }

  _clearEphemera() {
    for (const g of this.ephemera) {
      g.parent?.remove(g);
      g.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.ephemera.length = 0;
  }

  _sightlineWitness(opts = {}) {
    if (this.entity.isVisible || this.ended) return false;
    const p = this.player.pos;
    const forward = this.player.yaw + Math.PI;
    const side = Math.random() < 0.5 ? -1 : 1;
    const distances = [opts.dist ?? 7.5, 5.8, 9.0, 4.8];
    const offsets = [opts.off ?? 0.48, 0.82, -0.58, 1.05].map((o) => o * side);
    for (const d of distances) {
      for (const off of offsets) {
        const a = forward + off;
        const x = p.x + Math.sin(a) * d;
        const z = p.z + Math.cos(a) * d;
        if (!this.field || this.field.segmentClear(p.x, p.z, x, z)) {
          return this.witness(x, z, {
            dwell: opts.dwell ?? 0.38,
            life: opts.life ?? 4.2,
            intensity: opts.intensity ?? 0.45,
            hush: opts.hush ?? 0.8,
          });
        }
      }
    }
    return false;
  }

  // a quiet dread cue, weighted by tension — never flashes the screen
  _softBeat(t) {
    const wet = this._wet();
    const zone = this.zone;
    const leaf = zone === 'forest' || zone === 'conservatory';
    const opts = [
      [3, () => Audio.whisper(this._behind())],
      [2, () => Audio.creak(this._near(10))],
      [wet ? 3 : 1, () => Audio.drip(this._near(8))],
      [1 + t * 2, () => Audio.moan(this._near(14, 1.5))],
      [t * 2.2, () => Audio.distantScream(this._near(20, 2))],
      [t * 3, () => { if (t > 0.3) this._approachFootsteps(); }],
      [2.2 + t * 3.6, () => this.darkEyes()],
      [1.1 + t * 2.0, () => this.shadowFold()],
      [0.7 + t * 1.4, () => { if (t > 0.3 && !this.entity.isVisible) this.peripheral(); }],
      [0.5 + t * 1.9, () => { if (t > 0.4 && !this.entity.isVisible) this.behindYou(); }],   // it's right behind you
      [1.1 + t * 2.6, () => { if (t > 0.24) this._sightlineWitness({ intensity: 0.35 + t * 0.35 }); }],
      [0.9 + t * 2.0, () => this._wallHit()],
      [0.5 + t * 1.6, () => this._falseBlink()],
      [1 + t * 1.5, () => { if (t > 0.3) this._torchStutter(); }],
      // --- per-zone signature so each level's ambient dread sounds its own way ---
      [leaf ? 2.6 : 0, () => Audio.rustle(this._near(7))],                                  // leaves shifting nearby
      [(zone === 'library' || zone === 'gallery') ? 2.2 : 0, () => Audio.creak(this._near(8))], // settling wood / frames
      [zone === 'nursery' ? 1.4 + t * 1.6 : 0, () => Audio.moan(this._near(10, 1.3))],      // a small voice
      [(zone === 'chapel' || zone === 'final') ? 1.6 + t * 2.6 : 0, () => Audio.distantScream(this._near(18, 2))],
    ];
    const total = opts.reduce((s, o) => s + o[0], 0);
    let r = Math.random() * total;
    for (const [w, fn] of opts) { if ((r -= w) <= 0) { fn(); return; } }
  }

  // the room holds its breath and tightens — then either lands a scare or doesn't
  _buildBeat(t) {
    Audio.setTension(Math.min(1, t + 0.3));
    Audio.bumpHeart(0.5, 95);
    Audio.hush(1.3);
    if (!this.entity.isVisible && Math.random() < 0.65) this._sightlineWitness({ dist: 6.0, intensity: 0.7, hush: false });
    this._after(() => {
      if (this.ended) return;
      if (this._canLoud() && Math.random() < 0.6) this._loudScare();
      else { Audio.bumpHeart(0.3, 80); if (Math.random() < 0.5) Audio.whisper(this._behind(1.5)); }  // fake-out
    }, 1300);
  }

  // a real jump-scare, varied: breath (intimate) is most common, the full
  // shriek is rare, shriekHard only when you're already terrified.
  _loudScare() {
    const variant = Math.random();
    if (variant < 0.24) { this._blackoutReveal(); return; }   // torch-death reveal
    if (variant < 0.36) { this._nearMiss(); return; }
    if (variant < 0.50) {
      this.darkEyes(null, { force: true, life: 1.0, scale: 1.15, count: 3, heart: 0.55, bpm: 96 });
      this._after(() => { if (!this.ended) this.stinger('breath'); }, 130);
      return;
    }
    const t = Audio.tension, r = Math.random();
    let type = 'breath';
    if (t > 0.8 && r < 0.25) type = 'shriekHard';
    else if (r < 0.5) type = 'breath';
    else if (r < 0.78) type = 'shriek';
    else type = 'growl';
    // half the time the Presence is right there for the hit, then gone
    if (Math.random() < 0.5) {
      const p = this.player.pos, a = this.player.yaw + (Math.random() - 0.5) * 0.9;
      this.entity.spawnAt(p.x + Math.sin(a) * 2.4, p.z + Math.cos(a) * 2.4, p.x, p.z, 'idle', { dwell: 0.12 });
    }
    this.stinger(type);
  }

  // footsteps closing in from behind, getting nearer — then nothing
  _approachFootsteps() {
    let d = 6;
    const step = () => {
      if (this.ended || d < 1.2) { if (d < 1.2) Audio.bumpHeart(0.4, 92); return; }
      const a = this.player.yaw + Math.PI;
      Audio.footstep(new THREE.Vector3(this.player.pos.x + Math.sin(a) * d, 1, this.player.pos.z + Math.cos(a) * d), this._wet());
      d -= 1.0;
      this._after(step, 360);
    };
    step();
  }

  _wallHit() {
    const p = this.player.pos;
    const side = Math.random() < 0.5 ? -1 : 1;
    const a = this.player.yaw + side * Math.PI / 2;
    const pos = new THREE.Vector3(p.x + Math.sin(a) * (2.5 + Math.random() * 2), 1.3, p.z + Math.cos(a) * (2.5 + Math.random() * 2));
    Audio.slam(pos);
    Audio.bumpHeart(0.25, 84);
    this.ctx.post.kick('pulse', 0.25);
  }

  _falseBlink() {
    if (REDUCED_MOTION || this.ended) return;
    this.ctx.ui.blink(38, 160);
    this._after(() => {
      if (!this.ended && Math.random() < 0.45) Audio.whisper(this._behind(1.1));
    }, 70);
  }

  _nearMiss() {
    if (this.entity.isVisible || this.ended) return;
    const moved = this.crabSkitter();
    if (!moved) this.shadowFold(null, { life: 0.72, scale: 1.18 });
    this._after(() => {
      if (this.ended) return;
      this.stinger(Math.random() < 0.55 ? 'breath' : 'growl');
      this.player.addShake(0.55);
    }, 160);
  }

  _blackoutReveal() {
    // torch dies; when it returns, the Presence is right there — then gone
    const p = this.player;
    p.flashOn = false;
    Audio.bumpHeart(0.7, 100);
    const a = p.yaw + (Math.random() - 0.5) * 0.6;
    this._after(() => {
      p.flashOn = true;            // restore FIRST, so nothing below can leave you blind
      if (this.ended) return;
      this.entity.spawnAt(p.pos.x + Math.sin(a) * 3, p.pos.z + Math.cos(a) * 3, p.pos.x, p.pos.z, 'idle', { dwell: 0.1 });
      this.stinger(Math.random() < 0.5 ? 'breath' : 'shriek');
    }, 500 + Math.random() * 500);
  }
}
