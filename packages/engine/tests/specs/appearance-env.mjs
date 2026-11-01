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
  const fogShot = (fog, camY = 3) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const R = new THREE.WebGLRenderer({ canvas }), rt = new THREE.WebGLRenderTarget(32, 32), bytes = new Uint8Array(32 * 32 * 4);
    const sc = new THREE.Scene(); sc.fog = fog; sc.background = new THREE.Color(0x000000);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
    const g = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x336633 }));
    const box = new THREE.Mesh(new THREE.BoxGeometry(80, 160, 80), new THREE.MeshLambertMaterial({ color: 0x993333 })); box.position.set(0, 80, -400);   // 400 m: half into the default linear fog (180-600 m)
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
    name: '[守] 光源开关：sky({ sun / hemisphere }) true 默认照旧驱动；manual 不改颜色强度（太阳仍按时间转、带阴影）；false 隐藏且不动；写错报错给可选值',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {};
        const def = make({}).e; def.sky.timeOfDay = 0.5; def.sky.update(def.focus);
        out.def = { sun: def.sky.sun.intensity, hemi: def.sky.hemi.intensity, cast: def.sky.sun.castShadow === def.shadows };
        const man = make({}, { sun: 'manual', hemisphere: 'manual' }).e;
        man.sky.sun.intensity = 0.42; man.sky.sun.color.set(0xff0000); man.sky.hemi.intensity = 0.13;
        const p0 = man.sky.sun.position.clone(); man.sky.timeOfDay = 0.7; man.sky.update(man.focus);
        out.man = { sun: man.sky.sun.intensity, red: man.sky.sun.color.getHex(), hemi: man.sky.hemi.intensity, moved: !p0.equals(man.sky.sun.position), visible: man.sky.sun.visible };
        const off = make({}, { sun: false, hemisphere: false }).e;
        off.sky.sun.intensity = 0.3; const p1 = off.sky.sun.position.clone(); off.sky.timeOfDay = 0.7; off.sky.update(off.focus);
        out.off = { visible: off.sky.sun.visible || off.sky.hemi.visible, cast: off.sky.sun.castShadow, sun: off.sky.sun.intensity, still: p1.equals(off.sky.sun.position) };
        out.bad = make({}, { sun: 'off' }).error;
        for (const e of [def, man, off]) e.dispose();
        return out;
      }));
      check('默认：太阳 / 半球光照旧由天空驱动（正午强度来自关键帧）、阴影开关跟随引擎', r.def.sun === 3 && r.def.hemi === 1.2 && r.def.cast, JSON.stringify(r.def));
      check("'manual'：游戏设的强度和颜色保留，太阳方向仍按时间走", r.man.sun === 0.42 && r.man.red === 0xff0000 && r.man.hemi === 0.13 && r.man.moved && r.man.visible, JSON.stringify(r.man));
      check('false：灯隐藏、不投影、天空不再改它（强度、位置都不动）', !r.off.visible && !r.off.cast && r.off.sun === 0.3 && r.off.still, JSON.stringify(r.off));
      check('写错值：报错给出 true / manual / false', /must be true .*'manual'.*false/.test(r.bad || ''), r.bad);
    },
  },
  {
    name: '[守] 雾：默认线性雾逐像素等于 three 原生 Fog 且着色片段未改；exp / exp2 / height / 自定义 glsl 编译通过且生效；height 随相机高度变化；自定义雾色同步到穹顶；dispose 还原片段；写错报错',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {}, C = THREE.ShaderChunk, NAMES = ['fog_pars_vertex', 'fog_vertex', 'fog_pars_fragment', 'fog_fragment'];
        const orig = NAMES.map(n => C[n]).join('|');
        const def = make({}).e; def.sky.timeOfDay = 0.5; def.sky.update(def.focus);
        const f = def.scene.fog;
        out.defChunks = NAMES.map(n => C[n]).join('|') === orig;
        out.defKind = f.isFog && !f.isFogExp2 && Math.abs(f.near - f.far * 0.3) < 1e-9 && f.color.equals(def.sky.uniforms.uHorizon.value);
        const ref = fogShot(new THREE.Fog(f.color.getHex(), f.near, f.far)), mine = fogShot(f);
        out.defSame = ref.px === mine.px; out.defErr = ref.err + mine.err;
        out.domePlain = !/uFogColor|threedogSkyLayer/.test(def.sky.dome.material.fragmentShader);
        // each kind: compiles, differs from the default picture
        const kinds = {};
        for (const [k, fog] of Object.entries({ exp: { kind: 'exp' }, exp2: { kind: 'exp2' }, height: { kind: 'height', height: 0, falloff: 0.08, density: 0.03 },
          glsl: { glsl: 'vec4 threedogFog(vec3 c, float depth, vec3 p){ return vec4(vec3(1.0, 0.0, 1.0), step(fogNear * 0.0, depth) * 0.5); }' } })) {
          const e = make({ sky: { fog } }).e; e.sky.timeOfDay = 0.5; e.sky.update(e.focus);
          const s = fogShot(e.scene.fog);
          kinds[k] = { err: s.err, differs: s.px !== mine.px };
          if (k === 'height') kinds[k].byHeight = fogShot(e.scene.fog, 40).px !== fogShot(e.scene.fog, 3).px && fogShot(e.scene.fog, 40).err === '';
          e.dispose();
          kinds[k].restored = NAMES.map(n => C[n]).join('|') === orig;
        }
        out.kinds = kinds;
        // density follows weather fog (the modifier divides it) and the color option
        const dn = make({ sky: { fog: { kind: 'exp2', density: 0.01, color: 0x804020 } } }).e;
        dn.sky.modify('test', { fog: 0.5 }); dn.sky.update(dn.focus);
        out.density = dn.scene.fog.density; out.color = dn.scene.fog.color.getHex();
        out.domeFog = /uFogColor/.test(dn.sky.dome.material.fragmentShader) && domeShot(dn, 0.05).px !== domeShot(def, 0.05).px && domeShot(dn, 0.05).err === '';
        dn.dispose(); def.dispose();
        out.errKind = make({ sky: { fog: { kind: 'expo' } } }).error;
        out.errGlsl = make({ sky: { fog: { glsl: 'float x;' } } }).error;
        return out;
      }));
      check('默认：雾片段与 three 原版一致，雾是 Fog（near = 0.3 far，颜色 = 地平线）', r.defChunks && r.defKind);
      check('默认：32x32 像素与手建的 three Fog 逐字节一致', r.defSame && r.defErr === '', r.defErr);
      check('默认穹顶着色器不含雾色 / 自定义层代码', r.domePlain);
      for (const k of ['exp', 'exp2', 'height', 'glsl']) check(`kind ${k}：编译通过、画面不同于默认、dispose 后片段还原`, r.kinds[k].err === '' && r.kinds[k].differs && r.kinds[k].restored, JSON.stringify(r.kinds[k]));
      check('height：相机高低画面不同（低处雾浓）', r.kinds.height.byHeight);
      check('density 被天气雾倍率除（0.01 / 0.5 = 0.02），color 固定色生效', Math.abs(r.density - 0.02) < 1e-9 && r.color === 0x804020, `${r.density} ${r.color}`);
      check('自定义雾色：穹顶下沿渐变到雾色（地平线不露缝），编译通过', r.domeFog);
      check('kind 写错：报错给可选值和相近名', /'linear' \| 'exp' \| 'exp2' \| 'height'.*did you mean 'exp/.test(r.errKind || ''), r.errKind);
      check('glsl 没定义 threedogFog：报错给签名', /vec4 threedogFog\(vec3 color, float depth, vec3 worldPos\)/.test(r.errGlsl || ''), r.errGlsl);
    },
  },
  {
    name: '[守] 雾片段多引擎：同页先建后拆不丢别人的雾；相同设置共享（引用计数）、不同设置报错给改法；最后一个 dispose 才还原',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {}, C = THREE.ShaderChunk, NAMES = ['fog_pars_vertex', 'fog_vertex', 'fog_pars_fragment', 'fog_fragment'];
        const snap = () => NAMES.map(n => C[n]).join('|'), orig = snap();
        const H = { kind: 'height', height: 0, falloff: 0.08, density: 0.03 };
        const a = make({ sky: { fog: H } }).e, mine = snap();
        out.installed = mine !== orig;
        const b = make({}).e;                       // default linear built after A: must not wipe A's chunks
        out.afterLinear = snap() === mine;
        const c = make({ sky: { fog: H } }).e;      // same setting: shared
        c.dispose(); out.afterShared = snap() === mine;   // disposing a sharer keeps A's fog
        const d = make({ sky: { fog: { kind: 'exp' } } });   // different setting: throws with the fix
        out.err = d.error; out.afterErr = snap() === mine;
        const f = make({ sky: { fog: { kind: 'height', height: 0, falloff: 0.2, density: 0.03 } } }); out.errFalloff = !!f.error;
        b.dispose(); out.afterB = snap() === mine;
        const px = fogShot(a.scene.fog, 3); out.aStillFogs = px.err === '' && px.px !== fogShot(new THREE.Fog(0xcccccc, 180, 600)).px;
        a.dispose(); out.restored = snap() === orig;
        const g = make({ sky: { fog: { kind: 'exp' } } }).e; out.reuse = snap() !== orig; g.dispose(); out.restored2 = snap() === orig;   // a new setting works once the old one is gone
        return out;
      }));
      check('A 装 height 后，同页再建默认 linear 的引擎不会还原 A 的雾片段', r.installed && r.afterLinear);
      check('相同设置共享：另一个引擎 dispose 后 A 的片段还在，A 画面仍有雾', r.afterShared && r.afterB && r.aStillFogs);
      check('不同设置报错：说明原因并给改法（用同一种雾 / 只一个引擎用自定义雾），失败的引擎不改片段', /different custom fog.*same style\.sky\.fog.*only one engine/.test(r.err || '') && r.afterErr, r.err);
      check('只差 falloff 也算不同设置（常量写在片段里）', r.errFalloff);
      check('最后一个 dispose 才还原片段；之后可装新设置', r.restored && r.reuse && r.restored2);
    },
  },
  {
    name: '[守] 雾开关：sky({ fog }) true 默认照旧每帧写；manual 创建后不再写颜色距离；false 为 null 且不抛错；游戏置空或换对象不抛错；写错报错',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {};
        const def = make({}).e; def.sky.timeOfDay = 0.5; def.sky.update(def.focus);
        out.def = def.scene.fog.isFog && def.scene.fog.far === def.fogFar && def.scene.fog.color.equals(def.sky.uniforms.uHorizon.value);
        const obj = make({}, { fog: { kind: 'exp2' } }).e; out.obj = obj.scene.fog.isFogExp2;   // an object is still the style override
        const man = make({}, { fog: 'manual' }).e; man.sky.update(man.focus);
        man.scene.fog.color.set(0x123456); man.scene.fog.far = 77; man.scene.fog.near = 5; man.sky.timeOfDay = 0.1; man.sky.update(man.focus);
        out.man = [man.scene.fog.color.getHex(), man.scene.fog.far, man.scene.fog.near];
        const mine = new THREE.FogExp2(0x00ff00, 0.5); man.scene.fog = mine; man.sky.update(man.focus); out.manOwn = mine.color.getHex() === 0x00ff00 && mine.density === 0.5;
        const off = make({}, { fog: false }).e; out.offNull = off.scene.fog === null;
        off.sky.update(off.focus); off.setFogFar(300); out.offOk = true;
        const gen = make({}, { fog: true }).e; gen.scene.fog = null; gen.sky.update(gen.focus); out.nulled = true;   // game nulled it under a driven sky
        gen.scene.fog = { }; gen.sky.update(gen.focus); out.replaced = true;
        const dm = make({ sky: { fog: { color: 0x804020 } } }, { fog: false }).e; dm.sky.update(dm.focus); out.domeOff = domeShot(dm, 0.05).err === '';   // custom fog color but no fog object
        out.bad = make({}, { fog: 'off' }).error;
        for (const e of [def, obj, man, off, gen, dm]) e.dispose();
        return out;
      }));
      check('默认 / 对象写法：照旧由天空创建并驱动雾（对象 = style.sky.fog 覆盖）', r.def && r.obj);
      check("'manual'：游戏设的颜色和距离保留，换成自己的 FogExp2 也不被改", r.man[0] === 0x123456 && r.man[1] === 77 && r.man[2] === 5 && r.manOwn, JSON.stringify(r.man));
      check('false：scene.fog 为 null，update / setFogFar 不抛错', r.offNull && r.offOk);
      check('天空驱动时游戏把 scene.fog 置空或换成别的对象：update 不抛错；自定义雾色 + fog:false 穹顶仍编译', r.nulled && r.replaced && r.domeOff);
      check('写错值：报错给 true / manual / false', /must be true .*'manual'.*false/.test(r.bad || ''), r.bad);
    },
  },
  {
    name: '[守] 曝光与色调映射：style.exposure 数字照旧；关键帧按时间插值并跨午夜；函数每帧求值；engine.setExposure / setToneMapping 运行时改；写错报错',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {};
        const n = make({ exposure: 1.05, toneMapping: 'aces' }).e; n.sky.update(n.focus);
        out.num = n.renderer.toneMappingExposure === 1.05 && n.exposureDriver === null && n.renderer.toneMapping === THREE.ACESFilmicToneMapping;
        const k = make({ exposure: [[0, 2], [0.5, 1]] }).e, at = t => { k.sky.timeOfDay = t; k.sky.update(k.focus); return k.renderer.toneMappingExposure; };
        out.keys = [at(0), at(0.25), at(0.5), at(0.75)];
        const fn = make({ exposure: sky => sky.isDay ? 1 : 3 }).e; fn.sky.timeOfDay = 0.9; fn.sky.update(fn.focus); out.fn = fn.renderer.toneMappingExposure;
        fn.setExposure(1.3); fn.sky.update(fn.focus); out.set = fn.renderer.toneMappingExposure;
        fn.setToneMapping('agx'); out.tone = fn.renderer.toneMapping === THREE.AgXToneMapping;
        try { fn.setToneMapping('filmic'); } catch (e) { out.badTone = e.message; }
        try { make({ exposure: [[0.5, 1], [0.2, 2]] }); } catch (e) { out.badKeys = e.message; }
        try { fn.setExposure('bright'); } catch (e) { out.badKeys2 = e.message; }
        for (const e of [n, k, fn]) e.dispose();
        return out;
      }));
      check('数字曝光与色调映射照旧（不建每帧驱动）', r.num);
      check('关键帧 [[0,2],[0.5,1]]：0 → 2，0.25 → 1.5，0.5 → 1，0.75 跨午夜 → 1.5', JSON.stringify(r.keys) === '[2,1.5,1,1.5]', JSON.stringify(r.keys));
      check('函数曝光每帧求值（夜里 3），setExposure(1.3) 取代它', r.fn === 3 && r.set === 1.3, `${r.fn} ${r.set}`);
      check("setToneMapping('agx') 生效；写错报错给可选值", r.tone && /'aces' \| 'agx' \| 'neutral' \| 'none'/.test(r.badTone || ''), r.badTone);
      check('关键帧没排序 / 类型不对：报错给写法', /sorted by time/.test(r.badKeys || '') && /sorted by time/.test(r.badKeys2 || ''), `${r.badKeys} | ${r.badKeys2}`);
    },
  },
  {
    name: '[守] 天空多层：默认无层时穹顶着色器文本不变；层编译通过、画面变化、按 order 排序且改名不冲突、uniform 进 sky.uniforms；写错报错给签名',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {};
        const def = make({}).e; def.sky.timeOfDay = 0.5; def.sky.update(def.focus);
        const glsl = 'vec4 threedogSkyLayer(vec3 d, float time, vec3 sunDir, float night){ return vec4(uBand, smoothstep(0.2, 0.4, d.y) * uK); }';
        const two = make({ sky: { layers: [
          { glsl, uniforms: { uBand: [1, 0, 0], uK: 0.8 }, order: 2 },
          { glsl: 'vec4 threedogSkyLayer(vec3 d, float time, vec3 sunDir, float night){ return vec4(0.0, 0.3, 0.0, 1.0); }', blend: 'add', order: 1 } ] } }).e;
        two.sky.timeOfDay = 0.5; two.sky.update(two.focus);
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
