// Appearance open points (sky clouds, terrain ground color, vegetation): defaults draw what they always drew, new
// parameters take effect, replacement GLSL compiles, and the settings survive the worker boundary.
// Sky pixel checks render the dome material into a small render target and compare bytes.

export const specs = [
  {
    software: true,   // reads rendered pixels: stays on software rendering (same pixels on every machine)
    name: '[守] 天空云：默认云画面和旧着色器逐字节一致；horizon / fade / opacity / noise 参数生效；cumulus 与自定义 glsl 编译通过且画面不同；错误写法报错给改法',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, createEngine, sky, NOISE_GLSL } = threedogTest, R = engine.renderer, out = {};
        const rt = new THREE.WebGLRenderTarget(24, 24), cam = new THREE.PerspectiveCamera(100, 1, 0.1, 1000), bytes = new Uint8Array(24 * 24 * 4);
        const shot = (mat, pitch) => {
          const sc = new THREE.Scene(), m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
          m.scale.setScalar(500); m.frustumCulled = false; sc.add(m);
          cam.rotation.set(pitch, 0.4, 0, 'YXZ');
          let err = ''; const prev = R.debug.onShaderError;
          R.debug.onShaderError = (gl, p, vs, fs) => { err += (gl.getProgramInfoLog(p) || '') + (gl.getShaderInfoLog(fs) || ''); };
          R.setRenderTarget(rt); R.render(sc, cam); R.readRenderTargetPixels(rt, 0, 0, 24, 24, bytes); R.setRenderTarget(null);
          R.debug.onShaderError = prev;
          return { px: Array.from(bytes).join(','), err: err.slice(0, 400) };
        };
        const make = clouds => {
          const e = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'appearance-sky', style: { sky: { clouds: { coverage: 1, ...clouds } } } });
          try { e.use(sky()); } catch (err) { e.dispose(); return { error: err.message }; }
          e.uniforms.uCloud.value = 0.6; e.uniforms.uTime.value = 40; e.sky.uniforms.uNight.value = 0.2;
          return { e, mat: e.sky.dome.material };
        };
        // the original dome fragment shader, kept here as the oracle for "default look unchanged"
        const OLD = `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uNight;
uniform float uSunSize; uniform float uSunGlow; uniform float uSunPower; uniform float uMoonPower; uniform float uMoonSize; uniform vec3 uMoonColor; uniform float uStars; uniform float uStarScale; uniform float uCurve;
uniform float uTime; uniform float uCloud; uniform float uCloudCover; uniform float uCloudScale; uniform vec2 uCloudSpeed; uniform vec3 uCloudColor; uniform vec3 uCloudShade;
varying vec3 vDir;
float h3(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
${NOISE_GLSL}
void main(){
  vec3 d = normalize(vDir);
  float y = max(d.y, 0.0);
  vec3 col = d.y < 0.0 ? uHorizon : mix(uHorizon, uTop, pow(y, uCurve));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, uSunSize) * uSunPower + pow(sd, 12.0) * uSunGlow) * step(0.0, uSunDir.y + 0.05);
  float md = max(dot(d, -uSunDir), 0.0);
  col += uMoonColor * pow(md, uMoonSize) * uMoonPower * uNight;
  vec3 g = floor(d * uStarScale);
  float cov = uCloud * uCloudCover;
  if (d.y > 0.0 && cov > 0.01) {
    vec2 cp = d.xz / (d.y + 0.08) * uCloudScale + uCloudSpeed * uTime;
    float cn = threedogNoise(cp) * 0.6 + threedogNoise(cp * 2.7 + 7.0) * 0.3 + threedogNoise(cp * 6.1) * 0.1;
    float cloud = smoothstep(1.0 - cov, 1.0 - cov + 0.3, cn) * smoothstep(0.0, 0.18, d.y);
    vec3 cc = mix(uCloudShade, uCloudColor, smoothstep(0.3, 0.8, cn)) * (0.35 + 0.65 * (1.0 - uNight));
    col = mix(col, cc, cloud * 0.9);
  }
  col += vec3(step(1.0 - uStars, h3(g)) * uNight * smoothstep(0.0, 0.25, d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
        const base = make({});
        const oldMat = new THREE.ShaderMaterial({ vertexShader: base.mat.vertexShader, fragmentShader: OLD, uniforms: base.mat.uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false });
        const pitches = [0.5, 0.9, 1.3];
        out.same = pitches.every(p => { const a = shot(oldMat, p), b = shot(base.mat, p); out.err0 = a.err + b.err; return a.px === b.px; });
        const cloudy = shot(base.mat, 0.5).px;
        out.hasClouds = cloudy !== (() => { base.e.uniforms.uCloud.value = 0; const z = shot(base.mat, 0.5).px; base.e.uniforms.uCloud.value = 0.6; return z; })();
        out.defaults = ['uCloudHorizon', 'uCloudOpacity', 'uCloudSoft', 'uCloudRelief'].map(k => base.e.sky.uniforms[k].value).join() + '|' + base.e.sky.uniforms.uCloudFade.value.toArray() + '|' + base.e.sky.uniforms.uCloudMul.value.toArray() + '|' + base.e.sky.uniforms.uCloudWeights.value.toArray();
        // parameters take effect, shown by a different picture with the same coverage and no compile error
        const param = (clouds) => { const m = make(clouds), s = shot(m.mat, 0.9); m.e.dispose(); return s; };
        const ref = shot(base.mat, 0.9).px;
        out.horizon = param({ horizon: 0.8 }).px !== ref;
        out.opacity = param({ opacity: 0.3 }).px !== ref;
        out.fade = param({ fade: [0.2, 0.9] }).px !== ref;
        out.noise = param({ noise: { weights: [0.2, 0.4, 0.4], scales: [4, 9] } }).px !== ref;
        const cum = make({ kind: 'cumulus' }), cs = shot(cum.mat, 0.9);
        out.cumulus = { err: cs.err, differs: cs.px !== ref };
        cum.e.sky.uniforms.uSunDir.value.set(1, 0.5, 0).normalize(); const sunA = shot(cum.mat, 0.9).px;
        cum.e.sky.uniforms.uSunDir.value.set(-1, 0.5, 0).normalize();
        out.cumulusSun = shot(cum.mat, 0.9).px !== sunA;   // lighting follows the sun direction
        const glsl = `vec4 threedogClouds(vec3 d, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cover){
  float n = threedogNoise(d.xz / (d.y + 0.3) * 3.0 + time * 0.01);
  return vec4(mix(shade, lit, n) * uTint, smoothstep(1.0 - cover, 1.0, n));
}`;
        const hook = (h) => { const x = make({}); if (x.error) return x; try { x.e.look.sky.patch('clouds', h); } catch (err) { x.e.dispose(); return { error: err.message }; } return { e: x.e, mat: x.e.sky.dome.material }; };
        const cust = hook({ glsl, uniforms: { uTint: new THREE.Color(1, 0.5, 0.5), uPaper: new THREE.Texture() } });
        const ct = shot(cust.mat, 0.9);
        out.custom = { err: ct.err, differs: ct.px !== ref, hasUniform: !!cust.e.sky.uniforms.uTint };
        out.errKind = make({ kind: 'cumulous' }).error;
        out.errGlsl = hook('float x;').error;
        out.errUniform = hook({ glsl, uniforms: { uBad: 'red' } }).error;
        out.errStyle = make({ glsl }).error;
        rt.dispose();
        return out;
      });
      check('默认云：24x24 像素和旧着色器逐字节一致（3 个仰角）', r.same, r.err0);
      check('上面的比较有意义：云确实画出来了', r.hasClouds);
      check('默认参数 = 旧写死值（0.08 / 0.9 / 0.3、渐隐 0-0.18、倍率 2.7 6.1、权重 .6 .3 .1）', r.defaults === '0.08,0.9,0.3,5|0,0.18|2.7,6.1|0.6,0.3,0.1', r.defaults);
      check('horizon / opacity / fade / noise 参数各自改变画面', r.horizon && r.opacity && r.fade && r.noise, JSON.stringify([r.horizon, r.opacity, r.fade, r.noise]));
      check("kind: 'cumulus' 编译通过、画面不同于默认", r.cumulus.err === '' && r.cumulus.differs, JSON.stringify(r.cumulus));
      check('cumulus 受光随太阳方向变化', r.cumulusSun);
      check('look.sky.patch(clouds, { glsl, uniforms })（含贴图）编译通过、画面不同，uniform 在 sky.uniforms 里', r.custom.err === '' && r.custom.differs && r.custom.hasUniform, JSON.stringify(r.custom));
      check('kind 写错：报错并给出可选值与相近名', /kind 'cumulous'.*'plane' \| 'cumulus'.*did you mean 'cumulus'/.test(r.errKind), r.errKind);
      check('hook 没定义 threedogClouds：报错给出函数签名', /threedogClouds\(vec3 dir/.test(r.errGlsl || ''), r.errGlsl);
      check("style.sky.clouds.glsl 不是选项：报错指向 look.sky.patch('clouds')", /look\.sky\.patch\('clouds'/.test(r.errStyle || ''), r.errStyle);
      check('uniforms 类型不支持：报错说明可用类型', /uniforms\.uBad must be a number/.test(r.errUniform), r.errUniform);
    },
  },
  {
    name: '[守] 地面着色：style.terrain.variation 默认逐位等于旧写法；blend / jitter / patches 生效；配置能 structuredClone 进 worker 且结果相同；自定义地面材质（贴图 + 三向投影补丁）跨区块无缝并能编译',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, createTerrain, terrainMaterial, applyEffects } = threedogTest, R = engine.renderer, out = {};
        const base = { seed: 5, colors: { a: 0x4a7c3a, b: 0x6a9c4a, r: 0x777777 }, biomeColors: { default: ['a', 'b'] }, steep: [{ maxNormalY: 0.7, colors: ['r'] }],
          height: '(x,z,n)=>n.fbm(x*0.02,z*0.02,3)*12' };
        const hash = c => { let h = 0; for (const k of ['col', 'pos']) for (const v of c[k]) h = (h * 31 + Math.round(v * 1e6)) | 0; return h; };
        // golden values computed with the pre-variation terrainGen (same config), so "default unchanged" is checked against the old code, not itself
        out.smooth = hash(createTerrain({ ...base, shading: 'smooth' }).buildChunk(1, -2));
        out.flat = hash(createTerrain({ ...base, shading: 'flat' }).buildChunk(1, -2));
        const cfg = (v) => ({ ...base, shading: 'smooth', variation: v });
        const h = v => hash(createTerrain(cfg(v)).buildChunk(1, -2));
        out.emptyVar = h({}) === out.smooth;
        out.blend = h({ blend: { size: 10 } }) !== out.smooth && h({ blend: { strength: 2 } }) !== out.smooth;
        out.jitter = h({ jitter: { size: 0.5, min: 0.8, range: 0.3 } }) !== out.smooth;
        out.patches = h({ patches: { size: 90, strength: 0.3 } }) !== out.smooth;
        out.levels = h({ patches: { size: 90, strength: 0.3, levels: 4 } }) !== h({ patches: { size: 90, strength: 0.3 } });
        out.tint = h({ patches: { size: 90, strength: 0.5, tint: 0xff0000 } }) !== h({ patches: { size: 90, strength: 0.5 } });
        const v = { patches: { size: 60, strength: 0.3, levels: 3, tint: 0x884422 }, blend: { size: 12, strength: 1.5 }, jitter: { size: 0.5, min: 0.9, range: 0.1 } };
        out.worker = hash(createTerrain(structuredClone(cfg(v))).buildChunk(1, -2)) === h(v);   // the Worker receives exactly this clone
        // custom ground material: texture map on the chunk uv, and a triplanar patch from the world position
        const T = createTerrain({ seed: 1, height: '(x,z,n)=>0', shading: 'smooth' });
        const a = T.buildChunk(0, 0), b = T.buildChunk(1, 0), c = T.buildChunk(0, 1), CH = T.CHUNK;
        let seam = true;   // every vertex's uv equals world xz / chunk size, so the neighbour's first column has the same uv as this one's last
        for (const [ch, ox, oz] of [[a, 0, 0], [b, CH, 0], [c, 0, CH]]) for (let i = 0; i < ch.pos.length / 3; i++)
          if (Math.abs(ch.uv[i * 2] - (ox + ch.pos[i * 3]) / CH) > 1e-6 || Math.abs(ch.uv[i * 2 + 1] - (oz + ch.pos[i * 3 + 2]) / CH) > 1e-6) seam = false;
        const maxU = Math.max(...a.uv.filter((_, i) => i % 2 === 0)), minU = Math.min(...b.uv.filter((_, i) => i % 2 === 0));
        const maxV = Math.max(...a.uv.filter((_, i) => i % 2 === 1)), minV = Math.min(...c.uv.filter((_, i) => i % 2 === 1));
        out.uvSeam = seam && Math.abs(maxU - 1) < 1e-6 && Math.abs(minU - 1) < 1e-6 && Math.abs(maxV - 1) < 1e-6 && Math.abs(minV - 1) < 1e-6;
        const px = 32, data = new Uint8Array(px * px * 4);
        for (let i = 0; i < px * px; i++) { const n = (Math.sin(i % px * 0.7) + Math.sin(Math.floor(i / px) * 0.5) + 2) / 4 * 255; data.set([n, n * 0.8, n * 0.6, 255], i * 4); }
        const map = new THREE.DataTexture(data, px, px); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.colorSpace = THREE.SRGBColorSpace; map.repeat.set(8, 8); map.needsUpdate = true;
        const triplanar = { name: 'triplanar', needs: { patches: ['world'] }, uniforms: { uTri: { value: map }, uTriScale: { value: 0.1 } }, glsl: { fragment: {
          pars: 'uniform sampler2D uTri; uniform float uTriScale;',
          color_fragment: `vec3 tn = abs(normalize(cross(dFdx(vThreedogWorld), dFdy(vThreedogWorld)))); tn /= tn.x + tn.y + tn.z;
            diffuseColor.rgb *= texture2D(uTri, vThreedogWorld.zy * uTriScale).rgb * tn.x + texture2D(uTri, vThreedogWorld.xz * uTriScale).rgb * tn.y + texture2D(uTri, vThreedogWorld.xy * uTriScale).rgb * tn.z;` } } };
        const mats = [terrainMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, map }), { style: {}, assets: {} }),
          terrainMaterial(applyEffects(new THREE.MeshLambertMaterial({ vertexColors: true }), { clouds: false, patches: [triplanar] }), { style: {}, assets: {} })];
        const errors = []; const prev = R.debug.onShaderError; R.debug.onShaderError = (gl, p, vs, fs) => errors.push((gl.getProgramInfoLog(p) || '') + (gl.getShaderInfoLog(fs) || ''));
        const err0 = console.error; let logged = ''; console.error = (...x) => { logged += x.join(' '); };
        const sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-CH, CH, CH, -CH, 1, 500); cam.position.set(CH, 100, CH / 2); cam.lookAt(CH, 0, CH / 2);
        sc.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2));
        mats.forEach((m, k) => [[a, 0], [b, CH]].forEach(([ch, ox]) => {
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(ch.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(ch.nor, 3));
          g.setAttribute('color', new THREE.BufferAttribute(ch.col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(ch.uv, 2));
          const mesh = new THREE.Mesh(g, m); mesh.position.set(ox, 0, 0); sc.add(mesh);
        }));
        const rt = new THREE.WebGLRenderTarget(64, 32); R.setRenderTarget(rt); R.render(sc, cam); R.setRenderTarget(null); rt.dispose();
        console.error = err0; R.debug.onShaderError = prev;
        out.errors = errors.join('').slice(0, 300) + logged.slice(0, 300);
        return out;
      });
      check('默认地面颜色逐位等于旧写法（smooth / flat 两种着色的区块颜色+位置哈希）', r.smooth === 770401374 && r.flat === -1268058350, `${r.smooth} ${r.flat}`);
      check('variation: {} 与不写一样', r.emptyVar);
      check('blend.size / blend.strength / jitter / patches / levels / tint 各自改变区块颜色', r.blend && r.jitter && r.patches && r.levels && r.tint, JSON.stringify(r));
      check('variation 经 structuredClone（worker 配置）后结果相同', r.worker);
      check('地面 uv = 世界 xz / 区块大小：相邻区块在接缝处 uv 相等（贴图平铺跨区块无缝）', r.uvSeam);
      check('自定义地面材质（map 和三向投影补丁）带云影 / 季节后能编译渲染，无报错', r.errors === '', r.errors);
    },
  },
  {
    name: '[guard] patches sharing engine.uniforms.uTime: a game patch declaring uTime next to clouds / wind compiles (the patch system declares it once)',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, applyEffects } = threedogTest, R = engine.renderer, out = {};
        const rt = new THREE.WebGLRenderTarget(8, 8), cam = new THREE.PerspectiveCamera(60, 1, 0.1, 50); cam.position.set(0, 1, 4);
        const pulse = { name: 'pulse', slot: 'color', uniforms: { uTime: engine.uniforms.uTime }, pars: 'uniform float uTime;', glsl: 'diffuseColor.rgb *= 0.9 + 0.1 * sin(uTime);' };
        const sway = { name: 'sway', slot: 'position', uniforms: { uTime: engine.uniforms.uTime }, pars: 'uniform float uTime;', glsl: 'transformed.y += 0.01 * sin(uTime);' };
        const compile = (opts) => {
          const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2));
          sc.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), applyEffects(new THREE.MeshLambertMaterial(), opts)));
          let err = ''; const prev = R.debug.onShaderError;
          R.debug.onShaderError = (gl, p, vs, fs) => { err += (gl.getShaderInfoLog(vs) || '') + (gl.getShaderInfoLog(fs) || ''); };
          R.setRenderTarget(rt); R.render(sc, cam); R.setRenderTarget(null); R.debug.onShaderError = prev;
          return err.slice(0, 300);
        };
        out.fragment = compile({ patches: [pulse] });                  // clouds (on by default) declares uTime in the fragment stage too
        out.vertex = compile({ wind: 0.3, clouds: false, patches: [sway] });   // wind declares uTime in the vertex stage
        out.both = compile({ wind: 0.3, patches: [pulse, sway] });
        rt.dispose();
        return out;
      });
      check('fragment: clouds + a patch declaring uTime compiles', r.fragment === '', r.fragment);
      check('vertex: wind + a patch declaring uTime compiles', r.vertex === '', r.vertex);
      check('clouds + wind + both game patches compile', r.both === '', r.both);
    },
  },
  {
    software: true,   // reads rendered pixels: stays on software rendering (same pixels on every machine)
    name: '[守] 风摆：style.wind.glsl 替换摆动函数（照抄默认写法时与默认逐像素相同，换写法则画面不同，含自定义 uniform）；写错报错给签名；1 万株草 = 1 次 draw call（附耗时）',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, applyEffects } = threedogTest, R = engine.renderer, out = {};
        const rt = new THREE.WebGLRenderTarget(48, 48), cam = new THREE.PerspectiveCamera(60, 1, 0.1, 200), bytes = new Uint8Array(48 * 48 * 4);
        cam.position.set(0, 3, 12); cam.lookAt(0, 1.5, 0);
        const blade = new THREE.ConeGeometry(0.15, 2, 3).translate(0, 1, 0);
        const colors = new Float32Array(blade.attributes.position.count * 3).fill(0.6); blade.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const draw = (wind) => {
          const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2));
          const m = applyEffects(new THREE.MeshLambertMaterial({ vertexColors: true }), { wind, clouds: false });
          const im = new THREE.InstancedMesh(blade, m, 3);
          [-3, 0, 3].forEach((x, i) => im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0, 0)));
          sc.add(im);
          engine.uniforms.uTime.value = 7.3; engine.uniforms.uWind.value = 1.6;
          let err = ''; const prev = R.debug.onShaderError; R.debug.onShaderError = (gl, p, vs) => { err += (gl.getProgramInfoLog(p) || '') + (gl.getShaderInfoLog(vs) || ''); };
          R.setRenderTarget(rt); R.render(sc, cam); R.readRenderTargetPixels(rt, 0, 0, 48, 48, bytes); R.setRenderTarget(null); R.debug.onShaderError = prev;
          return { px: Array.from(bytes).join(','), err: err.slice(0, 300) };
        };
        const def = draw(0.3);
        const same = `void threedogWind(inout vec3 transformed, vec3 ip, vec3 position){
  float wt = uTime * uWindFreq;
  float sw = sin(wt * (1.2 + 0.6 * uWind) + ip.x * 0.31 + ip.z * 0.23) * 0.6 + sin(wt * 2.9 + ip.x * 0.77 - ip.z * 0.4) * 0.4;
  float k = max(position.y, 0.0) * THREEDOG_WIND_AMP * uWind;
  transformed.x += sw * k + k * 0.4 * (uWind - 1.0); transformed.z += sw * k * 0.6;
}`;
        const copy = draw({ amplitude: 0.3, glsl: same });
        out.copyErr = copy.err; out.copyEqual = copy.px === def.px; out.defErr = def.err;
        const mine = draw({ amplitude: 0.3, glsl: 'void threedogWind(inout vec3 t, vec3 ip, vec3 p){ t.x += uBend * max(p.y, 0.0) * uWind; }'.replace('uBend', '0.9') });
        out.mineErr = mine.err; out.mineDiffers = mine.px !== def.px;
        const withU = draw({ amplitude: 0.3, glsl: 'void threedogWind(inout vec3 t, vec3 ip, vec3 p){ t.x += uBend * max(p.y, 0.0); }', uniforms: { uBend: 0.8 } });
        out.uniformErr = withU.err; out.uniformDiffers = withU.px !== def.px;
        try { draw({ amplitude: 0.3, glsl: 'float x;' }); out.bad = ''; } catch (e) { out.bad = e.message; }
        // 10k grass blades: one InstancedMesh = one draw call; relative cost of the default wind vs none vs a custom sway
        const N = 10000, bench = (wind) => {
          const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2));
          const m = applyEffects(new THREE.MeshLambertMaterial({ vertexColors: true }), { wind, clouds: false });
          const im = new THREE.InstancedMesh(blade, m, N), mat = new THREE.Matrix4();
          for (let i = 0; i < N; i++) im.setMatrixAt(i, mat.makeTranslation((i % 100) - 50, 0, Math.floor(i / 100) - 50));
          im.frustumCulled = false; sc.add(im);
          const c2 = new THREE.PerspectiveCamera(60, 1, 0.1, 400); c2.position.set(0, 12, 40); c2.lookAt(0, 0, 0);
          R.setRenderTarget(rt); R.render(sc, c2);   // warm-up: compile + upload
          R.info.reset(); const t0 = performance.now();
          for (let i = 0; i < 5; i++) R.render(sc, c2);
          R.readRenderTargetPixels(rt, 0, 0, 1, 1, bytes);   // wait for the GPU, otherwise this times only the CPU side
          const ms = (performance.now() - t0) / 5, calls = R.info.render.calls / 5, tris = R.info.render.triangles / 5;
          R.setRenderTarget(null); im.dispose(); m.dispose();
          return { ms: +ms.toFixed(1), calls, tris };
        };
        out.none = bench(0); out.wind = bench(0.3); out.custom = bench({ amplitude: 0.3, glsl: same });
        rt.dispose();
        return out;
      });
      check('自定义摆动照抄默认写法：编译通过且与默认逐像素相同', r.copyErr === '' && r.defErr === '' && r.copyEqual, r.copyErr);
      check('换一种摆法：编译通过、画面不同', r.mineErr === '' && r.mineDiffers);
      check('自定义 uniform（数字）自动声明，编译通过、画面不同', r.uniformErr === '' && r.uniformDiffers, r.uniformErr);
      check('glsl 没定义 threedogWind：报错给签名', /must define `void threedogWind\(inout vec3 transformed, vec3 ip, vec3 position\)`/.test(r.bad), r.bad);
      check('1 万株草（一个 InstancedMesh）每帧 1 次 draw call；耗时（软件渲染，只看相对值）：无风 / 默认风 / 自定义风', r.none.calls === 1 && r.wind.calls === 1 && r.custom.calls === 1, JSON.stringify([r.none, r.wind, r.custom]));
    },
  },
];
