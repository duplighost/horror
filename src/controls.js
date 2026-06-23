import { IS_TOUCH, CFG } from './config.js';

// ---------------------------------------------------------------------------
// Unified input. Desktop = pointer-lock mouselook + WASD. Touch = two
// *floating* thumbsticks: press anywhere on the left half to spawn a move
// stick under your thumb, anywhere on the right half to spawn an aim stick. A
// quick tap (that barely moves) counts as "interact". Both halves are fully
// multi-touch and independent.
// ---------------------------------------------------------------------------

export function createControls(canvas) {
  const state = {
    move: { x: 0, y: 0 },     // -1..1, live
    run: false,
    locked: false,            // desktop pointer lock
    _look: { dx: 0, dy: 0 },  // accumulated, consumed per frame
    _interact: false,
    isTouch: IS_TOUCH,
    aiming: false,            // a look touch is active (used for hints/UI)
  };

  // --- keyboard (desktop) ---
  const keys = {};
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyE' || e.code === 'Space') state._interact = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.run = true;
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.run = false;
  });

  function readKeyboardMove() {
    let x = 0, y = 0;
    if (keys['KeyW'] || keys['ArrowUp']) y += 1;
    if (keys['KeyS'] || keys['ArrowDown']) y -= 1;
    if (keys['KeyA'] || keys['ArrowLeft']) x -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) x += 1;
    const m = Math.hypot(x, y) || 1;
    return { x: x / m, y: y / m, active: x !== 0 || y !== 0 };
  }

  // --- pointer lock mouselook (desktop) ---
  function onMouseMove(e) {
    if (!state.locked) return;
    state._look.dx += (e.movementX || 0) * CFG.mouseSensitivity;
    state._look.dy += (e.movementY || 0) * CFG.mouseSensitivity * (CFG.invertY ? -1 : 1);
  }
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
  });
  function lock() {
    try { if (!IS_TOUCH && canvas.requestPointerLock) { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } } catch (e) {}
  }
  // click to interact on desktop (in addition to E)
  canvas.addEventListener('mousedown', (e) => { if (state.locked && e.button === 0) state._interact = true; });

  // --- touch floating thumbsticks ---
  const sticks = { move: null, look: null }; // {id, ox, oy, x, y}
  const tapInfo = {}; // id -> {x,y,t,moved}
  const TAP_MOVE = 16, TAP_TIME = 280, STICK_R = 64, DEAD = 0.12;

  // DOM feedback rings (created lazily)
  let ringsBuilt = false;
  const ui = {};
  function buildRings() {
    if (ringsBuilt) return; ringsBuilt = true;
    const mk = (cls) => {
      const base = document.createElement('div');
      base.style.cssText = `position:fixed;width:${STICK_R * 2}px;height:${STICK_R * 2}px;border-radius:50%;border:1px solid rgba(200,195,180,0.25);background:rgba(120,120,120,0.04);pointer-events:none;z-index:28;opacity:0;transition:opacity .15s;transform:translate(-50%,-50%);`;
      const knob = document.createElement('div');
      knob.style.cssText = `position:fixed;width:46px;height:46px;border-radius:50%;border:1px solid rgba(220,215,200,0.5);background:rgba(200,195,180,0.10);pointer-events:none;z-index:29;opacity:0;transition:opacity .15s;transform:translate(-50%,-50%);box-shadow:0 0 12px rgba(0,0,0,0.6);`;
      document.body.appendChild(base); document.body.appendChild(knob);
      return { base, knob };
    };
    ui.move = mk('move'); ui.look = mk('look');
  }
  function showStick(which, ox, oy, kx, ky, on) {
    const u = ui[which]; if (!u) return;
    u.base.style.opacity = on ? '1' : '0';
    u.knob.style.opacity = on ? '1' : '0';
    if (on) {
      u.base.style.left = ox + 'px'; u.base.style.top = oy + 'px';
      u.knob.style.left = kx + 'px'; u.knob.style.top = ky + 'px';
    }
  }

  function touchStart(e) {
    buildRings();
    for (const t of e.changedTouches) {
      const rightHalf = t.clientX > window.innerWidth / 2;
      const which = rightHalf ? 'look' : 'move';
      tapInfo[t.identifier] = { x: t.clientX, y: t.clientY, t: performance.now(), moved: false, which };
      if (!sticks[which]) {
        sticks[which] = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: 0, y: 0 };
        if (which === 'look') state.aiming = true;
        showStick(which, t.clientX, t.clientY, t.clientX, t.clientY, true);
      }
    }
  }
  function touchMove(e) {
    for (const t of e.changedTouches) {
      const info = tapInfo[t.identifier];
      if (info) {
        if (Math.hypot(t.clientX - info.x, t.clientY - info.y) > TAP_MOVE) info.moved = true;
      }
      for (const which of ['move', 'look']) {
        const s = sticks[which];
        if (s && s.id === t.identifier) {
          let dx = t.clientX - s.ox, dy = t.clientY - s.oy;
          const len = Math.hypot(dx, dy);
          const clamped = Math.min(len, STICK_R);
          const nx = len ? dx / len : 0, ny = len ? dy / len : 0;
          s.x = nx * (clamped / STICK_R);
          s.y = ny * (clamped / STICK_R);
          showStick(which, s.ox, s.oy, s.ox + nx * clamped, s.oy + ny * clamped, true);
        }
      }
    }
  }
  function touchEnd(e) {
    for (const t of e.changedTouches) {
      const info = tapInfo[t.identifier];
      if (info && !info.moved && (performance.now() - info.t) < TAP_TIME) {
        state._interact = true;     // quick tap = interact
      }
      delete tapInfo[t.identifier];
      for (const which of ['move', 'look']) {
        const s = sticks[which];
        if (s && s.id === t.identifier) {
          sticks[which] = null;
          if (which === 'look') state.aiming = false;
          showStick(which, 0, 0, 0, 0, false);
        }
      }
    }
  }
  if (IS_TOUCH) {
    const opts = { passive: false };
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); touchStart(e); }, opts);
    canvas.addEventListener('touchmove', (e) => { e.preventDefault(); touchMove(e); }, opts);
    canvas.addEventListener('touchend', (e) => { e.preventDefault(); touchEnd(e); }, opts);
    canvas.addEventListener('touchcancel', (e) => { e.preventDefault(); touchEnd(e); }, opts);
  }

  // response curve for the aim stick (precise near center, fast at the edge)
  function curve(v) { const s = Math.sign(v), a = Math.abs(v); return a < DEAD ? 0 : s * Math.pow((a - DEAD) / (1 - DEAD), 1.7); }

  // called once per frame by the game loop
  function update(dt) {
    if (IS_TOUCH) {
      // movement from left stick
      const m = sticks.move;
      if (m) {
        const a = Math.hypot(m.x, m.y);
        if (a < DEAD) { state.move.x = 0; state.move.y = 0; }
        else { state.move.x = m.x; state.move.y = -m.y; state.run = a > 0.92; }
      } else { state.move.x = 0; state.move.y = 0; state.run = false; }
      // look from right stick → turn-rate
      const l = sticks.look;
      if (l) {
        const maxYaw = 3.0, maxPitch = 2.2;
        state._look.dx += curve(l.x) * maxYaw * dt;
        state._look.dy += curve(l.y) * maxPitch * dt * (CFG.invertY ? -1 : 1);
      }
    } else {
      const km = readKeyboardMove();
      state.move.x = km.x; state.move.y = km.y;
    }
  }

  function consumeLook() { const l = { dx: state._look.dx, dy: state._look.dy }; state._look.dx = 0; state._look.dy = 0; return l; }
  function consumeInteract() { const v = state._interact; state._interact = false; return v; }

  // Drop all held input. Without this, a key/stick held when the window loses
  // focus never gets its release event and the player drifts forever.
  function resetInput() {
    for (const k in keys) keys[k] = false;
    state.move.x = 0; state.move.y = 0; state.run = false;
    state._look.dx = 0; state._look.dy = 0; state.aiming = false;
    for (const id in tapInfo) delete tapInfo[id];
    for (const which of ['move', 'look']) { if (sticks[which]) { sticks[which] = null; showStick(which, 0, 0, 0, 0, false); } }
  }
  window.addEventListener('blur', resetInput);
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });
  document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas) resetInput(); });

  return {
    state, update, consumeLook, consumeInteract, lock,
    get locked() { return state.locked; },
    get aiming() { return state.aiming; },
  };
}
