import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Everything visual is painted procedurally onto <canvas> elements so the
// game ships with zero binary assets and still feels hand-grimed. Textures are
// generated once and cached.
// ---------------------------------------------------------------------------

let _renderer = null;
export function setTextureRenderer(r) { _renderer = r; }
function aniso() { return _renderer ? Math.min(8, _renderer.capabilities.getMaxAnisotropy()) : 1; }

// --- tiny deterministic value-noise -----------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const size = 256, mask = 255;
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const smooth = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x) & mask, yi = Math.floor(y) & mask;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const tl = g[yi * size + xi];
    const tr = g[yi * size + ((xi + 1) & mask)];
    const bl = g[((yi + 1) & mask) * size + xi];
    const br = g[((yi + 1) & mask) * size + ((xi + 1) & mask)];
    const u = smooth(xf), v = smooth(yf);
    return (tl * (1 - u) + tr * u) * (1 - v) + (bl * (1 - u) + br * u) * v;
  }
  return function fbm(x, y, oct = 4) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) { sum += amp * noise(x * freq, y * freq); norm += amp; amp *= 0.5; freq *= 2; }
    return sum / norm;
  };
}

function canvas(size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  return [c, c.getContext('2d')];
}
function finalize(c, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso();
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cache = {};
function cached(key, fn) { return cache[key] || (cache[key] = fn()); }

export function stainTexture(seed = 1, tint = '#2b120f') {
  return cached(`stain:${seed}:${tint}`, () => {
    const S = 256, [c, ctx] = canvas(S);
    const rnd = mulberry32(seed * 997 + 17);
    ctx.clearRect(0, 0, S, S);
    const hex = tint.startsWith('#') ? tint.slice(1) : '2b120f';
    const tr = parseInt(hex.slice(0, 2), 16) || 43;
    const tg = parseInt(hex.slice(2, 4), 16) || 18;
    const tb = parseInt(hex.slice(4, 6), 16) || 15;
    const rgba = (a) => `rgba(${tr},${tg},${tb},${a})`;

    const fillBlob = (x, y, rx, ry, alpha) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
      g.addColorStop(0, rgba(alpha));
      g.addColorStop(0.65, rgba(alpha * 0.38));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.translate(x, y); ctx.rotate((rnd() - 0.5) * Math.PI);
      ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, Math.max(rx, ry), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };

    for (let i = 0; i < 13; i++) {
      fillBlob(S * (0.25 + rnd() * 0.5), S * (0.22 + rnd() * 0.56), 18 + rnd() * 70, 10 + rnd() * 42, 0.16 + rnd() * 0.22);
    }
    ctx.strokeStyle = rgba(0.22);
    for (let i = 0; i < 22; i++) {
      const x = rnd() * S, y = rnd() * S;
      ctx.lineWidth = 1 + rnd() * 3;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + (rnd() - 0.5) * 40, y + rnd() * 45, x + (rnd() - 0.5) * 60, y + rnd() * 85, x + (rnd() - 0.5) * 80, y + rnd() * 120);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = aniso();
    return tex;
  });
}

// --- forest ground: wet earth, scattered rot leaves --------------------------
export function groundTexture() {
  return cached('ground', () => {
    const S = 512, [c, ctx] = canvas(S);
    const fbm = makeNoise(7);
    const img = ctx.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const n = fbm(x / 42, y / 42, 5);
      const patch = fbm(x / 9 + 50, y / 9 + 50, 3);
      let r = 14 + n * 26, g = 12 + n * 22, b = 9 + n * 14;
      // mossy green tinge in low areas
      g += (1 - patch) * 10 * n;
      // scattered dead leaves
      if (patch > 0.72 && fbm(x / 4, y / 4, 2) > 0.6) { r += 28; g += 14; b -= 4; }
      const i = (y * S + x) * 4;
      d[i] = r * 1.7; d[i + 1] = g * 1.7; d[i + 2] = b * 1.7; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return finalize(c, 14);
  });
}

// --- tree bark: deep grooves, raised ridges, knots, patches of moss ----------
export function barkTexture() {
  return cached('bark', () => {
    const S = 512, [c, ctx] = canvas(S);
    const fbm = makeNoise(31);
    const img = ctx.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const fib = fbm(x / 4, y / 110, 5);                               // vertical fibre
      const warp = fbm(x / 30, y / 60, 3) * 8;
      const groove = Math.abs(Math.sin((x / S) * Math.PI * 20 + warp + fib * 4));
      const ridge = Math.pow(groove, 0.45);                            // 0 in cracks, 1 on ridges
      const knot = fbm(x / 38 + 5, y / 38, 3);
      let l = 8 + fib * 14 + ridge * 26 - (1 - ridge) * 12;
      if (knot > 0.83) l *= 0.45;                                      // dark knots
      const moss = Math.max(0, fbm(x / 22, y / 22 + 9, 3) - 0.6) * 3.0; // greenish patches
      const i = (y * S + x) * 4;
      d[i] = Math.max(0, l * 1.05);
      d[i + 1] = Math.max(0, l * 0.9 + moss * 14);
      d[i + 2] = Math.max(0, l * 0.62 + moss * 5);
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = finalize(c, 1); t.repeat.set(1.6, 4.0);                  // tile so detail reads on a tall trunk
    return t;
  });
}

