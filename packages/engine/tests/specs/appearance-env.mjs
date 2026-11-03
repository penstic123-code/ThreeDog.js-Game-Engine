// Environment look open points (recipes/38): light modes, fog kinds / color / glsl, exposure over the day and tone mapping,
// extra dome layers. Defaults draw what they always drew (pixel / text comparison), new settings take effect, replacements compile,
// wrong settings throw with the fix.

// Shared page helpers (serialized into the page): a headless engine with a style and sky() options, and a pixel shot
const HELPERS = `
  const { THREE, createEngine, sky } = threedogTest;
  const make = (style, opts = {}) => {
    const e = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'appearance-env', style });
    try { e.use(sky(opts)); } catch (err) { e.dispose(); return { error: err.message }; }
    return { e };
  };
  // fog: its own renderer per shot (three caches programs by material settings, not by chunk text, so a shared renderer would
  // reuse a program compiled with other fog chunks)
  const fogShot = (fog, camY = 3, eng = null) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const R = new THREE.WebGLRenderer({ canvas }), rt = new THREE.WebGLRenderTarget(32, 32), bytes = new Uint8Array(32 * 32 * 4);
    const sc = new THREE.Scene(); sc.fog = fog; sc.background = new THREE.Color(0x000000);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
    const g = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x336633 }));
    const box = new THREE.Mesh(new THREE.BoxGeometry(80, 160, 80), new THREE.MeshLambertMaterial({ color: 0x993333 })); box.position.set(0, 80, -400);   // 400 m: half into the default linear fog (180-600 m)
    if (eng) { const grp = new THREE.Group(); grp.add(new THREE.Mesh(g.geometry, g.material), new THREE.Mesh(box.geometry, box.material)); eng.scene.add(grp); eng.sky.update(eng.focus); eng.scene.remove(grp); }
    sc.add(g, box);
    const cam = new THREE.PerspectiveCamera(60, 1, 0.3, 1500); cam.position.set(0, camY, 0); cam.lookAt(0, camY * 0.6, -100);
    let err = ''; R.debug.onShaderError = (gl, p, vs, fs) => { err += (gl.getProgramInfoLog(p) || '') + (gl.getShaderInfoLog(fs) || '') + (gl.getShaderInfoLog(vs) || ''); };
    R.setRenderTarget(rt); R.render(sc, cam); R.readRenderTargetPixels(rt, 0, 0, 32, 32, bytes); R.setRenderTarget(null);
    rt.dispose(); R.dispose(); R.forceContextLoss();
    return { px: Array.from(bytes).join(','), err: err.slice(0, 400) };
  };
  const domeShot = (e, pitch) => {
    const R = engine.renderer, rt = new THREE.WebGLRenderTarget(24, 24), bytes = new Uint8Array(24 * 24 * 4);
    const cam = new THREE.PerspectiveCamera(100, 1, 0.1, 1000), sc = new THREE.Scene(), m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), e.sky.dome.material);
    m.scale.setScalar(500); m.frustumCulled = false; sc.add(m); cam.rotation.set(pitch, 0.4, 0, 'YXZ');
    let err = ''; const prev = R.debug.onShaderError; R.debug.onShaderError = (gl, p, vs, fs) => { err += (gl.getProgramInfoLog(p) || '') + (gl.getShaderInfoLog(fs) || ''); };
    R.setRenderTarget(rt); R.render(sc, cam); R.readRenderTargetPixels(rt, 0, 0, 24, 24, bytes); R.setRenderTarget(null); R.debug.onShaderError = prev; rt.dispose();
    return { px: Array.from(bytes).join(','), err: err.slice(0, 400) };
  };
`;
const page = fn => new Function(`${HELPERS}\nreturn (${fn})();`);

