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
//
// Options:
//   page            URL path, default /
//   --time HH:MM   set the time of day (needs the sky module)
//   --weather name  clear / cloudy / overcast / rain / storm / snow / fog (needs the weather module)
//   --pos x,z      put the player here (on the ground)
//   --wait seconds  game seconds to advance after setup (default 1)
//   --size WxH      screenshot resolution, default 960x540
//   --keep-cutscene  do not skip a cutscene that is playing
//   --describe-only  print describeText() only, no screenshot
//   --no-build     do not rebuild, use the last dist/ (saves a few seconds when code did not change)
//   -w name         which workspace (engine, my-game…); default the one containing the current directory, then the engine package
process.env.THREEDOG_TEST = '1';
import { launchBrowser, newGamePage, buildAndPreview } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pickWorkspace, rel } from './paths.mjs';
import { waitEngine } from './wait-engine.mjs';

const t0 = Date.now();
const { dir, args } = pickWorkspace(process.argv.slice(2)), opt = {};
let url = '/';
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) { url = a; continue; }
  const k = a.slice(2), v = args[i + 1];
  if (v === undefined || v.startsWith('--')) opt[k] = true; else { opt[k] = v; i++; }
}
const [W, H] = String(opt.size || '960x540').split('x').map(Number);
const wait = opt.wait !== undefined ? +opt.wait : 1;

if (!opt['no-build']) console.log(`Building… (${rel(dir)})`);
const server = await buildAndPreview(dir, { build: !opt['no-build'] }), base = server.base;
const browser = await launchBrowser();
const errors = [];
const page = await newGamePage(browser, { errors, viewport: { width: W, height: H } });

try {
  // Time, weather, position, skipping cutscenes and advancing are all left to the engine's URL parameters (engine.applyState, see packages/engine/core/UrlState.js)
  const q = new URLSearchParams({ 'threedog-headless': '' });
  for (const k of ['time', 'weather', 'pos']) if (opt[k]) q.set(k, opt[k]);
  q.set('wait', String(wait));
  q.set('cutscene', opt['keep-cutscene'] ? 'keep' : 'skip');
  await page.goto(base + url + (url.includes('?') ? '&' : '?') + q.toString().replace('threedog-headless=', 'threedog-headless'));
  await waitEngine(page, { timeout: 60000, errors });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(() => engine.ui.settled());   // the loading screen fades out on a wall-clock timer after ready; do not capture it mid-fade
  const text = await ev(() => { engine.step(1 / 30, { render: true }); return engine.describeText(); });
  if (!opt['describe-only']) {
    mkdirSync(join(dir, '.threedog', 'shots'), { recursive: true });
    const name = [url.replace(/^\//, '').replace(/\.html.*$/, '') || 'main', opt.time && 't' + opt.time.replace(':', ''), opt.weather, opt.pos && 'pos' + opt.pos, 'w' + wait]
      .filter(Boolean).join('_').replace(/[^\w,.-]+/g, '-');
    const file = join(dir, '.threedog', 'shots', `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`Screenshot: ${rel(file)} (${W}×${H})`);
  }
  console.log('\n' + text);
} catch (e) { errors.push(String(e).split('\n')[0]); }
finally { await browser.close(); await server.close(); }
if (errors.length) console.log('\nPage errors:\n  ' + errors.slice(0, 5).join('\n  '));
console.log(`\nTook ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(errors.length ? 1 : 0);
