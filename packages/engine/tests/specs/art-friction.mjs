// 一次美术测试（实验游戏，已删）找出的引擎摩擦：根因修复各配一条不许绕开的检查。
// [守] 无头引擎 start 之后才开始的加载（加植物种类、换密度、传送），不调 step 也要加载完，stateApplied 要等它：
//      headless 没有实时循环，step() 是同步的、工人线程的结果在任务之间才回来，所以只能由引擎自己在加载没完时跑"加载帧"（core/headlessLoad.js）。
//      谁把 start() 里的 startHeadlessLoad 或 stateApplied 里的 headlessSettled 去掉，这条就红（截图会停在"waiting for module terrain"）。
export const specs = [
  {
    name: '无头加载：start 之后加的植物种类不调 step 也会加载完，stateApplied 等它，游戏时间不动（threads 测试页）',
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { all, mk } = threedogThreads, T = all.THREE;
        const E = mk(all.createEngine, 'headless-late-veg');
        E.use(all.terrain({ height: () => 0, viewChunks: 3 }), all.vegetation());
        await E.start();
        const t0 = E.time.now('real'), before = E.stateApplied;
        // start 之后才加：所有区块重排（terrain 不再 ready），以前无头页面没人跑帧，就一直卡住
        E.vegetation.define('late-box', { geometry: new T.BoxGeometry(0.3, 0.6, 0.3), positions: [[1, 1], [-2, 3], [4, -1], [0, -5]] });
        const right = { applied: E.stateApplied, terrainReady: E.terrain.readyAt({ x: 0, z: 0 }) };
        const t1 = performance.now();
        while (!E.stateApplied && performance.now() - t1 < 30000) await new Promise(res => setTimeout(res, 50));
        let inst = 0; for (const c of E.terrain.chunks.values()) inst += E.vegetationDraw.mesh(c, 'late-box')?.count ?? 0;
        const out = { before, right, after: E.stateApplied, elapsed: E.time.now('real') - t0, inst, stats: { ...E.terrain.stats } };
        E.dispose();
        return out;
      });
      check('start 后 stateApplied 为真；加种类后马上变假（在重新加载）', r.before && !r.right.applied && !r.right.terrainReady, JSON.stringify(r.right));
      check('不调 step 也加载完：stateApplied 回到真，新种类已长出来', r.after && r.inst === 4 && r.stats.visible > 0, JSON.stringify({ after: r.after, inst: r.inst, stats: r.stats }));
      check('加载帧不推进游戏时间（headless 的游戏时间只由 step 推进）', r.elapsed === 0, String(r.elapsed));
    },
  },
  {
    // [守] 补丁 GLSL 读了 vThreedogWorld 却没写 needs：引擎补上提供它的 'world'（render/patches.js withProviders），而不是编译报 undeclared identifier。
    //      所有入口（applyEffects、模块的 patches）都经过 patchMaterial，所以只在这一处补；去掉它这条就红。
    name: '着色器补丁：读 vThreedogWorld 不写 needs 也自动带上 world 补丁并能编译；写了 needs 的同样（threads 测试页）',
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { all } = threedogThreads, T = all.THREE, E = window.engine;
        const compiles = m => {
          const mesh = new T.Mesh(new T.PlaneGeometry(1, 1), m); E.renderer.compile(mesh, E.camera);
          const prog = E.renderer.properties.get(m).currentProgram;
          return !!prog && (!prog.diagnostics || prog.diagnostics.runnable);
        };
        const glsl = 'diffuseColor.rgb *= step(-1000.0, vThreedogWorld.z);';
        const bare = all.applyEffects(new T.MeshLambertMaterial(), { clouds: false, patches: [{ name: 'farTint', slot: 'color', glsl }] });
        const said = all.applyEffects(new T.MeshLambertMaterial(), { clouds: false, patches: [{ name: 'farTint', slot: 'color', needs: { patches: ['world'] }, glsl }] });
        const none = all.applyEffects(new T.MeshLambertMaterial(), { clouds: false, patches: [{ name: 'plain', slot: 'color', glsl: 'diffuseColor.rgb *= 0.9;' }] });
        return { bare: all.materialPatches(bare), bareOk: compiles(bare), said: all.materialPatches(said), saidOk: compiles(said), none: all.materialPatches(none) };
      });
      check('没写 needs：world 补在它前面，能编译', r.bare.join() === 'world,farTint' && r.bareOk, JSON.stringify(r));
      check('写了 needs：一样，能编译', r.said.join() === 'world,farTint' && r.saidOk, JSON.stringify(r));
      check('不读 vThreedogWorld 的补丁不多带 world', r.none.join() === 'plain', r.none.join());
    },
  },
  {
    // [守] detail 的 projection: 'screen' 按屏幕像素铺纹理：远处也一样粗（插画、印刷感要的），world 投影的颗粒到远处会被 fade 收掉。
    //      真渲染一张远处的平面比像素起伏：screen 有颗粒、world 没有；把 screen 换回按世界坐标采样这条就红。
    software: true,   // reads rendered pixels: stays on software rendering (same pixels on every machine)
    name: "detail projection: 'screen'：颗粒按屏幕像素，远处不缩不淡；world 投影远处被 fade 掉（threads 测试页，真渲染读像素）",
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { all } = threedogThreads, T = all.THREE, E = window.engine, R = E.renderer;
        const spread = projection => {
          const m = all.applyEffects(new T.MeshBasicMaterial({ color: 0x808080 }), { clouds: false, detail: { noise: 'grain', projection, strength: 0.8 } });
          const scene = new T.Scene(), cam = new T.PerspectiveCamera(40, 1, 1, 5000);
          const plane = new T.Mesh(new T.PlaneGeometry(4000, 4000), m); plane.position.z = -2000; scene.add(plane);   // 2 km 外、正对相机
          const rt = new T.WebGLRenderTarget(32, 32), px = new Uint8Array(32 * 32 * 4);
          R.setRenderTarget(rt); R.render(scene, cam); R.readRenderTargetPixels(rt, 0, 0, 32, 32, px); R.setRenderTarget(null); rt.dispose();
          let lo = 255, hi = 0; for (let i = 0; i < px.length; i += 4) { lo = Math.min(lo, px[i]); hi = Math.max(hi, px[i]); }
          return { range: hi - lo, scale: m.uniforms?.uDetailScale?.value };
        };
        return { screen: spread('screen'), world: spread('world') };
      });
      check('screen：远处平面上颗粒还在（像素有起伏）', r.screen.range >= 20, JSON.stringify(r));
      check('world：同一处颗粒被 fade 收掉（对照，说明上面不是碰巧）', r.world.range <= 4, JSON.stringify(r));
    },
  },
];
