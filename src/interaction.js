import * as THREE from 'three';

// Finds the one thing you can touch right now and lets you take/use it. The only
// "UI" is the reticle swelling — no prompts, no words.

export class InteractionManager {
  constructor(ui, audio) {
    this.ui = ui; this.audio = audio;
    this.list = [];
    this.focused = null;
    this._lockedRattle = 0;
  }
  setLevel(interactables) { this.list = interactables || []; this.focused = null; }

  update(player) {
    let best = null, bestScore = -Infinity;
    const cam = player.camera.position;
    for (const it of this.list) {
      if (it.enabled === false || it._done) continue;
      if (!it.focusable) continue;
      const d = it.pos.distanceTo(cam);
      if (d > it.radius) continue;
      // prefer things near the centre of view, but allow point-blank items
      const dir = new THREE.Vector3().subVectors(it.pos, cam).normalize();
      const dot = dir.dot(player.forward);
      if (dot < 0.35 && d > 1.3) continue;
      const score = dot * 2 - d * 0.5;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    this.focused = best;
    this.ui.setReticle(!!best);
    return best;
  }

  tryUse(ctx) {
    const it = this.focused;
    if (!it) return false;
    if (it.canUse && !it.canUse(ctx)) {
      // locked — the classic handle-rattle + dull thud, and a flinch, no words
      if (performance.now() - this._lockedRattle > 400) {
        this._lockedRattle = performance.now();
        this.audio.lockedDoor(it.pos); ctx.player.addShake(0.12);
      }
      return false;
    }
    it.onUse(ctx, ctx);
    it._done = true; it.enabled = false;
    this.ui.setReticle(false);
    this.focused = null;
    return true;
  }
}
