// 美术自由：游戏自己的 style能给任意材质、抗锯齿开后期不丢。页面用 perf 的 city 模式（style 是空对象，测试里临时换 materials 再还原）。
// [守] 这些检查防止以后有人把材质入口改回"只认几种类型"、或让后期链再次丢掉 MSAA。

export const specs = [
  {
    name: '[守] 材质开放：游戏自己的 style给实例 / 函数 / 规格三种写法都行，写错类型报错不静默回退',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, makeMaterial } = threedogTest, L = engine.look.materials, o = { owner: 'art-test' };
        const inst = new THREE.MeshMatcapMaterial();
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        // the three forms a style's materials table takes, written through look.materials (the one entry makeMaterial reads)
        L.replace('glass', inst, o);
        L.replace('shader', (params, purpose) => new THREE.ShaderMaterial({ userData: { got: purpose + ':' + (params.color ?? '') } }), o);
        L.replace('broken', () => 42, o);
        L.set({ typo: { type: 'lamber' }, default: { type: 'toon', steps: 4 } }, o);
        const a = makeMaterial('glass', { color: 0xff0000, type: 'x' });
        const b = makeMaterial('shader', { color: 7 });
        const c = makeMaterial('anything', { color: 0x00ff00 });
        const out = {
          clone: a !== inst && a.isMeshMatcapMaterial && a.color.getHex() === 0xff0000 && a.userData.purpose === 'glass' && a.type === 'MeshMatcapMaterial',
          fn: b.isShaderMaterial && b.userData.got === 'shader:7' && b.userData.purpose === 'shader',
          spec: c.isMeshToonMaterial && c.gradientMap?.image.width === 4,
          badFn: err(() => makeMaterial('broken')), badType: err(() => makeMaterial('typo')),
        };
        L._clear('art-test');
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
    name: '[守] 抗锯齿：开局的 MSAA 就是画布自带的（不开效果时直接画）；运行中切到另一值、或开效果时走后期渲染目标；画质预设能切',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const p = engine.post, samples = () => p.composer ? [p.composer.renderTarget1.samples, p.composer.renderTarget2.samples] : null;
        const fake = { enabled: true, needsSwap: false, renderToScreen: false, setSize() {}, render() {}, dispose() {} };
        const out = { canvas: engine.renderer.getContextAttributes().antialias, start: p.antialias };
        p.setAntialias(true); engine.step(1 / 30, { render: true });
        out.on = { active: p.active, s: samples() };
        const h = engine.look.post.add({ name: 'glow', create: () => ({ ...fake }) }); engine.step(1 / 30, { render: true });
        out.fx = samples();
        p.setAntialias(false); h.remove(); engine.step(1 / 30, { render: true });
        out.off = { active: p.active, s: samples() };
        engine.settings.preset('high'); out.high = p.antialias;
        engine.settings.preset('low'); out.low = p.antialias;
        p.setAntialias(out.start);
        // an engine whose canvas was made with MSAA: nothing on draws straight to it; switching MSAA off goes through the chain with 0 samples
        const E = threedogTest.createEngine({ canvas: document.createElement('canvas'), antialias: true, headless: true, ui: { loading: false }, urlState: false, saveKey: 'art-aa' });
        out.own = { canvas: E.renderer.getContextAttributes().antialias, active: E.post.active };
        E.post.setAntialias(false); E.post.render(0); out.own.offActive = E.post.active; out.own.offSamples = E.post.composer?.renderTarget1.samples;
        E.dispose();
        // a game's own renderer keeps its own MSAA choice by default (used as is, like its pixel ratio)
        out.game = [true, false].map(a => {
          const G = threedogTest.createEngine({ renderer: new threedogTest.THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: a }), headless: true, ui: { loading: false }, urlState: false, saveKey: 'art-aa-own' });
          const v = [G.post.antialias, G.post.active]; G.dispose(); G.renderer.dispose(); G.renderer.forceContextLoss(); return v;
        });
        return out;
      });
      check('画布自带的 MSAA 等于开局的抗锯齿值', r.canvas === r.start, JSON.stringify(r));
      check('游戏自己的渲染器：MSAA 默认跟它的 antialias 走，没开效果时都不走后期', JSON.stringify(r.game) === '[[true,false],[false,false]]', JSON.stringify(r.game));
      check('画布开了 MSAA、没开效果：不走后期；运行中关掉：走后期，渲染目标 0 采样', r.own.canvas === true && !r.own.active && r.own.offActive && r.own.offSamples === 0, JSON.stringify(r.own));
      // the page's canvas follows the tier: without its own MSAA (software rendering, low tier) switching on goes through the chain
      check('开抗锯齿：画布自带 MSAA 时直接画，否则走后期、渲染目标 4 倍采样', r.start ? !r.on.active : r.on.active && r.on.s.join() === '4,4', JSON.stringify(r));
      check('再加效果：仍是 4 倍采样', r.fx?.join() === '4,4');
      check('关掉、去掉效果：采样 0；画布没有 MSAA 时直接画', r.off.s.join() === '0,0' && r.off.active === r.start, JSON.stringify(r));
      check('画质预设 high 开、low 关', r.high === true && r.low === false);
    },
  },
  {
    name: '[守] 后期槽位：按 scene/hdr/输出/ldr/final 和 order 排，scene 槽唯一，remove 后恢复，参数和开关只走句柄',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const p = engine.post, L = engine.look.post, made = {};
        // 假 Pass：EffectComposer 只要求这几个成员；名字记在 tag 上，好读出链的顺序
        const fx = (name, slot, order, more = {}) => ({ name, slot, order, params: { k: 1 }, ...more,
          create: ({ params }) => { made[name] = (made[name] || 0) + 1; return { tag: name, k: params.k, enabled: true, needsSwap: false, renderToScreen: false, setSize() {}, render() {}, dispose() {} }; } });
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        const chain = () => p.composer.passes.map(x => x.tag ?? (x.isRenderPass ? 'RENDER' : x.isOutputPass ? 'OUTPUT' : '?'));
        const hs = [fx('grain', 'ldr', 0), fx('aa', 'final', 0), fx('late', 'hdr', 50), fx('early', 'hdr', -5), fx('lut', 'ldr', -1)].map(e => L.add(e));
        const off = L.add(fx('lazy', 'hdr', 0, { enabled: false }));
        engine.step(1 / 30, { render: true });
        const out = { order: chain().join(), list: p.list().map(e => e.name).join(), lazyBuilt: !!made.lazy };
        const px = L.add(fx('pixel', 'scene', 0));
        out.scene = chain()[0];
        out.dupScene = err(() => L.add(fx('pixel2', 'scene', 0)));
        out.dupName = err(() => L.add(fx('grain', 'hdr', 0)));
        out.badSlot = err(() => L.add(fx('x', 'post', 0)));
        px.remove(); out.restored = chain()[0];
        L.set({ 'late.k': 7 });                       // 没有 update：下次开启时重建，拿到新参数
        out.rebuilt = { made: made.late, k: p.composer.passes.find(x => x.tag === 'late').k };
        out.enableMissing = p.get('nope');
        L.set({ 'lazy.enabled': true }); out.lazyNow = chain().includes('lazy');
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
      check('get 不存在的名字返回 undefined', r.enableMissing === undefined);
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
        // 需要的数据：编译时没有实例化就报一次。走 warnOnce（console.warn，W4 起引擎不直接 console.error），按材质 + 补丁去重
        const errLog = console.error, warnLog = console.warn; let logged = '', errs = '';
        console.warn = x => { logged += x; }; console.error = x => { errs += x; };
        const inst = applyEffects(new THREE.MeshLambertMaterial(), { clouds: false, patches: [{ name: 'perTree', needs: { data: ['instancing'] }, glsl: { vertex: { begin_vertex: '// it' } } }] });
        compile(inst, L.lambert, { instancing: true }); const okLog = logged;
        compile(inst, L.lambert); compile(inst, L.lambert);
        console.error = errLog; console.warn = warnLog;
        out.data = { ok: okLog === '', once: (logged.match(/needs 'instancing'/g) || []).length, errs };
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
      check('needs.data：实例化时不报，没有时只报一次', r.data.ok && r.data.once === 1 && r.data.errs === '', JSON.stringify(r.data));
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
        // 决定 5：打过补丁后游戏再赋值 onBeforeCompile / customProgramCacheKey，两者都生效（游戏的先跑），缓存键跟着变
        const late = applyEffects(new THREE.MeshLambertMaterial(), { wind: 0.03 }), k0 = late.customProgramCacheKey(), v0 = late.version;
        late.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment> // late-game'); };
        const sl = compile(late, L.lambert);
        late.customProgramCacheKey = () => 'mine';
        out.late = { both: sl.fragmentShader.includes('// late-game') && sl.vertexShader.includes('threedog_wind_vertex'), names: materialPatches(late).join(),
          keyChanged: k0 !== late.customProgramCacheKey() && late.customProgramCacheKey().startsWith('mine|threedog:'), recompiles: late.version > v0,
          shadow: materialPatches(new THREE.Mesh(g, late).customDepthMaterial).join() };
        // 可调用的引擎效果：游戏自己的 ShaderMaterial 用 #include <threedog_*> 调 threedogWind / threedogCloudShadow / threedogSeason，真编译一遍
        const fx = new THREE.ShaderMaterial({ uniforms: { ...engine.uniforms },
          vertexShader: `#include <threedog_uniforms>
#include <threedog_wind>
varying vec3 vW;
void main(){ vec3 p = position + threedogWind(position, (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, 0.05); vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
          fragmentShader: `#include <threedog_uniforms>
#include <threedog_cloudShadow>
#include <threedog_season>
varying vec3 vW;
void main(){ gl_FragColor = vec4(threedogSeason(vec3(0.4, 0.7, 0.3), 0) * threedogCloudShadow(vW), 1.0); }` });
        const fxMesh = new THREE.Mesh(g, fx); engine.renderer.compile(fxMesh, engine.camera);
        const prog = engine.renderer.properties.get(fx).currentProgram;
        out.callable = !!prog && (!prog.diagnostics || prog.diagnostics.runnable) && materialPatches(fx).length === 0;
        // detail / lighting 也能调用：游戏着色器 #include <threedog_detail / threedog_lighting> 真编译；内置补丁调的就是同一组函数（不许各写一份）
        const fx2 = new THREE.ShaderMaterial({ uniforms: { uSun: { value: new THREE.Vector3(0.3, 0.9, 0.2).normalize() } },
          vertexShader: 'varying vec3 vW; varying vec3 vN; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }',
          fragmentShader: `#include <threedog_detail>
#include <threedog_lighting>
uniform vec3 uSun; varying vec3 vW; varying vec3 vN;
void main(){ vec4 d = threedogDetailNoise(vW.xz * 0.25, 1, 2.0); float nl = dot(vN, uSun); vec3 a = vec3(0.5, 0.6, 0.4) * d.rgb * 2.0;
  vec3 c = a * max(nl, 0.0) + threedogWrapDiffuse(nl, 0.4, vec3(1.0), 1.0, a) + threedogShadowTint(a * 0.3, vec3(0.3, 0.3, 0.6), 0.6, 0.3, nl, 1.0)
    + threedogRim(vN, normalize(cameraPosition - vW), vec3(1.0), 0.4, 3.0, 0.0, nl);
  gl_FragColor = vec4(threedogDetailBump(vW, vN, d.a, 0.0, 1.0) * 0.0 + c, 1.0); }` });
        const fx2Mesh = new THREE.Mesh(g, fx2); engine.renderer.compile(fx2Mesh, engine.camera);
        const prog2 = engine.renderer.properties.get(fx2).currentProgram;
        const lit = compile(applyEffects(new THREE.MeshLambertMaterial(), { patches: [] , detail: { noise: 'paper' } }), L.lambert);
        const shaped = threedogTest.makeMaterial('stone', { lighting: { wrap: 0.4, shadowTint: { color: 0x4455aa }, rim: { color: 0xffffff } } }, engine);
        const sh = compile(shaped, L.lambert);
        out.callable2 = { compiles: !!prog2 && (!prog2.diagnostics || prog2.diagnostics.runnable),
          // the patch's pars expand the threedog_* chunks once (patches.js sharedOnce), so look for the chunk's body, not the #include line;
          // one threedogHash definition = the detail grain calls the shared noise, no private copy (cloud shadows include the same chunk)
          detailSame: lit.fragmentShader.includes('#define THREEDOG_DETAIL') && lit.fragmentShader.includes('threedogDetailNoise(p, 1, uDetailOctaves)')
            && (lit.fragmentShader.match(/float threedogHash\(/g) || []).length === 1 && !/threedogD(Hash|Noise)\b/.test(THREE.ShaderChunk.threedog_detail),
          lightSame: ['threedogWrapDiffuse(', 'threedogShadowTint(', 'threedogRim('].every(f => sh.fragmentShader.includes(f)) };
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
      check('游戏 ShaderMaterial 里 #include <threedog_uniforms / wind / cloudShadow / season> 调引擎效果函数，能编译，引擎不给它打补丁', r.callable, JSON.stringify(r.callable));
      check('#include <threedog_detail / threedog_lighting>：游戏着色器调 threedogDetailNoise / WrapDiffuse / ShadowTint / Rim / DetailBump 能编译；内置 detail / lighting 补丁调的是同一组函数',
        r.callable2.compiles && r.callable2.detailSame && r.callable2.lightSame, JSON.stringify(r.callable2));
      check('打补丁后游戏再设 onBeforeCompile / customProgramCacheKey：游戏代码和风吹都在，缓存键带上游戏的键并触发重编译，影子照样摆',
        r.late.both && r.late.names === 'world,clouds,wind' && r.late.keyChanged && r.late.recompiles && r.late.shadow === 'wind', JSON.stringify(r.late));
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
        engine.vegetation.define('artTestA', { geometry: g, material: custom, wind: 0.02, rule: { perChunk: 0 } });
        engine.vegetation.define('artTestB', { geometry: g, material: raw, effects: false, rule: { perChunk: 0 } });
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
