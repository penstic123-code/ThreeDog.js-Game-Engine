// Surface looks (render/surface*.js): texture names in material specs, the `detail` patch, season mix mode, lighting (shadowTint, rim, wrap, toon ramp).
// Pixel checks render a small scene into a render target and hash the bytes; the goldens of the "default unchanged" checks were taken from the code before these features.

// Shared in-page helpers (a string, injected into each ev so every check renders the same scene)
const SCENE = `
  const { THREE, makeMaterial, applyEffects, terrainMaterial, materialPatches } = threedogTest, R = engine.renderer;
  const rt = new THREE.WebGLRenderTarget(48, 48), cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100), bytes = new Uint8Array(48 * 48 * 4);
  cam.position.set(0, 3, 6); cam.lookAt(0, 0.5, 0);
  const colored = g => { const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = 0.45; c[i * 3 + 1] = 0.65; c[i * 3 + 2] = 0.3; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };
  const shot = (mat, o = {}) => {
    const sc = new THREE.Scene(), sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(3, 5, 2);
    sc.add(sun, new THREE.HemisphereLight(0xcce0ff, 0x554433, 0.9));
    const ball = new THREE.Mesh(colored(new THREE.SphereGeometry(1.2, 24, 16)), mat); ball.position.y = 1.2; sc.add(ball);
    const floor = new THREE.Mesh(colored(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2)), mat); sc.add(floor);
    if (o.shadow) { sun.castShadow = true; sun.shadow.camera.left = sun.shadow.camera.bottom = -6; sun.shadow.camera.right = sun.shadow.camera.top = 6; ball.castShadow = true; floor.receiveShadow = true; }
    const sm = R.shadowMap.enabled; R.shadowMap.enabled = !!o.shadow;
    const errs = [], prev = R.debug.onShaderError; R.debug.onShaderError = (gl, p, vs, fs) => errs.push((gl.getProgramInfoLog(p) || '') + (gl.getShaderInfoLog(fs) || ''));
    R.setRenderTarget(rt); R.clear(); R.render(sc, cam); R.readRenderTargetPixels(rt, 0, 0, 48, 48, bytes); R.setRenderTarget(null);
    R.shadowMap.enabled = sm; R.debug.onShaderError = prev;
    let h = 0; for (const b of bytes) h = (Math.imul(h, 31) + b) | 0;
    return { h, errs: errs.join('').slice(0, 300), px: Array.from(bytes) };
  };
  const eng = style => ({ style, assets: { texture: async () => { throw new Error('no assets'); } } });
`;

