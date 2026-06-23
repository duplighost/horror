import * as THREE from 'three';
import { Entity } from './entity.js';
import { Audio } from './audio.js';

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

    this.flickering = false; this.flickT = 0;
    this.dreadTimer = 4 + Math.random() * 4;
    this.lastLoud = -999;          // seconds; loud scares are gated by LOUD_GAP
    this.LOUD_GAP = 26;            // minimum seconds between full jump-scares
    this.chaseActive = false;
    this.ended = false;
    this.zone = 'forest';         // the level you are ACTUALLY in (set on load)
  }

  _nowS() { return performance.now() / 1000; }
  _canLoud() { return this._nowS() - this.lastLoud > this.LOUD_GAP && Audio.tension > 0.4; }
  _wet() { return this.zone === 'basement' || this.zone === 'final'; }   // wet footsteps below ground

  // called by main on every level load so dread logic knows where you are
  enterZone(name) { this.zone = name; }

  setField(f) { this.field = f; }

  // Full reset for a clean replay — clears the Presence, every timer, and any
  // leftover player state (frozen / forced-look / dimmed torch). The zone is set
  // separately by enterZone() on level load, so it's not forced here.
  reset() {
    this.entity.despawn(Audio, true);
    this.chaseActive = false;
    this.ended = false;
    this.flickering = false; this.flickT = 0;
    this.dreadTimer = 4 + Math.random() * 4;
    this.lastLoud = -999;
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
    this.entity.spawnAt(x, z, this.player.pos.x, this.player.pos.z, 'idle', { dwell: 0.5 });
  }
  // appear at the EDGE of your vision (not fully behind) so you actually catch a
  // glimpse of it standing in the fog — then it's gone the moment you look at it.
  peripheral() {
    if (this.entity.isVisible || this.ended) return;
    const p = this.player.pos;
    const fwd = this.player.yaw + Math.PI;                                  // world-angle of forward (atan2(x,z))
    const off = (Math.random() < 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.7); // ~35-75° off centre
    const ang = fwd + off, d = 8 + Math.random() * 6;
    this.entity.spawnAt(p.x + Math.sin(ang) * d, p.z + Math.cos(ang) * d, p.x, p.z, 'idle', { dwell: 0.4 });
    Audio.bumpHeart(0.45, 88);
  }
  crossPath(ax, az, bx, bz) {
    if (this.ended) return;
    this.entity.spawnAt(ax, az, bx, bz, 'cross', { speed: 2.6, target: { x: bx, z: bz } });
  }
  // creeps toward you and freezes whenever watched
  approach(x, z) {
    if (this.ended) return;
    this.entity.spawnAt(x, z, this.player.pos.x, this.player.pos.z, 'approach', { speed: 1.0, dwell: 0.8 });
  }
  guard(x, z) {
    this.entity.spawnAt(x, z, this.player.pos.x, this.player.pos.z, 'guard', { dwell: 99999 });
  }

  // ---- scripted beats ------------------------------------------------------
  // One call lands a full jump-scare: audio stinger, white flash, post pulse,
  // camera shake, a heartbeat punch, and a haptic buzz on mobile.
  stinger(type, pos) {
    this.lastLoud = this._nowS();      // any full stinger resets the loud cooldown
    const hard = type === 'shriekHard';
    Audio.stinger(type);
    this.ctx.ui.flashWhite(hard ? 0.95 : (type === 'breath' ? 0.35 : 0.7), 220);
    this.ctx.post.kick('pulse', 0.7);
    this.player.addShake(hard ? 1.2 : 0.7);
    Audio.bumpHeart(1, 110);
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
    setTimeout(() => { this.player.flashOn = true; this.stinger('shriek'); this.approach(pos.x, pos.z + 3); }, 1400);
    Audio.setTension(0.7);
  }

  // A waking nightmare: something horrifying is RIGHT THERE — then a blink, and
  // it was never there at all. No white flash; this one creeps and crushes.
  hallucinate(x, z) {
    if (this.ended || this.entity.isVisible) return;
    const p = this.player;
    this.entity.spawnAt(x, z, p.pos.x, p.pos.z, 'idle', { dwell: 9 });   // looms, won't auto-vanish
    Audio.stinger('growl'); Audio.bumpHeart(0.9, 110);
    this.ctx.post.set('dread', 0.75); this.ctx.post.set('tunnel', 0.5); this.ctx.post.set('desat', 0.55);
    p.addShake(0.7); this.ctx.ui.buzz([60, 40, 110]);
    setTimeout(() => {
      if (this.ended) return;
      this.ctx.ui.blink(90, 360);
      this.entity.despawn(Audio, true);
      this.ctx.post.set('dread', 0); this.ctx.post.set('tunnel', 0); this.ctx.post.set('desat', 0.25);
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
  }
  caught() {
    // not a death — a violent blink, then the Presence is flung back a few
    // metres so you get a moment to keep fleeing. (We do NOT teleport the
    // player: a blind shove could push you through a wall into the void.)
    this.stinger('shriekHard');
    this.ctx.ui.blink(120, 400);
    Audio.setMuffle(500, 0.1);
    setTimeout(() => Audio.setMuffle(20000, 1.5), 600);
    setTimeout(() => {
      if (!this.chaseActive || this.ended) return;
      const p = this.player, a = p.yaw;          // behind the player, in the maze
      this.entity.spawnAt(p.pos.x + Math.sin(a) * 7, p.pos.z + Math.cos(a) * 7, p.pos.x, p.pos.z, 'chase', { speed: 3.4, onReach: () => this.caught() });
    }, 250);
  }

  // ---- the ending ----------------------------------------------------------
  beginEnding(relicPos, eye) {
    if (this.ended) return; this.ended = true;
    const p = this.player, ui = this.ctx.ui, post = this.ctx.post;
    p.frozen = true;
    p.forceLook(new THREE.Vector3(0, 2.5, -29.4), 0.9);   // wrench your gaze to the eye

    // the eye flies open, the guardian lunges, everything screams
    if (eye) { eye.userData.openness = 1; eye.userData.glow.intensity = 80; eye.userData.pupil.scale.setScalar(1.6); }
    this.entity.spawnAt(p.pos.x + Math.sin(p.yaw + Math.PI) * 1.4, p.pos.z + Math.cos(p.yaw + Math.PI) * 1.4, p.pos.x, p.pos.z, 'idle', { dwell: 99 });
    this.stinger('shriekHard');
    post.set('dread', 1); post.set('tunnel', 1); post.set('aberration', 0.02);
    p.addShake(1.6);
    Audio.bumpHeart(1, 150);

    // a second stinger as it reaches you, then hard cut to silence + black
    setTimeout(() => { this.stinger('shriekHard'); p.addShake(1.6); }, 700);
    setTimeout(() => {
      ui.fade.style.transition = 'opacity 90ms ease'; ui.fade.style.opacity = '1';
      Audio.stopCrescendo(); Audio.fadeOut(0.25);
    }, 1200);
    setTimeout(() => { this.ctx.endGame(); }, 4200);   // long silent black, then the card
  }

  // ---- per-frame: failing torch + systemic dread ---------------------------
  update(dt) {
    // entity behaviour
    this.entity.update(dt, this.player, this.field, Audio);

    if (this.ended) { this.player.flicker = 1; return; }

    this._updateTorch(dt);
    this._updateDread(dt);

    // light aberration creep with tension
    this.ctx.post.set('aberration', 0.0015 + Audio.tension * 0.002);
  }

  // ---- the failing torch (mostly cosmetic; an occasional longer stutter) ----
  _updateTorch(dt) {
    if (this.flickering) {
      this.flickT -= dt;
      this.player.flicker = Math.random() < 0.5 ? (0.08 + Math.random() * 0.5) : 1;
      if (this.flickT <= 0) { this.flickering = false; this.player.flicker = 1; }
    } else {
      this.player.flicker = 1 - Math.random() * 0.025;   // a constant faint unsteadiness
    }
  }
  _torchStutter() { this.flickering = true; this.flickT = 0.2 + Math.random() * 0.4; }

  // ---- the dread scheduler -------------------------------------------------
  // Most beats are quiet. Now and then the room "builds" — and that build pays
  // off with a real scare only if the loud cooldown allows; otherwise it
  // collapses into silence. So you're always braced, rarely actually hit.
  _updateDread(dt) {
    this.dreadTimer -= dt;
    if (this.dreadTimer > 0) return;
    const t = Audio.tension;
    this.dreadTimer = (5.5 + Math.random() * 7) - t * 3;          // tenser => a touch more often

    const sinceLoud = this._nowS() - this.lastLoud;
    if (Math.random() < 0.7 || sinceLoud < this.LOUD_GAP * 0.5) this._softBeat(t);
    else this._buildBeat(t);

    // tension simmers down between beats so it has room to rise again
    Audio.setTension(Math.max(this.zone === 'forest' ? 0.12 : 0.34, Audio.tension - 0.06));
  }

  _behind(dist = 3) {
    const a = this.player.yaw + Math.PI;
    return new THREE.Vector3(this.player.pos.x + Math.sin(a) * dist, 1.4, this.player.pos.z + Math.cos(a) * dist);
  }
  _near(radius = 9, y = 2) {
    const p = this.player.pos;
    return new THREE.Vector3(p.x + (Math.random() - 0.5) * radius, y, p.z + (Math.random() - 0.5) * radius);
  }

  // a quiet dread cue, weighted by tension — never flashes the screen
  _softBeat(t) {
    const wet = this._wet();
    const opts = [
      [3, () => Audio.whisper(this._behind())],
      [2, () => Audio.creak(this._near(10))],
      [wet ? 3 : 1, () => Audio.drip(this._near(8))],
      [1 + t * 2, () => Audio.moan(this._near(14, 1.5))],
      [t * 2.2, () => Audio.distantScream(this._near(20, 2))],
      [t * 3, () => { if (t > 0.3) this._approachFootsteps(); }],
      [0.6 + t * 4, () => { if (t > 0.2 && !this.entity.isVisible) this.peripheral(); }],   // glimpses, more often
      [1 + t * 1.5, () => { if (t > 0.3) this._torchStutter(); }],
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
    if (!this.entity.isVisible && Math.random() < 0.5) this.peripheral();   // a glimpse during the swell
    setTimeout(() => {
      if (this.ended) return;
      if (this._canLoud() && Math.random() < 0.6) this._loudScare();
      else { Audio.bumpHeart(0.3, 80); if (Math.random() < 0.5) Audio.whisper(this._behind(1.5)); }  // fake-out
    }, 1300);
  }

  // a real jump-scare, varied: breath (intimate) is most common, the full
  // shriek is rare, shriekHard only when you're already terrified.
  _loudScare() {
    if (Math.random() < 0.3) { this._blackoutReveal(); return; }   // torch-death reveal
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
      setTimeout(step, 360);
    };
    step();
  }

  _blackoutReveal() {
    // torch dies; when it returns, the Presence is right there — then gone
    const p = this.player;
    p.flashOn = false;
    Audio.bumpHeart(0.7, 100);
    const a = p.yaw + (Math.random() - 0.5) * 0.6;
    setTimeout(() => {
      p.flashOn = true;            // restore FIRST, so nothing below can leave you blind
      if (this.ended) return;
      this.entity.spawnAt(p.pos.x + Math.sin(a) * 3, p.pos.z + Math.cos(a) * 3, p.pos.x, p.pos.z, 'idle', { dwell: 0.1 });
      this.stinger(Math.random() < 0.5 ? 'breath' : 'shriek');
    }, 500 + Math.random() * 500);
  }
}
