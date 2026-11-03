// One-shot screenshot: npm run shot -- [page] [options]
// Build → open the page in a headless browser in headless mode (?threedog-headless), with the options turned into URL parameters (?time=18:30&pos=40,-20…, the engine sets up the scenario itself)
// → wait for state:applied → save a PNG to the workspace's .threedog/shots/ and print describeText().
// In headless mode the game only advances on step, so the same options give the same result every time; by default only 1 shot at 960×540, to spare the GPU.
//
//   npm run shot                                   the open-world example in its default state (engine package packages/engine)
//   npm run shot -- -w my-game / --describe-only   another game: -w name (or run npm run shot inside the game directory)
//   npm run shot -- / --time 18:30 --weather rain --pos 40,-20 --wait 3
//   npm run shot -- /tests/city/index.html --time 12:00        the town test page
//   npm run shot -- / --describe-only              print text only, no screenshot
//   npm run shot -- styletest --view room --time dusk --weather rain   the style test page: the lit room at dusk in rain
//
//   npm run shot -- http://localhost:5173/ --time 21:30   a page that is already running (the dev server): no build, opened as given
//   npm run shot -- --image my-shot.png            the pixel part of the look check on a picture taken any other way (no page, no build)
//
// Options:
//   page            URL path, default /; a bare name is a page of the workspace: `shot styletest` = /styletest.html;
//                   a full http(s):// URL is opened as given, without building (a dev server or any page that sets window.engine)
//   --image file    no page: read this saved picture and print the look numbers and pixel-only hints (clipped / near-black share, near-white
//                   spots, DESIGN.md intent, --ref). What needs the live page (which light or material glares, shadows, noon / midnight) says so
//   --time HH:MM   set the time of day (needs the sky module)
//   --weather name  clear / cloudy / overcast / rain / storm / snow / fog (needs the weather module)
//   --pos x,z      put the player here (on the ground; the same pos as applyState({ pos }) and ?pos=). The camera's own spot is --view
//   --view name    a named camera view: engine.views.define(name, { position, target, fov }) (camera position and target [x, y, z]) in any game, or a page's own ?view= (the style test: overview, character, water, room, path, ui)
//   --wait seconds  game seconds to advance after setup (default 1)
//   --load-timeout s  wall seconds to wait for loading (engine.loading) to finish before the shot, default 120; on timeout it fails naming what is pending
//   --size WxH      screenshot resolution, default 960x540
//   --tier low|high  the device tier the page renders at (default high, the desktop tier: the headless browser would detect low and drop ao / bloom);
//                   costly effects the tier leaves out are named under the screenshot line
//   --keep-cutscene  do not skip a cutscene that is playing
//   --play          start straight in play: past the title screen the way its Start does (?play, engine URL key; engine.session.newGame())
//   --describe-only  print describeText() only, no screenshot
//   --out file.png  a bare name: .threedog/shots/file.png instead of the generated name; a path with a directory (./x.png, out/x.png, absolute)
//                   is written as given, relative to the current directory. The output line says where it wrote
//   --keep         do not overwrite: add a timestamp to the file name, so shots of several runs sit side by side
//   (every shot)   prints the look numbers (luminance, contrast, saturation, clipped / near-black share, shadow area) and hints: contradictions
//                  (settings say X, pixels show not-X: shadows on but none visible, a light that lights nothing), facts (glare, clipped / near-black
//                  areas, a night not dark from lighting, key / fill) and, only against what the game declared, intent (DESIGN.md "Look intent"
//                  line, or --ref). Facts and
//                  likely causes with the parameter's current value, never target values; nothing fails, nothing is changed (style/look.mjs)
//   --ref image    also compare with this reference picture (style compare) and say where it clearly differs
//   --no-look      skip the numbers and hints
//   --json         print one JSON object (file, look numbers, probe facts, hints, describe text) instead of text; for MCP / the dev bridge
//   --compare before.png  after the shot, print both file names, a pixel-diff number (0 = identical) and the look differences; take `before` with --keep
//   --no-build     do not rebuild, use the last dist/ (saves a few seconds when code did not change)
//   --gpu / --software  force the renderer (default: the hardware GPU when headless can reach it, else SwiftShader; also THREEDOG_RENDER=gpu|software)
//   -w name         which workspace (engine, my-game…); default the one containing the current directory, then the engine package
process.env.THREEDOG_TEST = '1';
import { launchBrowser, newGamePage, buildAndPreview } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { cli, rel } from './paths.mjs';
import { waitEngine, waitLoaded } from './wait-engine.mjs';
import { shotName, shotFile, viewSize } from './lib/shot-name.mjs';
import { formatLook, pageLook, imageLook, NO_PAGE } from './style/look.mjs';
import { PICTURE } from './threedog/pageFns.mjs';

