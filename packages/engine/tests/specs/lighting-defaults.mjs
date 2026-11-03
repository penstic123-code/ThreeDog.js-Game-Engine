// [守] 引擎默认光照（demo 第 1 轮发现 1 和 13）。
// 一、昼夜亮度：装了 calendar + sky，夜里 MeshStandardMaterial 的地面必须明显比白天暗。
// 以前底线的中性房间环境图强度恒定 0.5，不跟时间走，夜里把整条街照得跟白天一样；现在房间图在天空下跟着 keyframes 的环境光列变暗。
// 守的是"不许绕开"：真渲染一张 PBR 地面量亮度（不是只读 scene.environmentIntensity），默认 keyframes 和风格自己很暗的夜 keyframes 各一次；
// describe().look.env.source 要说出是哪张图、跟不跟时间；游戏直接写 scene.environmentIntensity 时引擎让出、不再改它。
// 二、贴地阴影：sun 阴影的 bias 是阴影相机 0-1 深度里的量，sky 的深度范围 419 m，旧默认 -0.0006 等于 25 cm，
// 离地 25 cm 以内的东西（角色身体、箱子底）在地上没有影子。守法：一块离地 10 cm 的薄板，只进阴影图不进画面，量它在地上的影子深浅；sky 和无 sky 底线各一次。
import { ROOM_RADIANCE } from '../../render/lights.js';

const PAGE = '/tests/threads/';

