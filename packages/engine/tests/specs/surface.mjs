// Surface effects on plain materials: the `detail` patch, season mix mode, lighting (shadowTint, rim, wrap), the toon ramp, textures loaded by name.
// Pixel checks render a small scene into a render target and hash the bytes; the goldens of the "default unchanged" checks were taken from the code before these features.

// Shared in-page helpers (a string, injected into each ev so every check renders the same scene)
const SCENE = `
  const { THREE, rampTexture, applyEffects, terrainMaterial, materialPatches, fakeAssets, engineWith } = threedogTest, R = engine.renderer;
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
  const eng = () => engineWith({}, fakeAssets(async () => { throw new Error('no assets'); }));
  const grays = n => Array.from({ length: n }, (_, i) => (i + 1) / n);   // a toon ramp of n even bands
`;

export const specs = [
  {
    software: true,   // reads rendered pixels (through a helper)
    name: '[guard] detail texture by asset name: a neutral 50% gray texture draws the same as the gray stand-in (read as data, no darkening when it arrives)',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(`(async () => { ${SCENE}
        const d = new Uint8Array(4 * 4 * 4); for (let i = 0; i < 16; i++) d.set([128, 128, 128, 255], i * 4);
        const tex = new THREE.DataTexture(d, 4, 4); tex.needsUpdate = true;
        const e = engineWith({}, fakeAssets(async () => tex));
        const m = terrainMaterial(null, e, { detail: { texture: 'gray', strength: 1, fade: false } }), before = shot(m);
        await new Promise(r => setTimeout(r, 50));
        const after = shot(m);
        let diff = 0; for (let i = 0; i < before.px.length; i++) diff = Math.max(diff, Math.abs(before.px[i] - after.px[i]));
        return { diff, errs: before.errs + after.errs };
      })()`);
      check('the frame after the texture loads matches the frame with the stand-in (max channel difference <= 2)', r.diff <= 2 && !r.errs, JSON.stringify(r));
    },
  },
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: '[守] 表面质感：默认画面不变（goldens 取自改动前）',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(`(async () => { ${SCENE}
        const out = {};
        out.lambert = shot(new THREE.MeshLambertMaterial({ vertexColors: true })).h;
        // the 3-band ramp as 8-bit bytes: what the golden was taken with
        const toon3 = () => { const t = new THREE.DataTexture(new Uint8Array([85, 85, 85, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 3, 1); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; };
        out.toon = shot(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toon3() })).h;
        out.standard = shot(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })).h;
        engine.uniforms.uGroundTint.value.set(1, 0.5, 0.2);
        out.season = shot(terrainMaterial(null, eng())).h;
        engine.uniforms.uGroundTint.value.set(1, 1, 1);
        const px = 16, d = new Uint8Array(px * px * 4);
        for (let i = 0; i < px * px; i++) { const n = 60 + (i * 37 % 140); d.set([n, n, n, 255], i * 4); }
        const tex = new THREE.DataTexture(d, px, px); tex.needsUpdate = true;
        // 旧实现没有 fade：fade: false 时画面必须和旧实现逐字节相同（迁移没改画面）
        const e = engineWith({}, fakeAssets(async () => tex));
        const m = terrainMaterial(null, e, { detail: { texture: 'x', scale: 0.7, strength: 0.6, fade: false } }); out.detailBefore = shot(m).h;
        await new Promise(r => setTimeout(r, 50)); out.detail = shot(m).h;
        // 默认 fade 开着（b8a68961，2026-11-01 有意改的：比一个像素还细的花纹淡掉，远处不闪），默认画面另记一份 golden，取自 b8a68961 之后
        const ef = engineWith({}, fakeAssets(async () => tex));
        const mf = terrainMaterial(null, ef, { detail: { texture: 'x', scale: 0.7, strength: 0.6 } }); out.fadeBefore = shot(mf).h;
        await new Promise(r => setTimeout(r, 50)); out.fade = shot(mf).h;
        return out; })()`);
      check('lambert / toon / standard 材质的画面与改动前逐字节相同', r.lambert === 813980680 && r.toon === 141705411 && r.standard === -2046925158, JSON.stringify(r));
      check('季节地面色（乘）与改动前相同', r.season === -449878753, String(r.season));
      // the after-load goldens changed on purpose (2026-11-03): the detail texture is read as data like the gray stand-in, no longer decoded as
      // sRGB (the old after-load frames were the darkened ones); the before-load goldens did not move
      check('terrain({ detail }) 迁到 detail 补丁后（fade: false）：加载前的画面与旧实现逐字节相同，加载后按数据读贴图', r.detailBefore === 1844044487 && r.detail === -793329462, `${r.detailBefore} ${r.detail}`);
      check('detail 默认 fade 开：加载前后的画面与 golden 相同（加载后的取自贴图按数据读之后）', r.fadeBefore === -1051862270 && r.fade === 1607165640, `${r.fadeBefore} ${r.fade}`);
    },
  },
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: '[守] detail 补丁：噪声 / 贴图来源、三平面、法线与粗糙度都能编译；参数生效；同补丁不同参数的 N 个材质只编译 1 个程序；写错报错给改法',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(`(async () => { ${SCENE}
        const out = {}, E = eng(), std = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
        const base = shot(std()).h;
        const detailed = (d, e = E) => applyEffects(std(), { clouds: false, detail: d, engine: e });
        const withDetail = d => shot(detailed(d));
        const errs = [];
        for (const [k, d] of Object.entries({ grain: { noise: 'grain', strength: 0.5 }, paper: { noise: 'paper' }, stroke: { noise: 'stroke', direction: 30, stretch: 8 },
          tri: { noise: 'grain', projection: 'triplanar', strength: 0.5 }, bump: { noise: 'grain', normal: 0.3, strength: 0 }, rough: { noise: 'grain', roughness: 0.6, strength: 0 },
          add: { noise: 'grain', mode: 'add', strength: 0.4 }, mix: { noise: 'grain', mode: 'mix', tint: 0xff0000, strength: 0.4 },
          dabs: { noise: 'dabs', strength: 0.5 }, dabsTri: { noise: 'dabs', projection: 'triplanar', normal: 0.1 },
          custom: { glsl: 'vec4 threedogDetailSample(vec2 p){ float s = step(0.5, fract(p.x)) * (1.0 - threedogDetailFootprint); return vec4(vec3(s), s); }', strength: 0.5 } })) {
          const s = withDetail(d); out[k] = s.h; if (s.errs) errs.push(k + ': ' + s.errs);
        }
        out.errs = errs.join(' | ');
        out.moves = ['grain', 'paper', 'stroke', 'tri', 'bump', 'rough', 'add', 'mix', 'dabs', 'dabsTri', 'custom'].every(k => out[k] !== base);
        out.differ = new Set([out.grain, out.paper, out.stroke, out.add, out.mix]).size === 5;
        // fade: a pattern far smaller than a pixel vanishes (= no detail); fade:false keeps it; one that is larger than a pixel is untouched
        out.fadeTiny = withDetail({ noise: 'grain', scale: 5000, strength: 0.5 }).h === base; out.keepTiny = withDetail({ noise: 'grain', scale: 5000, strength: 0.5, fade: false }).h !== base;
        out.fadeBig = withDetail({ noise: 'grain', scale: 0.25, strength: 0.5 }).h === withDetail({ noise: 'grain', scale: 0.25, strength: 0.5, fade: false }).h;
        // same patch, different values: one program
        const count = () => R.info.programs.length;
        const first = withDetail({ noise: 'grain', scale: 0.1, strength: 0.2 }); const n1 = count();
        const hs = [];
        for (let i = 1; i <= 8; i++) hs.push(withDetail({ noise: 'grain', scale: 0.1 + i * 0.07, strength: 0.1 + i * 0.05, octaves: 1 + i % 4, direction: i * 20, stretch: 1 + i }).h);
        out.programs = count() - n1; out.distinct = new Set(hs).size;
        // texture by asset name: placeholder first, picture after loading
        const px = 8, d = new Uint8Array(px * px * 4); for (let i = 0; i < px * px; i++) d.set([i % 2 ? 250 : 20, 100, 60, 255], i * 4);
        const tex = new THREE.DataTexture(d, px, px); tex.needsUpdate = true;
        const T = engineWith({}, fakeAssets(async n => { if (n !== 'rock.png') throw new Error('no ' + n); return tex; }));
        const mt = detailed({ texture: 'rock.png', strength: 1, scale: 1 }, T);
        out.texBefore = shot(mt).h; await new Promise(r => setTimeout(r, 50)); out.texAfter = shot(mt).h;
        const bad = f => { try { f(); return ''; } catch (e) { return e.message; } };
        out.badNoise = bad(() => detailed({ noise: 'grian' }));
        out.badGlsl = bad(() => detailed({ glsl: 'float f(){return 1.;}' }));
        out.badMode = bad(() => detailed({ mode: 'blend' }));
        out.noEngine = bad(() => applyEffects(new THREE.MeshLambertMaterial(), { detail: { texture: 'rock.png' }, engine: { assets: null } }));
        out.lambertRough = bad(() => shot(applyEffects(new THREE.MeshLambertMaterial({ vertexColors: true }), { clouds: false, detail: { noise: 'grain', roughness: 0.5 }, engine: E })));
        return out; })()`);
      check('九种写法（三种噪声、三平面、法线、粗糙度、叠加 / 混合、自定义 glsl）都编译，画面都与无细节不同', r.errs === '' && r.moves, r.errs);
      check('grain / paper / stroke / add / mix 画面互不相同', r.differ);
      check('detail.fade：比像素小得多的图案淡出（与无细节相同），fade:false 保留，比像素大的图案不受影响', r.fadeTiny && r.keepTiny && r.fadeBig, JSON.stringify([r.fadeTiny, r.keepTiny, r.fadeBig]));
      check('同补丁、8 种不同参数的材质：新增 0 个着色器程序（共用 1 个）', r.programs === 0 && r.distinct >= 6, `programs +${r.programs}, distinct images ${r.distinct}`);
      check('贴图来源：加载前（占位）与加载后画面不同', r.texBefore !== r.texAfter);
      check('写错噪声名 / glsl 缺函数 / 混合模式：报错给可选值或签名', /grian.*grain \| paper \| stroke/.test(r.badNoise) && /threedogDetailSample\(vec2 p\)/.test(r.badGlsl) && /multiply \| add \| mix/.test(r.badMode), `${r.badNoise} | ${r.badGlsl} | ${r.badMode}`);
      check('贴图名但没有引擎：报错说明怎么传引擎', /pass the engine/.test(r.noEngine), r.noEngine);
      check('lambert 上写 detail.roughness：报错说清缺什么', /roughnessmap_fragment/.test(r.lambertRough), r.lambertRough);
    },
  },
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: '[守] 季节色混合：mix 模式把表面向季节色混合（不闷），multiply 默认不变；工具生成的 cacheKey 不因模式而变',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(`(async () => { ${SCENE}
        const out = {}, E = eng(), U = engine.uniforms;
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
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: '[guard] textures by name into a plain slot: engine.assets.useTexture swaps it in when loaded, color maps sRGB, data maps linear, a failed load warns with the fix',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(`(async () => { try { ${SCENE}
        const out = {}, loads = [];
        const px = 4, d = new Uint8Array(px * px * 4).fill(180); const img = new THREE.DataTexture(d, px, px); img.needsUpdate = true;
        const assets = fakeAssets(async (n, o = {}) => { loads.push([n, o]); if (n === 'missing.png') throw new Error('404 ' + n); const t = img.clone(); t.colorSpace = o.color === false ? THREE.NoColorSpace : THREE.SRGBColorSpace; return t; });
        const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
        const into = (slot, name, opts) => assets.useTexture(name, t => { t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.repeat.set(3, 2); m[slot] = t; m.needsUpdate = true; }, { where: 'rock.' + slot, instead: 'the slot stays empty', opts });
        const before = shot(m).h;
        into('map', 'rock.png', {}); into('normalMap', 'rock_n.png', { color: false }); into('roughnessMap', 'rock_r.png', { color: false });
        await new Promise(r => setTimeout(r, 50));
        out.cs = [m.map.colorSpace, m.normalMap.colorSpace, m.roughnessMap.colorSpace];
        out.rep = [m.map.repeat.x, m.map.repeat.y, m.map.wrapS === THREE.MirroredRepeatWrapping];
        out.loads = loads.map(l => l[0] + ':' + (l[1].color === false ? 'linear' : 'srgb')).join(',');
        const after = shot(m); out.changed = after.h !== before; out.errs = after.errs;
        const warns = []; const w0 = console.warn; console.warn = (...a) => warns.push(a.join(' '));
        into('emissiveMap', 'missing.png', {}); await new Promise(r => setTimeout(r, 50));
        console.warn = w0; out.warns = warns.join(' | ');
        return out; } catch (e) { return { crash: e.stack.slice(0, 600) }; } })()`);
      if (r.crash) { check('crash ' + r.crash.replace(/\s+/g, ' '), false); return; }
      check('the picture changes when the textures arrive, no shader error', r.changed && r.errs === '', r.errs);
      check('color space: map sRGB, normalMap / roughnessMap linear (asked with { color: false })', r.cs[0] === 'srgb' && r.cs[1] === '' && r.cs[2] === '' && /rock\.png:srgb/.test(r.loads) && /rock_n\.png:linear/.test(r.loads), JSON.stringify(r.cs) + r.loads);
      check('repeat / wrap are plain writes on the texture', r.rep[0] === 3 && r.rep[1] === 2 && r.rep[2], JSON.stringify(r.rep));
      check('a failed load warns with the fix', /did not load.*Register it/.test(r.warns), r.warns);
    },
  },
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: '[守] 光照出口：applyEffects lighting（shadowTint / rim / wrap / glsl）与 rampTexture（soften）生效、编译、同补丁不同数值共用 1 个程序；错误写法给改法',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(`(async () => { try { ${SCENE}
        const out = {}, E = eng();
        const mk = lighting => applyEffects(new THREE.MeshLambertMaterial({ vertexColors: true }), { clouds: false, lighting, engine: E });
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
        // toon ramp
        const toon = (ramp, soften) => shot(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: rampTexture(ramp, soften) }));
        const t3 = toon(grays(3)), t5 = toon(grays(5)), rampGray = toon([0.3, 0.65, 1]), rampCol = toon([0x5a6aa8, 0xc8b89a, 0xffffff]), soft = toon([0.3, 0.65, 1], 0.6);
        out.toonOk = [t3, t5, rampGray, rampCol, soft].every(x => !x.errs);
        out.toonDiff = new Set([t3.h, t5.h, rampGray.h, rampCol.h, soft.h]).size === 5;
        const bad = f => { try { f(); return ''; } catch (e) { return e.message; } };
        out.badGlsl = bad(() => mk({ glsl: 'void f(){}' }));
        out.badTint = bad(() => mk({ shadowTint: { strength: 1 } }));
        out.badRamp = bad(() => toon([0.5]));
        out.basic = bad(() => shot(applyEffects(new THREE.MeshBasicMaterial(), { clouds: false, lighting: { wrap: 0.5 }, engine: E })));
        // a slot typo fails where the patch is given, GLSL and TSL forms alike
        out.slotTypo = bad(() => applyEffects(new THREE.MeshLambertMaterial(), { clouds: false, engine: E, patches: [{ name: 'typo', slot: 'colr', glsl: 'diffuseColor.rgb *= 0.9;' }] }));
        out.tslSlotTypo = bad(() => applyEffects(new THREE.MeshLambertMaterial(), { clouds: false, engine: E, patches: [{ name: 'typo2', tsl: { colr: c => c.output } }] }));
        // lighting: false is no shaping at all: the same picture and no patch on the material
        const off = mk(false);
        out.lightingOff = shot(off, { shadow: true }).h === plain && !materialPatches(off).some(p => p.name === 'lighting');
        return out; } catch (e) { return { crash: e.stack.replace(/\s+/g, ' ').slice(0, 500) }; } })()`);
      if (r.crash) { check('crash ' + r.crash, false); return; }
      check('shadowTint / rim / rim 背光 / wrap / 全开 / 自定义 glsl 都编译，画面都与不加不同', r.errs === '' && r.moves, r.errs);
      check('同补丁、6 组不同颜色与数值的材质：新增 0 个着色器程序（共用 1 个）', r.programs === 0 && r.distinct >= 5, `programs +${r.programs}, distinct ${r.distinct}`);
      check('toon：不同段数 / 灰度 / 颜色 / soften 的 rampTexture 都编译且画面互不相同', r.toonOk && r.toonDiff);
      check('patch 的 slot 写错（GLSL 和 TSL 两种写法）都当场报错并列出可用的 slot', /unknown slot 'colr'/.test(r.slotTypo) && /color/.test(r.slotTypo.replace("'colr'", '')) && /unknown tsl slot 'colr'/.test(r.tslSlotTypo), r.slotTypo + ' | ' + r.tslSlotTypo);
      check('applyEffects lighting: false：画面与不加相同，材质上没有 lighting 补丁', r.lightingOff === true);
      check('写错：glsl 缺函数给签名；shadowTint 缺 color、ramp 太短都给改法', /threedogLighting\(inout ReflectedLight light/.test(r.badGlsl) && /needs a color/.test(r.badTint) && /at least 2/.test(r.badRamp), [r.badGlsl, r.badTint, r.badRamp].join(' | '));
      check('basic 材质写 lighting：报错说明缺哪个片段', /lights_fragment_end/.test(r.basic), r.basic);
    },
  },
];
