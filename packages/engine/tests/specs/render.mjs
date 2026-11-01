// Rendering guards: post-processing size, depth read order, patches follow clone, GLSL really compiles, engines do not share state, UI CSS order.
// Pages use the perf city / world modes; anything a test changes is restored inside the same ev.

export const specs = [
  {
    name: '[守] 后期尺寸：开着后期时 setPixelRatio 不会把渲染目标按像素比放大两次',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const p = engine.post, pr0 = engine.renderer.getPixelRatio(), out = { fresh: !p.composer };
        engine.setPixelRatio(1.5);   // 后期在像素比不是 1 时建起来，才会暴露"设备像素再乘像素比"
        p.enable('antialias', true); engine.step(1 / 30, { render: true });
        const css = engine.renderer.getSize(new engine.THREE.Vector2());
        for (const pr of [1, 2, 1.4]) {
          engine.setPixelRatio(pr); engine.step(1 / 30, { render: true });
          out[pr] = [p.composer.renderTarget1.width, p.composer.renderTarget2.height, Math.round(css.x * pr), Math.round(css.y * pr)];
        }
        engine.setPixelRatio(pr0);
        return out;
      });
      const { fresh, ...sizes } = r;
      check('后期是在像素比 1.5 时新建的', fresh);
      const ok = Object.values(sizes).every(([w, h, ew, eh]) => Math.abs(w - ew) <= 1 && Math.abs(h - eh) <= 1);
      check('像素比 1 / 2 / 1.4 下渲染目标 = CSS 尺寸 × 像素比', ok, JSON.stringify(r));
    },
  },
  {
    name: '[守] 后期深度顺序：读深度的效果排在换缓冲的效果后面时报错给改法，并且不留半加的效果；create 抛错回滚；remove 可重复；enable 拼错有提示',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const p = engine.post, out = {};
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        const pass = (swap, disposed = { n: 0 }) => ({ enabled: true, needsSwap: swap, renderToScreen: false, setSize() {}, render() {}, dispose() { disposed.n++; } });
        const before = p.list().map(e => e.name).join();
        out.ldr = err(() => p.add({ name: 'ldrDepth', slot: 'ldr', needsDepth: true, create: () => pass(false) }));   // 色调映射输出之后已经没有场景深度
        const grade = p.add({ name: 'grade', slot: 'hdr', order: 5, create: () => pass(true) });
        out.late = err(() => p.add({ name: 'edges', slot: 'hdr', order: 50, needsDepth: true, create: () => pass(true) }));
        out.lateGone = !p.get('edges');
        const edges = p.add({ name: 'edges', slot: 'hdr', order: 1, needsDepth: true, create: () => pass(true) });   // 先读深度再换缓冲：可以
        out.earlyOk = !!p.get('edges');
        // enable 打开一个会破坏顺序的效果：报错并保持关着
        const late2 = p.add({ name: 'late2', slot: 'hdr', order: 60, needsDepth: true, enabled: false, create: () => pass(false) });
        out.enable = err(() => late2.enable(true));
        out.enableKept = late2.enabled === false;
        late2.remove();
        // create 抛错：不留在链里，后面的调用不受影响
        out.create = err(() => p.add({ name: 'boom', create: () => { throw new Error('boom!'); } }));
        out.createGone = !p.get('boom') && err(() => p.enable('antialias', true)) === '';
        // remove 两次只 dispose 一次
        const d = { n: 0 }, once = p.add({ name: 'once', create: () => pass(false, d) });
        once.remove(); once.remove(); out.disposed = d.n;
        // enable 拼错：返回 false 并在开发版提示
        const warn = console.warn; let w = ''; console.warn = m => { w += m; };
        out.typo = p.enable('grde', false); console.warn = warn; out.typoWarn = w;
        grade.remove(); edges.remove(); p.enable('antialias', false);
        out.after = p.list().map(e => e.name).join() === before;
        return out;
      });
      check('读深度的效果排在换缓冲的效果后面：报错说明谁换了缓冲、怎么改', /'edges' reads scene depth.*after 'grade'.*lower order/.test(r.late), r.late);
      check('报错后这个效果没加进去；排在前面就可以', r.lateGone && r.earlyOk, JSON.stringify(r));
      check('ldr 槽读深度：报错（色调映射输出已换缓冲）', /after 'output \(tone mapping\)'/.test(r.ldr), r.ldr);
      check('enable 打开会破坏顺序的效果：报错并保持关着', /'late2' reads scene depth/.test(r.enable) && r.enableKept, r.enable);
      check('create 抛错：效果被移除，别的调用照常', /boom!/.test(r.create) && r.createGone, JSON.stringify(r));
      check('句柄 remove() 可重复调用，只 dispose 一次', r.disposed === 1, String(r.disposed));
      check('enable 拼错名字：返回 false 并提示 did you mean', r.typo === false && /grade/.test(r.typoWarn), r.typoWarn);
      check('全部还原', r.after);
    },
  },
  {
    name: '[守] 补丁跟着走：风格包材质实例经 makeMaterial clone 后补丁还在；copyPatches；多材质网格的影子取会动的那个；重打补丁时旧影子材质被释放；needs.data 拼错报错',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, makeMaterial, applyEffects, materialPatches, copyPatches } = threedogTest, S = engine.style, old = S.materials, out = {};
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        const snap = { name: 'snap', cacheKey: 8, glsl: { vertex: { project_vertex: '// snap' } } };
        S.materials = { prop: applyEffects(new THREE.MeshToonMaterial(), { clouds: false, patches: [snap] }) };
        const m = makeMaterial('prop', { color: 0xff0000 });
        out.clone = { patches: materialPatches(m).join(), notSame: m !== S.materials.prop, color: m.color.getHex() === 0xff0000 };
        S.materials = old;
        const src = applyEffects(new THREE.MeshLambertMaterial(), { wind: 0.05 });
        out.copied = materialPatches(copyPatches(src, src.clone())).join();
        // 多材质：树干（只有云影）在前、树叶（风吹）在后，影子要跟树叶走
        const g = new THREE.BoxGeometry(), trunk = applyEffects(new THREE.MeshLambertMaterial()), leaves = applyEffects(new THREE.MeshLambertMaterial(), { wind: 0.03 });
        const mm = new THREE.Mesh(g, [trunk, leaves]);
        out.multi = materialPatches(mm.customDepthMaterial).join();
        // 重新打补丁：旧的影子材质 dispose；源材质 dispose 时派生的也 dispose
        const d1 = new THREE.Mesh(g, leaves).customDepthMaterial; let disposed = 0;
        d1.addEventListener('dispose', () => disposed++);
        applyEffects(leaves, { wind: 0.06 });
        const d2 = new THREE.Mesh(g, leaves).customDepthMaterial; d2.addEventListener('dispose', () => disposed++);
        leaves.dispose();
        out.disposed = { n: disposed, fresh: d1 !== d2 };
        out.dataTypo = err(() => applyEffects(new THREE.MeshLambertMaterial(), { patches: [{ name: 'x', needs: { data: ['instanced'] }, glsl: { vertex: { begin_vertex: '//' } } }] }));
        return out;
      });
      check('makeMaterial 克隆风格包实例：自己的补丁还在，参数照常套用', r.clone.patches === 'snap' && r.clone.notSame && r.clone.color, JSON.stringify(r.clone));
      check('copyPatches 把补丁带到 clone 上', r.copied === 'world,clouds,wind', r.copied);
      check('多材质网格：影子用第一个会动的材质（不是第一个打过补丁的）', r.multi === 'wind', r.multi);
      check('重打补丁 / 源材质 dispose：派生影子材质被 dispose', r.disposed.n === 2 && r.disposed.fresh, JSON.stringify(r.disposed));
      check('needs.data 拼错：加补丁时就报错并给建议', /'instanced'.*did you mean 'instancing'/.test(r.dataTypo), r.dataTypo);
    },
  },
  {
    name: '[守] world 补丁：细节纹理不再依赖云影（无光照的 Basic 地形材质也能加）；占位纹理是中性的',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, terrainMaterial, materialPatches } = threedogTest;
        const warn = console.warn; console.warn = () => {};
        const fake = { style: { terrain: { detail: { texture: 'grain', strength: 0.35 } } }, assets: { texture: () => new Promise(() => {}) } };
        const m = terrainMaterial(new THREE.MeshBasicMaterial({ vertexColors: true }), fake);
        console.warn = warn;
        const s = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
        m.onBeforeCompile(s, null);
        const img = s.uniforms.uDetail.value.image, px = img.getContext('2d').getImageData(0, 0, 1, 1).data;
        return { patches: materialPatches(m).join(), varying: /threedog_world_pars_fragment/.test(s.fragmentShader), px: [...px].slice(0, 3), space: s.uniforms.uDetail.value.colorSpace };
      });
      check('Basic 材质：跳过云影，但 world + 季节 + 细节都在', r.patches === 'world,season,detail', r.patches);
      check('片元着色器有 world 的 varying 声明', r.varying);
      check('细节纹理加载前是线性 0.5 灰（乘 2 = 不变），不会让地面先暗一截', r.px.join() === '128,128,128' && r.space === '', JSON.stringify(r));
    },
  },
  {
    name: '[守] 真编译 GLSL：内置补丁的各种组合（lambert/phong/standard/toon × 云影/风吹/季节/细节 × 实例化）、阴影深度和点光距离、水、天空、雨雪、粒子都能编译链接',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, applyEffects, terrainMaterial, makeMaterial } = threedogTest, R = engine.renderer, errors = [];
        const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
        cam.position.set(0, 20, 40); cam.lookAt(0, 0, 0);
        const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(10, 30, 10); sun.castShadow = true; scene.add(sun, sun.target);
        const point = new THREE.PointLight(0xffffff, 50, 60); point.position.set(0, 8, 0); point.castShadow = true; scene.add(point);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));
        scene.fog = new THREE.Fog(0xcccccc, 10, 300);
        const g = new THREE.BoxGeometry(1, 2, 1);
        g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(0.8), 3));
        const types = { lambert: THREE.MeshLambertMaterial, phong: THREE.MeshPhongMaterial, standard: THREE.MeshStandardMaterial, toon: THREE.MeshToonMaterial };
        const combos = [{}, { wind: 0.03 }, { season: 'foliage' }, { wind: 0.02, season: 'ground' }, { clouds: false, wind: 0.04 }];
        const fakeEngine = { style: { terrain: { detail: { texture: 'grain' } } }, assets: { texture: () => new Promise(() => {}) } };
        let n = 0;
        const place = o => { o.position.set((n % 10) * 3 - 15, 0, Math.floor(n / 10) * 3 - 10); o.castShadow = o.receiveShadow = true; scene.add(o); n++; };
        const warn = console.warn; console.warn = () => {};
        for (const M of Object.values(types)) for (const c of combos) for (const inst of [false, true]) {
          const m = applyEffects(new M({ vertexColors: true }), c);
          place(inst ? new THREE.InstancedMesh(g, m, 2) : new THREE.Mesh(g, m));
        }
        for (const M of Object.values(types)) place(new THREE.Mesh(g, terrainMaterial(new M({ vertexColors: true }), fakeEngine)));
        // BatchedMesh: the world position and wind phase read batchingMatrix
        const bm = new THREE.BatchedMesh(2, 64, 64, applyEffects(new THREE.MeshLambertMaterial(), { wind: 0.03, season: 'foliage' }));
        bm.addInstance(bm.addGeometry(new THREE.BoxGeometry(1, 2, 1))); place(bm);
        place(new THREE.Mesh(g, terrainMaterial(new THREE.MeshBasicMaterial({ vertexColors: true }), fakeEngine)));
        console.warn = warn;
        // 引擎自己的着色器材质：天空穹顶、雨雪、水（如果装了）
        engine.particles.define('renderTestGlsl', {});
        const own = [engine.sky.dome.material, engine.weather.systems.get('rain')?.object.material, engine.water.material].filter(Boolean);
        for (const m of own) place(new THREE.Mesh(g, m));
        const dot = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
        for (const m of [engine.weather.systems.get('snow').object.material, engine.particles.effects.get('renderTestGlsl').material]) place(new THREE.Points(dot, m));
        // canary: a patch with a GLSL typo must be the one and only error, which proves the check sees real compile failures
        place(new THREE.Mesh(g, applyEffects(new THREE.MeshLambertMaterial(), { clouds: false, patches: [{ name: 'canary', glsl: { fragment: { color_fragment: 'diffuseColor.rgb *= threedogNope;' } } }] })));
        const prev = R.debug.onShaderError;
        R.debug.onShaderError = (gl, program, vs, fs) => errors.push((gl.getProgramInfoLog(program) || '') + (gl.getShaderInfoLog(vs) || '') + (gl.getShaderInfoLog(fs) || ''));
        const err0 = console.error; let logged = ''; console.error = (...a) => { logged += a.join(' ') + '\n'; };
        const rt = new THREE.WebGLRenderTarget(64, 64);
        R.setRenderTarget(rt); R.render(scene, cam); R.setRenderTarget(null);
        console.error = err0; R.debug.onShaderError = prev;
        const programs = R.info.programs.length;
        rt.dispose();
        return { errors: errors.map(e => e.slice(0, 300)), logged: logged.slice(0, 600), objects: n, programs };
      });
      check('故意写错的 canary 补丁被抓到（检查真的在编译）', r.errors.length >= 1 && r.errors.every(e => /threedogNope/.test(e)), JSON.stringify(r.errors));
      check('除 canary 外所有组合都编译链接成功', r.errors.length === 1, JSON.stringify(r.errors));
      check('渲染时没有 console.error（缺注入点、needs 不满足等）', r.logged === '', r.logged);
      check('确实画了这么多组合', r.objects >= 45 && r.programs > 10, `${r.objects} objects, ${r.programs} programs`);
    },
  },
  {
    name: '[守] 每个引擎自己的 uniforms 和风格包：两个引擎时间不串、makeMaterial 默认用第一个引擎的风格包；引擎兜底是中性的（无 ACES、曝光 1、无云影）',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, createEngine, makeMaterial, lowpoly } = threedogTest, out = {};
        out.neutral = { tone: engine.renderer.toneMapping === THREE.NoToneMapping, exposure: engine.renderer.toneMappingExposure, cloudShadow: engine.uniforms.uCloudShadow.value };
        const warn = console.warn; let w = ''; console.warn = m => { w += m; };
        const second = createEngine({ canvas: document.createElement('canvas'), style: { ...lowpoly, materials: { default: { type: 'phong' } } }, headless: true, ui: { loading: false }, saveKey: 'render-test-2' });
        const t1 = engine.elapsed, t2 = second.elapsed;
        engine.step(0.5, { render: false });
        out.time = { first: +(engine.elapsed - t1).toFixed(2), second: +(second.elapsed - t2).toFixed(2), uTime: engine.uniforms.uTime.value === engine.elapsed, separate: engine.uniforms.uTime !== second.uniforms.uTime };
        out.styleDefault = makeMaterial('anything').type;   // 第一个引擎（空风格包）→ lambert
        out.styleSecond = makeMaterial('anything', {}, second).type;
        out.warned = /different style packs/.test(w);
        out.lowpoly = { cloud: second.uniforms.uCloudShadow.value, tone: second.renderer.toneMapping === THREE.ACESFilmicToneMapping, exposure: second.renderer.toneMappingExposure };
        second.dispose(); console.warn = warn;
        out.afterDispose = makeMaterial('anything').type;
        return out;
      });
      check('引擎兜底：不做色调映射、曝光 1、没有云影', r.neutral.tone && r.neutral.exposure === 1 && r.neutral.cloudShadow === 0, JSON.stringify(r.neutral));
      check('第二个引擎不让第一个的 elapsed 变快，uTime 跟 elapsed 一致，两套 uniforms', r.time.first === 0.5 && r.time.second === 0 && r.time.uTime && r.time.separate, JSON.stringify(r.time));
      check('makeMaterial 不传引擎：用第一个引擎的风格包并提示传引擎', r.styleDefault === 'MeshLambertMaterial' && r.warned, JSON.stringify(r));
      check('makeMaterial(role, params, engine) 用那个引擎的风格包', r.styleSecond === 'MeshPhongMaterial');
      check('lowpoly 风格包自己给 ACES / 1.05 / 云影 0.55', r.lowpoly.cloud === 0.55 && r.lowpoly.tone && r.lowpoly.exposure === 1.05, JSON.stringify(r.lowpoly));
      check('第二个引擎 dispose 后不再参与', r.afterDispose === 'MeshLambertMaterial');
    },
  },
  {
    name: '[守] UI 样式顺序：风格包的 style.ui.css 永远排在模块默认 CSS 后面；默认 CSS 按内容去重；引擎 dispose 拿走自己的样式',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { createEngine, injectUICSS } = threedogTest, H = document.head, out = {};
        const threedog = () => [...H.querySelectorAll('style[data-threedog], style[data-threedog-pack], link[data-threedog-pack]')];
        const before = threedog().length;
        const second = createEngine({ canvas: document.createElement('canvas'), style: { ui: { css: '.threedog-hud-stats{top:auto}', bg: '#123' } }, headless: true, ui: { loading: false }, saveKey: 'render-test-ui' });
        injectUICSS('.threedog-late-module{color:red}');   // 模块在风格包之后才装、才注入默认 CSS
        injectUICSS('.threedog-late-module{color:red}');   // 同一段只加一次
        const list = threedog(), last = list[list.length - 1];
        out.packLast = list.filter(n => 'threedogPack' in n.dataset).every(n => list.indexOf(n) > list.findIndex(x => x.textContent.includes('threedog-late-module')));
        out.lastIsPack = 'threedogPack' in last.dataset;
        out.dedupe = list.filter(n => n.textContent.includes('threedog-late-module')).length;
        out.theme = second.uiRoot.style.getPropertyValue('--threedog-bg');
        out.rootClean = document.documentElement.style.getPropertyValue('--threedog-bg') === '';
        let bad = ''; try { createEngine({ canvas: document.createElement('canvas'), style: { ui: { fontFaces: [{ family: 'x', url: '/f.woff2' }] } }, headless: true, ui: { loading: false }, saveKey: 'render-test-bad' }); } catch (e) { bad = e.message; }
        out.bad = bad;
        second.dispose();
        out.packGone = !threedog().some(n => n.textContent.includes('hud-stats{top:auto}'));
        out.defaultsKept = threedog().some(n => n.dataset.threedog === 'default');   // 第一个引擎还在：默认 CSS 留着
        out.before = before;
        return out;
      });
      check('风格包的 <style> 在后注入的模块默认 CSS 之后（同优先级时风格包赢）', r.packLast && r.lastIsPack, JSON.stringify(r));
      check('同一段默认 CSS 只注入一次', r.dedupe === 1, String(r.dedupe));
      check('主题变量写在 engine.uiRoot 上，不写 :root', r.theme === '#123' && r.rootClean, JSON.stringify(r));
      check('旧写法 fontFaces（风格里写字体文件路径）：报错，教改成资源包 fonts + style.ui.fonts 写名字', /fontFaces is gone/.test(r.bad) && /fonts: \['pixel'\]/.test(r.bad), r.bad);
      check('dispose 拿走这个引擎的风格包 CSS，别的引擎还在用的默认 CSS 留着', r.packGone && r.defaultsKept, JSON.stringify(r));
    },
  },
  {
    name: '[守] 雨雪：着色器带色调映射和输出色彩空间（有没有后期都一样）；下落时间在 CPU 上取模（长时间不抖）',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const W = engine.weather, out = {}, rain = W.systems.get('rain'), snow = W.systems.get('snow');
        out.chunks = [rain.object.material, snow.object.material].every(m => m.fragmentShader.includes('#include <colorspace_fragment>') && m.fragmentShader.includes('#include <tonemapping_fragment>'));
        out.noRawTime = ![rain.object.material, snow.object.material].some(m => /uTime/.test(m.vertexShader));
        engine.step(0.2, { render: false });
        out.wrapped = rain.uniforms.uFallOff.value >= 0 && rain.uniforms.uFallOff.value < W.area && snow.uniforms.uSway.value < 20 * Math.PI;
        return out;
      });
      check('雨和雪的片元着色器 include 了 tonemapping / colorspace', r.chunks, JSON.stringify(r));
      check('顶点着色器不直接用无界的 uTime；下落量在 [0, 区域大小) 内', r.noRawTime && r.wrapped, JSON.stringify(r));
    },
  },
  {
    name: '[守] 粒子：重新 define 同名效果，已挂的发射器换到新效果上继续冒；粒子屏幕尺寸有上限',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(() => {
        const P = engine.particles, { THREE } = threedogTest;
        const chimney = new THREE.Object3D(); chimney.position.copy(engine.player.position); engine.add(chimney);
        P.define('renderTestSmoke', { max: 50, rate: 30, lifetime: [5, 6] });
        const h = P.attach('renderTestSmoke', chimney);
        engine.step(0.5, { render: false });
        const fx2 = P.define('renderTestSmoke', { max: 80, rate: 30, lifetime: [5, 6] });
        engine.step(0.5, { render: false });
        const out = { rebound: h.fx === fx2, count: P.count('renderTestSmoke'), maxPx: fx2.material.uniforms.uMaxPx.value, clamp: /min\(.*uMaxPx\)/.test(fx2.material.vertexShader) };
        h.remove(); engine.remove(chimney);
        return out;
      });
      check('发射器换到新效果上，还在冒烟', r.rebound && r.count > 0, JSON.stringify(r));
      check('点大小被 uMaxPx 限住（默认 512）', r.clamp && r.maxPx === 512, JSON.stringify(r));
    },
  },
  {
    name: '[守] HLOD 不合并带风吹（顶点会动）的网格：它们保持自己的变换和摆动',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { THREE, applyEffects } = threedogTest, g = new THREE.BoxGeometry(), root = new THREE.Group();
        const still = new THREE.Mesh(g, applyEffects(new THREE.MeshLambertMaterial())), flag = new THREE.Mesh(g, applyEffects(new THREE.MeshLambertMaterial(), { wind: 0.05 }));
        still.position.set(500, 40, 500); flag.position.set(502, 40, 500); root.add(still, flag); engine.add(root);
        const h = engine.hlod.add(root);
        for (let i = 0; i < 20 && !h.ready; i++) engine.step(1 / 30, { render: false });
        const originals = h.cells.flatMap(c => c.originals);
        const out = { still: originals.includes(still), flag: originals.includes(flag), ready: h.ready };
        h.remove(); engine.remove(root);
        return out;
      });
      check('静止网格进了 HLOD，带风吹的没进', r.still && !r.flag && r.ready, JSON.stringify(r));
    },
  },
  {
    name: '[守] 天空：关键帧没从 0 开始 / 没排序 / 时间重复时报错给写法；低档设备阴影贴图默认 1024',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { createEngine } = threedogTest, out = {};
        const err = kf => {
          const e2 = createEngine({ canvas: document.createElement('canvas'), style: { sky: { keyframes: kf } }, headless: true, ui: { loading: false }, saveKey: 'render-test-sky' });
          try { e2.use(threedogTest.sky()); return ''; } catch (e) { return e.message; } finally { e2.dispose(); }
        };
        const row = t => [t, 0x222222, 0x444444, 0xffffff, 1, 1];
        out.late = err([row(0.2), row(1)]); out.unsorted = err([row(0), row(0.6), row(0.4), row(1)]); out.dup = err([row(0), row(0.5), row(0.5), row(1)]);
        out.ok = err([row(0), row(0.5), row(1)]);
        out.tier = engine.tier;
        out.mapSize = engine.sky.shadowMapSize;
        return out;
      });
      for (const k of ['late', 'unsorted', 'dup']) check(`关键帧${k}：报错说清楚要求`, /sorted by time, starting at 0 and ending at 1/.test(r[k]), r[k]);
      check('合法关键帧不报错', r.ok === '', r.ok);
      check('测试环境是低档设备（软件渲染）', r.tier === 'low', r.tier);
      check('低档设备：阴影贴图默认 1024', r.mapSize === 1024, String(r.mapSize));
    },
  },
];
