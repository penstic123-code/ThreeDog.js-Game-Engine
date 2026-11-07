// [guard] The pixel ratio has one owner (core/scene/pixelRatio.js), and pixelSize is a mode of it. Art pixel widths are read off real screenshots at each display
// scale, so a fractional ratio or a rounded CSS size shows as a second width. The control draws with the old devicePixelRatio / k by hand and must come out uneven at
// 150%, so the measure is known to bite. Real WebGPU needs a GPU browser: the run says which backend it got, and a run that fell back is not counted as WebGPU.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '@threedog/tools/browser';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PAGE = '/tests/pixel-size/index.html';
const SCALES = [1, 1.25, 1.5, 2];
// a size no k divides, in CSS pixels, so both the fractional scale and the leftover at the edge are in play
const SIZE = { width: 803, height: 451 };
// deviceScaleFactor emulation lays the page out in whole CSS pixels and scales the result, so the leftover cannot be exact there (a real display lays out in real
// pixels, and the real-scale spec below runs SIZE): these sizes have no leftover at any scale in SCALES
const EVEN = { 2: { width: 960, height: 544 }, 3: { width: 960, height: 540 } };
const J = JSON.stringify;

/** engine sources that call a renderer's own setPixelRatio / setDrawingBufferSize, apart from the owner and the two named receivers */
function outsideWriters() {
  const hits = [];
  const walk = d => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.js')) readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
        // e. / engine. is the engine's entry (settings, a hint's text); c.setPixelRatio is the EffectComposer following the renderer (postWebGL.js)
        if (/(?<![\w.])(?!e\.|c\.|engine\.)[\w.]+\.(setPixelRatio|setDrawingBufferSize)\(/.test(l) && !/^\s*(\/\/|\*)/.test(l)) hits.push(`${relative(ROOT, p).replaceAll('\\', '/')}:${i + 1}`);
      });
    }
  };
  for (const d of ['core', 'modules', 'render', 'ui']) walk(join(ROOT, d));
  return hits.filter(h => !h.startsWith('core/scene/pixelRatio.js'));
}