export const specs = [
  {
    software: true,   // reads rendered pixels: stays on software rendering (same pixels on every machine)
    name: '[守] day-night light: with calendar + sky a MeshStandardMaterial ground is much darker at night than at noon (room env follows the sky)',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all, { createEngine } = T, out = {};
        // 地面亮度：从正上方往下看一块灰色 PBR 平面，读中心 8x8 像素的平均值（渲染目标里是线性值，比例照样可比）
        const lum = (E) => {
          const R = E.renderer, rt = new THREE.WebGLRenderTarget(16, 16), px = new Uint8Array(16 * 16 * 4);
          const cam = new THREE.PerspectiveCamera(40, 1, 0.5, 200); cam.position.set(0, 20, 0); cam.lookAt(0, 0, 0);
          R.setRenderTarget(rt); R.render(E.scene, cam); R.readRenderTargetPixels(rt, 0, 0, 16, 16, px); R.setRenderTarget(null); rt.dispose();
          let s = 0, n = 0; for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) { const i = (y * 16 + x) * 4; s += px[i] + px[i + 1] + px[i + 2]; n += 3; }
          return s / n;
        };
        const run = async (key, style) => {
          const E = mk(createEngine, key, style ? { style } : {});
          E.use(T.calendar({ time: '12:00' }), T.sky());
          E.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 })));
          await E.start();
          const at = (t) => { E.calendar.timeOfDay = t; E.step(1 / 30); E.step(1 / 30); return { lum: lum(E), env: E.scene.environmentIntensity, src: E.describe().look.env.source }; };
          const o = { noon: at(0.5), night: at(22 / 24), dawn: at(0.3) };
          // 游戏自己写强度：引擎让出（core/owned.js），之后不再按时间改
          E.scene.environmentIntensity = 0.77; at(0.5); o.taken = { env: E.scene.environmentIntensity, src: E.describe().look.env.source };
          E.dispose();
          return o;
        };
        out.neutral = await run('dn-neutral');
        // 和 demo 风格同形状：夜里太阳 0.06、环境光 0.1
        out.dark = await run('dn-dark', { sky: { keyframes: [
          [0, 0x0d1420, 0x1a2333, 0x7f95c0, 0.06, 0.1], [0.25, 0x6a88b0, 0xe7b998, 0xffc79a, 0.8, 0.35], [0.5, 0x6599d6, 0xb8d0e6, 0xfff4e2, 3.2, 0.34],
          [0.75, 0x4a5a8a, 0xf09868, 0xff9450, 0.9, 0.36], [0.83, 0x0f1828, 0x1e2838, 0x8095c0, 0.06, 0.1], [1, 0x0d1420, 0x1a2333, 0x7f95c0, 0.06, 0.1]] } });
        return out;
      });
      const n = r.neutral, d = r.dark;
      check('no style keyframes: the ground at 22:00 is under 35% of noon brightness', n.night.lum < n.noon.lum * 0.35 && n.noon.lum > 20, JSON.stringify(n));
      check('dark-night style keyframes: the ground at 22:00 is under 15% of noon brightness (the room env no longer lights it)', d.night.lum < d.noon.lum * 0.15, JSON.stringify(d));
      check('the room env intensity follows the day (its share of the ambient budget: night under a fifth of noon)', n.noon.env > 0 && n.night.env < n.noon.env * 0.2, JSON.stringify(n));
      check("describe().look.env.source says room + followsTime", n.noon.src?.value === 'room' && n.noon.src.followsTime === true && n.noon.src.writer === 'engine', JSON.stringify(n.noon.src));
      check('a game write of scene.environmentIntensity is kept (the engine yields) and describe says it no longer follows', r.neutral.taken.env === 0.77 && r.neutral.taken.src.followsTime === false, JSON.stringify(r.neutral.taken));
    },
  },
  {
    software: true,   // reads rendered pixels: stays on software rendering (same pixels on every machine)
    name: '[守] contact shadows: a thin caster 10 cm above the ground leaves a visible shadow under the default sun (sky and the no-sky baseline)',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all, { createEngine } = T, out = {};
        const run = async (key, withSky) => {
          const E = mk(createEngine, key);
          if (withSky) E.use(T.calendar({ time: '09:30' }), T.sky());
          const g = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 }));
          g.receiveShadow = true; E.scene.add(g);
          // 只进阴影图：colorWrite / depthWrite 关掉，主画面里看不见也不挡地面，阴影贴图用自己的深度材质照样画它
          const plate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.8), new THREE.MeshStandardMaterial({ colorWrite: false, depthWrite: false }));
          plate.castShadow = true; plate.position.set(0, 0.1, 0); E.scene.add(plate);
          await E.start(); E.step(1 / 30); E.step(1 / 30);
          const N = 48, R = E.renderer, rt = new THREE.WebGLRenderTarget(N, N), px = new Uint8Array(N * N * 4);
          const cam = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.5, 50); cam.position.set(0, 20, 0); cam.lookAt(0, 0, 0);
          R.setRenderTarget(rt); R.render(E.scene, cam); R.readRenderTargetPixels(rt, 0, 0, N, N, px); R.setRenderTarget(null); rt.dispose();
          let mn = 1e9, mx = 0; for (let i = 0; i < N * N; i++) { const v = px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]; mn = Math.min(mn, v); mx = Math.max(mx, v); }
          const o = { ratio: Math.round(mn / mx * 1000) / 1000, bias: E.lights.sun.shadow.bias, cast: E.lights.sun.castShadow };
          E.dispose();
          return o;
        };
        out.sky = await run('cs-sky', true);
        out.base = await run('cs-base', false);
        return out;
      });
      check('sky: the darkest ground under the plate is under 80% of lit ground (old bias: 98%, no shadow)', r.sky.cast && r.sky.ratio < 0.8, JSON.stringify(r.sky));
      check('no sky (render baseline): the same', r.base.cast && r.base.ratio < 0.8, JSON.stringify(r.base));
    },
  },
  {
    // 两个键各一个意思：env.intensity 永远是绝对的 scene.environmentIntensity，env.share 只是天空下环境图占 ambient 预算的份额。
    // 以前同一个键装了天空就悄悄变成"份额"（0.7 被读成 70%，还被夹到 1 以内、半球光被压低）。守的是"不许绕开"：游戏在天空下写的绝对值原样落地，
    // 份额只由 env.share 决定；去掉游戏的层就回到份额模式。
    name: '[guard] env keys: env.intensity is absolute with or without a sky (a game write under a sky lands as written); env.share is the sky budget split',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all, { createEngine } = T;
        const E = mk(createEngine, 'env-keys');
        E.use(T.calendar({ time: '12:00' }), T.sky());
        E.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(50, 50).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x888888 })));
        await E.start();
        const at = t => { E.calendar.timeOfDay = t; E.step(1 / 30); E.step(1 / 30); return { env: E.scene.environmentIntensity, hemi: E.lights.hemi.intensity, src: E.describe().look.env.source }; };
        const o = { share: { noon: at(0.5), night: at(22 / 24) } };
        const h = E.look.lights.set({ env: { intensity: 0.7 } }, { owner: 'mine' });
        o.abs = { noon: at(0.5), night: at(22 / 24) };
        h.remove();
        o.back = at(0.5);
        const hs = E.look.lights.set({ env: { share: 0.25 } }, { owner: 'split' });
        o.quarter = at(0.5);
        hs.remove();
        E.dispose();
        const N = mk(createEngine, 'env-keys-nosky');
        N.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
        await N.start(); N.look.lights.set({ env: { intensity: 0.7 } }); N.step(1 / 30);
        o.noSky = N.scene.environmentIntensity; N.dispose();
        return o;
      });
      const near = (a, b) => Math.abs(a - b) <= 0.02 * Math.max(Math.abs(a), Math.abs(b), 1e-6);
      check('default under a sky: share mode, the room map follows the day', r.share.noon.src.mode === 'share' && r.share.night.env < r.share.noon.env * 0.5, JSON.stringify(r.share));
      check('a game env.intensity 0.7 under a sky lands as 0.7 at noon and at night (no reinterpretation, no clamp), describe says absolute',
        r.abs.noon.env === 0.7 && r.abs.night.env === 0.7 && r.abs.noon.src.mode === 'absolute', JSON.stringify(r.abs));
      check('with the absolute map the hemisphere light keeps the whole ambient budget (not lowered for a share)', r.abs.noon.hemi > r.share.noon.hemi * 1.5, JSON.stringify({ abs: r.abs.noon.hemi, share: r.share.noon.hemi }));
      check('removing the game layer goes back to share mode', r.back.src.mode === 'share' && near(r.back.env, r.share.noon.env), JSON.stringify(r.back));
      check('env.share 0.25 halves the map against the default 0.5 share', near(r.quarter.env * 2, r.share.noon.env), JSON.stringify(r.quarter));
      check('without a sky env.intensity 0.7 is scene.environmentIntensity 0.7', r.noSky === 0.7, String(r.noSky));
    },
  },
  {
    // ROOM_RADIANCE 是 three 的 RoomEnvironment 的一个事实（环境强度 1 时白色漫反射球的平均线性亮度），天空下靠它把 ambient 换算成环境强度。
    // 这里真渲染一遍重新量：升级 three.js 后 RoomEnvironment 变了，这条会失败，而不是画面的补光悄悄变了
    name: '[guard] room radiance: a white Lambert sphere lit only by the room map at intensity 1 averages ROOM_RADIANCE (three RoomEnvironment unchanged)',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all, { createEngine } = T;
        const E = mk(createEngine, 'room-radiance');
        E.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
        await E.start(); E.step(1 / 30);
        const tex = E._roomEnv?.texture;
        if (!tex) { E.dispose(); return { none: true }; }
        const R = E.renderer, S = 64, rt = new THREE.WebGLRenderTarget(S, S, { type: THREE.FloatType }), px = new Float32Array(S * S * 4);
        const scene = new THREE.Scene(); scene.environment = tex; scene.environmentIntensity = 1;
        scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshLambertMaterial({ color: 0xffffff })));
        const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20), views = [], clear = new THREE.Color(); R.getClearColor(clear); const ca = R.getClearAlpha();
        R.setClearColor(0x000000, 0);
        for (const d of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
          cam.position.set(d[0] * 5, d[1] * 5, d[2] * 5); cam.up.set(d[1] ? 0 : 0, d[1] ? 0 : 1, d[1] ? 1 : 0); cam.lookAt(0, 0, 0);
          R.setRenderTarget(rt); R.clear(); R.render(scene, cam); R.readRenderTargetPixels(rt, 0, 0, S, S, px); R.setRenderTarget(null);
          let s = 0, n = 0;
          for (let i = 0; i < S * S; i++) if (px[i * 4 + 3] > 0.99) { s += 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]; n++; }
          views.push(n ? s / n : 0);
        }
        R.setClearColor(clear, ca); rt.dispose();
        E.dispose();
        return { views, mean: views.reduce((a, b) => a + b, 0) / views.length };
      });
      check('the room map was built (otherwise this guard measures nothing)', !r.none, JSON.stringify(r));
      check(`the measured mean (${r.mean?.toFixed(3)}) is within 5% of ROOM_RADIANCE ${ROOM_RADIANCE}`, Math.abs(r.mean - ROOM_RADIANCE) <= 0.05 * ROOM_RADIANCE, JSON.stringify(r));
    },
  },
  {
    // 天空替每个游戏做的两个画面决定（tint 跟天空的光变暗、星星跟云量变暗）默认开，各自能在 style.sky.dim 里关掉。
    // 守的是"不许绕开"：真读穹顶 uniform / 真渲染星空，开和关各一次
    name: '[guard] sky dim: style.sky.dim.tint and dim.stars default on (tint dark at night, stars gone under full cloud) and each switches off',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all, { createEngine } = T, out = {};
        const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        const run = async (key, dim) => {
          const E = mk(createEngine, key, { style: { sky: { starDensity: 0.2, ...(dim ? { dim } : {}) } } });
          E.use(T.calendar({ time: '23:30' }), T.sky());
          await E.start();
          const m = E.mod('look.sky.tint', { owner: 'test', value: { color: 0xffffff, amount: 1, horizon: 1 } });
          E.step(1 / 30); E.step(1 / 30);
          const top = lum(E.sky.uniforms.uTop.value);
          m.remove(); E.step(1 / 30);
          // stars: look straight up at the night dome, sum the brightness, clear sky against full cloud cover (uCloud is the weather's value)
          const R = E.renderer, S = 32, rt = new THREE.WebGLRenderTarget(S, S), px = new Uint8Array(S * S * 4);
          const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 5000); cam.position.set(0, 2, 0); cam.up.set(0, 0, 1); cam.lookAt(0, 100, 0);
          const shot = cloud => { E.uniforms.uCloud.value = cloud; R.setRenderTarget(rt); R.render(E.scene, cam); R.readRenderTargetPixels(rt, 0, 0, S, S, px); R.setRenderTarget(null);
            let n = 0; for (let i = 0; i < S * S; i++) if (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2] > 400) n++; return n; };
          const clear = shot(0), cloudy = shot(1);
          rt.dispose(); E.dispose();
          return { top, clear, cloudy };
        };
        out.on = await run('dim-on');
        out.off = await run('dim-off', { tint: false, stars: false });
        out.tintOnly = await run('dim-tint', { tint: false });
        return out;
      });
      check('default: a white sky.tint at 23:30 stays dark (dimmed by the sky\'s light)', r.on.top < 0.3, JSON.stringify(r.on));
      check('dim.tint false: the same tint keeps its full color at night', r.off.top > 0.9 && r.tintOnly.top > 0.9, JSON.stringify(r));
      check('default: stars show on a clear night and are gone under full cloud cover (a few bright pixels left: the moon)', r.on.clear > 50 && r.on.cloudy < r.on.clear * 0.1, JSON.stringify(r.on));
      check('dim.stars false: stars stay through full cloud cover; dim.tint false alone leaves the star dimming on', r.off.cloudy > r.off.clear * 0.9 && r.tintOnly.cloudy < r.tintOnly.clear * 0.1, JSON.stringify(r));
    },
  },
];
