// 后期合成（fuse）与描边新模式：合成 pass 的数量与重组、合成输出与逐个 pass 串联的像素对比、描边 normal / both / offLayer。
// 在 perf city 页面里临时加效果，用完全部移除；画布临时缩小到几十像素再还原。

export const specs = [
  {
    name: '[守] 后期 fuse：ldr 里连续启用的 fuse 效果合成 1 个 pass；开关 / 改参数 / 移除后重新合成；chromatic 读输入所以另起一组；fuse 不能放 scene 槽',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { lut, grain, vignette, chromatic } = threedogTest.postEffects, p = engine.post, out = {};
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        p.enable('antialias', false);
        const hs = [chromatic({ enabled: true }), lut({ enabled: true }), vignette({ enabled: true, strength: 0.5 }), grain({ enabled: true })].map(e => p.add(e));
        p.render(0.016);
        const fused = () => p.composer.passes.filter(x => x.items);
        out.passes4 = p.composer.passes.length; out.fused4 = fused().length; out.items4 = fused()[0]?.items.length;
        hs[3].enable(false);
        out.items3 = fused()[0]?.items.length; out.fused3 = fused().length;
        hs[2].set({ strength: 0.9 });
        out.uniform = fused()[0].material.uniforms.uVigStrength.value;
        hs[1].remove();
        out.afterRemove = fused().map(x => x.items.map(i => i.name).join('+'));
        // 改 order 让 chromatic 排在 vignette 后面：它读输入，必须另起一个 pass
        hs[0].enable(false); const late = p.add({ ...chromatic({ enabled: true, order: 50 }), name: 'chromatic2' });
        p.render(0.016);
        out.split = fused().map(x => x.items.map(i => i.name).join('+'));
        late.remove(); hs[2].remove(); hs[3].remove(); hs[0].remove();
        out.sceneErr = err(() => p.add({ name: 'fz', slot: 'scene', fuse: { glsl: '' } }));
        out.dupErr = err(() => { const a = p.add(vignette({ enabled: true })); p.add({ name: 'v2', slot: 'ldr', enabled: true, fuse: { uniforms: { uVigStrength: 'float' }, glsl: '' } }); });
        p.get('vignette')?.remove(); p.get('v2')?.remove();
        out.dupGone = !p.get('v2');
        p.render(0.016);
        out.clean = p.list().length;
        return out;
      });
      check('4 个 ldr fuse 效果：合成 1 个 pass（场景 + 色调映射输出 + 合成 = 3 个 pass）', r.fused4 === 1 && r.items4 === 4 && r.passes4 === 3, JSON.stringify(r));
      check('关掉 grain：合成 pass 里剩 3 个，仍是 1 个 pass', r.fused3 === 1 && r.items3 === 3);
      check('改参数不重建，uniform 直接更新', Math.abs(r.uniform - 0.9) < 1e-6, String(r.uniform));
      check('移除 lut 后重新合成（grain 还关着）：chromatic + vignette', r.afterRemove.length === 1 && r.afterRemove[0] === 'chromatic+vignette', JSON.stringify(r.afterRemove));
      check('chromatic 排在别的 fuse 后面时另起一组', r.split.length === 2 && /chromatic2$/.test(r.split[1]), JSON.stringify(r.split));
      check('fuse 放 scene 槽报错', /cannot replace the scene render/.test(r.sceneErr), r.sceneErr);
      check('两个效果声明同名 uniform：报错并回滚', /already taken/.test(r.dupErr) && r.dupGone, r.dupErr);
      check('全部移除后清爽', r.clean === 0, String(r.clean));
    },
  },
  {
    name: '[守] 后期 fuse 像素：合成 pass 的输出与逐个 pass 串联（中间隔一个直通 pass）的像素近似一致，且确实改了画面',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, postEffects: E, ShaderPass, CopyShader } = threedogTest, p = engine.post, R = engine.renderer, gl = R.getContext();
        const sz = R.getSize(new THREE.Vector2()), W = 64, H = 48;
        R.setSize(W, H, false); p.enable('antialias', false);
        // 一个 4x4x4 的小 LUT：红绿互换并压暗，确保 LUT 路径真的被采样
        const n = 4, data = new Uint8Array(n * n * n * 4);
        for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let rr = 0; rr < n; rr++) {
          const i = ((b * n + g) * n + rr) * 4; data[i] = g / 3 * 230; data[i + 1] = rr / 3 * 230; data[i + 2] = b / 3 * 255; data[i + 3] = 255;
        }
        const tex = new THREE.Data3DTexture(data, n, n, n); tex.format = THREE.RGBAFormat; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.unpackAlignment = 1; tex.needsUpdate = true;
        const fx = () => [E.chromatic({ enabled: true, amount: 0.02 }), E.lut({ enabled: true, lut: tex, amount: 0.7, contrast: 1.2, saturation: 1.3, temperature: 0.3 }),
          E.vignette({ enabled: true, strength: 0.6 }), E.grain({ enabled: true, amount: 0.1, animated: false })];
        const read = () => { const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
        const run = hs => { p.render(0.016); const px = read(); for (const h of hs) h.remove(); return px; };
        const sep = (i, order) => p.add({ name: 'sep' + i, slot: 'ldr', order, enabled: true, create: () => new ShaderPass(CopyShader) });
        const fused = run(fx().map(e => p.add(e)));
        const fusedPasses = (() => { const hs = fx().map(e => p.add(e)); p.render(0.016); const c = p.composer.passes.length; for (const h of hs) h.remove(); return c; })();
        // 逐个：每个效果之间插一个非 fuse 的直通 pass，每个效果自成一组
        const hs = []; fx().forEach((e, i) => { hs.push(p.add(e)); hs.push(sep(i, e.order + 1)); });
        const chain = p.composer.passes.length; const serial = run(hs); const serialPasses = chain;
        const plain = (() => { p.render(0.016); return read(); })();
        let maxD = 0, sum = 0, vs = 0;
        for (let i = 0; i < fused.length; i++) { const d = Math.abs(fused[i] - serial[i]); maxD = Math.max(maxD, d); sum += d; vs += Math.abs(fused[i] - plain[i]); }
        R.setSize(sz.x, sz.y, false); p.setSize(sz.x, sz.y);
        return { maxD, mean: sum / fused.length, vsPlain: vs / fused.length, fusedPasses, serialPasses };
      });
      check('合成链只有 3 个 pass，逐个串联有 10 个（4 个效果 + 4 个直通 + 场景 + 输出）', r.fusedPasses === 3 && r.serialPasses === 10, JSON.stringify(r));
      check('合成输出与逐个 pass 串联近似一致（最大差 ≤ 4 级，平均差 < 0.5 级）', r.maxD <= 4 && r.mean < 0.5, JSON.stringify(r));
      check('效果确实改了画面（与不开后期的图平均差 > 3 级）', r.vsPlain > 3, JSON.stringify(r));
    },
  },
  {
    name: '[守] 描边模式：默认 depth 不多渲染场景；normal / both 渲一次法线并还原 scene；offLayer 让带该图层的物体没有线；dof 可建',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, outline, postEffects: E } = threedogTest, p = engine.post, R = engine.renderer, gl = R.getContext(), sc = engine.scene;
        const sz = R.getSize(new THREE.Vector2()), W = 160, H = 120, out = {};
        R.setSize(W, H, false); p.enable('antialias', false);
        const read = () => { const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
        const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++; return n; };
        const shot = (o, setup) => {
          const h = p.add(outline({ enabled: true, thickness: 2, strength: 1, color: 0x000000, ...o })), pass = h._impl;
          setup?.();
          p.render(0.016); const px = read(), info = { normal: !!pass.normalRT, mask: !!pass.maskRT, override: sc.overrideMaterial, bg: sc.background };
          h.remove(); return { px, info };
        };
        const bg0 = sc.background;
        const dark = shot({ strength: 0 }).px;   // 线条强度 0 = 没有线的基准图
        const depth = shot({});
        const normal = shot({ mode: 'normal' }), both = shot({ mode: 'both', wobble: 1.5 });
        out.depthEdges = diff(depth.px, dark); out.normalEdges = diff(normal.px, dark); out.bothEdges = diff(both.px, dark);
        out.depthInfo = [depth.info.normal, depth.info.mask]; out.normalInfo = [normal.info.normal, normal.info.mask];
        out.restored = [normal, both].every(s => s.info.override === null && s.info.bg === bg0);
        // offLayer：场景里所有物体都带图层 29，线应该全部消失
        const meshes = []; sc.traverse(o => { if (o.isMesh || o.isPoints) meshes.push(o); });
        const masks = meshes.map(m => m.layers.mask);
        const off = shot({ offLayer: 29 }, () => meshes.forEach(m => m.layers.enable(29)));
        meshes.forEach((m, i) => { m.layers.mask = masks[i]; });
        out.offEdges = diff(off.px, dark); out.offInfo = [off.info.normal, off.info.mask];
        out.costly = [outline().costly, outline({ mode: 'both' }).costly];
        out.badMode = (() => { try { p.add(outline({ enabled: true, mode: 'nope' })); return ''; } catch (e) { return e.message; } })();
        out.badGone = !p.get('outline');
        // dof 建得起来（它与 outline 同时开会被深度顺序检查拦下，规则本身在 render.mjs 里测）
        const dof = p.add(E.dof({ enabled: true, focus: 12 })); p.render(0.016); out.dofOk = !!dof._impl;
        out.dofCostly = E.dof().costly;
        dof.remove();
        R.setSize(sz.x, sz.y, false); p.setSize(sz.x, sz.y);
        return out;
      });
      check('depth 模式有线、不渲法线也不渲遮罩', r.depthEdges > 20 && !r.depthInfo[0] && !r.depthInfo[1], JSON.stringify(r));
      check('normal 和 both 模式渲了法线，both 带 wobble 也有线', r.normalInfo[0] && r.normalEdges >= 0 && r.bothEdges > 20, JSON.stringify(r));
      check('法线渲染后 scene.overrideMaterial / background 还原', r.restored);
      check('offLayer 把所有物体排除后，线（几乎）全消失，且只在设了 offLayer 时才渲遮罩', r.offEdges < r.depthEdges * 0.1 && r.offInfo[1] && !r.depthInfo[1], JSON.stringify(r));
      check('mode 非 depth 标 costly；depth 不标', r.costly[0] === false && r.costly[1] === true);
      check('mode 写错报错说明三个选项，且不留半加的效果', /'depth' \| 'normal' \| 'both'/.test(r.badMode) && r.badGone, r.badMode);
      check('dof 可建，标 costly', r.dofOk && r.dofCostly === true, JSON.stringify(r));
    },
  },
];
