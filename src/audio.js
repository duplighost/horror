// ---------------------------------------------------------------------------
// The soundtrack IS the horror. Everything here is synthesized with the Web
// Audio API — no audio files. A living dissonant drone tracks the director's
// "tension" value, a heartbeat rises as something nears, and layered stingers
// land the screams. All routed through a procedural cathedral reverb so the
// world sounds vast and wet.
// ---------------------------------------------------------------------------

export const Audio = (() => {
  let ctx = null;
  let master, comp, muffle, revGain, dry, conv;
  let started = false, unlocked = false;
  let noiseBuf = null;

  // live beds we keep references to
  const bed = { osc: [], gain: null, lp: null, lfo: [], sub: null, subGain: null, dissGain: null };
  const wind = { src: null, gain: null, bp: null, lfo: null };
  // Heartbeat model. `rate` (BPM) eases toward a dread-scaled resting rate every
  // frame, so it rises AND falls — never a one-way ratchet. `spike` is a 0..1
  // transient loudness kick from scares that decays over ~1s; the steady level
  // comes from tension. Both can jump up sharply but always settle back down.
  let heart = { gain: null, on: false, next: 0, rate: 60, spike: 0 };
  let tension = 0, targetTension = 0;
  let zone = 'forest';

  // listener state for cheap positional panning
  const listener = { x: 0, y: 0, z: 0, fx: 0, fz: -1 };

  function now() { return ctx.currentTime; }

  function makeNoiseBuffer() {
    const len = ctx.sampleRate * 2;
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;     // brown-ish
      d[i] = (w * 0.4 + last * 6.0) * 0.5;
    }
    return b;
  }

  function noiseSource(loop = false) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = loop;
    return s;
  }

  // procedural impulse response: a long, slightly metallic decay
  function makeReverbIR(seconds = 2.8, decay = 3.2) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay);
        // sparse early reflections + diffuse tail
        let s = (Math.random() * 2 - 1) * env;
        if (i % 1733 === 0) s += (Math.random() * 2 - 1) * env * 2;
        d[i] = s;
      }
    }
    return ir;
  }

  function init() {
    if (ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    } catch (e) { ctx = null; return; }
    noiseBuf = makeNoiseBuffer();

    master = ctx.createGain(); master.gain.value = 0.0; // fades up on start
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.25;

    // master muffle — closes when stunned / underwater-dread
    muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass';
    muffle.frequency.value = 20000; muffle.Q.value = 0.6;

    // reverb send
    conv = ctx.createConvolver(); conv.buffer = makeReverbIR();
    revGain = ctx.createGain(); revGain.gain.value = 0.9;
    dry = ctx.createGain(); dry.gain.value = 1.0;

    master.connect(muffle);
    muffle.connect(comp);
    muffle.connect(conv); conv.connect(revGain); revGain.connect(comp);
    comp.connect(ctx.destination);
  }

  // route a node to master (dry) — reverb is taken globally off the muffle bus
  function out(node) { node.connect(master); return node; }

  // simple equal-power-ish pan + distance attenuation from a world position
  function panFor(pos) {
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const g = ctx.createGain();
    if (!pos) { g.gain.value = 1; if (p) { p.connect(g); return { in: p, out: g }; } return { in: g, out: g }; }
    const dx = pos.x - listener.x, dz = pos.z - listener.z;
    const dist = Math.hypot(dx, dz);
    // right vector = forward rotated -90deg
    const rx = -listener.fz, rz = listener.fx;
    const side = (dx * rx + dz * rz) / (dist || 1);
    const atten = 1 / (1 + dist * dist * 0.02);
    g.gain.value = Math.min(1, atten);
    if (p) { p.pan.value = Math.max(-1, Math.min(1, side)); p.connect(g); return { in: p, out: g }; }
    return { in: g, out: g };
  }

  // ---- ambient bed ---------------------------------------------------------
  function startBed() {
    bed.gain = ctx.createGain(); bed.gain.value = 0.0;
    bed.lp = ctx.createBiquadFilter(); bed.lp.type = 'lowpass';
    bed.lp.frequency.value = 320; bed.lp.Q.value = 0.7;
    bed.gain.connect(bed.lp); out(bed.lp);

    // root drone cluster (low D-ish), with detune unease
    const roots = [55, 55 * 1.5, 55 * 2.0]; // root, fifth, octave
    roots.forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = i === 0 ? 0.18 : 0.09;
      o.connect(g); g.connect(bed.gain);
      // slow detune LFO
      const lfo = ctx.createOscillator(); lfo.type = 'sine';
      lfo.frequency.value = 0.05 + i * 0.017;
      const la = ctx.createGain(); la.gain.value = 3 + i * 2;
      lfo.connect(la); la.connect(o.detune);
      o.start(); lfo.start();
      bed.osc.push(o); bed.lfo.push(lfo);
    });

    // dissonant minor-second cluster that swells in at high tension
    bed.dissGain = ctx.createGain(); bed.dissGain.value = 0.0;
    bed.dissGain.connect(bed.gain);
    [55 * 1.06, 55 * 1.41].forEach((f) => {        // ~minor 2nd & tritone, the dread interval
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.06; o.connect(g); g.connect(bed.dissGain);
      o.start(); bed.osc.push(o);
    });

    // sub rumble floor
    bed.subGain = ctx.createGain(); bed.subGain.value = 0.0; out(bed.subGain);
    bed.sub = ctx.createOscillator(); bed.sub.type = 'sine'; bed.sub.frequency.value = 33;
    bed.sub.connect(bed.subGain); bed.sub.start();

    bed.gain.gain.linearRampToValueAtTime(0.5, now() + 6);
  }

  function startWind() {
    wind.src = noiseSource(true);
    wind.bp = ctx.createBiquadFilter(); wind.bp.type = 'bandpass';
    wind.bp.frequency.value = 500; wind.bp.Q.value = 0.7;
    wind.gain = ctx.createGain(); wind.gain.value = 0.0;
    wind.src.connect(wind.bp); wind.bp.connect(wind.gain); out(wind.gain);
    // gusting
    wind.lfo = ctx.createOscillator(); wind.lfo.type = 'sine'; wind.lfo.frequency.value = 0.08;
    const la = ctx.createGain(); la.gain.value = 0.06;
    const base = ctx.createConstantSource(); base.offset.value = 0.08;
    wind.lfo.connect(la); la.connect(wind.gain.gain); base.connect(wind.gain.gain);
    wind.src.start(); wind.lfo.start(); base.start();
    // slow filter drift
    const flfo = ctx.createOscillator(); flfo.type = 'sine'; flfo.frequency.value = 0.05;
    const fa = ctx.createGain(); fa.gain.value = 300;
    flfo.connect(fa); fa.connect(wind.bp.frequency); flfo.start();
  }

  function startHeart() {
    heart.gain = ctx.createGain(); heart.gain.value = 1.0; out(heart.gain);
    heart.on = true; heart.next = now() + 1; heart.rate = 60; heart.spike = 0;
  }

  function thump(t, freq, gain, dur) {
    const o = ctx.createOscillator(); o.type = 'sine';
    const g = ctx.createGain();
    o.frequency.setValueAtTime(freq * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(heart.gain);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function scheduleHeart() {
    if (!heart.on) return;
    const t = now();
    while (heart.next < t + 0.2) {
      const beatT = Math.max(heart.next, t + 0.02);
      const loud = Math.min(1, tension * 0.7 + heart.spike);  // steady dread + transient punch
      const gain = 0.22 + loud * 0.95;
      thump(beatT, 46, gain, 0.18);
      thump(beatT + 0.22, 40, gain * 0.7, 0.16); // dub
      const interval = 60 / Math.max(40, heart.rate);
      heart.next = beatT + interval;
    }
  }

  // ---- public one-shots ----------------------------------------------------
  function creak(pos, big = false) {
    if (!ctx) return;
    const t = now(); const p = panFor(pos);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const g = ctx.createGain(); const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = big ? 220 : 480; bp.Q.value = 6;
    const f0 = big ? 70 : 130;
    o.frequency.setValueAtTime(f0, t);
    // stuttering pitch wobble = old wood groan
    for (let i = 0; i < 8; i++) o.frequency.setValueAtTime(f0 * (1 + Math.random() * 0.18), t + i * (big ? 0.12 : 0.06));
    const dur = big ? 1.4 : 0.6;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(big ? 0.16 : 0.09, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp); bp.connect(g); g.connect(p.in); p.out.connect(master); p.out.connect(conv);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function drip(pos) {
    if (!ctx) return;
    const t = now(); const p = panFor(pos);
    const o = ctx.createOscillator(); o.type = 'sine';
    const g = ctx.createGain();
    o.frequency.setValueAtTime(900 + Math.random() * 600, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.10, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(p.in); p.out.connect(master); p.out.connect(conv);
    o.start(t); o.stop(t + 0.25);
  }

  function whisper(pos) {
    if (!ctx) return;
    const t = now(); const p = panFor(pos);
    const s = noiseSource(false);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 8;
    const g = ctx.createGain();
    // sweep a couple formants to imply a voice with no words
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.linearRampToValueAtTime(1600, t + 0.4);
    bp.frequency.linearRampToValueAtTime(900, t + 0.9);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.15);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.0);
    s.connect(bp); bp.connect(g); g.connect(p.in); p.out.connect(master); p.out.connect(conv);
    s.start(t); s.stop(t + 1.1);
  }

  function footstep(pos, wet = false) {
    if (!ctx) return;
    const t = now(); const p = panFor(pos);
    const s = noiseSource(false);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = wet ? 900 : 1600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(wet ? 0.05 : 0.04, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (wet ? 0.18 : 0.1));
    s.connect(lp); lp.connect(g); g.connect(p.in); p.out.connect(master);
    s.start(t); s.stop(t + 0.2);
  }

  function flutter(pos) {
    if (!ctx) return;
    const t = now(); const p = panFor(pos);
    for (let i = 0; i < 9; i++) {
      const s = noiseSource(false);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 2;
      const g = ctx.createGain(); const tt = t + i * 0.045;
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.05, tt + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.04);
      s.connect(bp); bp.connect(g); g.connect(p.in); s.start(tt); s.stop(tt + 0.05);
    }
    p.out.connect(master); p.out.connect(conv);
  }

  function slam(pos) {
    if (!ctx) return;
    const t = now(); const p = panFor(pos);
    // low boom
    const o = ctx.createOscillator(); o.type = 'sine';
    const og = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.6, t + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    // crack
    const s = noiseSource(false); const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.4, t); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(og); s.connect(sg);
    og.connect(p.in); sg.connect(p.in); p.out.connect(master); p.out.connect(conv);
    o.start(t); o.stop(t + 0.55); s.start(t); s.stop(t + 0.2);
  }

  function doorCreak(pos) { creak(pos, true); }

  // ---- the scream: layered jump-scare stinger ------------------------------
  function stinger(type = 'shriek') {
    if (!ctx) return;
    const t = now();
    duck(0.25, 0.05);            // momentarily pull the bed so the hit cuts
    setTimeout(() => duck(1.0, 1.5), 120);

    // sub drop — punches the chest
    const sub = ctx.createOscillator(); sub.type = 'sine';
    const sg = ctx.createGain();
    sub.frequency.setValueAtTime(150, t); sub.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.8, t + 0.01);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    sub.connect(sg); sg.connect(master); sg.connect(conv);
    sub.start(t); sub.stop(t + 1.2);

    // noise burst impact
    const n = noiseSource(false); const ng = ctx.createGain();
    const nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 400;
    ng.gain.setValueAtTime(0.7, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    n.connect(nf); nf.connect(ng); ng.connect(master); ng.connect(conv);
    n.start(t); n.stop(t + 0.6);

    if (type === 'shriek' || type === 'shriekHard') {
      // violent detuned string cluster glissando — the classic violin shriek
      const partials = type === 'shriekHard' ? [1, 1.0595, 1.414, 2, 2.0595, 2.83] : [1, 1.0595, 1.5, 2];
      const baseF = 1100;
      partials.forEach((m, i) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        const g = ctx.createGain();
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = baseF * m; bp.Q.value = 3;
        o.frequency.setValueAtTime(baseF * m * 0.8, t);
        o.frequency.linearRampToValueAtTime(baseF * m * 1.15, t + 0.18);
        o.frequency.linearRampToValueAtTime(baseF * m, t + 0.9);
        const peak = (type === 'shriekHard' ? 0.16 : 0.11) / (1 + i * 0.4);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
        g.gain.setValueAtTime(peak, t + 0.5);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (type === 'shriekHard' ? 1.4 : 0.9));
        o.connect(bp); bp.connect(g); g.connect(master); g.connect(conv);
        o.start(t); o.stop(t + 1.5);
      });
    } else if (type === 'breath') {
      // a sudden inhaled gasp right in your ear (quieter, intimate)
      const s = noiseSource(false); const g = ctx.createGain();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.5;
      bp.frequency.setValueAtTime(500, t); bp.frequency.linearRampToValueAtTime(1400, t + 0.35);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22, t + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      s.connect(bp); bp.connect(g); g.connect(master); g.connect(conv);
      s.start(t); s.stop(t + 0.7);
    }
  }

  // ---- ending crescendo: a long, swallowing rise ---------------------------
  let crescendoNodes = [];
  function crescendo(seconds = 14) {
    if (!ctx) return;
    const t = now();
    // rising dissonant cluster
    const freqs = [110, 116.5, 155, 220, 233, 311];
    freqs.forEach((f) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.10, t + seconds * 0.85);
      o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 1.18, t + seconds);
      o.connect(g); g.connect(master); g.connect(conv); o.start(t);
      crescendoNodes.push(o, g);
    });
    // rising sub
    const sub = ctx.createOscillator(); sub.type = 'sine';
    const sg = ctx.createGain(); sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.5, t + seconds);
    sub.frequency.setValueAtTime(28, t); sub.frequency.linearRampToValueAtTime(55, t + seconds);
    sub.connect(sg); sg.connect(master); sub.start(t);
    crescendoNodes.push(sub, sg);
    // swelling noise
    const n = noiseSource(true); const ng = ctx.createGain(); const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.6;
    ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.25, t + seconds);
    bp.frequency.setValueAtTime(600, t); bp.frequency.linearRampToValueAtTime(4000, t + seconds);
    n.connect(bp); bp.connect(ng); ng.connect(master); ng.connect(conv); n.start(t);
    crescendoNodes.push(n, ng);
  }
  function stopCrescendo() {
    const t = now();
    crescendoNodes.forEach((nd) => {
      try { if (nd.gain) nd.gain.cancelScheduledValues(t), nd.gain.setTargetAtTime(0.0001, t, 0.3);
            else if (nd.stop) nd.stop(t + 1); } catch (e) {}
    });
    setTimeout(() => { crescendoNodes.forEach((nd) => { try { nd.disconnect(); } catch (e) {} }); crescendoNodes = []; }, 1500);
  }

  // ---- mixing controls -----------------------------------------------------
  function duck(amount, time = 0.4) {
    if (!ctx) return;
    if (!bed.gain) return;
    bed.gain.gain.cancelScheduledValues(now());
    bed.gain.gain.setTargetAtTime(0.5 * amount, now(), time / 3);
  }
  function setMuffle(freq, time = 0.3) {
    if (!ctx) return;
    if (!muffle) return;
    muffle.frequency.setTargetAtTime(freq, now(), time / 3);
  }

  // ---- frame update --------------------------------------------------------
  function update(dt, lp, forward) {
    if (!started) return;
    if (lp) { listener.x = lp.x; listener.y = lp.y; listener.z = lp.z; }
    if (forward) { listener.fx = forward.x; listener.fz = forward.z; }

    tension += (targetTension - tension) * Math.min(1, dt * 1.5);

    // bed responds to tension: brighter, more dissonant, more sub
    if (bed.lp) bed.lp.frequency.setTargetAtTime(280 + tension * 1400, now(), 0.3);
    if (bed.dissGain) bed.dissGain.gain.setTargetAtTime(tension * tension * 0.9, now(), 0.4);
    if (bed.subGain) bed.subGain.gain.setTargetAtTime(0.12 + tension * 0.5, now(), 0.4);
    if (wind.gain && zone === 'forest') { /* wind handled by its own lfo */ }

    // heartbeat: ease the rate toward a dread-scaled resting BPM (up or down),
    // and let any scare spike fade out over ~1s.
    if (heart.on) {
      const restingRate = 52 + tension * 46;
      heart.rate += (restingRate - heart.rate) * Math.min(1, dt * 0.8);
      heart.spike = Math.max(0, heart.spike - dt * 1.1);
      scheduleHeart();
    }
  }

  // ---- lifecycle -----------------------------------------------------------
  function unlock() {
    init();
    if (!ctx) return;            // AudioContext unavailable (e.g. headless) — bail safely
    if (ctx.state === 'suspended') ctx.resume();
    // iOS unlock: play a silent blip
    if (!unlocked) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      g.gain.value = 0.0001; o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.02); unlocked = true;
    }
  }

  function start() {
    init(); unlock();
    if (!ctx) return;            // audio unavailable (e.g. headless) — degrade silently
    if (started) return; started = true;
    startBed(); startWind(); startHeart();
    master.gain.setValueAtTime(0.0001, now());
    master.gain.linearRampToValueAtTime(0.9, now() + 4);
  }

  function setZone(z) {
    if (!ctx) return;
    zone = z;
    if (!started) return;
    // wind only outside; reverb longer & wetter as we descend
    if (wind.gain) wind.gain.gain.setTargetAtTime(z === 'forest' ? 0.1 : 0.02, now(), 1.5);
    revGain.gain.setTargetAtTime(z === 'basement' || z === 'final' ? 1.2 : z === 'mansion' ? 1.0 : 0.6, now(), 2);
  }

  function setTension(v) { targetTension = Math.max(0, Math.min(1, v)); }

  // A scare can punch the heartbeat: `intensity` (0..1) adds a decaying loudness
  // spike, and `rate` can jolt the BPM up instantly (it eases back down later).
  function bumpHeart(intensity = 0, rate = 0) {
    heart.spike = Math.max(heart.spike, intensity);
    if (rate) heart.rate = Math.max(heart.rate, rate);
  }

  function fadeOut(time = 2) { if (master) master.gain.setTargetAtTime(0.0001, now(), time / 3); }
  function fadeIn(time = 3) { if (master) { master.gain.cancelScheduledValues(now()); master.gain.setTargetAtTime(0.9, now(), time / 3); } }

  // Restore the whole mix after the ending faded it to silence. start() can't
  // re-run (we're already started), so a replay would otherwise be mute.
  function resetMix() {
    if (!ctx) return;
    setMuffle(20000, 0.4);
    if (bed.gain) bed.gain.gain.setTargetAtTime(0.5, now(), 0.5);   // undo any ducking
    heart.spike = 0; heart.rate = 60;
    tension = 0; targetTension = 0.12;
    fadeIn(2.5);
  }

  return {
    init, unlock, start, update, setZone, setTension, bumpHeart,
    creak, drip, whisper, footstep, flutter, slam, doorCreak,
    stinger, crescendo, stopCrescendo, duck, setMuffle, fadeOut, fadeIn, resetMix,
    get context() { return ctx; },
    get tension() { return tension; },
    get isStarted() { return started; },
  };
})();
