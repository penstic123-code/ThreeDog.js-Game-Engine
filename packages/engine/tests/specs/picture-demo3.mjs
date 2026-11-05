// [守] 第 3 轮画面 demo 的引擎发现（2026-11-02，R3 / R4 / R5）。都是"不许绕开"：真渲染量亮度、读天空每帧真写出的颜色、读 describe 的原文。
// R3 雨夜发灰：weather 的 grey 走 sky.tint，以前朝一个固定灰色 lerp，夜里把深蓝天顶拉成亮灰（#0d1628 -> #6b6b6d）。
//    现在 tint 颜色按天空此刻的光（相对最亮一行 keyframe）变暗：雨夜必须比雨天正午暗得多，且不比晴夜亮太多；正午雨天和以前一样。
// R4 Phong 夜里像正午：房间环境图只跟环境光那一列走，不跟天空颜色走；风格夜里环境光列高、颜色深蓝时，
//    读 scene.environment 的 Standard / Lambert / Phong 被白色房间图照亮，Toon 不读环境图就暗了。守法：同一套沙漠风格 keyframes，
//    Phong 和 Toon 各渲一块地面，夜/正午亮度比要接近（以前 Phong 60%、Toon 21%）。
// R2 连拍第二张全黑：自适应分辨率在一帧画完之后才改像素比，canvas 一改尺寸绘制缓冲就被清空，浏览器拿去显示的是空帧。
//    守法：真 rAF 循环里让自适应降一次分辨率，在那一帧结束时（合成前）读 canvas 的绘制缓冲，必须是画好的画面而不是全 0。
// R5 describe 把后期效果的 0.25 / 1.12 / 0.05 显示成 0.3 / 1.1 / 0.1：一位小数四舍五入是给测量值的，设定值要原样显示（math.js rv）。
const PAGE = '/tests/threads/';
// 两套 demo 风格的 keyframes 原样搬来（列：[time, zenith, horizon, sun color, ambient]）
const DESERT = [
  [0.00, '#060a1e', '#22346a', '#6a8cff', 0.6], [0.22, '#0d1530', '#2a3355', '#9fb4e8', 0.4], [0.27, '#3a4a7a', '#e69a6a', '#ffb070', 0.45],
  [0.35, '#1d5cc4', '#d8e2e6', '#fff1d6', 0.55], [0.50, '#1048c0', '#dce6ec', '#fff6e4', 0.5], [0.66, '#1d5cc0', '#e6dcc8', '#ffe2b0', 0.55],
  [0.74, '#3a3d78', '#ff8a4a', '#ff9a50', 0.5], [0.79, '#1c1d48', '#a8505a', '#ff7040', 0.42], [0.84, '#070b22', '#1c2650', '#6a8cff', 0.6],
  [1.00, '#060a1e', '#22346a', '#6a8cff', 0.6]];
const TOWN = [
  [0.00, '#0b1424', '#1d2a3c', '#8fa6d0', 0.32], [0.22, '#24324e', '#6a6f86', '#ffb08a', 0.45], [0.30, '#7fa6cf', '#e8d6c4', '#ffe0bf', 0.9],
  [0.50, '#6f9fd4', '#dfe8ee', '#fff4e2', 1.15], [0.68, '#7c97c4', '#f0cfa8', '#ffc58a', 0.95], [0.74, '#4b5a8c', '#e89a6e', '#ff9a5c', 0.7],
  [0.80, '#1e2742', '#6b5068', '#c07a6a', 0.42], [0.90, '#0c1526', '#1f2b3e', '#8fa6d0', 0.32], [1.00, '#0b1424', '#1d2a3c', '#8fa6d0', 0.32]];