export const specs = [
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: '[守] 光源开关：sky({ sun / hemisphere }) true 默认照旧驱动；look.lights.manual 后不改颜色强度（太阳仍按时间转）；false 隐藏且不动；写错报错给可选值和接管写法',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {};
        const def = make({}).e; def.sky.fixedTime = 0.5; def.sky.update(def.focus);
        out.def = { sun: def.lights.sun.intensity, hemi: def.lights.hemi.intensity, cast: def.lights.sun.castShadow === def.renderer.shadowMap.enabled };
        const man = make({}).e; man.look.lights.manual(['sun.intensity', 'sun.color', 'hemi']);
        man.lights.sun.intensity = 0.42; man.lights.sun.color.set(0xff0000); man.lights.hemi.intensity = 0.13;
        const p0 = man.lights.sun.position.clone(); man.sky.fixedTime = 0.7; man.sky.update(man.focus);
        out.man = { sun: man.lights.sun.intensity, red: man.lights.sun.color.getHex(), hemi: man.lights.hemi.intensity, moved: !p0.equals(man.lights.sun.position), visible: man.lights.sun.visible };
        const off = make({}, { sun: false, hemisphere: false }).e;
        off.lights.sun.intensity = 0.3; const p1 = off.lights.sun.position.clone(); off.sky.fixedTime = 0.7; off.sky.update(off.focus);
        out.off = { visible: off.lights.sun.visible || off.lights.hemi.visible, cast: off.lights.sun.castShadow, sun: off.lights.sun.intensity, still: p1.equals(off.lights.sun.position) };
        out.bad = make({}, { sun: 'off' }).error;
        for (const e of [def, man, off]) e.dispose();
        return out;
      }));
      check('默认：太阳 / 半球光照旧由天空驱动（正午强度来自关键帧）、阴影开关跟随引擎', r.def.sun === 3 && r.def.hemi === 1.2 && r.def.cast, JSON.stringify(r.def));
      check("look.lights.manual：游戏设的强度和颜色保留，太阳方向仍按时间走", r.man.sun === 0.42 && r.man.red === 0xff0000 && r.man.hemi === 0.13 && r.man.moved && r.man.visible, JSON.stringify(r.man));
      check('false：灯隐藏、不投影、天空不再改它（强度、位置都不动）', !r.off.visible && !r.off.cast && r.off.sun === 0.3 && r.off.still, JSON.stringify(r.off));
      check('写错值：报错给出 true / false 和接管写法', /must be true .*false.*look\.lights\.manual/.test(r.bad || ''), r.bad);
    },
  },
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: '[守] 雾：默认线性雾逐像素等于 three 原生 Fog；exp / exp2 / height / 自定义 hook 编译通过且生效（材质在引擎场景里，打上 fog 补丁）；height 随相机高度变化；自定义雾色同步到穹顶；写错报错',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {};
        const def = make({}).e; def.sky.fixedTime = 0.5; def.sky.update(def.focus);
        const f = def.scene.fog;
        out.defKind = f.isFog && !f.isFogExp2 && Math.abs(f.near - f.far * 0.3) < 1e-9 && f.color.equals(def.sky.uniforms.uHorizon.value);
        const ref = fogShot(new THREE.Fog(f.color.getHex(), f.near, f.far)), mine = fogShot(f, 3, def);
        out.defSame = ref.px === mine.px; out.defErr = ref.err + mine.err;
        out.domePlain = !/threedogSkyLayer/.test(def.sky.dome.material.fragmentShader) && def.sky.uniforms.uFogBand.value === 0;
        const kinds = {}, HOOK = 'vec4 threedogFog(vec3 c, float depth, vec3 p){ return vec4(vec3(1.0, 0.0, 1.0), step(fogNear * 0.0, depth) * 0.5); }';
        for (const [k, fog] of Object.entries({ exp: { kind: 'exp' }, exp2: { kind: 'exp2' }, height: { kind: 'height', height: 0, falloff: 0.08, density: 0.03 }, hook: {} })) {
          const e = make({ sky: { fog } }).e; if (k === 'hook') e.look.fog.patch('fog', HOOK);
          e.sky.fixedTime = 0.5; e.sky.update(e.focus);
          const s = fogShot(e.scene.fog, 3, e);
          kinds[k] = { err: s.err, differs: s.px !== mine.px };
          if (k === 'height') kinds[k].byHeight = fogShot(e.scene.fog, 40, e).px !== fogShot(e.scene.fog, 3, e).px && fogShot(e.scene.fog, 40, e).err === '';
          e.dispose();
        }
        out.kinds = kinds;
        const dn = make({ sky: { fog: { kind: 'exp2', density: 0.01, color: 0x804020 } } }).e;
        dn.mod('look.fog.far', { owner: 'test', mul: 0.5 }); dn.sky.update(dn.focus);
        out.density = dn.scene.fog.density; out.color = dn.scene.fog.color.getHex();
        out.domeFog = dn.sky.uniforms.uFogBand.value === 1 && domeShot(dn, 0.05).px !== domeShot(def, 0.05).px && domeShot(dn, 0.05).err === '';
        dn.dispose();
        out.errKind = make({ sky: { fog: { kind: 'expo' } } }).error;
        out.errHook = (() => { try { def.look.fog.patch('fog', 'float x;'); return ''; } catch (x) { return x.message; } })();
        def.dispose();
        return out;
      }));
      check('默认：雾是 Fog（near = 0.3 far，颜色 = 地平线）', r.defKind);
      check('默认：32x32 像素与手建的 three Fog 逐字节一致（没有 fog 补丁）', r.defSame && r.defErr === '', r.defErr);
      check('默认穹顶：雾带关（uFogBand 0，画面同原版），不含自定义层代码', r.domePlain);
      for (const k of ['exp', 'exp2', 'height', 'hook']) check(`kind ${k}：编译通过、画面不同于默认`, r.kinds[k].err === '' && r.kinds[k].differs, JSON.stringify(r.kinds[k]));
      check('height：相机高低画面不同（低处雾浓）', r.kinds.height.byHeight);
      check('an explicit density is the fog the game asked for: a look.fog.far multiplier does not change it (0.01), the fixed color holds', Math.abs(r.density - 0.01) < 1e-9 && r.color === 0x804020, `${r.density} ${r.color}`);
      check('自定义雾色：穹顶下沿渐变到雾色（地平线不露缝），编译通过', r.domeFog);
      check('kind 写错：报错给可选值和相近名', /'linear' \| 'exp' \| 'exp2' \| 'height'.*did you mean 'exp/.test(r.errKind || ''), r.errKind);
      check('hook 没定义 threedogFog：报错给签名', /vec4 threedogFog\(vec3 color, float depth, vec3 worldPos\)/.test(r.errHook || ''), r.errHook);
    },
  },
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: '[守] 雾开关：sky({ fog }) true 默认照旧每帧写；look.fog.manual() 后不再写颜色距离；false 为 null 且不抛错；游戏置空或换对象不抛错；写错报错',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {};
        const def = make({}).e; def.sky.fixedTime = 0.5; def.sky.update(def.focus);
        out.def = def.scene.fog.isFog && def.scene.fog.far === def.look.fog.value('far') && def.scene.fog.color.equals(def.sky.uniforms.uHorizon.value);
        const obj = make({}, { fog: { kind: 'exp2' } }).e; out.obj = obj.scene.fog.isFogExp2;   // an object is still the style override
        const man = make({}).e; man.look.fog.manual(); man.sky.update(man.focus);
        man.scene.fog.color.set(0x123456); man.scene.fog.far = 77; man.scene.fog.near = 5; man.sky.fixedTime = 0.1; man.mod('look.fog.far', { owner: 'terrain:view', layer: 'engine', set: 900 }); man.sky.update(man.focus);   // the terrain view distance must not write a fog the game owns
        const yl = make({}).e; yl.sky.update(yl.focus); yl.scene.fog.far = 50; yl.scene.fog.near = 15; yl.sky.update(yl.focus); yl.mod('look.fog.far', { owner: 'terrain:view', layer: 'engine', set: 900 }); yl.sky.update(yl.focus);   // same 0.3 ratio: still an outside write (values recorded, not the ratio)
        out.yield = [yl.scene.fog.far, yl.scene.fog.near]; yl.dispose();
        out.man = [man.scene.fog.color.getHex(), man.scene.fog.far, man.scene.fog.near];
        const mine = new THREE.FogExp2(0x00ff00, 0.5); man.scene.fog = mine; man.sky.update(man.focus); out.manOwn = mine.color.getHex() === 0x00ff00 && mine.density === 0.5;
        const off = make({}, { fog: false }).e; out.offNull = off.scene.fog === null;
        off.sky.update(off.focus); off.viewFar(300); out.offOk = true;
        const gen = make({}, { fog: true }).e; gen.scene.fog = null; gen.sky.update(gen.focus); out.nulled = true;   // game nulled it under a driven sky
        gen.scene.fog = { }; gen.sky.update(gen.focus); out.replaced = true;
        const dm = make({ sky: { fog: { color: 0x804020 } } }, { fog: false }).e; dm.sky.update(dm.focus); out.domeOff = domeShot(dm, 0.05).err === '';   // custom fog color but no fog object
        out.bad = make({}, { fog: 'off' }).error;
        for (const e of [def, obj, man, off, gen, dm]) e.dispose();
        return out;
      }));
      check('默认 / 对象写法：照旧由天空创建并驱动雾（对象 = style.sky.fog 覆盖）', r.def && r.obj);
      check("look.fog.manual()：游戏设的颜色和距离保留，换成自己的 FogExp2 也不被改", r.man[0] === 0x123456 && r.man[1] === 77 && r.man[2] === 5 && r.manOwn, JSON.stringify(r.man));
      check('false: scene.fog is null, update / the terrain view distance do not throw', r.offNull && r.offOk);
      check('[guard] game wrote fog far 50 / near 15 directly (same ratio as the engine): engine yields, the terrain view distance does not overwrite', r.yield?.[0] === 50 && r.yield?.[1] === 15, JSON.stringify(r.yield));
      check('天空驱动时游戏把 scene.fog 置空或换成别的对象：update 不抛错；自定义雾色 + fog:false 穹顶仍编译', r.nulled && r.replaced && r.domeOff);
      check('写错值：报错给 true / false 和接管写法', /must be true .*false.*look\.fog\.manual/.test(r.bad || ''), r.bad);
    },
  },
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: '[守] 曝光与色调映射：style.exposure 数字照旧；关键帧按时间插值并跨午夜；函数每帧求值；engine.look.tone.set 运行时改；写错报错',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {};
        const n = make({ exposure: 1.05, toneMapping: 'aces' }).e; n.sky.update(n.focus);
        out.num = n.renderer.toneMappingExposure === 1.05 && n.exposureDriver === null && n.renderer.toneMapping === THREE.ACESFilmicToneMapping;
        // no style: the technical baseline (AgX); a style that names no curve: none (the style owns its look); the style value above applies
        out.defTone = make({}).e.renderer.toneMapping === THREE.AgXToneMapping && make({ exposure: 1 }).e.renderer.toneMapping === THREE.AgXToneMapping && make({ exposure: 1, toneMapping: 'none' }).e.renderer.toneMapping === THREE.NoToneMapping;
        const k = make({ exposure: [[0, 2], [0.5, 1]] }).e, at = t => { k.sky.fixedTime = t; k.sky.update(k.focus); return k.renderer.toneMappingExposure; };
        out.keys = [at(0), at(0.25), at(0.5), at(0.75)];
        const fn = make({ exposure: ({ sky }) => sky.isDay ? 1 : 3 }).e; fn.sky.fixedTime = 0.9; fn.sky.update(fn.focus); out.fn = fn.renderer.toneMappingExposure;
        fn.look.tone.set({ exposure: 1.3 }); fn.sky.update(fn.focus); out.set = fn.renderer.toneMappingExposure;
        // the curve is plain three.js: a direct write survives the sky's frames (the engine writes toneMapping only at creation)
        fn.renderer.toneMapping = THREE.NeutralToneMapping; fn.sky.update(fn.focus); fn.sky.update(fn.focus); out.tone = fn.renderer.toneMapping === THREE.NeutralToneMapping;
        try { createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'appearance-env', style: { toneMapping: 'filmic' } }).dispose(); } catch (e) { out.badTone = e.message; }
        try { make({ exposure: [[0.5, 1], [0.2, 2]] }); } catch (e) { out.badKeys = e.message; }
        try { fn.look.tone.set({ exposure: 'bright' }); } catch (e) { out.badKeys2 = e.message; }
        for (const e of [n, k, fn]) e.dispose();
        return out;
      }));
      check('数字曝光与色调映射照旧（不建每帧驱动）', r.num);
      check('色调映射：技术基线 agx（有没有游戏自己的 style都一样）；游戏自己的 style写 none 才关', r.defTone);
      check('关键帧 [[0,2],[0.5,1]]：0 → 2，0.25 → 1.5，0.5 → 1，0.75 跨午夜 → 1.5', JSON.stringify(r.keys) === '[2,1.5,1,1.5]', JSON.stringify(r.keys));
      check('函数曝光每帧求值（夜里 3），look.tone.set({ exposure: 1.3 }) 取代它', r.fn === 3 && r.set === 1.3, `${r.fn} ${r.set}`);
      check('直接写 renderer.toneMapping 不被天空每帧覆盖；style.toneMapping 写错报错给可选值', r.tone && /"aces", "agx", "neutral", "none"/.test(r.badTone || ''), r.badTone);
      check('关键帧没排序 / 类型不对：报错给写法', /sorted by time/.test(r.badKeys || '') && /sorted by time/.test(r.badKeys2 || ''), `${r.badKeys} | ${r.badKeys2}`);
    },
  },
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: '[守] 天空多层：默认无层时穹顶着色器文本不变；层编译通过、画面变化、按 order 排序且改名不冲突、uniform 进 sky.uniforms；写错报错给签名',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {};
        const def = make({}).e; def.sky.fixedTime = 0.5; def.sky.update(def.focus);
        const glsl = 'vec4 threedogSkyLayer(vec3 d, float time, vec3 sunDir, float night){ return vec4(uBand, smoothstep(0.2, 0.4, d.y) * uK); }';
        const two = make({ sky: { layers: [
          { glsl, uniforms: { uBand: [1, 0, 0], uK: 0.8 }, order: 2 },
          { glsl: 'vec4 threedogSkyLayer(vec3 d, float time, vec3 sunDir, float night){ return vec4(0.0, 0.3, 0.0, 1.0); }', blend: 'add', order: 1 } ] } }).e;
        two.sky.fixedTime = 0.5; two.sky.update(two.focus);
        const fs = two.sky.dome.material.fragmentShader;
        out.renamed = /threedogSkyLayer0\(/.test(fs) && /threedogSkyLayer1\(/.test(fs) && !/threedogSkyLayer\(/.test(fs);
        out.ordered = fs.indexOf('col += L.rgb * L.a') < fs.indexOf('col = mix(col, L.rgb, L.a)');   // order 1 (add) drawn before order 2
        out.uniform = two.sky.uniforms.uK?.value === 0.8;
        const a = domeShot(def, 0.9), b = domeShot(two, 0.9);
        out.err = a.err + b.err; out.differs = a.px !== b.px;
        def.dispose(); two.dispose();
        out.errGlsl = make({ sky: { layers: [{ glsl: 'float x;' }] } }).error;
        out.errBlend = make({ sky: { layers: [{ glsl, uniforms: { uBand: [1, 0, 0], uK: 1 }, blend: 'screen' }] } }).error;
        out.errList = make({ sky: { layers: { glsl } } }).error;
        return out;
      }));
      check('两层改名为 threedogSkyLayer0 / 1，原名不残留', r.renamed);
      check('按 order 画（order 1 的 add 层在前）', r.ordered);
      check('层的 uniform 在 engine.sky.uniforms 里', r.uniform);
      check('层编译通过且画面变化', r.err === '' && r.differs, r.err);
      check('glsl 没定义 threedogSkyLayer / blend 写错 / 不是数组：各自报错给写法',
        /vec4 threedogSkyLayer\(vec3 dir/.test(r.errGlsl || '') && /'mix' or 'add'/.test(r.errBlend || '') && /must be an array/.test(r.errList || ''), [r.errGlsl, r.errBlend, r.errList].join(' | '));
    },
  },
];
