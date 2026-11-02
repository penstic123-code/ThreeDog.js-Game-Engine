// [守] shot 的画面检查（packages/tools/style/look.mjs）：真引擎、真渲染，跑和 threedog shot 同一个页内探针 probeLook，再用同一个 lookHints 出提示。
// 守的是"不许绕开"：不是喂假数字给 lookHints，而是让探针自己把阴影强度调 0 对比像素，
// 所以 bias 把影子推没了这种"设置说有、画面没有"的矛盾，只有真量到才会报；正常场景不许报任何矛盾。
import { probeLook, lookHints, lookNumbers } from '@threedog/tools/look';

const PAGE = '/tests/threads/';

export const specs = [
  {
    name: '[守] look check: a shadowed scene gives no contradiction; the same scene with a bias that pushes the shadows away names bias; probe restores what it touched',
    url: PAGE,
    async run({ check, ev }) {
      await ev(src => { window.__probeLook = (0, eval)('(' + src + ')'); }, probeLook.toString());
      const r = await ev(async () => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all, { createEngine } = T;
        const E = mk(createEngine, 'look-check');
        E.renderer.setSize(320, 180, false);
        E.use(T.calendar({ time: '10:00' }), T.sky());
        const g = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.9 }));
        g.receiveShadow = true; E.scene.add(g);
        // 几个立方体投影到地上，相机斜着看：影子占画面一块，正常时量得到
        for (const [x, z] of [[-3, 0], [0, 2], [3, -1], [1, -4]]) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 3, 1.6), new THREE.MeshStandardMaterial({ color: 0xb08060 }));
          b.position.set(x, 1.5, z); b.castShadow = true; b.receiveShadow = true; E.scene.add(b);
        }
        await E.start();
        E.step(1 / 30); E.step(1 / 30);
        // 从太阳对面看：影子落在箱子朝相机的一侧（顺着太阳看，影子全躲在箱子后面，量不到也不算矛盾）
        const aim = () => { E.camera.position.set(-10, 10, -14); E.camera.lookAt(0, 0, 0); E.camera.updateMatrixWorld(); };
        aim();
        const out = {};
        out.normal = await window.__probeLook(E, { time: false });
        // 顺着太阳看：影子都在箱子后面，量不到是正常的，不许报矛盾
        E.camera.position.set(8, 9, 12); E.camera.lookAt(0, 0, 0); E.camera.updateMatrixWorld();
        out.behind = await window.__probeLook(E, { time: false });
        // camera inside a box (the demo's first shot stood inside a building): the probe names that box; from outside it names nothing
        E.camera.position.set(-3, 1.5, 0); E.camera.lookAt(0, 1.5, 5); E.camera.updateMatrixWorld();
        out.inside = await window.__probeLook(E, { time: false });
        aim();
        const was = E.lights.sun.shadow.bias, tod = E.calendar.timeOfDay;
        E.look.shadow.set({ bias: -0.05 });   // 阴影深度 0-1 里的 -0.05，乘上几百米的深度范围就是十几米：影子全没了
        E.step(1 / 30); aim();
        // scene.background 是引擎建场景时写的底色灰 #8c8c8c（core/Engine.js），穹顶盖在它上面：不许当成"夜里还亮着的东西"报出来。
        // 不能自己赋一个新 Color 进去：那算游戏接管背景，天空会让出并藏起穹顶，底色就真露出来了
        out.biased = await window.__probeLook(E, { time: true });
        E.sky.dome.visible = false;   // 穹顶拿掉，底色真露出来了，才该点名
        out.bare = await window.__probeLook(E, { time: true });
        E.sky.dome.visible = true;
        out.restored = { bias: E.lights.sun.shadow.bias, intensity: E.lights.sun.shadow.intensity, tod: E.calendar.timeOfDay === tod, view: E.debug.viewState?.().mode ?? 'off' };
        out.biasSet = E.lights.sun.shadow.bias !== was;
        for (const k of ['normal', 'behind', 'inside', 'biased', 'bare']) delete out[k].pixels;
        E.dispose();
        return out;
      });
      const N = { luminance: 0.5, saturation: 0.2, contrast: 0.15, range: 0.4, overexposed: 0, dark: 0 };
      const hn = lookHints({ numbers: N, probe: r.normal }), hb = lookHints({ numbers: N, probe: r.biased });
      check('normal scene: shadows are measured (area above 1%) and no contradiction hint', r.normal.shadows?.area > 0.01 && !hn.some(h => h.kind === 'contradiction'),
        JSON.stringify({ shadows: r.normal.shadows, hints: hn }));
      check('[guard] camera inside a box: the probe names it (camera-inside); from outside, no mesh is named',
        /^Mesh /.test(r.inside.cameraInside?.name ?? '') && !r.normal.cameraInside && lookHints({ numbers: N, probe: r.inside }).some(h => h.id === 'camera-inside'),
        JSON.stringify({ inside: r.inside.cameraInside, normal: r.normal.cameraInside ?? null }));
      check('[guard] key against fill: the sun off and the fill off each darken the shot (two measured renders), and the hint states both shares',
        r.normal.key && r.normal.key.noKey < r.normal.key.base && r.normal.key.noFill < r.normal.key.base && lookHints({ numbers: N, probe: r.normal }).some(h => h.id === 'light-balance' && /% of the lit brightness/.test(h.text)),
        JSON.stringify(r.normal.key));
      check('sun behind the camera: shadows hidden behind the casters are no contradiction', !lookHints({ numbers: N, probe: r.behind }).some(h => h.kind === 'contradiction'), JSON.stringify(r.behind.shadows));
      check('[guard] scene.background is named as a night source only when it shows: covered by the sky dome no, dome hidden yes',
        r.biased.time && !r.biased.time.at.midnight.background && r.bare.time?.at.midnight.background?.value === '#8c8c8c',
        JSON.stringify({ covered: r.biased.time?.at?.midnight, bare: r.bare.time?.at?.midnight }));
      const sh = hb.find(h => h.id === 'shadow-invisible');
      check('bias -0.05: the probe measures no shadow and the hint names look.shadow bias with its value', r.biasSet && r.biased.shadows?.area < 0.003 && /look\.shadow bias -0\.05/.test(sh?.text ?? ''),
        JSON.stringify({ shadows: r.biased.shadows, hints: hb }));
      check('hints state facts, never a target value ("should", "<", "target")', ![...hn, ...hb].some(h => /\bshould\b|\btarget\b| < \d/.test(h.text)), JSON.stringify(hb));
      check('the probe puts back shadow intensity, the time of day and the debug view', r.restored.intensity === 1 && r.restored.tod && r.restored.view === 'off', JSON.stringify(r.restored));
      check('lookNumbers: contrast and range of a two-tone picture', (() => { const px = new Uint8Array(4 * 4); px.set([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]); const n = lookNumbers(px); return n.contrast === 0.5 && n.range === 1; })());
    },
  },
  {
    // 为什么：逐灯开关那一段以前把投影的灯整个跳过（!casters.includes），游戏自己的投影灯（带影子的路灯、手电）
    // 点不亮东西或者晃眼，都不会被量，提示也就不会有。投影只决定它进不进阴影那一段，不该决定量不量它。
    name: '[守] look check: a game light that casts shadows is still turned off and measured (light-no-effect)',
    url: PAGE,
    async run({ check, ev }) {
      await ev(src => { window.__probeLook = (0, eval)('(' + src + ')'); }, probeLook.toString());
      const r = await ev(async () => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all, { createEngine } = T;
        const E = mk(createEngine, 'look-check-caster');
        E.renderer.setSize(320, 180, false);
        const g = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.9 }));
        g.receiveShadow = true; E.scene.add(g);
        const lamp = new THREE.PointLight(0xffffff, 1e-6, 30, 2); lamp.name = 'castLamp'; lamp.castShadow = true; lamp.position.set(0, 3, 0); E.scene.add(lamp);
        await E.start();
        E.step(1 / 30);
        E.camera.position.set(0, 6, 8); E.camera.lookAt(0, 0, 0); E.camera.updateMatrixWorld();
        const p = await window.__probeLook(E, { time: false });
        delete p.pixels;
        E.dispose();
        return { lights: p.lights, error: p.error ?? null };
      });
      const lamp = r.lights.find(l => l.name === 'castLamp');
      const h = lookHints({ numbers: { luminance: 0.5, saturation: 0.2, contrast: 0.15, range: 0.4, overexposed: 0, dark: 0 }, probe: { lights: r.lights } });
      check('the shadow-casting lamp is measured and named as changing no pixel', !!lamp && !lamp.changed && h.some(x => x.id === 'light-no-effect' && x.text.includes('castLamp')), JSON.stringify(r));
    },
  },
];
