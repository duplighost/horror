// Thin wrapper over the DOM overlay layers. The game shows almost no words —
// just black fades, white stinger flashes, a red dread pulse, and a reticle dot
// that swells when something can be touched.

const $ = (id) => document.getElementById(id);
const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const UI = {
  fade: $('fade'), flash: $('flash'), reticle: $('reticle'),
  boot: $('boot'), loading: $('loading'), endcard: $('endcard'), mobhint: $('mobhint'),

  // haptics: a short buzz on mobile for stingers and the worst moments
  buzz(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {} },

  fadeTo(opacity, ms = 1200) {
    this.fade.style.transition = `opacity ${ms}ms ease`;
    requestAnimationFrame(() => { this.fade.style.opacity = String(opacity); });
  },

  blink(downMs = 90, upMs = 220) {
    // a hard eye-blink: snap to black then open
    this.fade.style.transition = `opacity ${downMs}ms ease`;
    this.fade.style.opacity = '1';
    return new Promise((res) => setTimeout(() => {
      this.fade.style.transition = `opacity ${upMs}ms ease`;
      this.fade.style.opacity = '0';
      setTimeout(res, upMs);
    }, downMs));
  },

  flashWhite(intensity = 0.85, ms = 240) {
    if (REDUCED_MOTION) {
      intensity = Math.min(intensity, 0.18);
      ms = Math.min(ms, 120);
    }
    // Drive the decay with a forced reflow rather than rAF: rAF callbacks are
    // throttled in background tabs and can be starved under heavy load, which
    // could otherwise leave the white flash stuck on. A reflow commits the peak
    // synchronously, so the transition back to 0 always runs.
    const f = this.flash;
    f.style.transition = 'none';
    f.style.opacity = String(intensity);
    void f.offsetWidth;
    f.style.transition = `opacity ${ms}ms ease`;
    f.style.opacity = '0';
  },

  setReticle(active) { this.reticle.classList.toggle('active', active); },

  showLoading(on) { this.loading.classList.toggle('show', on); },
  hideBoot() { this.boot.classList.add('hidden'); },

  showEnd(title, sub = 'restart') {
    this.endcard.querySelector('.et').textContent = title;
    this.endcard.querySelector('.es').textContent = sub;
    this.endcard.classList.add('show');
  },
  hideEnd() { this.endcard.classList.remove('show'); },

  showMobHint(svg) { this.mobhint.innerHTML = svg; this.mobhint.classList.add('show'); },
  hideMobHint() { this.mobhint.classList.remove('show'); },
};
