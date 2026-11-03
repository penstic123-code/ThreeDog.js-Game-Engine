// 级联阴影（sky shadow.cascades，modules/sky/cascades.js）。
// 守：材质只经 'csm' 具名补丁接入（风吹 / 季节 / 云影补丁链不丢、影子深度材质仍带风吹）、ShaderChunk 全局不被改、开关可逆、写错报错、低档默认单阴影。
// 验收：styletest 的 path 机位（匀速直线移动）下，近处阴影比单阴影锐、移动时边缘不抖、级联交界处阴影位置和亮度连续，并报告投影绘制次数与帧耗时（软件渲染只看相对值）。
import { shadowFor } from '../../modules/sky/shadow.js';

const READY = { timeout: 60000 };

export const specs = [
  {
    serial: true,   // timing assertion: runs alone, not beside other pages
    name: '[守] 级联阴影：唯一入口是具名补丁 csm，风吹等补丁链和影子深度材质不丢，ShaderChunk 不被全局替换，开关可逆，写错报错，低档默认单阴影',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const low = shadowFor('low', { cascades: 3 }), lowOver = shadowFor('low', { cascades: 3, low: { cascades: 2 } });
      const optLow = shadowFor('low', undefined, { cascades: 3 }), high = shadowFor('high', { cascades: 3 });
      check('低档默认 1 个级联（单阴影），low 覆盖可开；sky({ shadow }) 在低档也按 low.cascades；高档照写',
        low.cascades === 1 && lowOver.cascades === 2 && optLow.cascades === 1 && high.cascades === 3, JSON.stringify({ low, lowOver, optLow, high }));
      const r = await ev(async () => {
        const { THREE, applyEffects, patchMaterial, materialPatches } = threedogTest;
        const sky = engine.sky, sun = engine.lights.sun, L = THREE.ShaderLib, out = {};
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        const compile = (m, lib) => { const s = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader }; m.onBeforeCompile(s, engine.renderer); return s; };
        engine.pause();
        const chunks = [THREE.ShaderChunk.lights_fragment_begin, THREE.ShaderChunk.lights_pars_begin];
        const m = applyEffects(new THREE.MeshLambertMaterial(), { wind: 0.04, season: 'foliage' });
        const before = materialPatches(m).join();
        const tree = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1), m); tree.castShadow = true; tree.position.copy(engine.focus);
        const basic = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
        engine.scene.add(tree, basic);
        const right0 = sun.shadow.camera.right, calls1 = engine.budget.byTag().reduce((a, s) => a + s.drawCalls, 0);
        engine.look.shadow.set({ cascades: 3 });
        engine.step(1 / 30, { describe: false });
        out.on = { names: materialPatches(m).join(), before, depth: materialPatches(tree.customDepthMaterial).join(), basic: materialPatches(basic.material).join(),
          lights: sky.csm.lights.length, sunFirst: sky.csm.lights[0] === sun, inScene: sky.csm.lights.every(l => l.parent === engine.scene), cast: sky.csm.lights.every(l => l.castShadow) };
        const s = compile(m, L.lambert), d = compile(tree.customDepthMaterial, L.depth);
        out.glsl = { csm: s.fragmentShader.includes('CSM_cascades[ UNROLLED_LOOP_INDEX ]') || s.fragmentShader.includes('CSM_cascades[UNROLLED_LOOP_INDEX]'),
          swapped: s.fragmentShader.split('#include <lights_fragment_begin>').length === 1, wind: s.vertexShader.includes('threedog_wind_vertex'),
          tint: s.fragmentShader.includes('uFoliageTint'), clouds: s.fragmentShader.includes('threedogCloudLight'), depthWind: d.vertexShader.includes('threedog_wind_vertex') };
        out.chunksKept = THREE.ShaderChunk.lights_fragment_begin === chunks[0] && THREE.ShaderChunk.lights_pars_begin === chunks[1];
        out.calls = { one: calls1, three: engine.budget.byTag().reduce((a, x) => a + x.drawCalls, 0) };
        // photo mode's setShadowMapSize reaches every cascade light, not only the sun (cascade 0); each map is reallocated at the new size
        const size0 = sun.shadow.mapSize.x;
        sky.setShadowMapSize(size0 / 2); engine.step(1 / 30, { describe: false });
        out.mapSize = { half: size0 / 2, sizes: sky.csm.lights.map(l => l.shadow.mapSize.x), drawn: sky.csm.lights.map(l => l.shadow.map?.width ?? null) };
        sky.setShadowMapSize(size0); out.mapSize.back = sky.csm.lights.map(l => l.shadow.mapSize.x).every(s => s === size0);
        // a material that shows up later is picked up on the next frame
        // plain lit materials also take the cloud shadow (render/terms.js: world + clouds); these checks are about csm alone
        const csmOf = m => materialPatches(m).filter(n => n !== 'world' && n !== 'clouds').join();
        const late = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); engine.scene.add(late);
        engine.step(1 / 30, { describe: false });
        out.late = csmOf(late.material);
        // no full walk after turning on: quiet frames visit nothing; a nested add and a material swap are picked up next frame
        const w0 = sky.csm.view.walks; engine.step(1 / 30, { describe: false }); engine.step(1 / 30, { describe: false });
        const quiet = sky.csm.view.walks - w0;
        const holder = new THREE.Group(); engine.scene.add(holder); engine.step(1 / 30, { describe: false });
        const nested = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhongMaterial()); holder.add(nested);
        engine.step(1 / 30, { describe: false });
        const swapped = new THREE.MeshToonMaterial(); late.material = swapped; engine.step(1 / 30, { describe: false });
        // a class with its own material accessor (troika-three-text style): its getter / setter still run, and the swap is still seen
        class OwnMat extends THREE.Mesh {
          get material() { this.gets = (this.gets ?? 0) + 1; return this._mat; }
          set material(m) { this.sets = (this.sets ?? 0) + 1; this._mat = m; }
        }
        const txt = new OwnMat(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial()); engine.scene.add(txt); engine.step(1 / 30, { describe: false });
        const libSets = txt.sets, libSwap = new THREE.MeshPhongMaterial(); txt.material = libSwap; const g0 = txt.gets; void txt.material;
        engine.step(1 / 30, { describe: false });
        out.lib = { setterRan: txt.sets === libSets + 1, getterRan: txt.gets > g0, stored: txt._mat === libSwap, csm: csmOf(libSwap) };
        engine.scene.remove(txt);
        out.walk = { quiet, nested: csmOf(nested.material), swapped: csmOf(swapped), total: sky.csm.view.walks - w0 };
        engine.scene.remove(holder);
        // 决定 4 方案 A：游戏自己 new 的内置受光材质也打（不打就 N 倍亮），describe().owned 点名；游戏的 ShaderMaterial 不悄悄打，警告给 include 原文
        const lib = THREE.ShaderLib.lambert, sm = new THREE.ShaderMaterial({ name: 'myLit', lights: true, uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader });
        const own = new THREE.Mesh(new THREE.BoxGeometry(), sm); engine.scene.add(own);
        const w = await __t.warns(() => engine.step(1 / 30, { describe: false }));
        out.shaderMat = { before: materialPatches(sm).join(), warned: w.warns.some(x => x.includes('engine.look.shadow.include(mat)') && x.includes('myLit')) };
        engine.look.shadow.include(sm); engine.step(1 / 30, { describe: false });
        out.shaderMat.after = materialPatches(sm).join();
        out.ownedRow = engine.describe().owned?.['shadow.csm']?.materials ?? [];
        out.engineMadeNotListed = !out.ownedRow.includes(m.name || 'none');
        engine.scene.remove(own);
        out.bad = { count: err(() => engine.look.shadow.set({ cascades: 5 })), split: err(() => engine.look.shadow.set({ cascades: 2, split: 'logarithmc' })), kept: sky.shadow.cascades };
        out.clash = err(() => patchMaterial(new THREE.MeshLambertMaterial(), [{ name: 'a', glsl: { fragment: { lights_fragment_begin: { replace: '// a' } } } },
          { name: 'b', glsl: { fragment: { lights_fragment_begin: { replace: '// b' } } } }]));
        const extra = sky.csm.lights.slice(1);
        engine.look.shadow.set({ cascades: 1 });
        engine.step(1 / 30, { describe: false });
        out.off = { names: materialPatches(m).join(), late: csmOf(late.material), csm: sky.csm, gone: extra.every(l => !l.parent), right: sun.shadow.camera.right === right0,
          chunks: THREE.ShaderChunk.lights_fragment_begin === chunks[0] };
        engine.scene.remove(tree, basic, late); engine._resume();
        return out;
      });
      check('开启后材质补丁 = 原补丁链 + csm（风吹/季节/云影一个不少），MeshBasic 不受影响', r.on.names === r.on.before + ',csm' && r.on.before.includes('wind') && r.on.basic === '', JSON.stringify(r.on));
      check('影子深度材质仍是风吹补丁（风吹阴影照样摆动），编译后的顶点 / 片元都带风吹、季节、云影和级联代码，lights_fragment_begin 只被换一次',
        r.on.depth === 'wind' && Object.values(r.glsl).every(Boolean), JSON.stringify({ depth: r.on.depth, ...r.glsl }));
      check('3 盏灯：engine.lights.sun 是第 0 级，其余加在场景里，全部投影', r.on.lights === 3 && r.on.sunFirst && r.on.inScene && r.on.cast, JSON.stringify(r.on));
      check('ShaderChunk.lights_fragment_begin / lights_pars_begin 全程未被替换（不影响别的材质和同页别的引擎）', r.chunksKept && r.off.chunks);
      check('budget 的阴影估算按级联数加倍', r.calls.three > r.calls.one, JSON.stringify(r.calls));
      check('setShadowMapSize（拍照提分辨率）改到每一级，各级阴影图按新尺寸重建，改回也到每一级',
        r.mapSize.sizes.every(s => s === r.mapSize.half) && r.mapSize.drawn.every(w => w === r.mapSize.half) && r.mapSize.back, JSON.stringify(r.mapSize));
      check('之后加进场景的受光材质下一帧自动接上 csm', r.late === 'csm', r.late);
      check('开启后不再整场景遍历（core/sceneDelta.js 只看新加的子树）：嵌套加进组里的网格、换掉的 mesh.material 下一帧接上 csm',
        r.walk.quiet === 0 && r.walk.nested === 'csm' && r.walk.swapped === 'csm' && r.walk.total === 0, JSON.stringify(r.walk));
      check('类自带 material 访问器（如 troika-three-text）：引擎不覆盖它，原 getter / setter 照样执行，换材质下一帧仍接上 csm',
        r.lib.setterRan && r.lib.getterRan && r.lib.stored && r.lib.csm === 'csm', JSON.stringify(r.lib));
      check('方案 A：游戏的 ShaderMaterial（lights: true）不被悄悄打，警告一次给 engine.look.shadow.include(mat)，include 后才打',
        r.shaderMat.before === '' && r.shaderMat.warned && r.shaderMat.after === 'csm', JSON.stringify(r.shaderMat));
      check('方案 A：被打补丁的游戏内置材质出现在 describe().owned["shadow.csm"]', r.ownedRow.includes('MeshStandardMaterial') && r.ownedRow.includes('MeshLambertMaterial'), JSON.stringify(r.ownedRow));
      check('写错报错且不生效：级联数 5、split 拼错；同一个块被两个补丁替换报错',
        r.bad.count.includes('1 (one shadow map') && r.bad.split.includes("'practical'") && r.bad.kept === 3 && r.clash.includes('both replace one chunk'), JSON.stringify({ ...r.bad, clash: r.clash }));
      check('运行时关掉：csm 补丁全部摘掉、多出的灯移出场景、sun 阴影框还原', r.off.names === r.on.before && r.off.late === '' && r.off.csm === null && r.off.gone && r.off.right, JSON.stringify(r.off));
    },
  },
  {
    software: true,   // reads rendered pixels: stays on software rendering (same pixels on every machine)
    serial: true,   // timing assertion: runs alone, not beside other pages
    name: '级联阴影验收（styletest path 机位）：近处更锐、移动不抖、级联交界连续；投影绘制次数与帧耗时',
    url: '/styletest.html',
    async run({ page, check, ev }) {
      await page.waitForFunction(() => window.engine?.stateApplied && engine.world.ready, null, READY);
      const r = await ev(() => {
        const T = engine.THREE, sky = engine.sky, sun = engine.lights.sun, cam = engine.camera, R = engine.renderer, gl = R.getContext();
        engine.pause();
        engine.ops.run('styletest.view', { name: 'path' });
        engine.calendar.timeOfDay = 0.4;   // the sun off to one side, so pole shadows run diagonally across the floor
        // only the test rig is drawn (exhibits would cast onto the floor or stand between the camera and far poles)
        const kept = []; engine.scene.traverse(o => { if ((o.isMesh || o.isPoints || o.isLine) && o.visible) { kept.push(o); o.visible = false; } });
        engine.step(1 / 30, { describe: false });
        const p0 = cam.position.clone(), dir = cam.getWorldDirection(new T.Vector3()).setY(0).normalize(), side = new T.Vector3(-dir.z, 0, dir.x);
        const c0 = p0.clone().addScaledVector(dir, 10), y = engine.surface(c0.x, c0.z) + 0.03, white = new T.MeshLambertMaterial({ color: 0xffffff });
        const rig = new T.Group(); engine.scene.add(rig);
        const floor = new T.Mesh(new T.PlaneGeometry(50, 50).rotateX(-Math.PI / 2), white); floor.position.set(c0.x, y, c0.z); floor.receiveShadow = true; rig.add(floor);
        // the shadows run to the left: each pole stands so that its shadow is seen left of every nearer pole (a nearer pole hides the floor behind it)
        const sd = sky.sunDir, run = new T.Vector3(-sd.x, 0, -sd.z).normalize(), across = new T.Vector3(-run.z, 0, run.x), half = 1.5 * Math.hypot(sd.x, sd.z) / sd.y;
        const poles = [7, 10, 13, 17, 22].map((dist, i) => {
          const b = p0.clone().addScaledVector(dir, dist).addScaledVector(side, dist * (0.35 - 0.1 * i) + half).setY(y);
          const m = new T.Mesh(new T.BoxGeometry(0.4, 3, 0.4), white); m.position.set(b.x, y + 1.5, b.z); m.castShadow = true; rig.add(m);
          return { dist, b };
        });
        // the shadow of a 3 m pole runs from its foot away from the sun; sample a line across it at half its length (world meters, 1 cm apart)
        const size = R.getDrawingBufferSize(new T.Vector2()), W = size.x, H = size.y, buf = new Uint8Array(W * H * 4), v = new T.Vector3();
        const frame = () => { engine.step(1 / 30, { describe: false }); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf); };
        const lumAt = p => {
          v.copy(p).project(cam);
          const x = Math.round((v.x + 1) / 2 * W), yy = Math.round((v.y + 1) / 2 * H), k = (yy * W + x) * 4;
          return 0.2126 * buf[k] + 0.7152 * buf[k + 1] + 0.0722 * buf[k + 2];
        };
        // profile across a pole's shadow: the two 50% crossings (meters along `across`), 10-90% width of the first edge, lit level
        const profile = pole => {
          const c = pole.b.clone().addScaledVector(run, half), s = [], val = [];
          for (let i = -80; i <= 80; i++) { s.push(i / 100); val.push(lumAt(c.clone().addScaledVector(across, i / 100))); }
          const lit = (val.slice(0, 10).reduce((a, b) => a + b) + val.slice(-10).reduce((a, b) => a + b)) / 20, dark = Math.min(...val);
          const cross = (lv, from, down) => { for (let i = from; i < val.length - 1; i++) if (down ? val[i] >= lv && val[i + 1] < lv : val[i] < lv && val[i + 1] >= lv) return s[i] + (val[i] - lv) / (val[i] - val[i + 1]) * 0.01; return NaN; };
          const mid = (lit + dark) / 2, e1 = cross(mid, 0, true), lo = cross(lit - 0.1 * (lit - dark), 0, true), hi = cross(dark + 0.1 * (lit - dark), 0, true);
          return { e1, e2: cross(mid, Math.round((e1 + 0.8) * 100) + 1, false), width: hi - lo, lit, dark };
        };
        const out = { texel: {}, near: {}, shimmer: {}, seam: {}, perf: {} };
        const info = R.info, auto = info.autoReset;
        const measure = mode => {
          engine.ops.run('styletest.view', { name: 'path' });
          frame(); frame(); frame();   // compile and settle
          const sh = sun.shadow.camera;
          out.texel[mode] = +((sh.right - sh.left) / sun.shadow.mapSize.x * 100).toFixed(2);   // cm per shadow texel at the camera's nearest shadows
          const p = profile(poles[0]);
          out.near[mode] = { width: +(p.width * 100).toFixed(1), lit: Math.round(p.lit), dark: Math.round(p.dark) };
          // moving camera: the path view moves 2.5 m/s along its line; the shadow edge of a fixed pole must stay put in the world
          // (the 10 m pole: the camera closes in about 1.4 m, which would take the 7 m pole's shadow below the screen; 10 m is still cascade 0 at maxFar 120)
          const e = [];
          for (let i = 0; i < 24; i++) { frame(); e.push(profile(poles[1]).e1); }
          out.shimmer[mode] = { range: +((Math.max(...e) - Math.min(...e)) * 100).toFixed(2), moved: +p0.distanceTo(cam.position).toFixed(2), nan: e.filter(Number.isNaN).length };
          info.autoReset = false; info.reset(); const t0 = performance.now();
          for (let i = 0; i < 6; i++) frame();
          out.perf[mode] = { ms: +((performance.now() - t0) / 6).toFixed(1), calls: Math.round(info.render.calls / 6), passes: R.shadowMap.enabled ? engine.scene.children.filter(o => o.isLight && o.castShadow && o.visible).length : 0 };
          info.autoReset = auto;
        };
        engine.look.shadow.set({ cascades: 1 }); measure('single');
        engine.look.shadow.set({ cascades: 3 }); measure('csm3');
        // seams: borders close in (maxFar 50 m: about 9 m, 21 m, 50 m), so the poles at 7-22 m straddle both borders; the shadow of
        // each pole must sit where the single map puts it and the lit floor must be as bright as with one map
        const seam = mode => {
          engine.ops.run('styletest.view', { name: 'path' }); frame(); frame(); frame();
          return poles.map(pl => { const p = profile(pl); return { dist: pl.dist, center: (p.e1 + p.e2) / 2, lit: p.lit, dark: p.dark }; });
        };
        engine.look.shadow.set({ cascades: 1 }); const a = seam('single');
        engine.look.shadow.set({ cascades: 3, maxFar: 50 }); const b = seam('csm3');
        const far = Math.min(cam.far, 50);
        out.seam.breaks = sky.csm.breaks.map(x => +(x * far).toFixed(1));
        out.seam.shift = +Math.max(...a.map((x, i) => Math.abs(x.center - b[i].center) * 100)).toFixed(2);
        out.seam.spread = +((Math.max(...b.map(x => x.center)) - Math.min(...b.map(x => x.center))) * 100).toFixed(2);
        out.seam.litRatio = +Math.max(...a.map((x, i) => Math.abs(b[i].lit / x.lit - 1))).toFixed(3);
        out.seam.nan = b.filter(x => Number.isNaN(x.center)).length;
        out.seam.centers = [a, b].map(l => l.map(x => +(x.center * 100).toFixed(1)));
        engine.look.shadow.set({ cascades: 1, maxFar: 120 });
        engine.scene.remove(rig); for (const o of kept) o.visible = true;
        engine.ops.run('styletest.view', { name: 'overview' }); engine._resume();
        return out;
      });
      const txt = JSON.stringify(r);
      console.log('[cascades] ' + txt);
      check(`近处阴影更精细：每个阴影 texel 单阴影 ${r.texel.single} cm、级联第 0 级 ${r.texel.csm3} cm；7 米处边缘过渡宽度 ${r.near.single.width} → ${r.near.csm3.width} cm`,
        r.texel.csm3 * 2 < r.texel.single && r.near.csm3.width < r.near.single.width, txt);
      check(`镜头沿 path 移动 ${r.shimmer.csm3.moved} m（24 帧）时固定杆子的阴影边缘位置变化 ${r.shimmer.csm3.range} cm，小于 2 个第 0 级 texel（单阴影 ${r.shimmer.single.range} cm）`,
        r.shimmer.csm3.nan === 0 && r.shimmer.csm3.moved > 1 && r.shimmer.csm3.range < 2 * r.texel.csm3, JSON.stringify(r.shimmer));
      check(`级联交界（${r.seam.breaks} m）：各杆阴影与单阴影位置差最大 ${r.seam.shift} cm（< 单阴影 1 个 texel），受光地面亮度差最大 ${(r.seam.litRatio * 100).toFixed(1)}%（光没有叠加、无亮度缝）`,
        r.seam.nan === 0 && r.seam.shift < r.texel.single && r.seam.litRatio < 0.03, JSON.stringify(r.seam));
      check(`成本（软件渲染只看相对值）：每帧绘制 ${r.perf.single.calls} → ${r.perf.csm3.calls} 次，投影灯 ${r.perf.single.passes} → ${r.perf.csm3.passes}，帧耗时 ${r.perf.single.ms} → ${r.perf.csm3.ms} ms`,
        r.perf.csm3.passes === 3 * r.perf.single.passes && r.perf.csm3.calls > r.perf.single.calls, JSON.stringify(r.perf));
    },
  },
];
