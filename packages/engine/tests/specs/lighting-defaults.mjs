// [守] 引擎默认光照（demo 第 1 轮发现 1 和 13）。
// 一、昼夜亮度：装了 calendar + sky，夜里 MeshStandardMaterial 的地面必须明显比白天暗。
// 以前底线的中性房间环境图强度恒定 0.5，不跟时间走，夜里把整条街照得跟白天一样；现在房间图在天空下跟着 keyframes 的环境光列变暗。
// 守的是"不许绕开"：真渲染一张 PBR 地面量亮度（不是只读 scene.environmentIntensity），默认 keyframes 和风格自己很暗的夜 keyframes 各一次；
// describe().look.env.source 要说出是哪张图、跟不跟时间；游戏直接写 scene.environmentIntensity 时引擎让出、不再改它。
// 二、贴地阴影：sun 阴影的 bias 是阴影相机 0-1 深度里的量，深度范围是几百米，旧默认 -0.0006 约等于十几到二十几 cm，
// 离地 25 cm 以内的东西（角色身体、箱子底）在地上没有影子。守法：一块离地 10 cm 的薄板，只进阴影图不进画面，量它在地上的影子深浅；sky 和无 sky 底线各一次。

const PAGE = '/tests/threads/';

export const specs = [
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
    // 天空替每个游戏做的两个画面决定（tint 跟天空的光变暗、星星跟云量变暗）默认开，各自能在 look.sky dim 里关掉。
    // 守的是"不许绕开"：真读穹顶 uniform / 真渲染星空，开和关各一次
    name: '[guard] sky dim: dim.tint and dim.stars default on (tint dark at night, stars gone under full cloud) and each switches off',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all, { createEngine } = T, out = {};
        const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        const run = async (key, dim) => {
          const E = mk(createEngine, key);
          E.use(T.calendar({ time: '23:30' }), T.sky({ starDensity: 0.2, ...(dim ? { dim } : {}) }));
          await E.start();
          const m = E.mod('sky.tint', { owner: 'test', value: { color: 0xffffff, amount: 1, horizon: 1 } });
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
