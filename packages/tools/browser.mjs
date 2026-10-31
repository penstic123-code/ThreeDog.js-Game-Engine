// The one headless-browser harness for the test runner, screenshots, perf, bake, doctor, pack tests and the dev bridge: launch arguments,
// a game page that collects errors, and build + preview on a free port.
//   CHROMIUM_ARGS   software WebGL through ANGLE's SwiftShader (--use-gl=swiftshader fails on some Windows setups), autoplay without a gesture
import { chromium } from 'playwright';
import { join } from 'node:path';

export const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required'];
/** Console noise from software WebGL that is not a page error */
export const IGNORED_CONSOLE = /GL Driver|GPU stall due to ReadPixels|Automatic fallback to software WebGL/;

/** Launch headless Chromium with CHROMIUM_ARGS (extra launch options merged in) */
export const launchBrowser = (opts = {}) => chromium.launch({ ...opts, args: [...CHROMIUM_ARGS, ...(opts.args || [])] });

/**
 * A new page whose page errors and console errors go into `errors` (array). Options are passed to browser.newPage
 * (default viewport 1280×720). Returns the page.
 */
export async function newGamePage(browser, { errors = [], ...opts } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ...opts });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !IGNORED_CONSOLE.test(m.text())) errors.push(m.text()); });
  return page;
}

/** Build a workspace (unless build: false) and serve dist with vite preview on a free 127.0.0.1 port: { base, close() } */
export async function buildAndPreview(dir, { build: doBuild = true } = {}) {
  const { build, preview } = await import('vite');
  const configFile = join(dir, 'vite.config.js');
  if (doBuild) await build({ root: dir, configFile, logLevel: 'error' });
  const server = await preview({ root: dir, configFile, preview: { port: 0, host: '127.0.0.1', strictPort: false }, logLevel: 'error' });
  const base = (server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${server.httpServer.address().port}/`).replace(/\/$/, '');
  return { base, close: () => new Promise(r => server.httpServer.close(() => r())) };
}

/** The promise's result, or a rejection `<label> timed out after N s` when it takes longer than ms */
export function withTimeout(promise, ms, label) {
  let t;
  const late = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)} s`)), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(t));
}