// --- crunchy autumn leaf litter ----------------------------------------------
export function leafTexture() {
  return cached('leaf', () => {
    const S = 256, [c, ctx] = canvas(S);
    ctx.fillStyle = '#1c1206'; ctx.fillRect(0, 0, S, S);
    const rnd = mulberry32(55);
    for (let i = 0; i < 300; i++) {
      const x = rnd() * S, y = rnd() * S, r = 4 + rnd() * 11, a = rnd() * Math.PI;
      const warm = rnd();
      const col = warm < 0.45 ? [120 + rnd() * 70, 55 + rnd() * 45, 18 + rnd() * 14]   // orange
                : warm < 0.8 ? [80 + rnd() * 40, 42 + rnd() * 30, 16 + rnd() * 10]      // brown
                : [50 + rnd() * 30, 55 + rnd() * 30, 24];                                // sickly green
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
      ctx.restore();
    }
    return finalize(c, 1);
  });
}

// --- peeling wallpaper for the mansion ---------------------------------------
export function wallpaperTexture() {
  return cached('wallpaper', () => {
    const S = 512, [c, ctx] = canvas(S);
    const fbm = makeNoise(99);
    const img = ctx.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const stain = fbm(x / 60, y / 60, 5);
      const damask = (Math.sin(x / 18) * Math.sin(y / 18)) * 0.5 + 0.5;
      const grime = fbm(x / 6, y / 6, 3);
      // base sickly green-brown, darker as it descends (water damage at bottom)
      const wet = Math.pow(y / S, 1.6);
      let r = 46 - wet * 30 + damask * 10 - stain * 22;
      let g = 42 - wet * 30 + damask * 12 - stain * 20;
      let b = 30 - wet * 22 + damask * 4 - stain * 18;
      r += grime * 8; g += grime * 7; b += grime * 5;
      // peeling tears
      if (fbm(x / 30 + 9, y / 8, 3) > 0.78 && y < S * 0.7) { r *= 0.4; g *= 0.4; b *= 0.4; }
      const i = (y * S + x) * 4;
      d[i] = Math.max(0, r); d[i + 1] = Math.max(0, g); d[i + 2] = Math.max(0, b); d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return finalize(c, 1);
  });
}

// --- aged wood floorboards ---------------------------------------------------
export function woodFloorTexture() {
  return cached('woodfloor', () => {
    const S = 512, [c, ctx] = canvas(S);
    const fbm = makeNoise(53);
    const img = ctx.createImageData(S, S), d = img.data;
    const plankH = 64;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const plank = Math.floor(y / plankH);
      const off = (plank * 137) % 256;
      const grain = fbm((x + off) / 3, y / 30, 4);
      const longstreak = fbm((x + off) / 90, y / 8, 3);
      let l = 22 + grain * 16 + longstreak * 14;
      // plank seams
      if (y % plankH < 2) l *= 0.3;
      if ((x + off * 3) % 256 < 2) l *= 0.5;
      l *= 1.7;
      const i = (y * S + x) * 4;
      d[i] = l * 1.0; d[i + 1] = l * 0.78; d[i + 2] = l * 0.55; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return finalize(c, 5);
  });
}

// --- damp basement stone -----------------------------------------------------
export function stoneTexture() {
  return cached('stone', () => {
    const S = 512, [c, ctx] = canvas(S);
    const fbm = makeNoise(71);
    const img = ctx.createImageData(S, S), d = img.data;
    const bw = 128, bh = 64;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const row = Math.floor(y / bh);
      const ox = (row % 2) * (bw / 2);
      const bx = ((x + ox) % bw), by = (y % bh);
      const mortar = (bx < 4 || by < 4) ? 0.35 : 1;
      const n = fbm(x / 18, y / 18, 5);
      const damp = fbm(x / 50 + 20, y / 50, 3);
      let l = (16 + n * 18) * mortar;
      // black wet patches
      l *= (0.5 + damp * 0.7);
      l *= 1.7;
      const i = (y * S + x) * 4;
      const greenish = damp > 0.6 ? 1.05 : 1.0;
      d[i] = l; d[i + 1] = l * greenish; d[i + 2] = l * 0.92; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return finalize(c, 4);
  });
}

