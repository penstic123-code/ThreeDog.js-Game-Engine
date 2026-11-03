// 0.3 发布前最后一批（第 4 轮真实 demo 复测）引擎运行时修复的守护测试。每条对应一个条目（W5 / W6 / D1 / G2；G11 的守护在 packages/tools/tests/bridge.mjs），
// 测的是"不许绕开"的那条路：例如 lightPool 的 dusk 必须走 lookGlow 的同一条日光曲线，而不是自己再算一遍。

import { ROOM_RADIANCE } from '../../render/lights.js';

export const specs = [
  {
    // W5：lightPool 的光源可选跟随昼夜（dusk），与 look.materials.glow 共用 render/lookGlow.js 的曲线；默认不跟随（白天也亮的灯照样亮）
    name: 'r4 W5: lightPool source with dusk follows glow\'s daylight curve (off at noon, lit at night); without dusk it stays lit',
    url: '/night-lights.html?threedog-headless',
    async run({ check, ev }) {
      const r = await ev(() => { try {
        const { THREE } = window.nightLightsTest, P = engine.lightPool, cam = engine.camera.position;
        // 参照物：一条 glow 规则（night 1 = 写进去的就是夜晚系数本身），灯的强度必须是 50 x 这个系数——同一条曲线，不是另算一条
        const ref = new THREE.MeshStandardMaterial({ emissive: 0xffffff, name: 'r4-ref' });
        engine.scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), ref));
        engine.look.materials.glow('r4-ref', { night: 1, owner: 'r4' });
        const halo = new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 2 });
        const lamp = P.add({ x: cam.x, y: cam.y + 1, z: cam.z }, { name: 'r4-lamp', intensity: 50, priority: 100, dusk: true, glow: halo });
        const torch = P.add({ x: cam.x, y: cam.y + 1, z: cam.z - 1 }, { name: 'r4-torch', intensity: 50, priority: 100 });
        // dusk 0 = on only while daylight is 0 (no fade); the glow rule accepts the same 0
        const darkHalo = new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 2 });
        const dark = P.add({ x: cam.x, y: cam.y + 1, z: cam.z + 1 }, { name: 'r4-dark', intensity: 50, priority: 200, dusk: 0, glow: darkHalo });
        let glow0 = null; try { engine.look.materials.glow('r4-ref0', { night: 1, dusk: 0, owner: 'r4-0' }).remove(); } catch (err) { glow0 = String(err.message); }
        const at = t => {
          engine.calendar.timeOfDay = t; engine.step(1);
          const d = engine.calendar.daylight;
          return { d, lamp: lamp.light ? +lamp.light.intensity.toFixed(2) : 0, lampW: lamp.weight, torch: torch.light ? +torch.light.intensity.toFixed(2) : 0,
            halo: halo.emissiveIntensity, want: +(50 * ref.emissiveIntensity).toFixed(2), dark: dark.weight, darkHalo: darkHalo.emissiveIntensity };   // 灯池权重 1 = 满亮；替身发光跟同一条曲线
        };
        const night = at(0.95), noon = at(0.5), dusk = at(0.27);
        let bad = null; try { P.add({ x: 0, y: 0, z: 0 }, { dusk: 2 }); } catch (err) { bad = String(err.message); }
        return { night, noon, dusk, bad, glow0 };
      } catch (err) { return { err: String(err.stack) }; } });
      if (r.err) { check('runs without error', false, r.err); return; }
      check('at night the dusk lamp holds a light at intensity x glow\'s night factor', r.night.lampW === 1 && Math.abs(r.night.lamp - r.night.want) < 0.05 && r.night.want > 0, JSON.stringify(r.night));
      check('at noon the dusk lamp is off (no light, stand-in dimmed with it), the plain torch still lit', r.noon.lamp === 0 && r.noon.lampW === 0 && r.noon.halo === 0 && r.noon.torch > 0, JSON.stringify(r.noon));
      check('dusk 0: lit when daylight is 0, off while any daylight is left (dusk) and at noon; glow takes dusk 0 too',
        r.night.d === 0 && (r.night.dark === 1 || r.night.darkHalo === 2) && r.dusk.d > 0 && r.dusk.dark === 0 && r.dusk.darkHalo === 0 && r.noon.dark === 0 && r.glow0 === null, JSON.stringify({ night: r.night, dusk: r.dusk, glow0: r.glow0 }));
      check('a dusk outside 0..1 throws naming the forms', /dusk is true/.test(r.bad ?? ''), String(r.bad));
    },
  },
  {
    // W6：夜里下雨 / 阴天时星星要被天气的云量压暗（天空与天气的协调：dome 着色器读 uCloud，并且星星在画出来的云后面）
    software: true,   // reads rendered pixels: stays on software rendering (same pixels on every machine)
    name: 'r4 W6: night stars dim with the weather cloud cover (rain shows far fewer bright star pixels than clear)',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(() => { try {
        const cal = engine.calendar, cam = engine.camera;
        cal.dayLength = Infinity; cal.timeOfDay = 0.0;   // 午夜：uNight = 1
        engine.weather.setAuto(false);
        // 直接用 renderer 画一帧仰望天顶（绕开相机控制器和后期），同一个任务里读像素：只比较天穹本身
        const stars = name => {
          engine.weather.set(name, { seconds: 0.01 }); engine.step(0.5, { render: false });
          cam.position.set(0, 50, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 1000, 0); cam.updateMatrixWorld();
          engine.renderer.render(engine.scene, cam);
          const src = engine.renderer.domElement, c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
          const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data, L = [];
          for (let i = 0; i < d.length; i += 4) L.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
          // 星星 = 孤立的亮点：比左右上下四个邻居都亮很多（云、月亮、天空渐变都是平滑的，不算）
          const W = c.width, H = c.height; let bright = 0;
          for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
            const v = L[y * W + x] - 40;
            if (v > L[y * W + x - 1] && v > L[y * W + x + 1] && v > L[(y - 1) * W + x] && v > L[(y + 1) * W + x]) bright++;
          }
          return { bright };
        };
        const clear = stars('clear'), rain = stars('rain');
        return { clear, rain, cloud: engine.uniforms.uCloud.value };
      } catch (err) { return { err: String(err.stack) }; } });
      if (r.err) { check('runs without error', false, r.err); return; }
      check('a clear night shows stars', r.clear.bright > 0, JSON.stringify(r));
      check('a rainy night shows at most a fifth of the clear night bright star pixels', r.rain.bright * 5 <= r.clear.bright, JSON.stringify(r));
    },
  },
  {
    // D1：用 look.post.add（或插件文件）加进来的效果就是开着的（引擎规则 enabled ?? true，对所有效果一条），工厂不能再默认 enabled: false 让它静默失效；
    // style check 数"开着几个"用同一条规则
    name: 'r4 D1: a listed post effect is on (every factory, engine and style check agree); enabled: false lists it off',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const P = await import('@threedog/post-effects');
      const names = ['lut', 'grain', 'vignette', 'chromatic', 'dof', 'ao', 'outline', 'bloom'];
      const offByDefault = names.filter(n => P[n]().enabled === false);
      check('no effect factory lists itself off by default', offByDefault.length === 0, offByDefault.join(', '));
      check('enabled: false still lists one off', names.every(n => P[n]({ enabled: false }).enabled === false));
      // style check 用同一条规则数开着的效果：packages/tools/tests/style-tools.mjs
      const r = await ev(() => { const h = engine.look.post.add(threedogTest.postEffects.outline()); const on = engine.post.get('outline').enabled; h.remove?.(); return { on }; });
      check('look.post.add(outline()) is on in the engine', r.on === true, JSON.stringify(r));
    },
  },
  {
    // G2：hud.counter 同一个部件也能显示纯文字状态（时间、任务步骤）；没有 value 只显示标签，不再显示 "0"；其它类型抛错
    name: 'r4 G2: hud.counter shows text values and a label without value (no "0"); a number keeps "n / max"',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        const text = id => [...document.querySelectorAll('.threedog-hud-counter')].map(el => el.textContent).find(t => t.includes(id)) ?? null;
        engine.hud.counter('r4-clock', { label: 'Clock', value: '08:30' });
        engine.hud.counter('r4-step', { label: 'Step: find the key' });
        engine.hud.counter('r4-fish', { label: 'Fish', value: 2, max: 5 });
        const out = { clock: text('Clock'), step: text('Step'), fish: text('Fish') };
        try { engine.hud.counter('r4-bad', { value: { n: 1 } }); } catch (err) { out.bad = err.message; }
        for (const id of ['r4-clock', 'r4-step', 'r4-fish']) engine.hud.remove(id);
        return out;
      });
      check('text value shows as text', r.clock === 'Clock 08:30', JSON.stringify(r));
      check('no value shows the label alone', r.step === 'Step: find the key', JSON.stringify(r));
      check('a number with max still shows "2 / 5"', r.fish === 'Fish 2 / 5', JSON.stringify(r));
      check('an object value throws naming number or text', /number \(a count\) or text/.test(r.bad ?? ''), String(r.bad));
    },
  },
  {
    // 底光：天空下风格的 ambient 列是全部漫反射补光预算，room 环境图和半球光分摊它（look.lights env.share = 环境图那份），
    // 不能再在半球光之上额外加一层。守的是"和"：环境图折成半球光单位（x PI x ROOM_RADIANCE）+ 半球光 = ambient 列 x 天空色亮度
    name: 'r4 fill: under a sky the room map and the hemisphere light share one ambient budget (env.share = the map share)',
    url: '/night-lights.html?threedog-headless',
    async run({ check, ev }) {
      const r = await ev(async (ROOM_RADIANCE) => { try {
        const s = engine.scene, h = engine.lights.hemi, lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        const at = (t, share) => {
          engine.look.lights.set({ env: { share } }); engine.calendar.timeOfDay = t; engine.step(0.2);
          const room = s.environment && s.environmentIntensity;   // 0 份额时没有环境图
          return { hemi: h.intensity, env: room ? s.environmentIntensity : 0, envAsHemi: (room ? s.environmentIntensity : 0) * Math.PI * ROOM_RADIANCE, hemiLum: lum(h.color) };
        };
        const noon = at(0.5, 0.5), night = at(0.95, 0.5), noonAllHemi = at(0.5, 0), noonAllMap = at(0.5, 1);
        return { noon, night, noonAllHemi, noonAllMap };
      } catch (err) { return { err: String(err.stack) }; } }, ROOM_RADIANCE);   // render/lights.js 的同一个数（node 这边导入，传进页面）
      if (r.err) { check('runs without error', false, r.err); return; }
      const near = (a, b) => Math.abs(a - b) <= 0.03 * Math.max(a, b, 1e-6);
      const total = x => x.hemi * x.hemiLum + x.envAsHemi;   // 半球光单位下的漫反射补光总量
      const budget = r.noonAllHemi.hemi * r.noonAllHemi.hemiLum;   // 份额 0：半球光拿全部 = ambient 列 x 天空色亮度
      check('share 0.5 at noon: map and hemisphere light split the budget evenly', near(r.noon.envAsHemi, r.noon.hemi * r.noon.hemiLum), JSON.stringify(r.noon));
      check('the sum is the same budget whatever the share (0, 0.5, 1): the map is never a fill on top', near(total(r.noon), budget) && near(total(r.noonAllMap), budget) && r.noonAllMap.hemi < 1e-6, JSON.stringify(r));
      check('at night the map follows the budget down with the hemisphere light', near(r.night.envAsHemi, r.night.hemi * r.night.hemiLum) && r.night.envAsHemi < r.noon.envAsHemi * 0.2, JSON.stringify(r.night));
    },
  },
  {
    // G10：UI 显示计时（toast 停留多久）跟着驱动页面的时钟走：游戏里是墙钟，无头页面是 step 推进的时间。守：step 够长 toast 就没了，不够就还在
    name: 'r4 G10: on a headless page toasts expire with engine.step time (not wall clock)',
    url: '/night-lights.html?threedog-headless',
    async run({ check, ev }) {
      const r = await ev(() => {
        const n = () => document.querySelectorAll('.threedog-toast').length;
        const ui = engine.ui.get('toast');
        for (let i = 0; i < 3; i++) ui.show({ text: 'r4 toast ' + i, kind: 'info', ms: 2000 });
        const shown = n();
        engine.step(1, { render: false }); const mid = n();
        engine.step(1.5, { render: false }); const after = n();
        return { headless: engine.headless, shown, mid, after };
      });
      check('the page is a headless (step-driven) page', r.headless === true, JSON.stringify(r));
      check('toasts are still there after 1 s of stepped time', r.shown === 3 && r.mid === 3, JSON.stringify(r));
      check('and gone after their 2 s (+ the fade) of stepped time, with no wall-clock wait', r.after === 0, JSON.stringify(r));
    },
  },
];