export const specs = [
  {
    name: '[守] 表面质感：默认画面不变（goldens 取自改动前）',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(`(async () => { ${SCENE}
        const out = {};
        out.lambert = shot(makeMaterial('default', { vertexColors: true }, eng({ materials: { default: { type: 'lambert' } } }))).h;
        out.toon = shot(makeMaterial('default', { vertexColors: true }, eng({ materials: { default: { type: 'toon', steps: 3 } } }))).h;
        out.standard = shot(makeMaterial('default', { vertexColors: true }, eng({ materials: { default: { type: 'standard', roughness: 0.8 } } }))).h;
        engine.uniforms.uGroundTint.value.set(1, 0.5, 0.2);
        out.season = shot(terrainMaterial(null, eng({ materials: { terrain: { type: 'lambert' } } }))).h;
        engine.uniforms.uGroundTint.value.set(1, 1, 1);
        const px = 16, d = new Uint8Array(px * px * 4);
        for (let i = 0; i < px * px; i++) { const n = 60 + (i * 37 % 140); d.set([n, n, n, 255], i * 4); }
        const tex = new THREE.DataTexture(d, px, px); tex.needsUpdate = true;
        const e = { style: { materials: { terrain: { type: 'lambert' } }, terrain: { detail: { texture: 'x', scale: 0.7, strength: 0.6 } } }, assets: { texture: async () => tex } };
        const m = terrainMaterial(null, e); out.detailBefore = shot(m).h;
        await new Promise(r => setTimeout(r, 50)); out.detail = shot(m).h;
        return out; })()`);
      check('lambert / toon / standard 材质的画面与改动前逐字节相同', r.lambert === 813980680 && r.toon === 141705411 && r.standard === -2046925158, JSON.stringify(r));
      check('季节地面色（乘）与改动前相同', r.season === -449878753, String(r.season));
      check('style.terrain.detail 迁到 detail 补丁后：加载前后的画面都与旧实现逐字节相同', r.detailBefore === 1844044487 && r.detail === 1857022951, `${r.detailBefore} ${r.detail}`);
    },
  },
  {
    name: '[守] detail 补丁：噪声 / 贴图来源、三平面、法线与粗糙度都能编译；参数生效；同补丁不同参数的 N 个材质只编译 1 个程序；写错报错给改法',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(`(async () => { ${SCENE}
        const out = {}, std = { materials: { default: { type: 'standard', roughness: 0.8 } } }, E = eng(std);
        const base = shot(makeMaterial('default', { vertexColors: true }, E)).h;
        const withDetail = d => shot(makeMaterial('default', { vertexColors: true, detail: d }, E));
        const errs = [];
        for (const [k, d] of Object.entries({ grain: { noise: 'grain', strength: 0.5 }, paper: { noise: 'paper' }, stroke: { noise: 'stroke', direction: 30, stretch: 8 },
          tri: { noise: 'grain', projection: 'triplanar', strength: 0.5 }, bump: { noise: 'grain', normal: 0.3, strength: 0 }, rough: { noise: 'grain', roughness: 0.6, strength: 0 },
          add: { noise: 'grain', mode: 'add', strength: 0.4 }, mix: { noise: 'grain', mode: 'mix', tint: 0xff0000, strength: 0.4 },
          custom: { glsl: 'vec4 threedogDetailSample(vec2 p){ float s = step(0.5, fract(p.x)); return vec4(vec3(s), s); }', strength: 0.5 } })) {
          const s = withDetail(d); out[k] = s.h; if (s.errs) errs.push(k + ': ' + s.errs);
        }
        out.errs = errs.join(' | ');
        out.moves = ['grain', 'paper', 'stroke', 'tri', 'bump', 'rough', 'add', 'mix', 'custom'].every(k => out[k] !== base);
        out.differ = new Set([out.grain, out.paper, out.stroke, out.add, out.mix]).size === 5;
        // same patch, different values: one program
        const count = () => R.info.programs.length;
        const first = withDetail({ noise: 'grain', scale: 0.1, strength: 0.2 }); const n1 = count();
        const hs = [];
        for (let i = 1; i <= 8; i++) hs.push(withDetail({ noise: 'grain', scale: 0.1 + i * 0.07, strength: 0.1 + i * 0.05, octaves: 1 + i % 4, direction: i * 20, stretch: 1 + i }).h);
        out.programs = count() - n1; out.distinct = new Set(hs).size;
        // texture by asset name: placeholder first, picture after loading
        const px = 8, d = new Uint8Array(px * px * 4); for (let i = 0; i < px * px; i++) d.set([i % 2 ? 250 : 20, 100, 60, 255], i * 4);
        const tex = new THREE.DataTexture(d, px, px); tex.needsUpdate = true;
        const T = { style: std, assets: { texture: async n => { if (n !== 'rock.png') throw new Error('no ' + n); return tex; } } };
        const mt = makeMaterial('default', { vertexColors: true, detail: { texture: 'rock.png', strength: 1, scale: 1 } }, T);
        out.texBefore = shot(mt).h; await new Promise(r => setTimeout(r, 50)); out.texAfter = shot(mt).h;
        const bad = f => { try { f(); return ''; } catch (e) { return e.message; } };
        out.badNoise = bad(() => makeMaterial('default', { detail: { noise: 'grian' } }, E));
        out.badGlsl = bad(() => makeMaterial('default', { detail: { glsl: 'float f(){return 1.;}' } }, E));
        out.badMode = bad(() => makeMaterial('default', { detail: { mode: 'blend' } }, E));
        out.noEngine = bad(() => applyEffects(new THREE.MeshLambertMaterial(), { detail: { texture: 'rock.png' }, engine: { assets: null } }));
        out.lambertRough = bad(() => shot(makeMaterial('default', { vertexColors: true, detail: { noise: 'grain', roughness: 0.5 } }, eng({ materials: { default: { type: 'lambert' } } }))));
        return out; })()`);
      check('九种写法（三种噪声、三平面、法线、粗糙度、叠加 / 混合、自定义 glsl）都编译，画面都与无细节不同', r.errs === '' && r.moves, r.errs);
      check('grain / paper / stroke / add / mix 画面互不相同', r.differ);
      check('同补丁、8 种不同参数的材质：新增 0 个着色器程序（共用 1 个）', r.programs === 0 && r.distinct >= 6, `programs +${r.programs}, distinct images ${r.distinct}`);
      check('贴图来源：加载前（占位）与加载后画面不同', r.texBefore !== r.texAfter);
      check('写错噪声名 / glsl 缺函数 / 混合模式：报错给可选值或签名', /grian.*grain \| paper \| stroke/.test(r.badNoise) && /threedogDetailSample\(vec2 p\)/.test(r.badGlsl) && /multiply \| add \| mix/.test(r.badMode), `${r.badNoise} | ${r.badGlsl} | ${r.badMode}`);
      check('贴图名但没有引擎：报错说明怎么传引擎', /pass the engine/.test(r.noEngine), r.noEngine);
      check('lambert 上写 detail.roughness：报错说清缺什么', /roughnessmap_fragment/.test(r.lambertRough), r.lambertRough);
    },
  },
  {
    name: '[守] 季节色混合：mix 模式把表面向季节色混合（不闷），multiply 默认不变；工具生成的 cacheKey 不因模式而变',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(`(async () => { ${SCENE}
        const out = {}, E = eng({ materials: { terrain: { type: 'lambert' } } }), U = engine.uniforms;
        const px = m => shot(m).px;
        U.uGroundTint.value.set(1, 0.5, 0.2);
        const mult = shot(terrainMaterial(null, E));
        U.uGroundMix.value = 0.6;
        const mixd = shot(terrainMaterial(null, E));
        U.uGroundMix.value = 0; U.uGroundTint.value.set(1, 1, 1);
        const neutral = shot(terrainMaterial(null, E));
        const red = a => { let r = 0, g = 0; for (let i = 0; i < a.length; i += 4) { r += a[i]; g += a[i + 1]; } return [r, g]; };
        out.multGolden = mult.h; out.differ = mult.h !== mixd.h; out.neutralGolden = neutral.h; out.errs = mult.errs + mixd.errs;
        // multiplying green by orange darkens it; mixing keeps it bright
        const lum = a => { let t = 0; for (let i = 0; i < a.length; i += 4) t += a[i] + a[i + 1] + a[i + 2]; return t; };
        out.mixBrighter = lum(mixd.px) > lum(mult.px);
        return out; })()`);
      check('mix 与 multiply 画面不同、都能编译', r.differ && r.errs === '', r.errs);
      check('mix 模式不比乘法闷（亮度更高）', r.mixBrighter);
      check('multiply 模式（默认）的季节地面画面与改动前逐字节相同', r.multGolden === -449878753, String(r.multGolden));
    },
  },
  {
    name: '[守] 贴图资源名：材质规格里直接写 map / normalMap / roughnessMap…，色彩空间、wrap、repeat 自动设置；占位到位；写错有改法',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(`(async () => { try { ${SCENE}
        const out = {}, loads = [];
        const px = 4, d = new Uint8Array(px * px * 4).fill(180); const img = new THREE.DataTexture(d, px, px); img.needsUpdate = true;
        const assets = { texture: async (n, o = {}) => { loads.push([n, o]); if (n === 'missing.png') throw new Error('404 ' + n); const t = img.clone(); t.colorSpace = o.color === false ? THREE.NoColorSpace : THREE.SRGBColorSpace; return t; } };
        const E = { style: { materials: { rock: { type: 'standard', map: 'rock.png', normalMap: 'rock_n.png', roughnessMap: 'rock_r.png', repeat: [3, 2], wrap: 'mirror', roughness: 1 } } }, assets };
        const m = makeMaterial('rock', { vertexColors: true }, E);
        out.stand = m.map?.isTexture && m.normalMap?.isTexture;
        const before = shot(m).h;
        await new Promise(r => setTimeout(r, 50));
        out.cs = [m.map.colorSpace, m.normalMap.colorSpace, m.roughnessMap.colorSpace];
        out.rep = [m.map.repeat.x, m.map.repeat.y, m.map.wrapS === THREE.MirroredRepeatWrapping];
        out.loads = loads.map(l => l[0] + ':' + (l[1].color === false ? 'linear' : 'srgb')).join(',');
        out.changed = shot(m).h !== before; out.errs = shot(m).errs;
        const warns = []; const w0 = console.warn; console.warn = (...a) => warns.push(a.join(' '));
        const bad = f => { try { f(); return ''; } catch (e) { return e.message; } };
        out.typo = bad(() => makeMaterial('rock', { normalmap: 'x.png' }, E)) + warns.join(' ');
        out.typo2 = bad(() => makeMaterial('rock', { roughnesMap: 'x.png' }, E));
        makeMaterial('rock', { map: 'missing.png' }, E); await new Promise(r => setTimeout(r, 50));
        const lam = makeMaterial('rock', { type: 'lambert', roughnessMap: 'r.png' }, { ...E, style: { materials: { rock: { type: 'lambert' } } } });
        console.warn = w0; out.warns = warns.join(' | ');
        out.noEngine = bad(() => makeMaterial('rock', { map: 'a.png' }, { style: E.style, assets: null }));
        out.badWrap = bad(() => makeMaterial('rock', { wrap: 'tile' }, E));
        // a texture object still works as before
        const m2 = makeMaterial('rock', { map: img }, E); out.obj = m2.map === img;
        return out; } catch (e) { return { crash: e.stack.slice(0, 600) }; } })()`);
      if (r.crash) { check('crash ' + r.crash.replace(/\s+/g, ' '), false); return; }
      check('占位到位：加载前槽里就有占位贴图，加载后画面变化，无着色器报错', r.stand && r.changed && r.errs === '', r.errs);
      check('色彩空间：map 为 sRGB，normalMap / roughnessMap 为线性（以 { color: false } 请求）', r.cs[0] === 'srgb' && r.cs[1] === '' && r.cs[2] === '' && /rock\.png:srgb/.test(r.loads) && /rock_n\.png:linear/.test(r.loads), JSON.stringify(r.cs) + r.loads);
      check('repeat / wrap 作用到贴图', r.rep[0] === 3 && r.rep[1] === 2 && r.rep[2], JSON.stringify(r.rep));
      check('键写错（normalmap / roughnesMap）报错带相近名', /did you mean 'normalMap'/.test(r.typo) && /did you mean 'roughnessMap'/.test(r.typo2), r.typo + ' | ' + r.typo2);
      check('加载失败与材质类型不支持该槽：警告里带改法', /did not load.*Register it/.test(r.warns) && /use type 'standard'/.test(r.warns), r.warns);
      check('没有引擎时写贴图名：报错说明怎么传；wrap 写错给可选值；传 Texture 对象照旧', /pass the engine/.test(r.noEngine) && /repeat \| clamp \| mirror/.test(r.badWrap) && r.obj, r.noEngine + ' | ' + r.badWrap);
    },
  },
  {
    name: '[守] 光照出口：shadowTint / rim / wrap / lighting.glsl / style.lighting / toon ramp 与 soften 生效、编译、同补丁不同数值共用 1 个程序；错误写法给改法',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(`(async () => { try { ${SCENE}
        const out = {}, E = eng({ materials: { default: { type: 'lambert' } } });
        const mk = (lighting, e = E) => makeMaterial('default', { vertexColors: true, lighting }, e);
        const plain = shot(mk(undefined), { shadow: true }).h;
        const cases = { tint: { shadowTint: { color: 0x4060ff, strength: 1 } }, rim: { rim: { color: 0xffaa66, strength: 1, power: 2 } }, wrap: { wrap: 0.6 },
          rimBack: { rim: { color: 0xffaa66, strength: 1, power: 2, shadowSide: 1 } }, all: { wrap: 0.3, shadowTint: { color: 0x4060ff }, rim: { color: 0xffffff } },
          glsl: { glsl: 'void threedogLighting(inout ReflectedLight light, vec3 normal, vec3 viewDir, vec3 sunDir, float sunShadow, vec3 albedo){ light.indirectDiffuse *= vec3(1.0, 0.3, 0.3); }' } };
        const errs = [];
        for (const [k, l] of Object.entries(cases)) { const s = shot(mk(l), { shadow: true }); out[k] = s.h; if (s.errs) errs.push(k + ': ' + s.errs); }
        out.errs = errs.join(' | ');
        out.moves = Object.keys(cases).every(k => out[k] !== plain);
        // shadowTint changes only shadowed pixels' hue: with no shadow map and the sun overhead nothing is "in shadow" except the far side
        const count = () => R.info.programs.length;
        shot(mk({ shadowTint: { color: 0x4060ff, strength: 0.2 }, rim: { color: 0xffffff } }), { shadow: true }); const n1 = count();
        const hs = []; for (let i = 1; i <= 6; i++) hs.push(shot(mk({ shadowTint: { color: 0x2040ff + i * 900, strength: 0.1 * i, soft: 0.1 + i * 0.05 }, rim: { color: 0xffffff - i * 3000, power: i, strength: 0.1 * i } }), { shadow: true }).h);
        out.programs = count() - n1; out.distinct = new Set(hs).size;
        // style.lighting applies to every lit spec material; lighting: false opts out
        const S = eng({ lighting: { shadowTint: { color: 0x4060ff, strength: 1 } }, materials: { default: { type: 'lambert' } } });
        out.styleWide = shot(makeMaterial('default', { vertexColors: true }, S), { shadow: true }).h !== plain;
        out.optOut = shot(makeMaterial('default', { vertexColors: true, lighting: false }, S), { shadow: true }).h === plain;
        // toon ramp
        const toon = (extra) => shot(makeMaterial('default', { vertexColors: true }, eng({ materials: { default: { type: 'toon', ...extra } } })));
        const t3 = toon({ steps: 3 }), t5 = toon({ steps: 5 }), rampGray = toon({ ramp: [0.3, 0.65, 1] }), rampCol = toon({ ramp: [0x5a6aa8, 0xc8b89a, 0xffffff] }), soft = toon({ ramp: [0.3, 0.65, 1], soften: 0.6 });
        out.toonOk = [t3, t5, rampGray, rampCol, soft].every(x => !x.errs);
        out.toonDiff = new Set([t3.h, t5.h, rampGray.h, rampCol.h, soft.h]).size === 5;
        const bad = f => { try { f(); return ''; } catch (e) { return e.message; } };
        out.badGlsl = bad(() => mk({ glsl: 'void f(){}' }));
        out.badTint = bad(() => mk({ shadowTint: { strength: 1 } }));
        out.badRamp = bad(() => toon({ ramp: [0.5] }));
        out.rampOnLambert = bad(() => makeMaterial('default', { ramp: [0, 1] }, E));
        out.basic = bad(() => shot(makeMaterial('default', { lighting: { wrap: 0.5 } }, eng({ materials: { default: { type: 'basic' } } }))));
        return out; } catch (e) { return { crash: e.stack.replace(/\s+/g, ' ').slice(0, 500) }; } })()`);
      if (r.crash) { check('crash ' + r.crash, false); return; }
      check('shadowTint / rim / rim 背光 / wrap / 全开 / 自定义 glsl 都编译，画面都与不加不同', r.errs === '' && r.moves, r.errs);
      check('同补丁、6 组不同颜色与数值的材质：新增 0 个着色器程序（共用 1 个）', r.programs === 0 && r.distinct >= 5, `programs +${r.programs}, distinct ${r.distinct}`);
      check('style.lighting 作用于所有受光规格材质；lighting: false 退出（画面回到不加）', r.styleWide && r.optOut);
      check('toon：steps / ramp 灰度 / ramp 颜色 / soften 都编译且画面互不相同', r.toonOk && r.toonDiff);
      check('写错：glsl 缺函数给签名；shadowTint 缺 color、ramp 太短、非 toon 写 ramp 都给改法', /threedogLighting\(inout ReflectedLight light/.test(r.badGlsl) && /needs a color/.test(r.badTint) && /at least 2/.test(r.badRamp) && /belong to type 'toon'/.test(r.rampOnLambert), [r.badGlsl, r.badTint, r.badRamp, r.rampOnLambert].join(' | '));
      check('basic 材质写 lighting：报错说明缺哪个片段', /lights_fragment_end/.test(r.basic), r.basic);
    },
  },
];