// --- organic / flesh wall for the deepest basement ---------------------------
export function fleshTexture() {
  return cached('flesh', () => {
    const S = 512, [c, ctx] = canvas(S);
    const fbm = makeNoise(13);
    const img = ctx.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const veins = Math.abs(fbm(x / 24, y / 24, 5) - 0.5) * 2;
      const pulse = fbm(x / 8, y / 8, 4);
      let r = 60 - veins * 50 + pulse * 24;
      let g = 14 - veins * 12 + pulse * 8;
      let b = 16 - veins * 12 + pulse * 8;
      if (veins < 0.08) { r += 40; } // bright capillaries
      const i = (y * S + x) * 4;
      d[i] = Math.max(0, r); d[i + 1] = Math.max(0, g); d[i + 2] = Math.max(0, b); d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return finalize(c, 3);
  });
}

// --- a single staring portrait (faint, only resolves under the flashlight) ---
export function portraitTexture(seed = 1) {
  return cached(`portrait:${seed}`, () => {
  const S = 256, [c, ctx] = canvas(S);
  ctx.fillStyle = '#0b0a08'; ctx.fillRect(0, 0, S, S);
  const fbm = makeNoise(seed * 17 + 3);
  // grimy varnish
  const img = ctx.getImageData(0, 0, S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = fbm(x / 40, y / 40, 4);
    const i = (y * S + x) * 4;
    d[i] += n * 22; d[i + 1] += n * 18; d[i + 2] += n * 12;
  }
  ctx.putImageData(img, 0, 0);
  // gaunt face suggestion
  const cx = S / 2, cy = S * 0.46;
  const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, S * 0.42);
  g.addColorStop(0, 'rgba(70,62,52,0.55)');
  g.addColorStop(0.6, 'rgba(28,24,20,0.4)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath();
  ctx.ellipse(cx, cy, S * 0.22, S * 0.30, 0, 0, Math.PI * 2); ctx.fill();
  // hollow eyes
  ctx.fillStyle = 'rgba(0,0,0,0.92)';
  for (const ex of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(cx + ex * S * 0.085, cy - S * 0.02, S * 0.035, S * 0.05, 0, 0, Math.PI * 2); ctx.fill();
  }
  // faint pinprick highlights (the eyes that seem to follow)
  ctx.fillStyle = 'rgba(180,170,150,0.5)';
  for (const ex of [-1, 1]) {
    ctx.beginPath(); ctx.arc(cx + ex * S * 0.085, cy - S * 0.02, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  // mouth — a thin dark line, slightly agape
  ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - S * 0.05, cy + S * 0.16);
  ctx.quadraticCurveTo(cx, cy + S * 0.20, cx + S * 0.05, cy + S * 0.16); ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso();
  return t;
  });
}

// --- a sclera: pale, wet, threaded with burst red veins ----------------------
export function eyeballTexture() {
  return cached('eyeball', () => {
    const S = 512, [c, ctx] = canvas(S);
    const fbm = makeNoise(303);
    ctx.fillStyle = '#cdc7b6'; ctx.fillRect(0, 0, S, S);
    const img = ctx.getImageData(0, 0, S, S), d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const n = fbm(x / 60, y / 60, 4);
      const i = (y * S + x) * 4;
      d[i] -= n * 18; d[i + 1] -= n * 26; d[i + 2] -= n * 30;     // yellowed
    }
    ctx.putImageData(img, 0, 0);
    // veins crawling from the edges inward
    ctx.strokeStyle = 'rgba(150,20,20,0.5)'; ctx.lineWidth = 1.2;
    const rndv = mulberry32(77);
    for (let v = 0; v < 60; v++) {
      let a = rndv() * Math.PI * 2, r = S * 0.5;
      let x = S / 2 + Math.cos(a) * r, y = S / 2 + Math.sin(a) * r;
      ctx.beginPath(); ctx.moveTo(x, y);
      const steps = 6 + (rndv() * 8) | 0;
      for (let s = 0; s < steps; s++) {
        a += (rndv() - 0.5) * 1.0; r -= S * 0.04 * rndv();
        x = S / 2 + Math.cos(a) * r + (rndv() - 0.5) * 16;
        y = S / 2 + Math.sin(a) * r + (rndv() - 0.5) * 16;
        ctx.lineWidth = 1.6 * (s / steps);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso();
    return t;
  });
}

// --- soft round sprite used for dust, embers, eyes in the dark ---------------
export function softDot(color = '#ffffff') {
  return cached(`soft:${color}`, () => {
  const S = 64, [c, ctx] = canvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, color); g.addColorStop(0.25, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
  });
}
