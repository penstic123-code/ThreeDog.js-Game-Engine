// The one headless-browser harness for the test runner, screenshots, perf, stress, bake, doctor, pack tests and the dev bridge: launch arguments,
// a game page that collects errors, and build + preview on a free port.
//   CHROMIUM_ARGS.software  WebGL through ANGLE's SwiftShader (--use-gl=swiftshader fails on some Windows setups): same pixels on every machine, so tests use it
//   CHROMIUM_ARGS.gpu       WebGL through ANGLE on the real GPU (backend per platform): shot / gallery / perf / stress prefer it, it is several times faster
import { chromium } from 'playwright';
import { trackPageErrors } from './wait-engine.mjs';
import { viteOptions } from './paths.mjs';

const COMMON = ['--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
/** ANGLE backend that reaches the hardware GPU headless on this platform */
const GPU_ANGLE = { win32: 'd3d11', darwin: 'metal' }[process.platform] ?? 'vulkan';
export const CHROMIUM_ARGS = {
  software: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...COMMON],
  // --force_high_performance_gpu: on a laptop with two GPUs the discrete one (what a game asking powerPreference 'high-performance' gets);
  // without it headless Chromium took the integrated one. --enable-unsafe-webgpu: WebGPU on adapters Chromium has not allow-listed yet;
  // --disable-dawn-features=use_dxc: Playwright's Chromium ships without dxil.dll, so D3D12 WebGPU requestDevice() failed ("dxil.dll Windows Error 87")
  // and every WebGPU page silently ran on the WebGL2 backend; FXC (built into Windows) compiles the shaders instead
  gpu: [`--use-angle=${GPU_ANGLE}`, '--force_high_performance_gpu', '--enable-unsafe-webgpu', '--disable-dawn-features=use_dxc', ...COMMON],
};
/** Renderer strings of software rasterizers (SwiftShader, Mesa llvmpipe, the Windows basic adapter): not a hardware GPU */
export const SOFTWARE_RENDERER = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i;
/** Console noise from software WebGL that is not a page error */
export const IGNORED_CONSOLE = /GL Driver|GPU stall due to ReadPixels|Automatic fallback to software WebGL/;

/** What the user forced: --gpu / --software on the command line, else THREEDOG_RENDER=gpu|software, else null */
export function forcedRender() {
  // both given: an error, not a silent pick (gpu used to win)
  if (process.argv.includes('--gpu') && process.argv.includes('--software')) throw new Error('--gpu and --software pick opposite renderers: give one of them');
  if (process.argv.includes('--gpu')) return 'gpu';
  if (process.argv.includes('--software')) return 'software';
  const e = process.env.THREEDOG_RENDER;
  if (e && e !== 'gpu' && e !== 'software') throw new Error(`THREEDOG_RENDER="${e}": use gpu or software`);
  return e || null;
}

/** WebGL2 renderer string and timer-query support of a fresh page in this browser (null when WebGL2 cannot be created) */
export async function probeRenderer(browser) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const g = document.createElement('canvas').getContext('webgl2');
      if (!g) return null;
      const dbg = g.getExtension('WEBGL_debug_renderer_info');
      return { renderer: dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', timer: !!g.getExtension('EXT_disjoint_timer_query_webgl2') };
    });
  } finally { await page.close(); }
}

let gpuFailed = null;   // why the GPU launch fell back, remembered so perf (a fresh browser per page) notes it once and does not retry each time
/**
 * Launch headless Chromium. `prefer`: 'software' (default: tests need the same pixels everywhere) or 'gpu' (shot, gallery, perf, stress);
 * --gpu / --software / THREEDOG_RENDER override it. A GPU launch is verified (renderer string): no hardware GPU or a failed launch falls back to
 * SwiftShader with a one-line note. The browser gets `render`: { kind: 'gpu' | 'software', renderer?, timer?, fallback? }.
 */
export async function launchBrowser({ prefer = 'software', ...opts } = {}) {
  const want = forcedRender() ?? prefer;
  const launch = kind => chromium.launch({ ...opts, args: [...CHROMIUM_ARGS[kind], ...(opts.args || [])] });
  if (want === 'gpu' && !gpuFailed) {
    let b;
    try {
      b = await launch('gpu');
      const r = await probeRenderer(b);
      if (r && !SOFTWARE_RENDERER.test(r.renderer)) { b.render = { kind: 'gpu', ...r }; return b; }
      gpuFailed = r ? `the GPU launch got a software renderer (${r.renderer})` : 'the GPU launch has no WebGL2';
    } catch (e) { gpuFailed = `the GPU launch failed (${String(e?.message ?? e).split('\n')[0]})`; }
    await b?.close().catch(() => {});
    // stderr: a diagnostic, not output. shot / doctor / stress --json print one JSON object on stdout, and this line in front of it broke the parse
    console.error(`Note: ${gpuFailed}; using software rendering (SwiftShader). threedog doctor shows the details.`);
  }
  const b = await launch('software');
  b.render = { kind: 'software', ...(want === 'gpu' && { fallback: gpuFailed }) };
  return b;
}

/**
 * A new page whose page errors and console errors go into `errors` (array). Options are passed to browser.newPage
 * (default viewport 1280×720). Returns the page.
 */
export async function newGamePage(browser, { errors = [], ...opts } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ...opts });
  trackPageErrors(page);   // from creation, so waitEngine sees an error main.js threw during page.goto (before any wait started)
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !IGNORED_CONSOLE.test(m.text())) errors.push(m.text()); });
  return page;
}

/** Build a workspace (unless build: false) and serve dist with vite preview on a free 127.0.0.1 port: { base, close() } */
export async function buildAndPreview(dir, { build: doBuild = true } = {}) {
  const { build, preview } = await import('vite');
  if (doBuild) await build(await viteOptions(dir, { logLevel: 'error' }));
  // Serve without compression. vite preview gzips every response on the fly, and the physics library is one 4 MB script (its wasm inlined as
  //   base64): that was ~250 ms of CPU on the machine for every test page that loads it, and compressing over 127.0.0.1 saves nothing. The hook
  //   runs before the compression middleware, so dropping Accept-Encoding here switches it off.
  const noGzip = { name: 'threedog-preview-no-gzip', configurePreviewServer(s) { s.middlewares.use((req, _res, next) => { delete req.headers['accept-encoding']; next(); }); } };
  const server = await preview(await viteOptions(dir, { plugins: [noGzip], preview: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' }));
  const base = (server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${server.httpServer.address().port}/`).replace(/\/$/, '');
  return { base, close: () => new Promise(r => server.httpServer.close(() => r())) };
}

/** The promise's result, or a rejection `<label> timed out after N s` when it takes longer than ms */
export function withTimeout(promise, ms, label) {
  let t;
  const late = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)} s`)), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(t));
}
