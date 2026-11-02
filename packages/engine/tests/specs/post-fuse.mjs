// 后期合成（fuse）与描边新模式：合成 pass 的数量与重组、合成输出与逐个 pass 串联的像素对比、描边 normal / both / offLayer。
// 在 perf city 页面里临时加效果，用完全部移除；画布临时缩小到几十像素再还原。

export const specs = [
  {
    name: '[守] 后期 fuse：ldr 里连续启用的 fuse 效果合成 1 个 pass；开关 / 改参数 / 移除后重新合成；chromatic 读输入所以另起一组；fuse 不能放 scene 槽',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { lut, grain, vignette, chromatic } = threedogTest.postEffects, p = engine.post, L = engine.look.post, out = {};
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        p.setAntialias(false);
        const hs = [chromatic({ enabled: true }), lut({ enabled: true }), vignette({ enabled: true, strength: 0.5 }), grain({ enabled: true })].map(e => L.add(e));
        p.render(0.016);
        const fused = () => p.composer.passes.filter(x => x.items);
        out.passes4 = p.composer.passes.length; out.fused4 = fused().length; out.items4 = fused()[0]?.items.length;
        L.set({ 'grain.enabled': false });
        out.items3 = fused()[0]?.items.length; out.fused3 = fused().length;
        L.set({ 'vignette.strength': 0.9 });
        out.uniform = fused()[0].material.uniforms.uVigStrength.value;
        hs[1].remove();
        out.afterRemove = fused().map(x => x.items.map(i => i.name).join('+'));
        // 改 order 让 chromatic 排在 vignette 后面：它读输入，必须另起一个 pass
        L.set({ 'chromatic.enabled': false }); const late = L.add({ ...chromatic({ enabled: true, order: 50 }), name: 'chromatic2' });
        p.render(0.016);
        out.split = fused().map(x => x.items.map(i => i.name).join('+'));
        late.remove(); hs[2].remove(); hs[3].remove(); hs[0].remove();
        out.sceneErr = err(() => L.add({ name: 'fz', slot: 'scene', fuse: { glsl: '' } }));
        out.dupErr = err(() => { const a = L.add(vignette({ enabled: true })); L.add({ name: 'v2', slot: 'ldr', enabled: true, fuse: { uniforms: { uVigStrength: 'float' }, glsl: '' } }); });
        L._clear('game');
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
        const { THREE, postEffects: E, ShaderPass, CopyShader } = threedogTest, p = engine.post, L = engine.look.post, R = engine.renderer, gl = R.getContext();
        const sz = R.getSize(new THREE.Vector2()), W = 64, H = 48;
        R.setSize(W, H, false); p.setAntialias(false);
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
        const sep = (i, order) => L.add({ name: 'sep' + i, slot: 'ldr', order, enabled: true, create: () => new ShaderPass(CopyShader) });
        const fused = run(fx().map(e => L.add(e)));
        const fusedPasses = (() => { const hs = fx().map(e => L.add(e)); p.render(0.016); const c = p.composer.passes.length; for (const h of hs) h.remove(); return c; })();
        // 逐个：每个效果之间插一个非 fuse 的直通 pass，每个效果自成一组
        const hs = []; fx().forEach((e, i) => { hs.push(L.add(e)); hs.push(sep(i, e.order + 1)); });
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
        const { THREE, outline, postEffects: E } = threedogTest, p = engine.post, L = engine.look.post, R = engine.renderer, gl = R.getContext(), sc = engine.scene;
        const sz = R.getSize(new THREE.Vector2()), W = 160, H = 120, out = {};
        R.setSize(W, H, false); p.setAntialias(false);
        const read = () => { const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
        const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++; return n; };
        const shot = (o, setup) => {
          const h = L.add(outline({ enabled: true, thickness: 2, strength: 1, color: 0x000000, ...o })), pass = p.composer.passes.find(x => 'normalRT' in x);
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
        out.badMode = (() => { try { L.add(outline({ enabled: true, mode: 'nope' })); return ''; } catch (e) { return e.message; } })();
        out.badGone = !p.get('outline');
        // dof 建得起来（与 outline 同时开见下一项）
        const n0 = p.composer.passes.length, dof = L.add(E.dof({ enabled: true, focus: 12 })); p.render(0.016); out.dofOk = p.composer.passes.length > n0;
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
  {
    name: '[守] 风格里的 bloom / ao / outline 就是 post-effects 导出的那份（同一种 pass、同样的 slot / order）；dof 与 outline 同开像素不变',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, lowpoly } = threedogTest, p = engine.post, L = engine.look.post, R = engine.renderer, gl = R.getContext(), sz = R.getSize(new THREE.Vector2()), W = 96, H = 72, out = {};
        // 钉住色调：渲染基线（AgX、中性房间环境 0.5）在每个风格包下都开着，会改掉每个像素；下面 dof 的黄金值取自基线之前，
        // 守的是"dof 让出深度前后同一份效果"，不是基线长什么样，所以关掉基线再比（重新取值就只能证明"和现在的自己一样"）。
        // 另外基线下有一处已知差异：scene.background 是纯色时，直接渲染不做色调映射，走 post 链时 OutputPass 会把它 AgX 一遍，
        // 不开 MSAA 时下面 dof 的 blurred 会把整片天空的色差也算进去（2357 里约 2248 是背景），不是 dof 糊得多
        // 色调曲线是纯 three.js（引擎只在创建时写一次），直接改 renderer.toneMapping，结束时还原
        const tm0 = R.toneMapping; R.toneMapping = THREE.NoToneMapping;
        const pin = [{ remove: () => { R.toneMapping = tm0; } }, engine.look.lights.set({ env: { intensity: 0 } }, { owner: 'pixelPin' })];
        R.setSize(W, H, false); p.setAntialias(false);
        // 自己搭一个固定的场景（城市页面里的东西每次载入位置不同），隐藏原有内容
        const sc = engine.scene, cam = engine.camera, hidden = sc.children.map(c => [c, c.visible]); hidden.forEach(([c]) => { c.visible = false; });
        const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: 0xcc6644 })), ball = new THREE.Mesh(new THREE.SphereGeometry(1.2, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffeeaa, emissiveIntensity: 0.6 }));
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x66aa55 })); floor.rotation.x = -Math.PI / 2;
        const lamp = new THREE.DirectionalLight(0xffffff, 3); lamp.position.set(5, 8, 3); const amb = new THREE.AmbientLight(0xffffff, 0.5);
        box.position.set(-1.5, 1, 0); ball.position.set(1.8, 1.2, -1.5);
        const mine = [box, ball, floor, lamp, amb]; sc.add(...mine);
        const bg0 = sc.background, fog0 = sc.fog; sc.background = new THREE.Color(0x88aacc); sc.fog = null;
        const cp = cam.position.clone(), cq = cam.quaternion.clone(); cam.position.set(0, 4, 9); cam.lookAt(0, 1, 0); cam.updateMatrixWorld();
        // dof 与 outline 同时开：dof 把场景深度写进自己的输出（gl_FragDepth），outline 在它后面仍读到真深度；线的位置只取决于深度，所以有无 dof 应一致
        const Ef = threedogTest.postEffects, bytes = () => { const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
        const dist = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++; return n; };
        const frame = fx => { const hs = []; try { fx.forEach(e => hs.push(L.add(e))); p.render(0.016); return { px: bytes(), n: p.composer.passes.length }; } catch (e) { return { err: e.message }; } finally { hs.forEach(h => h.remove()); } };
        const dofE = () => Ef.dof({ enabled: true, focus: 9, range: 1, falloff: 5, maxBlur: 4 }), lineE = s => Ef.outline({ enabled: true, thickness: 1, strength: s, color: 0x000000 });
        out.dof = {};
        for (const aa of [false, true]) {
          p.setAntialias(aa);
          p.render(0.016); const plain = bytes(), d = frame([dofE()]), off = frame([lineE(0)]), on = frame([lineE(1)]), dOff = frame([dofE(), lineE(0)]), dOn = frame([dofE(), lineE(1)]);
          out.dof[aa] = { err: dOn.err ?? dOff.err ?? d.err, hash: d.px && (() => { let h = 2166136261; for (const v of d.px) h = Math.imul(h ^ v, 16777619); return h >>> 0; })(),
            blurred: dist(d.px, plain), linesPlain: dist(on.px, off.px), linesWithDof: dOn.px && dist(dOn.px, dOff.px), passes: [d.n, on.n, dOn.n] };
        }
        pin.forEach(h => h.remove());
        sc.remove(...mine); sc.background = bg0; sc.fog = fog0; hidden.forEach(([c, v]) => { c.visible = v; }); cam.position.copy(cp); cam.quaternion.copy(cq);
        R.setSize(sz.x, sz.y, false); p.setSize(sz.x, sz.y);
        // 结构对照，不比像素：风格写的 bloom() / ao() / outline() 每次调用都是新对象（create 是新箭头函数），所以比它们造出的 pass 是不是
        // post-effects 那一种、slot / order / costly / needsDepth 一致。像素哈希只能守一次性迁移，换一台机器或升级 three 就失效
        const E = threedogTest.postEffects, ctx = { scene: sc, camera: cam, width: 8, height: 8 };
        const passOf = e => { const pass = e.create({ ...ctx, params: { ...e.params } }); const C = pass.constructor; pass.dispose?.(); return C; };
        const meta = e => [e.name, e.slot, e.order, e.costly === true, e.needsDepth === true].join();
        out.meta = lowpoly.post.map(e => [meta(e), meta(E[e.name]())]);
        out.sameClass = lowpoly.post.map(e => [e.name, typeof E[e.name] === 'function' && passOf(e) === passOf(E[e.name]())]);
        return out;
      });
      const dd = r.dof, goldDof = { false: '3391731882', true: '342418655' };
      check('dof 与 outline 同时开不报错（不论 MSAA），链是 4 个 pass（场景 + dof + outline + 输出），没有多出的 pass', [false, true].every(a => !dd[a].err && dd[a].passes.join() === '3,3,4'), JSON.stringify(dd));
      check('dof 后面的 outline 画出的线与没有 dof 时一样多（位置只取决于深度）', [false, true].every(a => dd[a].linesPlain > 20 && Math.abs(dd[a].linesWithDof - dd[a].linesPlain) <= dd[a].linesPlain * 0.02), JSON.stringify(dd));
      check('dof 单开的像素与让出深度之前逐字节相同，且确实糊了画面', [false, true].every(a => String(dd[a].hash) === goldDof[a] && dd[a].blurred > 100), JSON.stringify(dd));
      check('风格的 bloom / ao / outline 造出的 pass 与 post-effects 导出的同一种', r.sameClass.length === 3 && r.sameClass.every(([, ok]) => ok), JSON.stringify(r.sameClass));
      check('slot / order / costly / needsDepth 与 post-effects 的定义一致', r.meta.length === 3 && r.meta.every(([a, b]) => a === b), JSON.stringify(r.meta));
    },
  },
  {
    // render/PostFX.js _direct: a Color background (or none: the clear color) is a clear, which three never tone-maps; the composer tone-maps it in OutputPass
    name: '[guard] a THREE.Color background or the clear color is the same pixel with effects on / off and MSAA on / off (tone-mapped on both paths)',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, ShaderPass, CopyShader } = threedogTest, p = engine.post, L = engine.look.post, R = engine.renderer, S = engine.scene, gl = R.getContext();
        const sz = R.getSize(new THREE.Vector2()), aa = p._aa, bg = S.background, W = 32, H = 24;
        const shown = S.children.filter(o => o.visible); for (const o of shown) o.visible = false;
        R.setSize(W, H, false); p.setSize(W, H);
        const col = new THREE.Color(0x88ccff); S.background = col;
        const px = () => { p.render(0.016); const b = new Uint8Array(4); gl.readPixels(W >> 1, H >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); return [...b.slice(0, 3)]; };
        const out = { tone: R.toneMapping };
        p.setAntialias(false); out.direct = px(); out.directActive = p.active;
        p.setAntialias(true); out.msaa = px();
        const h = L.add({ name: 'bgcopy', slot: 'ldr', enabled: true, create: () => new ShaderPass(CopyShader) });
        p.setAntialias(false); out.effect = px();
        p.setAntialias(true); out.both = px();
        h.remove();
        const tm = R.toneMapping; R.toneMapping = THREE.NoToneMapping; p.setAntialias(false); out.noTone = px(); R.toneMapping = tm;
        // no background: the renderer's clear color, same four combinations
        const cc = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha(); S.background = null; R.setClearColor(col, 1);
        out.clear = [];
        for (const [fx, msaa] of [[false, false], [false, true], [true, false], [true, true]]) {
          const hh = fx ? L.add({ name: 'bgcopy', slot: 'ldr', enabled: true, create: () => new ShaderPass(CopyShader) }) : null;
          p.setAntialias(msaa); out.clear.push(px()); hh?.remove();
        }
        R.setClearColor(cc, ca); S.background = col;
        { const c = col.clone().convertLinearToSRGB(); out.raw = [c.r, c.g, c.b].map(v => Math.round(v * 255)); }
        out.restored = S.background === col;
        S.background = bg; for (const o of shown) o.visible = true;
        p.setAntialias(aa); R.setSize(sz.x, sz.y, false); p.setSize(sz.x, sz.y);
        return out;
      });
      const d = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
      check('Color background: direct (no effects, MSAA off) = MSAA on = an effect on = both (within 2 levels)', !r.directActive && d(r.direct, r.msaa) <= 2 && d(r.direct, r.effect) <= 2 && d(r.direct, r.both) <= 2, JSON.stringify(r));
      check('no background (clear color): direct = MSAA on = an effect on = both = the Color background pixel (within 2 levels)', r.clear.every(c => d(c, r.direct) <= 2), JSON.stringify(r.clear));
      check('it is tone-mapped on the direct path too (differs from the raw sRGB color; tone mapping off gives the raw color); scene.background is restored', r.tone !== 0 && d(r.direct, r.raw) > 4 && d(r.noTone, r.raw) <= 1 && r.restored, JSON.stringify(r));
    },
  },
  {
    // the check that keeps games off the internal field: what post.object() / targets() hand out is the composer the engine renders with,
    // and the engine still owns it (a chain change rebuilds passes over whatever the game did)
    name: '[guard] post.object() / targets(): the live composer and its render targets, read-only; the engine still rebuilds the chain',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { ShaderPass, CopyShader } = threedogTest, p = engine.post, L = engine.look.post, out = {};
        const h = L.add({ name: 'readcopy', slot: 'ldr', enabled: true, create: () => new ShaderPass(CopyShader) });
        p.render(0.016);
        const c = p.object(), t = p.targets();
        out.same = !!c && c === p.composer && t.renderTarget1 === c.renderTarget1 && t.renderTarget2 === c.renderTarget2 && t.readBuffer === c.readBuffer;
        out.frozen = Object.isFrozen(t);
        out.hasPass = c.passes.some(x => x instanceof ShaderPass);
        c.passes = [];                         // a game write: the next chain change puts the engine's list back
        h.remove(); const h2 = L.add({ name: 'readcopy2', slot: 'ldr', enabled: true, create: () => new ShaderPass(CopyShader) });
        out.rebuilt = c.passes.length > 1; h2.remove();
        return out;
      });
      check('object() is the composer the engine renders with; targets() its render targets (frozen view)', r.same && r.frozen, JSON.stringify(r));
      check('the chain shows the added pass; a game write to passes is replaced on the next chain change (engine owns it)', r.hasPass && r.rebuilt, JSON.stringify(r));
    },
  },
];