export const specs = [
  {
    software: true,   // reads rendered pixels: stays on software rendering (same pixels on every machine)
    name: '[守] lights R4: under a sky, Phong and Toon dim alike at night (the room env follows the sky light, not only the ambient column)',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async (kf) => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all, { createEngine } = T;
        // 从正上方看一块同色地面，读中心 8x8 像素均值（渲染目标里是线性值，比例可比）
        const lum = (E) => {
          const R = E.renderer, rt = new THREE.WebGLRenderTarget(16, 16), px = new Uint8Array(16 * 16 * 4);
          const cam = new THREE.PerspectiveCamera(40, 1, 0.5, 200); cam.position.set(0, 20, 0); cam.lookAt(0, 0, 0);
          R.setRenderTarget(rt); R.render(E.scene, cam); R.readRenderTargetPixels(rt, 0, 0, 16, 16, px); R.setRenderTarget(null); rt.dispose();
          let s = 0, n = 0; for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) { const i = (y * 16 + x) * 4; s += px[i] + px[i + 1] + px[i + 2]; n += 3; }
          return s / n;
        };
        const out = {};
        for (const [k, C] of Object.entries({ phong: THREE.MeshPhongMaterial, toon: THREE.MeshToonMaterial })) {
          const E = mk(createEngine, 'r4-' + k);
          E.use(T.calendar({ time: '12:00' }), T.sky({ keyframes: kf }));
          E.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new C({ color: 0x1fa69a })));
          await E.start();
          const at = (t) => { E.calendar.timeOfDay = t; E.step(1 / 30); E.step(1 / 30); return lum(E); };
          const noon = at(0.5), night = at(22 / 24);
          out[k] = { noon, night, ratio: night / noon };
          E.dispose();
        }
        return out;
      }, DESERT);
      const all = JSON.stringify(r);
      check('Phong is lit by day like Toon (the room env carries its share of the ambient budget, not a fill on top)', r.phong.noon > r.toon.noon * 0.7, all);
      // 以前 0.6 对 0.21；不定目标亮度，只守"两种材质跟同一份天光走"
      check('night / noon brightness of Phong is within 1.5x of Toon\'s (was 0.60 vs 0.21)', r.phong.ratio < r.toon.ratio * 1.5, all);
    },
  },
  {
    name: '[守] weather R3: the rain grey follows the sky light: a rainy night stays dark, rainy noon is unchanged by the fix',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async (kf) => {
        const { mk } = threedogThreads, T = threedogThreads.all, { createEngine } = T;
        const E = mk(createEngine, 'r3');
        E.use(T.calendar({ time: '21:30' }), T.sky({ keyframes: kf }), T.weather({ ...T.presets.weather.temperate, start: 'clear' }));
        await E.start();
        // 天空每帧真写出的天顶 / 地平线 / 雾色的亮度（线性）
        const L = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        const read = () => ({ top: L(E.sky.uniforms.uTop.value), hor: L(E.sky.uniforms.uHorizon.value), fog: L(E.uniforms.uSkyHorizon.value), grey: E.sky._tintNow.amount });
        const o = {};
        for (const [name, t] of [['noon', 0.5], ['night', 21.5 / 24]]) {
          E.calendar.timeOfDay = t;
          E.weather.set('clear', { seconds: 0 }); for (let i = 0; i < 5; i++) E.step(1 / 30); o[name + 'Clear'] = read();
          E.weather.set('rain', { seconds: 0 }); for (let i = 0; i < 5; i++) E.step(1 / 30); o[name + 'Rain'] = read();
        }
        E.dispose();
        return o;
      }, TOWN);
      const all = JSON.stringify(r);
      check('rain does tint the sky (grey > 0)', r.nightRain.grey > 0 && r.noonRain.grey > 0, all);
      // 以前雨夜天顶亮度是晴夜的 ~20 倍；现在 tint 跟天光走，雨夜不能比晴夜亮多少，且远暗于雨天正午
      check('a rainy night zenith / fog is no brighter than 1.5x the clear night', r.nightRain.top < r.nightClear.top * 1.5 && r.nightRain.fog < r.nightClear.fog * 1.5, all);
      check('a rainy night is far darker than a rainy noon (fog under 15%)', r.nightRain.fog < r.noonRain.fog * 0.15, all);
      check('at the brightest row the rain still greys the sky (rainy noon horizon differs from clear noon)', Math.abs(r.noonRain.hor - r.noonClear.hor) > 0.02, all);
    },
  },
  {
    software: true,   // reads rendered pixels: stays on software rendering (same pixels on every machine)
    name: '[守] adaptive resolution R2: the frame in which the render scale changes is drawn at the new size, never presented blank',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => new Promise(res => {
        const a = engine.adaptive, R = engine.renderer, gl = R.getContext(), keep = { on: a.on, target: a.target };
        engine.setPixelRatio(a.max);
        // 过了启动宽限期、预算 1 ms：下一个判定窗口一定判成过载、降一档
        Object.assign(a, { on: true, paused: false, age: 10, t: 0, costs: [], gaps: [], target: 1000, cooldown: 0, lowered: false });
        const pr0 = R.getPixelRatio(), prev = engine._afterTick; let frames = 0;
        engine._afterTick = () => {
          prev?.(); frames++;
          const pr = R.getPixelRatio();
          if (pr === pr0 && frames < 400) return;
          // 这一帧的绘制缓冲（合成前、同一个任务里读）：16x16 个采样点里有几个不是全 0
          const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(4);
          let lit = 0;
          for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { gl.readPixels(Math.floor((x + 0.5) * w / 16), Math.floor((y + 0.5) * h / 16), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); if (px[0] + px[1] + px[2] > 0) lit++; }
          engine._afterTick = prev; Object.assign(a, keep); engine.setPixelRatio(a.max);
          res({ paused: engine.halted, pr0, pr, frames, lit, size: [w, h], bufferMatches: w === R.domElement.width });
        };
      }));
      const all = JSON.stringify(r);
      check('adaptive resolution lowered the scale during the run', r.pr < r.pr0, all);
      check('the frame of the change is drawn (sampled pixels are not cleared to 0)', r.lit > 200, all);
    },
  },
  {
    name: '[守] describe R5: set values show as set (post 0.25 / exposure 1.125 are not rounded to one decimal)',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { vignette } = threedogTest.postEffects;
        engine.haltLoop();
        const fx = engine.post.add(vignette({ enabled: true, strength: 0.25 }));
        const x0 = engine.renderer.toneMappingExposure; engine.renderer.toneMappingExposure = 1.125;
        engine.step(1 / 30);
        const d = engine.describe(), text = engine.describeText({ full: true });
        const o = { render: d.render.post.find(x => x.name === 'vignette')?.params.strength,
          exposure: d.render.exposure.value, text: text.split('\n').filter(l => /^(post|renderer):/.test(l)).join(' | ') };
        fx.remove(); engine.renderer.toneMappingExposure = x0;
        return o;
      });
      const all = JSON.stringify(r);
      check('describe().render.post value is 0.25', r.render === 0.25, all);
      check('describe text says strength=0.25 and exposure 1.125', /strength=0\.25\b/.test(r.text) && /exposure 1\.125\b/.test(r.text) && r.exposure === 1.125, all);
    },
  },
];
