// Frame capture for development: threedog capture [page] [options]
// Opens the page headless (like `threedog shot`), renders one frame and prints a short summary of it: draw calls, shadow draws, render passes (post
// effects), and the largest draws with their ThreeDog names (world record id, budget tag, material purpose). Two sources, joined in the summary:
//   - a hook on the renderer (renderBufferDirect / setRenderTarget): one entry per draw call with the three.js object and material behind it;
//   - Spector.js (https://spector.babylonjs.com), when it can run: records the raw WebGL command stream of the same frame to a file you can open
//     in the Spector UI (or read as JSON). Spector is NOT a dependency of the engine or of any game: it is fetched on first use from the npm CDN
//     into <workspace>/.threedog/cache/ and injected into the page by this tool only. --no-spector skips it, --spector-url overrides the source.
//
//   npm run capture                                 the open-world example, default state
//   npm run capture -- /tests/city/index.html --top 12
//   npm run capture -- / --time 18:30 --pos 40,-20 --out .threedog/captures
//
// Options: page (default /) · -w name · --top N (largest draws listed, default 8) · --out dir · --time HH:MM · --weather name · --pos x,z ·
//   --no-spector · --spector-url url · --full (keep Spector's per-draw state and stack traces: loads in the Spector UI, 10+ MB) · --no-build · --size WxH
// The capture file lists every WebGL command of the frame; the printed summary is what to read first. Under software rendering the GPU work is
// slow but the draw list is the same as on a real GPU.
process.env.THREEDOG_TEST = '1';
import { launchBrowser, newGamePage, buildAndPreview } from './browser.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cli, rel } from './paths.mjs';
import { viewSize } from './lib/shot-name.mjs';
import { waitEngine } from './wait-engine.mjs';
import { summarize, hookScript, fetchSpector, spectorDraws } from './lib/capture-lib.mjs';

// Per-draw state snapshots and stack traces make a frame 10+ MB; the default file keeps the command list (names, arguments, text) only
const slim = cap => ({ ...cap, commands: cap.commands.map(({ id, name, commandArguments, status, text }) => ({ id, name, commandArguments, status, text })) });

const { dir, page: url, opt } = cli(process.argv.slice(2), { page: '/', flags: ['no-spector', 'full', 'no-build', 'gpu', 'software'], values: ['top', 'out', 'time', 'weather', 'pos', 'size', 'spector-url'] });
let W, H; try { [W, H] = viewSize(opt.size); } catch (e) { console.error('✗ ' + e.message); process.exit(1); }
const TOP = +(opt.top || 8);
// resolve, not join: join(cwd, 'D:/caps') glued an absolute --out under the current folder ("<cwd>/D:/caps")
const outDir = opt.out ? resolve(String(opt.out)) : join(dir, '.threedog', 'captures');

if (!opt['no-build']) console.log(`Building… (${rel(dir)})`);
const server = await buildAndPreview(dir, { build: !opt['no-build'] }), base = server.base;
const browser = await launchBrowser();
const errors = [];
const page = await newGamePage(browser, { errors, viewport: { width: W, height: H } });
let spectorNote = '', file = null;

try {
  // desktop tier like shot (core/tier.js): the captured frame is the one the game's look is made of, costly post included
  const q = new URLSearchParams({ 'threedog-headless': '', 'threedog-tier': 'high', wait: '1', cutscene: 'skip' });
  for (const k of ['time', 'weather', 'pos']) if (opt[k]) q.set(k, opt[k]);
  await page.goto(base + url + (url.includes('?') ? '&' : '?') + q.toString().replace('threedog-headless=', 'threedog-headless'));
  await waitEngine(page, { timeout: 60000, errors });
  await page.evaluate(() => engine.ui.settled());
  // paused first: a page with a live loop would render between our calls and mix several frames into the capture. The warm-up step compiles
  // the shaders and does the first uploads, so the captured frame is a steady one
  await page.evaluate(() => { engine.pause(); engine.step(1 / 30); });

  await page.evaluate(hookScript);   // the hook records the draws of the next render
  let spector = null;
  if (!opt['no-spector']) {
    try {
      const code = await fetchSpector(join(dir, '.threedog', 'cache'), opt['spector-url']);
      await page.addScriptTag({ content: code });
      const ok = await page.evaluate(() => {
        const S = window.SPECTOR; if (!S) return false;
        const sp = window.__spector = new S.Spector();
        window.__captured = null; sp.onCapture.add(c => { window.__captured = c; });
        const canvas = engine.renderer.domElement;
        sp.startCapture(canvas, 1e6, true);   // quick capture: the command list only, no per-draw state snapshots (keeps the file small)
        return true;
      });
      spector = ok;
      if (!ok) spectorNote = 'Spector bundle loaded but window.SPECTOR is missing';
    } catch (e) { spectorNote = 'Spector not available: ' + String(e.message).split('\n')[0]; }
  }
  const frame = await page.evaluate(() => { engine.step(1 / 60); return JSON.parse(JSON.stringify(window.__draws)); });
  let captured = null;
  if (spector) {
    captured = await page.evaluate(async () => {
      window.__spector.stopCapture();
      for (let i = 0; i < 100 && !window.__captured; i++) await new Promise(r => setTimeout(r, 50));
      const c = window.__captured; if (!c) return null;
      return JSON.parse(JSON.stringify(c, (k, v) => (k === 'visual' || k === 'VisualState' ? undefined : v)));
    });
    if (!captured) spectorNote = 'Spector did not return a capture (headless WebGL: the frame ended before it could record)';
    else {
      mkdirSync(outDir, { recursive: true });
      file = join(outDir, `capture-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
      writeFileSync(file, JSON.stringify(opt.full ? captured : slim(captured)));
    }
  }
  console.log(summarize(frame, { top: TOP, gl: captured ? spectorDraws(captured) : null }));
  if (file) console.log(`\nSpector capture: ${rel(file)} (${(readFileSync(file).length / 1048576).toFixed(1)} MB; the commands array, or with --full a file the Spector UI can load)`);
  if (spectorNote) console.log(`\n${spectorNote}. The summary above comes from the renderer hook alone.`);
} catch (e) { errors.push(String(e).split('\n')[0]); }
finally { await browser.close(); await server.close(); }
// Spector probes the canvas for a WebGL 1 context; three.js logs that as an error although nothing is wrong
const real = errors.filter(e => !/Canvas has an existing context of a different type/.test(e));
if (real.length) console.log('\nPage errors:\n  ' + real.slice(0, 5).join('\n  '));
process.exit(real.length ? 1 : 0);