const t0 = Date.now();

// switches never take a value (so `--keep /page` keeps /page as the page); an unknown option fails naming the closest one
let { dir, page: url, pageArg, opt } = cli(process.argv.slice(2), { page: '/', flags: ['keep', 'no-look', 'json', 'describe-only', 'no-build', 'keep-cutscene', 'gpu', 'software', 'play'],
  values: ['time', 'weather', 'pos', 'view', 'wait', 'load-timeout', 'size', 'compare', 'out', 'ref', 'tier', 'image'],
  // an option the other switches off used to be dropped without a word (--ref under --no-look compared nothing)
  conflicts: [['ref', 'no-look', 'the reference is compared inside the look check'],
    ...['ref', 'compare', 'out', 'keep'].map(k => [k, 'describe-only', 'describe-only takes no screenshot']),
    ...['time', 'weather', 'pos', 'view', 'wait', 'size', 'out', 'keep', 'compare', 'no-look', 'describe-only', 'tier', 'play'].map(k => [k, 'image', '--image reads a saved picture, there is no page to set up'])] });
const json = !!opt.json;
if (opt.image !== undefined) process.exit(await imageOnly(opt));

/** --image: the look check's pixel facts on a picture taken any other way (a self-written screenshot script, a browser's own capture) */
async function imageOnly(opt) {
  if (opt.image === true) { console.log('✗ --image needs a file: shot --image my-shot.png'); return 1; }
  try {
    let ref = null;
    if (opt.ref && opt.ref !== true) ref = await (await import('./style/compare.mjs')).compareImages(opt.ref, opt.image);
    const r = await imageLook(opt.image, { dir, ref });
    if (json) console.log(JSON.stringify({ image: resolve(opt.image), size: r.size, look: r.numbers, intent: r.intent, hints: r.hints, page: false }, null, 1));
    else console.log([`Picture: ${opt.image} (${r.size.join('×')})`, ...formatLook(r.numbers, null, r.hints, null), NO_PAGE].join('\n'));
    return 0;
  } catch (e) { console.log('✗ ' + e.message); return 1; }
}
// The device tier the page renders at (core/tier.js ?threedog-tier). Default high: the headless browser reports SwiftShader or an integrated GPU,
// which detection calls low, and the shot then silently lacked the game's costly post (ao, bloom); --tier low checks what weak devices get
const tier = opt.tier === undefined ? 'high' : String(opt.tier);
if (!['low', 'high'].includes(tier)) { console.log(`✗ --tier ${opt.tier}: use low or high`); process.exit(1); }
const say = json ? () => {} : (...a) => console.log(...a), result = {};   // --json: stdout is the one JSON object
if (/^[\w-]+$/.test(url)) url = `/${url}.html`;   // a bare name is a page: shot styletest
let W, H; try { [W, H] = viewSize(opt.size); } catch (e) { console.log('✗ ' + e.message); process.exit(1); }
const wait = opt.wait !== undefined ? +opt.wait : 1;

// a full URL: the page already runs (dev server, another host). Why: the demos screenshotted their running dev server with their own script and
// skipped the look check; pointing shot at that same URL keeps the check without a build
const live = /^https?:\/\//i.test(url);
// npm echoes the rewritten argument (`> threedog shot C:/Git/`): say which page really opens, so the echo is not taken for it
if (pageArg && pageArg !== url && /^[A-Za-z]:[\\/]/.test(pageArg)) say(`Page: ${url} (Git Bash had rewritten the argument to ${pageArg}; undone)`);
if (!opt['no-build'] && !live) say(`Building… (${rel(dir)})`);
const server = live ? { base: '', close: async () => {} } : await buildAndPreview(dir, { build: !opt['no-build'] }), base = server.base;
const browser = await launchBrowser({ prefer: 'gpu' });   // a hardware GPU is several times faster than SwiftShader; tests stay on software for stable pixels
const errors = [];
const page = await newGamePage(browser, { errors, viewport: { width: W, height: H } });

