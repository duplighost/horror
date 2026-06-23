import * as THREE from 'three';
import { CFG, Quality } from './config.js';

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
    this.frozen = false;        // director can lock the player for a beat
    this.lookFrozen = false;
    this.speedScale = 1;        // dread can make limbs heavy
    this.shake = 0;             // transient camera shake amount
    this._shakeV = new THREE.Vector3();
    this.headTilt = 0;          // forced look-at influence (0..1) toward target
    this.lookTarget = null;

    this._buildFlashlight();
    this._buildViewmodel();
    this.forward = new THREE.Vector3(0, 0, -1);
  }

  // a held flashlight + hand, parented to the camera (cosmetic, lit by the lens)
  _buildViewmodel() {
    const vm = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.4, metalness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x6a4a3a, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.2, 12), metal);
    body.rotation.x = Math.PI / 2; body.position.set(0, 0, -0.06); vm.add(body);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.034, 0.07, 14), metal);
    head.rotation.x = Math.PI / 2; head.position.set(0, 0, -0.18); vm.add(head);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.045, 14),
      new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffdca0, emissiveIntensity: 2.2, roughness: 0.3 }));
    lens.position.set(0, 0, -0.214); vm.add(lens);
    // a fist gripping the barrel
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.09), skin);
    palm.position.set(0, -0.015, -0.02); vm.add(palm);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.03, 0.05), skin);
      f.position.set(-0.03 + i * 0.02, 0.02, -0.03); f.rotation.x = -0.5; vm.add(f);
    }
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.025), skin);
    thumb.position.set(0.04, 0.0, -0.01); thumb.rotation.z = 0.5; vm.add(thumb);

    vm.position.set(0.22, -0.22, -0.42);
    vm.rotation.set(0.05, -0.12, 0);
    vm.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    this.viewmodel = vm;
    this.camera.add(vm);
    this._vmBase = vm.position.clone();
  }

  _buildFlashlight() {
    const f = CFG.flashlight;
    this.flashlight = new THREE.SpotLight(f.color, f.intensity, f.distance, f.angle, f.penumbra, 2.0);
    this.flashlight.castShadow = Quality.shadows;
    if (Quality.shadows) {
      this.flashlight.shadow.mapSize.set(Quality.shadowSize, Quality.shadowSize);
      this.flashlight.shadow.camera.near = 0.2;
      this.flashlight.shadow.camera.far = f.distance;
      this.flashlight.shadow.bias = -0.0009;
      this.flashlight.shadow.radius = 3;
    }
    this.flashTarget = new THREE.Object3D();
    this.flashlight.target = this.flashTarget;

    // a faint warm fill at the lens so nearby surfaces and your "presence" read
    this.lens = new THREE.PointLight(0xffe0c0, 6.0, 4.5, 2);

    // the held cone is swayed with a little lag for a handheld feel
    this._aimDir = new THREE.Vector3(0, 0, -1);
    this.flashOn = true;
    this.baseIntensity = f.intensity;
    this.flicker = 1;           // multiplier driven by scare system
  }

  // The flashlight, its target, and the lens fill light live in the scene (not
  // parented to the camera) so shadows update correctly; they persist for the
  // whole game, so there's no matching remove.
  addToScene(scene) {
    scene.add(this.flashlight); scene.add(this.flashTarget); scene.add(this.lens);
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

  addShake(amount) { this.shake = Math.min(1.6, this.shake + amount); }

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
    const speed = (running ? CFG.runSpeed : CFG.walkSpeed) * this.speedScale;

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
    this._shakeV.set((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(this.shake * 0.18);

    // --- compose camera transform ---
    const eye = this.height + bob + breath;
    this.camera.position.set(this.pos.x + sway, eye, this.pos.z);
    this.camera.position.add(this._shakeV);
    const euler = new THREE.Euler(this.pitch + this._shakeV.z * 0.4, this.yaw, sway * 0.6, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
    this.camera.getWorldDirection(this.forward);

    // --- flashlight follow with lag ---
    this._aimDir.lerp(this.forward, Math.min(1, dt * 12));
    const fpos = this.camera.position;
    this.flashlight.position.copy(fpos).addScaledVector(this.camera.up, -0.05);
    this.flashTarget.position.copy(fpos).addScaledVector(this._aimDir, 8);
    this.lens.position.copy(fpos).addScaledVector(this.forward, 0.2);
    const inten = this.flashOn ? this.baseIntensity * this.flicker : 0;
    this.flashlight.intensity = inten;
    this.lens.intensity = this.flashOn ? 6.0 * this.flicker : 0;

    // --- viewmodel bob/sway (lags the camera, breathes, dims with the torch) ---
    if (this.viewmodel) {
      const b = this._vmBase;
      const bobY = Math.sin(this.bobPhase) * 0.012 * Math.min(1, horizSpeed / CFG.walkSpeed);
      const bobX = Math.cos(this.bobPhase * 0.5) * 0.009 * Math.min(1, horizSpeed / CFG.walkSpeed);
      const breathe = Math.sin(this.breathPhase) * 0.004;
      this.viewmodel.position.set(b.x + bobX - look.dx * 0.6, b.y + bobY + breathe + look.dy * 0.5, b.z);
      this.viewmodel.rotation.set(0.05 + look.dy * 0.6, -0.12 - look.dx * 0.8, look.dx * 0.4);
      this.viewmodel.visible = this.flashOn;
      const lensMat = this.viewmodel.children[2].material;
      if (lensMat) lensMat.emissiveIntensity = this.flashOn ? 2.2 * this.flicker : 0;
    }

    return { running, horizSpeed, hitWall, moving };
  }
}
