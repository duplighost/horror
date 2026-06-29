import * as THREE from 'three';
import { Quality } from './config.js';

// One fullscreen shader pass over the rendered frame: chromatic aberration,
// film grain (also dithers the 8-bit darkness so it doesn't band), vignette,
// desaturation, flashlight halation, dirty-lens breakup, a creeping red
// "dread" tint, and a tunnel-vision crush used when something is too close.

const frag = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2 uRes;
  uniform float uTime, uVignette, uAberration, uGrain, uDesat, uDread, uTunnel, uPulse;
  varying vec2 vUv;

  float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }

  void main(){
    vec2 uv = vUv;
    vec2 c = uv - 0.5;
    float r = length(c) * 1.41421;

    // chromatic aberration grows toward the edges
    float a = uAberration * (0.25 + r*1.6);
    vec3 col;
    col.r = texture2D(tDiffuse, uv + c*a).r;
    col.g = texture2D(tDiffuse, uv).g;
    col.b = texture2D(tDiffuse, uv - c*a).b;

    // desaturate toward greyscale dread
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(l), uDesat);

    // Cold shadows and warmer flashlight highlights. This gives the same
    // geometry more depth without adding heavy lighting passes.
    float hi = smoothstep(0.28, 0.88, l);
    vec3 cold = col * vec3(0.74, 0.88, 1.10);
    vec3 warm = col * vec3(1.18, 0.98, 0.74);
    col = mix(cold, warm, hi);

    // Filmic contrast and black crush that rises with dread, while leaving a
    // little grey detail in the darkest parts so the player can still read shape.
    float contrast = 1.10 + uDread * 0.22 + uPulse * 0.08;
    col = (col - 0.5) * contrast + 0.5;
    col = max(col, vec3(0.006));

    // One-pass halation on bright torch hits. It is not a true blur, but it
    // makes close lit walls feel wet/overexposed instead of flat.
    float bloom = smoothstep(0.52, 1.10, l);
    col += vec3(1.0, 0.66, 0.38) * bloom * (0.09 + uPulse * 0.18);

    // red wash from the edges inward
    float dredge = uDread * smoothstep(0.05, 0.85, r);
    col = mix(col, vec3(l*1.2, l*0.12, l*0.12), dredge*0.85);
    col *= 1.0 + uPulse*0.4;

    // Uneven lens grime near the edges: just enough to make darkness feel
    // physical, not like a plain black overlay.
    float dirt = hash(floor(uv * vec2(31.0, 19.0)) + vec2(7.0, 13.0));
    float smear = smoothstep(0.78, 0.18, abs(sin((uv.x * 5.0 + uv.y * 11.0 + dirt * 2.0) * 3.14159)));
    col *= 1.0 - smoothstep(0.46, 1.0, r) * smear * (0.018 + uDread * 0.045);

    // vignette
    float vig = smoothstep(1.05, 0.3, r);
    float edgeBreath = 1.0 - sin(uTime * 1.7) * 0.025 * uDread;
    col *= mix(1.0, vig * edgeBreath, uVignette);

    // tunnel crush — edges collapse to black as it rises
    float t = smoothstep(0.45 - uTunnel*0.42, 1.0 - uTunnel*0.55, r);
    col *= 1.0 - t*uTunnel;

    // subtle scan instability + film grain/dithering
    float scan = sin((uv.y + hash(vec2(floor(uTime * 5.0), 2.0)) * 0.006) * uRes.y * 1.35);
    col *= 1.0 - (1.0 - smoothstep(-0.2, 0.8, scan)) * (0.006 + uDread * 0.008);

    // film grain + dithering
    float g = hash(uv*uRes + fract(uTime)*vec2(91.7, 33.1));
    col += (g - 0.5) * uGrain * (0.10 + uDread * 0.055);
    col += (g - 0.5) * (1.0/255.0);

    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

const vert = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this._rtOpts = {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace,
      depthBuffer: true, stencilBuffer: false, samples: Quality.tier === 'high' ? 2 : 0,
    };
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, this._rtOpts);
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.uniforms = {
      tDiffuse: { value: this.rt.texture },
      uRes: { value: new THREE.Vector2(size.x, size.y) },
      uTime: { value: 0 },
      uVignette: { value: 1.0 },
      uAberration: { value: 0.0015 },
      uGrain: { value: Quality.grain ? 1.0 : 0.0 },
      uDesat: { value: 0.25 },
      uDread: { value: 0.0 },
      uTunnel: { value: 0.0 },
      uPulse: { value: 0.0 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);

    // tween targets so effects ease instead of snap
    this.target = { vignette: 1.0, aberration: 0.0015, desat: 0.25, dread: 0.0, tunnel: 0.0, pulse: 0.0 };
  }

  setSize(w, h) {
    const dpr = this.renderer.getPixelRatio();
    this.rt.setSize(Math.floor(w * dpr), Math.floor(h * dpr));
    this.uniforms.uRes.value.set(this.rt.width, this.rt.height);
  }

  // after a GPU context loss, the old framebuffer is gone — build a fresh one
  onContextRestored() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    try { this.rt.dispose(); } catch (e) {}
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, this._rtOpts);
    this.uniforms.tDiffuse.value = this.rt.texture;
    this.uniforms.uRes.value.set(this.rt.width, this.rt.height);
  }

  set(key, value) { if (key in this.target) this.target[key] = value; }
  // momentary kick (e.g. a stinger) that decays back
  kick(key, value) { if (key in this.target) this.uniforms['u' + key[0].toUpperCase() + key.slice(1)].value = value; }

  render(scene, camera, dt) {
    // ease uniforms toward targets
    const u = this.uniforms, k = Math.min(1, dt * 3.5);
    u.uVignette.value += (this.target.vignette - u.uVignette.value) * k;
    u.uAberration.value += (this.target.aberration - u.uAberration.value) * k;
    u.uDesat.value += (this.target.desat - u.uDesat.value) * k;
    u.uDread.value += (this.target.dread - u.uDread.value) * k;
    u.uTunnel.value += (this.target.tunnel - u.uTunnel.value) * k;
    u.uPulse.value += (this.target.pulse - u.uPulse.value) * Math.min(1, dt * 6);
    u.uTime.value += dt;

    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.cam);
  }
}