try {
  // Time, weather, position, skipping cutscenes and advancing are all left to the engine's URL parameters (engine.applyState, see packages/engine/core/UrlState.js)
  const q = new URLSearchParams({ 'threedog-headless': '', 'threedog-tier': tier });
  for (const k of ['time', 'weather', 'pos', 'view']) if (opt[k]) q.set(k, opt[k]);
  q.set('wait', String(wait));
  q.set('cutscene', opt['keep-cutscene'] ? 'keep' : 'skip');
  if (opt.play) q.set('play', '');
  await page.goto(base + url + (url.includes('?') ? '&' : '?') + q.toString().replace('threedog-headless=', 'threedog-headless'));
  await waitEngine(page, { timeout: 60000, errors });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  // A picture taken while terrain / models are still arriving shows a half-built world that looks like an art bug, so finish loading first.
  // Headless only advances on step, so step (no render) until engine.loading says nothing is pending; past the limit fail with what it is still waiting for
  await waitLoaded(page, { timeout: (opt['load-timeout'] !== undefined ? +opt['load-timeout'] : 120) * 1000 });
  await ev(() => engine.ui.settled());   // the loading screen fades out on a wall-clock timer after ready; do not capture it mid-fade
  const text = await ev(() => { engine.step(1 / 30, { render: true }); return engine.describeText(); });
  if (!opt['describe-only']) {
    // --keep: a timestamp in the name, so a new shot never replaces an earlier one (to compare before / after a change)
    const stamp = opt.keep ? '_' + new Date().toISOString().replace(/\D/g, '').slice(4, 14) + String(Date.now() % 1000).padStart(3, '0') : '';
    // --out: a bare name goes into .threedog/shots/ too, a path with a directory is kept as given (lib/shot-name.mjs)
    const file = shotFile(dir, opt.out === true ? undefined : opt.out, shotName(url, opt, wait), stamp);
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file });
    // effects the tier left out, said with the shot: a picture without the game's bloom / ao must not pass for its look
    const skipped = await ev(() => (engine.describe().render?.post ?? []).filter(p => p.why).map(p => p.name));
    Object.assign(result, { file, size: [W, H], renderer: browser.render.kind, tier, skipped });
    say(`Screenshot: ${rel(file)} (${W}×${H}, ${browser.render.kind} rendering, ${tier} tier)`);
    if (skipped.length) say(`  Not in this picture: ${skipped.join(', ')} (costly post, off by default on the ${tier} tier). `
      + `To see them: shot --tier high, or force them in the game: engine.look.post.set({ ${skipped.map(n => `${n}: true`).join(', ')} })`);
    if (opt.compare && opt.compare !== true) {   // before / after: the earlier picture against this one
      const { compareImages, formatCompare, pixelDiff } = await import('./style/compare.mjs');
      const diff = await pixelDiff(opt.compare, file), cmp = await compareImages(opt.compare, file);
      result.compare = { before: opt.compare, pixelDiff: diff, ...cmp };
      say(`Before: ${opt.compare}
After:  ${rel(file)}
Pixel diff: ${diff} (0 = identical, 1 = black vs white)`);
      say(formatCompare(cmp));
    }
    if (!opt['no-look']) {
      const tLook = Date.now();
      let ref = null, refMs = 0;
      if (opt.ref && opt.ref !== true) {   // --ref opens its own picture reader: not counted in the look time
        const { compareImages } = await import('./style/compare.mjs'), t = Date.now();
        ref = await compareImages(opt.ref, file); refMs = Date.now() - t;
      }
      // noon / midnight renders only where the game moves time (calendar + sky: 'auto'), or when this shot set a time
      // Playwright evaluates a string as an expression (a function source comes back as the function itself, serialized to undefined): call it here
      const lk = await pageLook((src, arg) => page.evaluate(`(${src})(${JSON.stringify(arg)})`), { dir, time: opt.time ? true : 'auto', ref });
      // the look check never fails the shot: a probe that could not read the canvas says so and the shot stands
      if (lk.error) { result.lookError = lk.error; say(`Look: skipped (${lk.error})`); }
      else {
        const lookMs = Date.now() - tLook - refMs;
        Object.assign(result, { look: lk.numbers, lookMs, probe: lk.probe, intent: lk.intent, hints: lk.hints, ...(ref && { ref: { file: ref.reference.file, diff: ref.diff, summary: ref.summary } }) });
        say(formatLook(lk.numbers, lk.probe, lk.hints, lookMs).join('\n'));
      }
    }
  }
  result.describe = text;
  // under a picture only what bears on it (the same PICTURE lines as threedog snap); --describe-only and --json keep the whole describeText
  if (opt['describe-only']) say('\n' + text);
  else { result.picture = await ev(`(${PICTURE})(window.engine)`); say('\n' + result.picture.join('\n')); }
} catch (e) { errors.push(String(e?.message ?? e)); }   // whole message: the wait/loading failures put the reason on the following lines
finally { await browser.close(); await server.close(); }
if (errors.length) say('\nPage errors:\n  ' + errors.slice(0, 5).join('\n  '));
say(`\nTook ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (json) console.log(JSON.stringify({ ...result, errors, seconds: +((Date.now() - t0) / 1000).toFixed(1) }, null, 1));
process.exit(errors.length ? 1 : 0);

