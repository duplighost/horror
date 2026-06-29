// Central tunables and runtime quality detection.
// Keeping every "magic number" that shapes the feel in one place so the
// experience can be tuned without hunting through systems.

export const IS_TOUCH = (('ontouchstart' in window) || navigator.maxTouchPoints > 0);
export const IS_MOBILE = IS_TOUCH && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Rough GPU tier guess. We can't trust UA, so we lean conservative on touch
// devices and let the frame-rate governor in main.js adapt further at runtime.
function guessTier() {
  const mem = navigator.deviceMemory || (IS_MOBILE ? 4 : 8);
  const cores = navigator.hardwareConcurrency || (IS_MOBILE ? 4 : 8);
  if (IS_MOBILE && (mem <= 3 || cores <= 4)) return 'low';
  if (IS_MOBILE) return 'mid';
  if (mem <= 4 || cores <= 4) return 'mid';
  return 'high';
}

export const TIER = guessTier();

// Quality is a mutable object — the runtime governor nudges these if the
// frame budget is blown, so dread never costs us the framerate.
export const Quality = {
  tier: TIER,
  pixelRatio: TIER === 'high' ? Math.min(window.devicePixelRatio, 1.9)
            : TIER === 'mid' ? Math.min(window.devicePixelRatio, 1.35)
            : 1.0,
  shadows: TIER !== 'low',
  shadowSize: TIER === 'high' ? 1024 : 512,
  fogDensityScale: 1.0,
  grain: true,
  // draw distance is intentionally short; the fog hides the edge of the world
  far: TIER === 'high' ? 90 : TIER === 'mid' ? 70 : 55,
  maxInstancedTrees: TIER === 'high' ? 1200 : TIER === 'mid' ? 700 : 360,
  dustMotes: TIER === 'high' ? 600 : TIER === 'mid' ? 280 : 0,
};

export const CFG = {
  // --- Player ---
  eyeHeight: 1.62,
  crouchHeight: 0.95,
  walkSpeed: 2.48,
  runSpeed: 4.1,          // a frightened jog — drains stamina, used rarely
  accel: 16,
  friction: 13,
  playerRadius: 0.32,
  // mouse / stick look
  mouseSensitivity: 0.0021,
  touchLookSensitivity: 0.00135,
  invertY: false,
  maxPitch: 1.45,         // radians from horizon
  // headbob & breathing
  bobAmount: 0.038,
  bobSpeed: 8.8,
  breathAmount: 0.015,

  // --- Flashlight (physically-based candela units in three r160, decay 2) ---
  flashlight: {
    angle: 0.72,          // radians (cone half-angle-ish)
    penumbra: 0.64,
    intensity: 980.0,
    spillIntensity: 330.0,
    spillAngle: 1.10,
    distance: 68,
    color: 0xffeccb,
  },

  // --- Atmosphere palettes per zone. Fog is a murky blue/charcoal, never pure
  //     black, so trees and rooms silhouette against it like the references. ---
  zones: {
    forest:       { fog: 0x0e1622, fogDensity: 0.038, ambient: 0x1a2334, ambientI: 0.5,  sky: 0x0e1622 },
    mansion:      { fog: 0x0b0b13, fogDensity: 0.055, ambient: 0x16131d, ambientI: 0.32, sky: 0x0b0b13 },
    basement:     { fog: 0x0d080a, fogDensity: 0.090, ambient: 0x1a0b0d, ambientI: 0.17, sky: 0x0d080a },
    // The deep levels ramp fog UP toward the climax (the world closes in as you
    // descend) and each leans on one saturated key colour so they never blur
    // together.
    conservatory: { fog: 0x0a221b, fogDensity: 0.046, ambient: 0x1d5040, ambientI: 0.50, sky: 0x0a221b },
    library:      { fog: 0x130c06, fogDensity: 0.055, ambient: 0x4a2c14, ambientI: 0.40, sky: 0x130c06 },
    nursery:      { fog: 0x160a17, fogDensity: 0.062, ambient: 0x52203a, ambientI: 0.40, sky: 0x160a17 },
    bathhouse:    { fog: 0x05131a, fogDensity: 0.070, ambient: 0x12525f, ambientI: 0.40, sky: 0x05131a },
    gallery:      { fog: 0x120611, fogDensity: 0.072, ambient: 0x4a1840, ambientI: 0.36, sky: 0x120611 },
    chapel:       { fog: 0x14060a, fogDensity: 0.082, ambient: 0x4a1410, ambientI: 0.30, sky: 0x14060a },
    final:        { fog: 0x160611, fogDensity: 0.082, ambient: 0x220a18, ambientI: 0.14, sky: 0x160611 },
  },

  // --- Director / dread ---
  // Global tension 0..1 ramps the soundtrack and the odds of incidental scares.
  tensionRise: 0.06,
  tensionFall: 0.04,
};

// Layer bitmask so the flashlight and entity can be selectively lit/hidden.
export const LAYER = { DEFAULT: 0, ENTITY: 1, NOFLASH: 2 };
