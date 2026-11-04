// One particle effect (helper of Particles.js): a ring buffer of particles drawn as one THREE.Points, updated on the CPU every frame.
import * as THREE from 'three';
import { vert, frag } from './shaders.js';
import { codedError } from '../../core/errorHints.js';
import { isWebGPU, webgpuPart, onRendererSwap } from '../../render/backend.js';

export const NEUTRAL = {
  max: 120, lifetime: [1, 2], rate: 10, speed: [0.5, 1.5], direction: [0, 1, 0], spread: 0.5, area: 0,
  gravity: -2, drag: 0.5, wind: 0, windDir: [1, 0, 0.3], size: [0.3, 0.3], color: [0xcccccc, 0xcccccc], opacity: [0.8, 0],
  texture: null, blending: 'normal', spin: 0, worldSpace: true, fog: true, maxPixels: 512,
};
export const KEYS = Object.keys(NEUTRAL);
const pair = v => Array.isArray(v) ? v : [v, v];
/** The node-material side (render/fx/particles.tsl.js, loaded with threedog/tsl) when the renderer is a WebGPURenderer, else null */
function nodeSide(engine, name) {
  return isWebGPU(engine.renderer) ? webgpuPart('particles', `[particles ${name}] the particle material`) : null;
}

export class Effect {
  constructor(sys, name, o) {
    this.sys = sys; this.name = name; this.o = o;
    const N = this.max = Math.max(1, Math.round(o.max * (sys.engine.tier === 'low' ? 0.5 : 1)));
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3);
    this.age = new Float32Array(N); this.life = new Float32Array(N).fill(0);   // life 0 = empty slot
    this.spinV = new Float32Array(N);
    this.col0 = new Float32Array(N * 3); this.col1 = new Float32Array(N * 3);   // start/end color of each particle (emit may override)
    this.sz = new Float32Array(N * 2); this.op = new Float32Array(N * 2);
    this.extra = new Float32Array(N * 3);   // gravity, drag, wind (emit may override)
    this.head = 0; this.alive = 0;
    /** @internal the game's material while one is set */ this._given = null;
    this._c0 = new THREE.Color(); this._c1 = new THREE.Color();
    this._build();
    // fallback 'webgl': an effect defined before start() was built for the WebGPURenderer start() then replaced; build its draw object again
    // for the renderer in use (the particle state lives in the arrays above, so live particles carry over)
    /** @internal */ this._swap = onRendererSwap(sys.engine, () => {
      const vis = this.points.visible, was = [this.aPos, this.aSize, this.aAlpha, this.aAngle, this.aColor].map(a => a.array);
      this._drop();
      this._build();
      [this.aPos, this.aSize, this.aAlpha, this.aAngle, this.aColor].forEach((a, i) => a.array.set(was[i]));
      this.points.visible = vis;
      if (this._given) this.points.material = this._given;
      if (this._tex) this._useTexture(this._tex);
    });
    if (o.texture) this._loadTexture(o.texture);
  }

  /** The plain three.js material drawn; set yours and it is drawn as given, null gives the engine's back */
  get material() { return this._given ?? this._own; }
  set material(m) {
    if (m != null && !m.isMaterial) throw codedError('module-params', `particles '${this.name}': material is a three.js material (or null for the engine's); got ${m}`);
    this._given = m || null;
    this.points.material = m ?? this._own;
  }
  /** The engine material's { value } objects (uMap, uHasMap, uScale, uMaxPx): the engine writes them whichever material is drawn, a ShaderMaterial of yours can share them */
  get uniforms() { return this._own.uniforms; }

  /** @internal engine.remove disposes what the object draws, so the game's material comes off first: it stays the game's */
  _drop() { this.points.material = this._own; this.sys.engine.remove(this.points); }

  /** @internal The geometry, material and draw object for the engine's current renderer (sprite quads on WebGPU, points on WebGL) */
  _build() {
    const sys = this.sys, o = this.o, N = this.max, name = this.name;
    const g = this.geometry = new THREE.BufferGeometry();
    const gpu = nodeSide(sys.engine, name);   // WebGPU: the same attributes, read per instance by sprite quads
    const attr = (n, size) => { const a = new (gpu ? THREE.InstancedBufferAttribute : THREE.BufferAttribute)(new Float32Array(N * size), size); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.aPos = attr('position', 3); this.aSize = attr('aSize', 1); this.aAlpha = attr('aAlpha', 1); this.aAngle = attr('aAngle', 1); this.aColor = attr('aColor', 3);
    this._attrs = null;
    if (gpu) ({ material: this._own, object: this.points } = gpu.particles({ count: N, fog: o.fog !== false, additive: o.blending === 'additive',
      maxPixels: o.maxPixels, attrs: { aPos: this.aPos, aSize: this.aSize, aAlpha: this.aAlpha, aAngle: this.aAngle, aColor: this.aColor } }));
    else this._own = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, fog: o.fog !== false,
      blending: o.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uHasMap: { value: 0 }, uScale: { value: 400 }, uMaxPx: { value: o.maxPixels } }]),
    });
    if (!gpu) this.points = new THREE.Points(g, this._own);
    this.points.frustumCulled = false; this.points.visible = false; this.points.renderOrder = 10;
    this.points.matrixAutoUpdate = false;
    sys.engine.add(this.points, { owner: 'engine:particles' });
  }

  /** @internal */
  _useTexture(tex) { this._tex = tex; this.uniforms.uMap.value = tex; this.uniforms.uHasMap.value = 1; }

  _loadTexture(t) {
    if (t.isTexture) this._useTexture(t);
    else this.sys.engine.assets.useTexture(t, tex => this._useTexture(tex), { where: `particles '${this.name}'`, instead: 'a round dot shows instead' });
  }

  /** Emit count particles. origin {x,y,z}; o is the merged params; frame optional: particle direction rotates with the object */
  spawn(origin, count, o, quat) {
    // presentation: particle scatter
    const N = this.max, rnd = Math.random, life = pair(o.lifetime), spd = pair(o.speed), sz = pair(o.size), op = pair(o.opacity), col = pair(o.color);
    this._c0.set(col[0]); this._c1.set(col[1]);   // three converts to linear color space automatically
    const dir = this.sys._dir.set(o.direction[0], o.direction[1], o.direction[2]).normalize();
    if (quat) dir.applyQuaternion(quat);
    // two perpendicular directions around axis dir, for random picks inside the cone
    const up = Math.abs(dir.y) < 0.99 ? this.sys._up.set(0, 1, 0) : this.sys._up.set(1, 0, 0);
    const t1 = this.sys._t1.crossVectors(dir, up).normalize(), t2 = this.sys._t2.crossVectors(dir, t1);
    const area = o.area, ax = Array.isArray(area) ? area[0] : area, ay = Array.isArray(area) ? area[1] : area, az = Array.isArray(area) ? area[2] : area;
    for (let n = 0; n < count; n++) {
      const i = this.head; this.head = (this.head + 1) % N;
      if (this.life[i] === 0) this.alive++;
      const i3 = i * 3;
      this.pos[i3] = origin.x + (rnd() * 2 - 1) * ax; this.pos[i3 + 1] = origin.y + (rnd() * 2 - 1) * ay; this.pos[i3 + 2] = origin.z + (rnd() * 2 - 1) * az;
      // random direction in a cone: off-axis angle theta in [0, spread] (cos theta uniform = uniform on the sphere)
      const cosT = 1 - rnd() * (1 - Math.cos(Math.min(Math.PI, o.spread))), sinT = Math.sqrt(1 - cosT * cosT), ph = rnd() * Math.PI * 2;
      const a = Math.cos(ph) * sinT, b = Math.sin(ph) * sinT, v = spd[0] + rnd() * (spd[1] - spd[0]);
      this.vel[i3] = (dir.x * cosT + t1.x * a + t2.x * b) * v;
      this.vel[i3 + 1] = (dir.y * cosT + t1.y * a + t2.y * b) * v;
      this.vel[i3 + 2] = (dir.z * cosT + t1.z * a + t2.z * b) * v;
      this.age[i] = 0; this.life[i] = life[0] + rnd() * (life[1] - life[0]) || 0.01;
      this.spinV[i] = o.spin ? (rnd() * 2 - 1) * o.spin : 0;
      this.aAngle.array[i] = rnd() * Math.PI * 2;
      this.col0[i3] = this._c0.r; this.col0[i3 + 1] = this._c0.g; this.col0[i3 + 2] = this._c0.b;
      this.col1[i3] = this._c1.r; this.col1[i3 + 1] = this._c1.g; this.col1[i3 + 2] = this._c1.b;
      this.sz[i * 2] = sz[0]; this.sz[i * 2 + 1] = sz[1]; this.op[i * 2] = op[0]; this.op[i * 2 + 1] = op[1];
      this.extra[i3] = o.gravity; this.extra[i3 + 1] = o.drag; this.extra[i3 + 2] = o.wind;
    }
    this.points.visible = true;
  }

  update(dt) {
    if (!this.alive) { this.points.visible = false; return; }
    const N = this.max, P = this.pos, V = this.vel, ap = this.aPos.array, as = this.aSize.array, aa = this.aAlpha.array, ac = this.aColor.array, ag = this.aAngle.array;
    const w = this.o.windDir, wl = Math.hypot(w[0], w[2]) || 1, wind = this.sys.engine.uniforms.uWind.value, wx = w[0] / wl * wind, wz = w[2] / wl * wind;
    let alive = 0, hi = -1;
    for (let i = 0; i < N; i++) {
      const L = this.life[i];
      if (L === 0) continue;
      hi = i;
      const age = this.age[i] += dt;
      if (age >= L) { this.life[i] = 0; aa[i] = 0; continue; }
      alive++;
      const i3 = i * 3, k = age / L, g = this.extra[i3], dr = Math.max(0, 1 - this.extra[i3 + 1] * dt), wd = this.extra[i3 + 2];
      V[i3] = V[i3] * dr + wx * wd * dt; V[i3 + 1] = V[i3 + 1] * dr + g * dt; V[i3 + 2] = V[i3 + 2] * dr + wz * wd * dt;
      ap[i3] = P[i3] += V[i3] * dt; ap[i3 + 1] = P[i3 + 1] += V[i3 + 1] * dt; ap[i3 + 2] = P[i3 + 2] += V[i3 + 2] * dt;
      as[i] = this.sz[i * 2] + (this.sz[i * 2 + 1] - this.sz[i * 2]) * k;
      aa[i] = this.op[i * 2] + (this.op[i * 2 + 1] - this.op[i * 2]) * k;
      ac[i3] = this.col0[i3] + (this.col1[i3] - this.col0[i3]) * k;
      ac[i3 + 1] = this.col0[i3 + 1] + (this.col1[i3 + 1] - this.col0[i3 + 1]) * k;
      ac[i3 + 2] = this.col0[i3 + 2] + (this.col1[i3 + 2] - this.col0[i3 + 2]) * k;
      if (this.spinV[i]) ag[i] += this.spinV[i] * dt;
    }
    this.alive = alive;
    this.points.visible = alive > 0;
    // upload only the used range (0 to the last live particle), not the whole buffer
    const n = hi + 1;
    if (this.points.isSprite) this.points.count = n;   // WebGPU sprites: instances up to the last live one (dead ones in between have size 0)
    for (const a of this._attrs ||= [this.aPos, this.aSize, this.aAlpha, this.aColor, this.aAngle]) {
      a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true;
    }
  }

  dispose() { this._swap.remove(); this._drop(); }
}