async function open(browser, origin, query, scale, size = SIZE, init) {
  const ctx = await browser.newContext(scale ? { viewport: size, deviceScaleFactor: scale } : { viewport: null });
  const page = await ctx.newPage();
  if (init) await page.addInitScript(init);
  await page.goto(`${origin}${PAGE}?${query}`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
  return page;
}

/** Repaint at the current buffer, then read the widths off a screenshot of what the page shows */
async function measure(page) {
  await page.evaluate(async () => { await frames(4); paint(); await frames(4); });
  const shot = (await page.screenshot({ type: 'png' })).toString('base64');
  return page.evaluate(async b64 => ({ ...(await readWidths(b64)), buffer: [engine.renderer.domElement.width, engine.renderer.domElement.height],
    ratio: engine.renderer.getPixelRatio(), backend: engine.describe().renderer?.backend ?? null, dpr: devicePixelRatio }), shot);
}
const even = (m, k) => Object.keys(m.widths).join() === String(k) && Object.keys(m.heights).join() === String(k) && m.gray === 0;
const fills = (m, k) => Math.abs(m.buffer[0] * k - m.shot[0]) < k && Math.abs(m.buffer[1] * k - m.shot[1]) < k;

/** Each scale in a browser of its own: the flag is per launch. A route that fell back says so, and that row proves nothing about WebGPU */
async function realScales(check, origin, route, prefer) {
  for (const scale of SCALES) {
    const b = await launchBrowser({ prefer, args: [`--force-device-scale-factor=${scale}`, `--window-size=${SIZE.width},${SIZE.height}`] });
    try {
      const p = await open(b, origin, `route=${route}&k=3`, null), m = await measure(p);
      console.log(`  real scale ${scale} ${route} (${m.backend}, ${b.render?.kind}): dpr ${m.dpr} widths ${J(m.widths)} heights ${J(m.heights)} gray ${m.gray} buffer ${m.buffer} shot ${m.shot}`);
      check(`real scale ${scale}, ${route} on ${m.backend}: every art pixel 3 wide and tall, none blended`, m.dpr === scale && even(m, 3) && fills(m, 3), J(m));
      if (route === 'webgpu' && m.backend !== 'webgpu') console.log('  NOT real WebGPU: this browser fell back, so this row says nothing about the WebGPU backend');
    } finally { await b.close(); }
  }
}

export const specs = [
  {
    name: '[guard] pixel ratio: one owner; pixelRatio.js is the only file that writes it',
    url: PAGE + '?k=3',
    software: true,
    async run({ check, ev }) {
      const w = outsideWriters();
      check('no engine file writes the renderer ratio except core/scene/pixelRatio.js', w.length === 0, w.join(' '));
      const r = await ev(async () => {
        const t = f => { try { f(); return null; } catch (e) { return `${e.code ?? ''} ${e.message}`; } }, R = engine.renderer, a = engine.adaptive, pr = () => R.getPixelRatio();
        const c = () => document.createElement('canvas'), o = { lights: false, ui: { loading: false }, urlState: false, headless: true };
        const out = { start: pr(), k: engine.describe().render.scale.pixelSize, on: a.on };
        out.both = t(() => createEngine({ ...o, canvas: c(), pixelRatio: 1, pixelSize: 2 }));
        out.bothAdaptive = t(() => createEngine({ ...o, canvas: c(), adaptiveResolution: true, pixelSize: 2 }));
        out.badOption = [1.5, 0, -2, '3'].map(v => t(() => createEngine({ ...o, canvas: c(), pixelSize: v })));
        out.badCall = [1.5, 0, -2, '3', undefined].map(v => t(() => engine.setPixelSize(v)));
        out.ratioCall = t(() => engine.setPixelRatio(1)); out.afterRatioCall = pr();
        // adaptive: heavy frames and an explicit on, the same drive the adaptive tests use
        const w0 = console.warn; console.warn = () => {};
        Object.assign(a, { target: 60, t: 0, age: 10, cooldown: 0 }); a.on = true;
        for (let s = 0; s < 8; s += 1 / 60) engine._adapt(1 / 60, 40, false, true);
        console.warn = w0;
        out.adaptive = { on: a.on, ratio: pr(), lowered: a.lowered };
        // the tier learned in start(): the ratio stays, the top comes back with setPixelSize(null)
        const max0 = a.max; tierRatio(engine, 'low'); out.tier = { ratio: pr(), max: a.max }; a.max = max0;
        // photo: art pixels stay, nothing moves
        const buf = () => [R.domElement.width, R.domElement.height].join();
        const b0 = buf(), shot = engine.photo.take({ scale: 2 }), img = new Image(); img.src = shot.url; await img.decode();
        out.photo = { w: img.width, h: img.height, b0, b1: buf(), ratio: pr() };
        // a direct three.js write: the engine yields, then setPixelSize takes it back
        R.setPixelRatio(0.5); engine._resize();
        out.yielded = { writer: engine.describe().owned['view.pixelRatio'].writer, ratio: pr(), pad: R.domElement.style.paddingRight };
        engine.setPixelSize(3); out.back = { writer: engine.describe().owned['view.pixelRatio'].writer, ratio: pr() };
        const mine = engine.autoView.manual('pixelRatio'); out.manual = t(() => engine.setPixelSize(2)); mine.remove(); engine.setPixelSize(3);
        // off: what the game asked for returns
        engine.setPixelSize(null);
        out.off = { k: engine.describe().render.scale.pixelSize, ratio: pr(), max: a.max, on: a.on, style: R.domElement.getAttribute('style') };
        return out;
      });
      console.log('  pixelSize numbers:', J(r));
      check('createEngine({ pixelRatio, pixelSize }) throws pixel-conflict and names both', /^pixel-conflict.*pixelRatio.*pixelSize.*Keep/.test(r.both), r.both);
      check('adaptiveResolution: true with pixelSize throws and names both', /^pixel-conflict.*adaptiveResolution.*pixelSize/.test(r.bothAdaptive), r.bothAdaptive);
      check('a wrong k in createEngine throws naming pixelSize', r.badOption.every(m => /pixelSize/.test(m)), J(r.badOption));
      check('a wrong k in setPixelSize throws naming it', r.badCall.every(m => /^engine-misuse.*setPixelSize/.test(m)), J(r.badCall));
      check('engine.setPixelRatio throws while pixelSize is on and the ratio stays', /^pixel-conflict.*setPixelSize\(null\)/.test(r.ratioCall) && r.afterRatioCall === r.start, r.ratioCall);
      check('adaptive stays off and leaves the ratio under heavy frames, even after a.on = true', r.adaptive.on === false && r.adaptive.ratio === r.start && !r.adaptive.lowered, J(r.adaptive));
      check('a tier change leaves the ratio', r.tier.ratio === r.start, J(r.tier));
      check('a photo keeps the art pixels: picture = buffer, ratio and buffer unchanged', r.photo.b0 === r.photo.b1 && `${r.photo.w},${r.photo.h}` === r.photo.b0 && r.photo.ratio === r.start, J(r.photo));
      check('a direct renderer.setPixelRatio wins, and the engine stops fitting the canvas', r.yielded.writer.startsWith('three') && r.yielded.ratio === 0.5 && r.yielded.pad === '', J(r.yielded));
      check('setPixelSize after a direct write takes the ratio back', r.back.writer === 'engine' && r.back.ratio === r.start, J(r.back));
      check("setPixelSize after autoView.manual('pixelRatio') is a conflict naming the hand-back", /^pixel-conflict.*manual\('pixelRatio', false\)/.test(r.manual), r.manual);
      check('setPixelSize(null): the ratio before, adaptive as asked, no padding or pixelated left', r.off.k === null && r.off.ratio === r.off.max && r.off.on === true && !/padding|pixelated/.test(r.off.style ?? ''), J(r.off));
    },
  },
  {
    name: '[guard] pixelSize: settings, and a game without it behaves as before',
    url: PAGE + '?k=2&settings=1',
    async run({ check, ev, page }) {
      const r = await ev(() => { const s = engine.settings; return { omit: ['pixelRatio', 'adaptive'].every(k => s._omit.has(k)), ratio: engine.renderer.getPixelRatio(), want: devicePixelRatio / 2 }; });
      check('under pixelSize the settings leave the ratio and adaptive rows out', r.omit && r.ratio === r.want, J(r));
      const plain = await open(page.context().browser(), new URL(page.url()).origin, 'plain=1&settings=1', 1.5);
      const p = await plain.evaluate(() => { const c = engine.renderer.domElement, s = engine.describe().render.scale; return { ratio: engine.renderer.getPixelRatio(), style: c.getAttribute('style'), k: s.pixelSize, adaptive: engine.adaptive.on, on: engine.settings._omit.has('pixelRatio'), buffer: c.width, css: c.clientWidth }; });
      await plain.context().close();
      check('without pixelSize: the default ratio, no padding or pixelated, adaptive on, settings rows there', p.ratio === 1.5 && p.k === null && p.adaptive && !p.on && !/padding|pixelated/.test(p.style ?? '') && p.buffer === Math.floor(p.css * 1.5), J(p));
    },
  },
  {
    name: '[guard] pixelSize: every art pixel has one width at scales 1, 1.25, 1.5, 2 on WebGL (and the WebGPU route on the same browser)',
    notRealWebGPU: 'opens its own pages per backend; the real WebGPU one is the spec below',
    url: PAGE + '?k=3',
    serial: true,
    software: true,
    async run({ check, page }) {
      const browser = page.context().browser(), origin = new URL(page.url()).origin;
      for (const [route, k, extra] of [['webgl', 3, ''], ['webgl', 2, ''], ['webgl', 3, '&post=1'], ['webgpu', 3, ''], ['webgpu', 3, '&fallback=webgl']]) {
        for (const scale of SCALES) {
          const p = await open(browser, origin, `route=${route}&k=${k}${extra}`, scale, EVEN[k]), m = await measure(p);
          console.log(`  ${route}${extra} (${m.backend}) k=${k} scale ${scale}: widths ${J(m.widths)} heights ${J(m.heights)} gray ${m.gray} buffer ${m.buffer} shot ${m.shot}`);
          check(`${route}${extra} (${m.backend}) k=${k} at ${scale}: every art pixel is ${k} wide and tall, none blended, and they fill the canvas`, even(m, k) && fills(m, k), J(m));
          await p.context().close();
        }
      }
      // the control: the same measure on the old hand calculation
      const hand = await open(browser, origin, 'hand=1&k=3', 1.5), h = await measure(hand);
      await hand.context().close();
      console.log(`  control devicePixelRatio / k at 1.5: widths ${J(h.widths)}`);
      check('control: devicePixelRatio / k by hand comes out uneven at 150%', !even(h, 3), J(h));
    },
  },
  {
    name: '[guard] pixelSize: a real display scale (browser flag, no emulation) with leftover pixels, on WebGL, and a fractional box',
    url: PAGE + '?k=3',
    serial: true,
    software: true,
    async run({ check, page }) {
      const origin = new URL(page.url()).origin;
      await realScales(check, origin, 'webgl', 'software');
      const b = await launchBrowser({ args: ['--force-device-scale-factor=1.5', `--window-size=${SIZE.width},${SIZE.height}`] });
      try {
        const p = await open(b, origin, 'k=3&frac=1', null), m = await measure(p);
        const box = await p.evaluate(() => ({ device: engine._deviceBox, css: engine.renderer.domElement.clientWidth, pad: engine.renderer.domElement.style.paddingRight }));
        console.log(`  fractional box at 1.5: widths ${J(m.widths)} heights ${J(m.heights)} ${J(box)} buffer ${m.buffer}`);
        check('a fractional CSS box at 1.5: the browser measured it, and every art pixel is 3 wide', !!box.device && even(m, 3), J({ m, box }));
      } finally { await b.close(); }
    },
  },
  {
    name: '[guard] pixelSize: a real display scale with leftover pixels, on real WebGPU where the GPU allows it',
    notRealWebGPU: 'launches the real GPU itself, in every full run',
    url: PAGE + '?k=3',
    serial: true,
    software: true,
    async run({ check, page }) { await realScales(check, new URL(page.url()).origin, 'webgpu', 'gpu'); },
  },
  {
    name: '[guard] pixelSize: page zoom, another display and a resize keep every art pixel one width; a photo in ratio mode restores',
    url: PAGE + '?k=3',
    serial: true,
    software: true,
    async run({ check, page }) {
      const browser = page.context().browser(), origin = new URL(page.url()).origin;
      // headless Chromium cannot change the scale of a running page (a CDP override leaves devicePixelRatio at 1), so this drives the query the browser would fire
      const p = await open(browser, origin, 'k=3', 1, EVEN[3], () => {
        const real = window.matchMedia.bind(window); window.mediaWatch = [];
        window.matchMedia = q => { const m = real(q); if (q.includes('resolution')) { const add = m.addEventListener.bind(m); m.addEventListener = (t, fn, o) => { window.mediaWatch.push({ q, fn, o }); add(t, fn, o); }; } return m; };
      });
      for (const scale of [1.5, 1.25, 2, 1]) {   // more than one change: the query has to register again after each
        const r = await p.evaluate(s => {
          const w = window.mediaWatch, last = w.at(-1), n = w.length;
          Object.defineProperty(window, 'devicePixelRatio', { value: s, configurable: true });
          last.fn();
          const now = w.at(-1);
          return { added: w.length - n, query: now.q, once: now.o.once, signal: now.o.signal === engine.signal, ratio: engine.renderer.getPixelRatio(), buffer: engine.renderer.domElement.width };
        }, scale);
        console.log(`  display change to ${scale}: ${J(r)}`);
        check(`moved to scale ${scale}: ratio ${scale} / 3, the buffer follows, and the next query is registered on engine.signal`,
          r.added === 1 && r.query === `(resolution: ${scale}dppx)` && r.once && r.signal && Math.abs(r.ratio - scale / 3) < 1e-9 && r.buffer === 960 * scale / 3, J(r));
      }
      await p.context().close();
      const z = await open(browser, origin, 'k=3', 1.5);
      for (const size of [{ width: 640, height: 360 }, { width: 1000, height: 500 }]) {
        await z.setViewportSize(size);
        const m = await measure(z);
        console.log(`  resized to ${size.width}x${size.height} at 1.5: widths ${J(m.widths)} heights ${J(m.heights)}`);
        check(`resized to ${size.width}x${size.height} at 1.5: one width`, even(m, 3) && fills(m, 3), J(m));
      }
      // the photo after a resize: art pixels still come back on the screen
      await z.evaluate(() => engine.photo.take());
      const m = await measure(z);
      check('after a photo the screen is the same art pixels', even(m, 3) && fills(m, 3), J(m));
      await z.context().close();
      const plain = await open(browser, origin, 'plain=1', 1.5);
      const r = await plain.evaluate(async () => {
        const R = engine.renderer, a = R.getPixelRatio(), b = R.domElement.width, s = engine.photo.take({ scale: 2 }), img = new Image(); img.src = s.url; await img.decode();
        const back = { ratio: R.getPixelRatio(), buffer: R.domElement.width };
        R.setPixelRatio(a * 0.7);        // an outside write the engine has not seen, then a photo: the way back must not mark it as the engine's
        engine.photo.take();
        return { a, b, back, shotW: img.width, writer: engine.describe().owned['view.pixelRatio'].writer, keeps: R.getPixelRatio() === a * 0.7 };
      });
      await plain.context().close();
      check('ratio mode: a photo draws finer, then ratio and buffer are back', r.shotW === Math.floor(r.b * 2) && r.back.ratio === r.a && r.back.buffer === r.b, J(r));
      check('ratio mode: a game write before a photo stays the game\'s', r.writer.startsWith('three') && r.keeps, J(r));
    },
  },
];
