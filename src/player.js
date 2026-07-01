import * as THREE from 'three';
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
import { CFG, Quality } from './config.js?v=distinct-mazes';

// First-person body + camera + flashlight. Movement is velocity-based with
// acceleration/friction for weight, axis-resolved against the active collider
// field for wall-sliding, and topped with headbob + breathing so even standing
// still the frame is alive and uneasy.

export class Player {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, Quality.far);
    this.pos = new THREE.Vector3(0, 0, 0);   // feet on ground (y=0)
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.bobPhase = 0;
    this.breathPhase = Math.random() * 10;
    this.stamina = 1;
    this.field = null;          // ColliderField, set per level
    this.height = CFG.eyeHeight;
    this.crawl = false;         // set by crawl-space triggers; lowers the eye + slows
    this.eyeNow = CFG.eyeHeight; // smoothed eye height
    this.frozen = false;        // director can lock the player for a beat
    this.lookFrozen = false;
    this.speedScale = 1;        // dread can make limbs heavy
    this.shake = 0;             // transient camera shake amount
    this._shakeV = new THREE.Vector3();
    this._shakePhase = Math.random() * 100;
    this.headTilt = 0;          // forced look-at influence (0..1) toward target
    this.lookTarget = null;

    this._buildFlashlight();
    this._buildViewmodel();
    this.forward = new THREE.Vector3(0, 0, -1);
  }

  // A held flashlight gripped in a fist, parented to the camera. It is UNLIT
  // (MeshBasic) — the torch beam starts right at the camera and would otherwise
  // blast it to solid white, so we paint fixed dark tones instead and let only
  // the lens glow. Reads as a dark flashlight + hand silhouette with a bright eye.
  _buildViewmodel() {
    const vm = new THREE.Group();
    const B = (c) => new THREE.MeshBasicMaterial({ color: c });
    const body = B(0x303338), grip = B(0x191b1e), head = B(0x3a3e44);
    const skin = B(0x2e2017), skinHi = B(0x42301f);
    this._vmLensMat = B(0xffe9c2);                    // dimmed by flicker in update

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.033, 0.2, 16), body);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0, -0.02); vm.add(barrel);
    const gripMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.085, 16), grip);
    gripMesh.rotation.x = Math.PI / 2; gripMesh.position.set(0, 0, 0.03); vm.add(gripMesh);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.031, 0.03, 14), body);
    tail.rotation.x = Math.PI / 2; tail.position.set(0, 0, 0.088); vm.add(tail);
    const headMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.034, 0.06, 18), head);
    headMesh.rotation.x = Math.PI / 2; headMesh.position.set(0, 0, -0.15); vm.add(headMesh);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.048, 20), this._vmLensMat);
    lens.position.set(0, 0, -0.181); vm.add(lens);
    // a faint glow disc behind the lens so it reads as a light source
    const halo = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), new THREE.MeshBasicMaterial({ color: 0xffcf87, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.position.set(0, 0, -0.185); vm.add(halo); this._vmHalo = halo;

    // fist gripping the barrel
    const hand = new THREE.Group();
    const backHand = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.055, 0.075), skin);
    backHand.position.set(-0.005, -0.05, 0.03); hand.add(backHand);
    for (let i = 0; i < 4; i++) {
      const fg = new THREE.Mesh(new THREE.CapsuleGeometry(0.0125, 0.05, 3, 6), skinHi);
      fg.rotation.x = Math.PI / 2 - 0.1;
      fg.position.set(-0.03 + i * 0.02, -0.012, 0.05 - i * 0.004); hand.add(fg);
    }
    const knuck = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.02, 0.05), skinHi);
    knuck.position.set(-0.005, 0.006, 0.04); hand.add(knuck);
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.04, 3, 6), skinHi);
    thumb.rotation.set(1.1, 0, -0.6); thumb.position.set(0.042, -0.025, 0.04); hand.add(thumb);
    vm.add(hand);

    vm.position.set(0.19, -0.25, -0.5);
    vm.rotation.set(0.16, -0.18, 0.06);
    vm.scale.setScalar(0.92);
    vm.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.renderOrder = 10; } });
    this.viewmodel = vm;
    this.camera.add(vm);
    this._vmBase = vm.position.clone();
  }

  _buildFlashlight() {
    const f = CFG.flashlight;
    this.flashlight = new THREE.SpotLight(f.color, f.intensity, f.distance, f.angle, f.penumbra, 2.0);
    this.flashlight.castShadow = false;
    this.flashTarget = new THREE.Object3D();
    this.flashlight.target = this.flashTarget;
    this.flashSpill = new THREE.SpotLight(
      f.color,
      f.spillIntensity ?? f.intensity * 0.18,
      f.distance * 0.95,
      f.spillAngle ?? Math.min(1.05, f.angle * 1.35),
      0.88,
      2.0,
    );
    this.flashSpill.castShadow = false;
    this.flashSpill.target = this.flashTarget;

    // A warm fill light at the lens. This is the ONE omnidirectional light on the
    // rig, so it's what keeps the immediate surroundings from being pitch black
    // when the flashlight cone is aimed elsewhere (the maze corridors used to go
    // fully black off-aim). Kept short-range so it lights the cell you're in, not
    // the whole maze — a faint "you can always see your own feet and the near
    // wall", never a flood that kills the dark. It already lives permanently in
    // the scene, so tuning it costs ZERO light-count (no shader recompile).
    this.baseLensIntensity = 6.0;
    this.lens = new THREE.PointLight(0xffe0c0, this.baseLensIntensity, 3.4, 2);

    // the held cone is swayed with a little lag for a handheld feel
    this._aimDir = new THREE.Vector3(0, 0, -1);
    this.flashOn = true;
    this._offSince = 0;         // wall-clock ms when the torch went off (watchdog)
    this.baseIntensity = f.intensity;
    this.baseSpillIntensity = f.spillIntensity ?? f.intensity * 0.18;
    this.flicker = 1;           // multiplier driven by scare system
  }

  // The flashlight, its target, and the lens fill light live in the scene (not
  // parented to the camera) so shadows update correctly; they persist for the
  // whole game, so there's no matching remove.
  addToScene(scene) {
    scene.add(this.flashlight); scene.add(this.flashSpill); scene.add(this.flashTarget); scene.add(this.lens);
  }

  teleport(x, z, yaw) {
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0);
    if (yaw !== undefined) this.yaw = yaw;
  }

  applyLook(dx, dy) {
    if (this.lookFrozen) return;
    this.yaw -= dx;
    this.pitch -= dy;
    const lim = CFG.maxPitch;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  addShake(amount) { this.shake = Math.min(1.6, this.shake + (REDUCED_MOTION ? amount * 0.15 : amount)); }

  // pull the camera to look at a world point (for forced-witness beats)
  forceLook(target, strength) { this.lookTarget = target; this.headTilt = strength; }
  releaseLook() { this.lookTarget = null; this.headTilt = 0; }

  update(dt, controls) {
    // --- look ---
    const look = controls.consumeLook();
    this.applyLook(look.dx, look.dy);

    // forced look-at blends yaw/pitch toward a target (eases the player's head)
    if (this.lookTarget && this.headTilt > 0) {
      const dx = this.lookTarget.x - this.camera.position.x;
      const dz = this.lookTarget.z - this.camera.position.z;
      const dy = this.lookTarget.y - this.camera.position.y;
      const desiredYaw = Math.atan2(-dx, -dz);
      const desiredPitch = Math.atan2(dy, Math.hypot(dx, dz));
      // shortest-arc yaw blend
      let diff = ((desiredYaw - this.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      this.yaw += diff * this.headTilt * Math.min(1, dt * 3);
      this.pitch += (desiredPitch - this.pitch) * this.headTilt * Math.min(1, dt * 3);
    }

    // --- movement intent (camera-relative) ---
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    let wishX = 0, wishZ = 0;
    if (!this.frozen) {
      const m = controls.state.move;
      // forward is -Z in camera space
      const fx = -sinY, fz = -cosY;     // forward
      const rx = cosY, rz = -sinY;      // right
      wishX = (fx * m.y + rx * m.x);
      wishZ = (fz * m.y + rz * m.x);
      const wl = Math.hypot(wishX, wishZ);
      if (wl > 1) { wishX /= wl; wishZ /= wl; }
    }

    const running = controls.state.run && this.stamina > 0.05 && (wishX || wishZ);
    if (running) this.stamina = Math.max(0, this.stamina - dt * 0.32);
    else this.stamina = Math.min(1, this.stamina + dt * 0.18);
    const speed = (running ? CFG.runSpeed : CFG.walkSpeed) * this.speedScale * (this.crawl ? 0.45 : 1);

    // accelerate toward wish velocity
    const targetVX = wishX * speed, targetVZ = wishZ * speed;
    const moving = (wishX || wishZ);
    const rate = moving ? CFG.accel : CFG.friction;
    this.vel.x += (targetVX - this.vel.x) * Math.min(1, rate * dt);
    this.vel.z += (targetVZ - this.vel.z) * Math.min(1, rate * dt);

    // integrate + collide
    let nx = this.pos.x + this.vel.x * dt;
    let nz = this.pos.z + this.vel.z * dt;
    let hitWall = false;
    if (this.field) {
      const r = this.field.resolve(nx, nz, CFG.playerRadius);
      if (r.hit) {
        // kill velocity into the wall to stop jitter
        const ddx = r.x - nx, ddz = r.z - nz;
        const dl = Math.hypot(ddx, ddz);
        if (dl > 0.00001) {
          const nxn = ddx / dl, nzn = ddz / dl;
          const into = this.vel.x * nxn + this.vel.z * nzn;
          if (into < 0) { this.vel.x -= into * nxn; this.vel.z -= into * nzn; }
        }
        hitWall = true;
      }
      nx = r.x; nz = r.z;
    }
    this.pos.x = nx; this.pos.z = nz;

    // --- headbob & breathing ---
    const horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (horizSpeed > 0.15) this.bobPhase += dt * CFG.bobSpeed * (running ? 1.35 : 1.0);
    this.breathPhase += dt * (running ? 4.5 : 1.6);
    const bob = Math.sin(this.bobPhase) * CFG.bobAmount * Math.min(1, horizSpeed / CFG.walkSpeed);
    const sway = Math.cos(this.bobPhase * 0.5) * CFG.bobAmount * 0.6 * Math.min(1, horizSpeed / CFG.walkSpeed);
    const breath = Math.sin(this.breathPhase) * CFG.breathAmount * (1 + (1 - this.stamina) * 2.2);

    // shake decay
    this.shake *= Math.pow(0.0009, dt); // fast decay
    this._shakePhase += dt * (9.0 + this.shake * 18.0);
    this._shakeV.set(
      Math.sin(this._shakePhase * 2.1) + Math.sin(this._shakePhase * 5.7) * 0.35,
      Math.cos(this._shakePhase * 2.7) * 0.55,
      Math.sin(this._shakePhase * 3.3 + 1.7) * 0.65,
    ).multiplyScalar(this.shake * 0.095);

    // --- compose camera transform (eye lowers smoothly when crawling) ---
    this.eyeNow += ((this.crawl ? 0.5 : this.height) - this.eyeNow) * Math.min(1, dt * 7);
    const eye = this.eyeNow + bob * (this.crawl ? 0.4 : 1) + breath;
    this.camera.position.set(this.pos.x + sway, eye, this.pos.z);
    this.camera.position.add(this._shakeV);
    const euler = new THREE.Euler(this.pitch + this._shakeV.z * 0.4, this.yaw, sway * 0.6, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
    this.camera.getWorldDirection(this.forward);

    // --- flashlight follow with lag ---
    this._aimDir.lerp(this.forward, Math.min(1, dt * 12));
    const fpos = this.camera.position;
    this.flashlight.position.copy(fpos).addScaledVector(this.camera.up, -0.05);
    this.flashSpill.position.copy(this.flashlight.position);
    this.flashTarget.position.copy(fpos).addScaledVector(this._aimDir, 8);
    this.lens.position.copy(fpos).addScaledVector(this.forward, 0.2);
    // safety net: the torch may never stay off longer than a scripted blackout.
    // Wall-clock based (frame-rate independent), so if anything leaves it off (a
    // scare's restore failing, a level slip) it force-returns after ~2.2s and you
    // can never end up permanently blind and stuck.
    if (this.flashOn) { this._offSince = 0; }
    else if (this._offSince === 0) { this._offSince = performance.now(); }
    else if (performance.now() - this._offSince > 2200) { this.flashOn = true; }

    const inten = this.flashOn ? this.baseIntensity * this.flicker : 0;
    this.flashlight.intensity = inten;
    this.flashSpill.intensity = this.flashOn ? this.baseSpillIntensity * Math.max(0.55, this.flicker) : 0;
    this.lens.intensity = this.flashOn ? this.baseLensIntensity * Math.max(0.45, this.flicker) : 0;

    // --- viewmodel bob/sway (lags the camera, breathes, dims with the torch) ---
    if (this.viewmodel) {
      const b = this._vmBase;
      const bobY = Math.sin(this.bobPhase) * 0.012 * Math.min(1, horizSpeed / CFG.walkSpeed);
      const bobX = Math.cos(this.bobPhase * 0.5) * 0.009 * Math.min(1, horizSpeed / CFG.walkSpeed);
      const breathe = Math.sin(this.breathPhase) * 0.004;
      this.viewmodel.position.set(b.x + bobX - look.dx * 0.6, b.y + bobY + breathe + look.dy * 0.5, b.z);
      this.viewmodel.rotation.set(0.05 + look.dy * 0.6, -0.12 - look.dx * 0.8, look.dx * 0.4);
      this.viewmodel.visible = this.flashOn;
      const f = this.flashOn ? this.flicker : 0;
      if (this._vmLensMat) this._vmLensMat.color.setRGB(f, 0.92 * f, 0.76 * f);  // lens dims/dies with the torch
      if (this._vmHalo) this._vmHalo.material.opacity = 0.35 * f;
    }

    return { running, horizSpeed, hitWall, moving };
  }
}
