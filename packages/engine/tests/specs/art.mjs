// 美术自由：风格包能给任意材质、抗锯齿开后期不丢。页面用 perf 的 city 模式（style 是空对象，测试里临时换 materials 再还原）。
// [守] 这些检查防止以后有人把材质入口改回"只认几种类型"、或让后期链再次丢掉 MSAA。

export const specs = [
  {
    name: '[守] 材质开放：风格包给实例 / 函数 / 规格三种写法都行，写错类型报错不静默回退',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, makeMaterial } = threedogTest, S = engine.style, old = S.materials;
        const inst = new THREE.MeshMatcapMaterial();
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        S.materials = {
          glass: inst,
          shader: (params, purpose) => new THREE.ShaderMaterial({ userData: { got: purpose + ':' + (params.color ?? '') } }),
          broken: () => 42,
          typo: { type: 'lamber' },
          default: { type: 'toon', steps: 4 },
        };
        const a = makeMaterial('glass', { color: 0xff0000, type: 'x' });
        const b = makeMaterial('shader', { color: 7 });
        const c = makeMaterial('anything', { color: 0x00ff00 });
        const out = {
          clone: a !== inst && a.isMeshMatcapMaterial && a.color.getHex() === 0xff0000 && a.userData.purpose === 'glass' && a.type === 'MeshMatcapMaterial',
          fn: b.isShaderMaterial && b.userData.got === 'shader:7' && b.userData.purpose === 'shader',
          spec: c.isMeshToonMaterial && c.gradientMap?.image.width === 4,
          badFn: err(() => makeMaterial('broken')), badType: err(() => makeMaterial('typo')),
        };
        S.materials = old;
        return out;
      });
      check('实例写法：每次 clone，params 照常套用', r.clone, JSON.stringify(r));
      check('函数写法：收到 params 和用途名，返回任意材质', r.fn);
      check('规格写法：落到 default 的 toon', r.spec);
      check('函数没返回材质时报错', /must return a three.js Material/.test(r.badFn), r.badFn);
      check('未知 type 报错并列出可选项', /unknown type 'lamber'.*lambert \| phong/.test(r.badType), r.badType);
    },
  },
  {
    name: '[守] 抗锯齿：画布本身不开 MSAA，开关在后期渲染目标上；开着效果时 MSAA 还在；画质预设能切',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const p = engine.post, samples = () => p.composer ? [p.composer.renderTarget1.samples, p.composer.renderTarget2.samples] : null;
        const fake = { enabled: true, needsSwap: false, renderToScreen: false, setSize() {}, render() {}, dispose() {} };
        const out = { canvas: engine.renderer.getContextAttributes().antialias, start: p.antialias };
        p.enable('antialias', true); engine.step(1 / 30, { render: true });
        out.on = { active: p.active, s: samples() };
        const h = p.add({ name: 'glow', create: () => ({ ...fake }) }); engine.step(1 / 30, { render: true });
        out.fx = samples();
        p.enable('antialias', false); h.remove(); engine.step(1 / 30, { render: true });
        out.off = { active: p.active, s: samples() };
        engine.settings.preset('high'); out.high = p.antialias;
        engine.settings.preset('low'); out.low = p.antialias;
        return out;
      });
      check('画布不开原生抗锯齿（MSAA 只在渲染目标上，才能运行时切换、开后期不丢）', r.canvas === false, JSON.stringify(r));
      check('开抗锯齿：走后期，渲染目标 4 倍采样', r.on.active && r.on.s.join() === '4,4');
      check('再加效果：仍是 4 倍采样', r.fx?.join() === '4,4');
      check('关掉：采样 0，没有效果时直接画', !r.off.active && r.off.s.join() === '0,0');
      check('画质预设 high 开、low 关', r.high === true && r.low === false);
    },
  },
  {
    name: '[守] 后期槽位：按 scene/hdr/输出/ldr/final 和 order 排，scene 槽唯一，remove 后恢复，参数和开关只走句柄',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const p = engine.post, made = {};
        // 假 Pass：EffectComposer 只要求这几个成员；名字记在 tag 上，好读出链的顺序
        const fx = (name, slot, order, more = {}) => ({ name, slot, order, params: { k: 1 }, ...more,
          create: ({ params }) => { made[name] = (made[name] || 0) + 1; return { tag: name, k: params.k, enabled: true, needsSwap: false, renderToScreen: false, setSize() {}, render() {}, dispose() {} }; } });
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        const chain = () => p.composer.passes.map(x => x.tag ?? (x.isRenderPass ? 'RENDER' : x.isOutputPass ? 'OUTPUT' : '?'));
        const hs = [fx('grain', 'ldr', 0), fx('aa', 'final', 0), fx('late', 'hdr', 50), fx('early', 'hdr', -5), fx('lut', 'ldr', -1)].map(e => p.add(e));
        const off = p.add(fx('lazy', 'hdr', 0), { enabled: false });
        engine.step(1 / 30, { render: true });
        const out = { order: chain().join(), list: p.list().map(e => e.name).join(), lazyBuilt: !!made.lazy };
        const px = p.add(fx('pixel', 'scene', 0));
        out.scene = chain()[0];
        out.dupScene = err(() => p.add(fx('pixel2', 'scene', 0)));
        out.dupName = err(() => p.add(fx('grain', 'hdr', 0)));
        out.badSlot = err(() => p.add(fx('x', 'post', 0)));
        px.remove(); out.restored = chain()[0];
        const late = p.get('late'); late.set({ k: 7 });                       // 没有 update：下次开启时重建，拿到新参数
        out.rebuilt = { made: made.late, k: p.composer.passes.find(x => x.tag === 'late').k };
        out.enableMissing = p.enable('nope', true);
        off.enable(true); out.lazyNow = chain().includes('lazy');
        for (const h of [...hs, off]) h.remove();
        out.after = chain().join();
        return out;
      });
      check('链顺序：RenderPass → hdr(按 order) → 输出 → ldr(按 order) → final', r.order === 'RENDER,early,late,OUTPUT,lut,grain,aa', r.order);
      check('list 按渲染顺序', r.list === 'early,lazy,late,lut,grain,aa', r.list);
      check('关着的效果不建实现', r.lazyBuilt === false && r.lazyNow === true);
      check('scene 槽替换 RenderPass，remove 后恢复', r.scene === 'pixel' && r.restored === 'RENDER');
      check('scene 槽只能一个、重名、未知槽都报错给改法', /remove it first/.test(r.dupScene) && /already added/.test(r.dupName) && /unknown slot 'post'/.test(r.badSlot), JSON.stringify(r));
      check('set 没有 update 时重建并拿到新参数', r.rebuilt.made === 2 && r.rebuilt.k === 7, JSON.stringify(r.rebuilt));
      check('enable 不存在的名字返回 false', r.enableMissing === false);
      check('全部 remove 后只剩 RenderPass 和输出', r.after === 'RENDER,OUTPUT', r.after);
    },
  },
  {
    name: '[守] 补丁组合：风吹 + 季节 + 云影叠在一个材质上各自生效；冲突、缺依赖、uniform 撞名、缓存键不跟代码都报错；影子和点光距离材质带风',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, applyEffects, patchMaterial, materialPatches } = threedogTest;
        const L = THREE.ShaderLib, out = {};
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        const compile = (m, lib, flags = {}) => { const s = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, ...flags }; m.onBeforeCompile(s, null); return s; };
        const m = applyEffects(new THREE.MeshLambertMaterial(), { wind: 0.04, season: 'foliage' });
        const s = compile(m, L.lambert);
        out.names = materialPatches(m).join();
        out.all = s.vertexShader.includes('threedog_wind_vertex') && s.fragmentShader.includes('threedogCloudLight') && s.fragmentShader.includes('uFoliageTint');
        out.key = m.customProgramCacheKey();
        const g = new THREE.BoxGeometry(), mesh = new THREE.Mesh(g, m);
        out.depth = materialPatches(mesh.customDepthMaterial).join(); out.dist = materialPatches(mesh.customDistanceMaterial).join();
        out.distKind = !!mesh.customDistanceMaterial?.isMeshDistanceMaterial;
        // 冲突：一个声明和风吹不能共存的补丁
        out.conflict = err(() => applyEffects(m, { patches: [{ name: 'stiff', conflicts: ['wind'], glsl: { vertex: { begin_vertex: '// stiff' } } }] }));
        out.reverse = err(() => patchMaterial(applyEffects(new THREE.MeshLambertMaterial(), { patches: [{ name: 'stiff', conflicts: ['wind'], glsl: { vertex: { begin_vertex: '// stiff' } } }] }), [{ name: 'wind', cacheKey: 9, glsl: {} }]));
        out.needs = err(() => applyEffects(new THREE.MeshLambertMaterial(), { clouds: false, patches: [{ name: 'speck', needs: { patches: ['clouds'] }, glsl: { fragment: { color_fragment: '// vThreedogWorld' } } }] }));
        out.uniform = err(() => applyEffects(new THREE.MeshLambertMaterial(), { patches: [{ name: 'mine', uniforms: { uTime: { value: 0 } }, glsl: { fragment: { color_fragment: '// t' } } }] }));
        applyEffects(new THREE.MeshLambertMaterial(), { patches: [{ name: 'grid', cacheKey: 1, glsl: { fragment: { color_fragment: '// 8' } } }] });
        out.cacheKey = err(() => applyEffects(new THREE.MeshLambertMaterial(), { patches: [{ name: 'grid', cacheKey: 1, glsl: { fragment: { color_fragment: '// 16' } } }] }));
        out.after = materialPatches(m).join();
        // 需要的数据：编译时没有实例化就报一次
        const errLog = console.error; let logged = ''; console.error = x => { logged += x; };
        const inst = applyEffects(new THREE.MeshLambertMaterial(), { clouds: false, patches: [{ name: 'perTree', needs: { data: ['instancing'] }, glsl: { vertex: { begin_vertex: '// it' } } }] });
        compile(inst, L.lambert, { instancing: true }); const okLog = logged;
        compile(inst, L.lambert); compile(inst, L.lambert);
        console.error = errLog;
        out.data = { ok: okLog === '', once: (logged.match(/needs 'instancing'/g) || []).length };
        return out;
      });
      check('补丁按顺序叠上且都注入（云影自带 world 补丁）', r.names === 'world,clouds,season,wind' && r.all, JSON.stringify(r));
      check('缓存键按顺序拼三个补丁', /threedog:world=,clouds=,season=foliage,wind=0.04$/.test(r.key), r.key);
      check('阴影深度材质和点光距离材质都只带风吹', r.depth === 'wind' && r.dist === 'wind' && r.distKind, r.depth + '/' + r.dist);
      check('声明冲突的补丁报错（两个方向都查）', /'wind' and 'stiff' cannot be combined/.test(r.conflict) && /'stiff' and 'wind' cannot be combined/.test(r.reverse), r.conflict + ' | ' + r.reverse);
      check('缺依赖补丁报错', /needs patch 'clouds'/.test(r.needs), r.needs);
      check('uniform 撞名报错', /uniform named 'uTime'/.test(r.uniform), r.uniform);
      check('同名同缓存键代码不同报错', /same cacheKey '1'/.test(r.cacheKey), r.cacheKey);
      check('报错的补丁没加进去', r.after === 'world,clouds,season,wind', r.after);
      check('needs.data：实例化时不报，没有时只报一次', r.data.ok && r.data.once === 1, JSON.stringify(r.data));
    },
  },
  {
    name: '[守] 着色器补丁：对任意材质生效、和已有 onBeforeCompile 叠加、缓存键拼接、缺注入点报错、风吹带影子',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { THREE, applyEffects, patchMaterial, materialPatches } = threedogTest;
        // 不需要 WebGL：拿内置着色器源码做一个假 shader，直接调 onBeforeCompile 看注入结果
        const compile = (m, lib) => { const s = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader }; m.onBeforeCompile(s, null); return s; };
        const L = THREE.ShaderLib, out = {};
        for (const [k, M, lib] of [['lambert', THREE.MeshLambertMaterial, L.lambert], ['toon', THREE.MeshToonMaterial, L.toon], ['standard', THREE.MeshStandardMaterial, L.standard]]) {
          const s = compile(applyEffects(new M(), { wind: 0.03, season: 'foliage' }), lib);
          out[k] = s.vertexShader.includes('threedog_wind_vertex') && s.fragmentShader.includes('threedogCloudLight') && !!s.uniforms.uWind && !!s.uniforms.uFoliageTint;
        }
        const { value: basic, warns } = await __t.warns(() => applyEffects(new THREE.MeshBasicMaterial(), { wind: 0.03 }));
        out.basic = { names: materialPatches(basic), warned: warns.some(w => /clouds/.test(w)) };
        let calls = '';
        const own = new THREE.MeshLambertMaterial();
        own.onBeforeCompile = s => { calls += 'own,'; s.fragmentShader += '\n// own'; };
        patchMaterial(own, [{ name: 'a', cacheKey: 1, glsl: { fragment: { color_fragment: '// A' } } }]);
        patchMaterial(own, [{ name: 'b', glsl: { fragment: { color_fragment: '// B' } } }]);
        const so = compile(own, L.lambert);
        out.stack = calls === 'own,' && so.fragmentShader.includes('// own') && /\/\/ A[\s\S]*\/\/ B/.test(so.fragmentShader);
        out.key = own.customProgramCacheKey();
        const k1 = applyEffects(new THREE.MeshLambertMaterial(), { wind: 0.01 }).customProgramCacheKey(), k2 = applyEffects(new THREE.MeshLambertMaterial(), { wind: 0.05 }).customProgramCacheKey();
        out.keysDiffer = k1 !== k2;
        try { patchMaterial(new THREE.ShaderMaterial({ vertexShader: 'void main(){}', fragmentShader: 'void main(){}' }), [{ name: 'x', glsl: { vertex: { begin_vertex: '' } } }]); out.strict = ''; } catch (e) { out.strict = e.message; }
        const hand = new THREE.ShaderMaterial({ vertexShader: '#include <threedog_wind_pars_vertex>\nvoid main(){}', fragmentShader: 'void main(){}' });
        out.chunk = !!THREE.ShaderChunk.threedog_wind_vertex && !!THREE.ShaderChunk.threedog_clouds_pars_fragment && hand.vertexShader.length > 0;
        const tree = applyEffects(new THREE.MeshLambertMaterial(), { wind: 0.03 });
        const g = new THREE.BoxGeometry(), mine = new THREE.MeshDepthMaterial(), m3 = new THREE.Mesh(g, tree);
        const d = new THREE.InstancedMesh(g, tree, 1).customDepthMaterial;
        m3.customDepthMaterial = mine;
        out.depth = !!d?.isMeshDepthMaterial && materialPatches(d).join() === 'wind' && new THREE.Mesh(g, tree).customDepthMaterial === d
          && new THREE.Mesh(g, applyEffects(new THREE.MeshLambertMaterial())).customDepthMaterial === undefined && m3.customDepthMaterial === mine;
        const cust = applyEffects(new THREE.MeshLambertMaterial(), { clouds: false, patches: [{ name: 'snap', glsl: { vertex: { project_vertex: '// snap' } } }] });
        out.custom = materialPatches(cust).join();
        return out;
      });
      check('lambert / toon / standard 都注入了风吹、云影、季节色', r.lambert && r.toon && r.standard, JSON.stringify(r));
      check('Basic 没光照片段：跳过云影并提示一次，风吹照常', r.basic.names.join() === 'world,wind' && r.basic.warned, JSON.stringify(r.basic));
      check('先调材质自己的 onBeforeCompile，再按添加顺序跑补丁', r.stack);
      check('缓存键拼上每个补丁的名字和参数', /threedog:a=1,b=$/.test(r.key), r.key);
      check('参数不同的风吹不共用程序', r.keysDiffer);
      check('手动 patchMaterial 缺注入点直接报错', /needs vertex <begin_vertex>/.test(r.strict), r.strict);
      check('GLSL 片段登记到 ShaderChunk，手写着色器能 #include', r.chunk);
      check('风吹自带影子：用这种材质的网格自动拿到摆动的深度材质；没风时不设；手动指定的优先', r.depth, JSON.stringify(r));
      check('applyEffects 的 patches 收自定义补丁', r.custom === 'snap', r.custom);
    },
  },
  {
    name: '植被：实例挂上摆动影子材质，自定义材质也加上风吹（effects: false 可关）',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, materialPatches } = threedogTest, ims = [];
        engine.scene.traverse(o => { if (o.isInstancedMesh && materialPatches(o.material).includes('wind')) ims.push(o); });
        const custom = new THREE.MeshToonMaterial(), raw = new THREE.MeshToonMaterial(), g = new THREE.BoxGeometry();
        engine.vegetation.add('artTestA', { geometry: g, material: custom, wind: 0.02, rule: { perChunk: 0 } });
        engine.vegetation.add('artTestB', { geometry: g, material: raw, effects: false, rule: { perChunk: 0 } });
        return { n: ims.length, depth: ims.length > 0 && ims.every(o => o.customDepthMaterial?.isMeshDepthMaterial), custom: materialPatches(custom).join(), raw: materialPatches(raw).length };
      });
      check('摆动的植被实例都有 customDepthMaterial', r.depth, JSON.stringify(r));
      check('自定义材质加上了云影 / 季节 / 风吹', r.custom === 'world,clouds,season,wind', r.custom);
      check('effects: false 时不动材质', r.raw === 0);
    },
  },
  {
    name: '[守] 水的材质入口：style.water.material 整个换掉水面材质（不再套内置波浪 / 菲涅尔），拿到共享 uniforms 和波浪补丁；返回值不是材质时报错',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, applyEffects, materialPatches } = threedogTest, W = engine.water, st = W.st, old = st.material;
        let got = null;
        st.material = (e, ctx) => { got = ctx; return applyEffects(new THREE.MeshToonMaterial({ color: 0x3a8acf }), { clouds: false, patches: [ctx.waves] }); };
        const m = W._material();
        const out = { toon: m.isMeshToonMaterial, patches: materialPatches(m).join(), uTime: got?.uniforms.uTime === got?.waves.uniforms.uTime && !!got?.uniforms.uWave,
          builtin: materialPatches(W.material).join() };
        st.material = () => 42;
        try { W._material(); out.bad = ''; } catch (e) { out.bad = e.message; }
        st.material = old;
        return out;
      });
      check('自定义材质生效，只有自己选的波浪补丁', r.toon && r.patches === 'waves', JSON.stringify(r));
      check('拿到共享 uniforms（uTime 与波浪补丁同一个对象）', r.uTime);
      check('默认水面仍是内置波浪 + 菲涅尔', /waves/.test(r.builtin) && /fresnel/.test(r.builtin), r.builtin);
      check('返回值不是材质时报错给写法', /must return a three.js Material/.test(r.bad), r.bad);
    },
  },
];
