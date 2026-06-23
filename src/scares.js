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

    this.flick = 1; this.flickering = false; this.flickT = 0;
    this.nextFlicker = 6 + Math.random() * 6;
    this.ambientTimer = 4 + Math.random() * 4;
    this.chaseActive = false;
    this.ended = false;
    this.objective = 'forest';
  }

  setField(f) { this.field = f; }
  reset() { this.entity.despawn(Audio, true); this.chaseActive = false; }

  setObjective(name) {
    this.objective = name;
    if (name === 'mansion') Audio.setTension(0.35);
    if (name === 'basement') Audio.setTension(0.6);
  }

  // ---- entity placement primitives (called by level triggers) --------------
  // a still figure that appears off to the side and vanishes when you look
  lurk(x, z) {
    if (this.entity.isVisible || this.ended) return;
    this.entity.spawnAt(x, z, this.player.pos.x, this.player.pos.z, 'idle', { dwell: 0.5 });
  }
  // spawn just outside your view, behind/beside you
  peripheral() {
    if (this.entity.isVisible || this.ended) return;
    const p = this.player.pos, fy = this.player.yaw;
    const ang = fy + (Math.random() < 0.5 ? 1 : -1) * (1.6 + Math.random() * 0.8);
    const d = 7 + Math.random() * 4;
    const x = p.x + Math.sin(ang) * d, z = p.z + Math.cos(ang) * d;
    this.entity.spawnAt(x, z, p.x, p.z, 'idle', { dwell: 0.35 });
    Audio.bumpHeart(0.5, 90);
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
  stinger(type, pos) {
    Audio.stinger(type);
    this.ctx.ui.flashWhite(type === 'shriekHard' ? 0.95 : 0.7, 220);
    this.ctx.post.kick('pulse', 0.7);
    this.player.addShake(type === 'shriekHard' ? 1.2 : 0.7);
    Audio.bumpHeart(1, 110);
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
    // not a death — a violent slip that throws you onward
    this.stinger('shriekHard');
    this.ctx.ui.blink(120, 400);
    Audio.setMuffle(500, 0.1);
    setTimeout(() => Audio.setMuffle(20000, 1.5), 600);
    // shove the player a few metres along their facing so they keep fleeing
    const p = this.player, a = p.yaw;
    setTimeout(() => {
      p.teleport(p.pos.x - Math.sin(a) * 3, p.pos.z - Math.cos(a) * 3, a);
      if (this.chaseActive) this.entity.spawnAt(p.pos.x + Math.sin(a) * 8, p.pos.z + Math.cos(a) * 8, p.pos.x, p.pos.z, 'chase', { speed: 3.4, onReach: () => this.caught() });
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

    // --- flashlight nerve ---
    if (this.flickering) {
      this.flickT -= dt;
      this.player.flicker = Math.random() < 0.5 ? (0.08 + Math.random() * 0.5) : 1;
      if (this.flickT <= 0) { this.flickering = false; this.player.flicker = 1; }
    } else {
      this.player.flicker = 1 - Math.random() * 0.025;
      this.nextFlicker -= dt;
      if (this.nextFlicker <= 0) {
        this.flickering = true;
        this.flickT = 0.15 + Math.random() * 0.35;
        this.nextFlicker = (8 + Math.random() * 10) - Audio.tension * 5;
        // sometimes a flicker hides a full blackout reveal
        if (Math.random() < 0.18 + Audio.tension * 0.3) this._blackoutReveal();
      }
    }

    // --- systemic ambient dread, scaled by tension ---
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = (5 + Math.random() * 6) - Audio.tension * 3;
      const t = Audio.tension, r = Math.random();
      const p = this.player.pos, behind = this.player.yaw + Math.PI;
      const bpos = new THREE.Vector3(p.x + Math.sin(behind) * 3, 1.4, p.z + Math.cos(behind) * 3);
      if (r < 0.3) Audio.whisper(bpos);
      else if (r < 0.5) Audio.creak(new THREE.Vector3(p.x + (Math.random() - 0.5) * 10, 2, p.z + (Math.random() - 0.5) * 10));
      else if (r < 0.65 && t > 0.3) Audio.footstep(bpos, this.objective !== 'forest');
      else if (r < 0.8 && t > 0.45 && !this.entity.isVisible) this.peripheral();
      else if (r < 0.9) Audio.drip(new THREE.Vector3(p.x + (Math.random() - 0.5) * 8, 2, p.z + (Math.random() - 0.5) * 8));
      // tension naturally simmers down between scares
      Audio.setTension(Math.max(this.objective === 'forest' ? 0.15 : 0.4, Audio.tension - 0.05));
    }

    // light aberration creep with tension
    this.ctx.post.set('aberration', 0.0015 + Audio.tension * 0.002);
  }

  _blackoutReveal() {
    // torch dies; when it returns, the Presence is right there — then gone
    const p = this.player;
    p.flashOn = false;
    Audio.bumpHeart(0.7, 100);
    const a = p.yaw + (Math.random() - 0.5) * 0.6;
    setTimeout(() => {
      this.entity.spawnAt(p.pos.x + Math.sin(a) * 3, p.pos.z + Math.cos(a) * 3, p.pos.x, p.pos.z, 'idle', { dwell: 0.1 });
      p.flashOn = true;
      this.stinger('shriek');
    }, 500 + Math.random() * 500);
  }
}
