// Picture parts from different sources in one game (core/pictureSlots.js, core/pictureWriters.js), on the real dev server: a bundle has no source lines. The page
// (packages/engine/tests/picture-parts/) installs a sky, rain and a sea written in three styles. First they must run together and go without a trace; then each planned
// collision must fail with a message naming both sides and the fix.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
import { launchBrowser } from '../browser.mjs';
import { ENGINE, viteOptions } from '../paths.mjs';

export const name = 'picture parts: three sources in one game, slots, stray writes, leftovers (dev server)';

export async function run({ check }) {
  const env = process.env.NODE_ENV;   // see tests/picture-writers.mjs: an earlier build leaves production here
  process.env.NODE_ENV = 'development';
  const server = await createServer(await viteOptions(ENGINE, { server: { port: 0, host: 'localhost' }, logLevel: 'error' }));
  await server.listen();
  const browser = await launchBrowser({ prefer: 'software' });
  const open = async which => {
    const page = await browser.newPage();
    const warnings = [];
    page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
    page.on('pageerror', err => warnings.push('PAGE ERROR ' + err.message));
    await page.goto(`${server.resolvedUrls.local[0]}tests/picture-parts/index.html?case=${which}`);
    await page.waitForFunction(() => window.engine?.ready, null, { timeout: 90000 });
    await page.evaluate(() => {
      window.engine.haltLoop();
      window.step = n => { for (let i = 0; i < n; i++) window.engine.step(1 / 60, { describe: false }); };
      window.writers = () => window.engine.describe('picture').picture.writers;
      // what a part could leave: the scene, the lights, the post chain, the hooks
      window.snapshot = () => { const e = window.engine, names = []; e.scene.traverse(o => names.push(o.name || o.type));
        return { names: names.sort(), post: e.post.list().map(p => p.name), hooks: [e._onRender.before.length, e._onRender.after.length, e._frame.length, e._fixed.length], fog: !!e.scene.fog }; };
    });
    return { page, warnings, about: re => warnings.filter(w => re.test(w)) };
  };
  try {
    // ---- together
    let { page, warnings, about } = await open('none');
    const empty = await page.evaluate(() => { step(2); return snapshot(); });
    await page.close();
    ({ page, warnings, about } = await open('together'));
    let seen = await page.evaluate(() => {
      const e = window.engine, read = () => ({ daySun: e.scene.getObjectByName('sun').intensity, top: e.scene.getObjectByName('skyDome').material.uniforms.uTop.value.b, drops: e.rain.drops.material.opacity, far: e.scene.fog.far, rough: e.sea.water.material.roughness, buoy: e.sea.buoy.intensity });
      step(3);
      const clear = read();
      e.weather.set('rain', { seconds: 0 });
      e.calendar.timeOfDay = 22 / 24;
      step(3);
      return { clear, wet: read(), level: e.stacks.get('sun.level').value(), slots: e.describe('picture').picture.slots };
    });
    const { clear, wet } = seen;
    check('[guard] the time signal reaches the sky and the sea', wet.top < clear.top && wet.buoy > clear.buoy, JSON.stringify(seen));
    check('[guard] the weather signal reaches the rain and the sea', wet.drops > clear.drops && wet.far < clear.far && wet.rough > clear.rough, JSON.stringify(seen));
    check('[guard] a shared value: rain dims the sun through sun.level, the sky writes the light once', Math.abs(seen.level - 0.7) < 1e-6, JSON.stringify(seen));
    check('describe shows who holds each slot', seen.slots.sky === 'gradientSky' && seen.slots.sun === 'gradientSky' && seen.slots.fog === 'rain' && seen.slots.tone === null, JSON.stringify(seen.slots));
    let w = await page.evaluate(() => writers());
    check('[guard] three clean parts: no fight, no stray write, no warning', w.conflicts.length === 0 && w.held.length === 0 && about(/picture-|written twice|is held by/).length === 0, warnings.join(' | ') + JSON.stringify(w.conflicts));
    check('[guard] a declared owner is told from a stray: the holder wrote it', w.values['fog.far']?.writer === 'holder' && w.values['fog.far']?.holder === 'rain' && /parts\/rain\.js:\d+$/.test(w.values['fog.far'].at), JSON.stringify(w.values['fog.far']));
    check('the sun is found by name: its strength is the holder\'s', w.values['light:sun.intensity']?.writer === 'holder' && /parts\/sky\.js:\d+$/.test(w.values['light:sun.intensity'].at), JSON.stringify(w.values['light:sun.intensity']));
    const flash = await page.evaluate(() => { window.engine.events.emit('rain:flash', {}); step(2); return writers(); });
    check('[guard] the holder writing from its own listener is no stray, though no hook is running', flash.held.length === 0 && flash.values['fog.near']?.writer === 'holder', JSON.stringify(flash.values['fog.near']) + JSON.stringify(flash.held));

    const lone = await page.evaluate(() => { const e = window.engine; e.use(window.clash.quiet()); step(1); e.events.emit('quiet:go', {}); step(1); const r = writers(); e.unuse('quiet'); return { held: r.held, v: r.values['renderer.toneMappingExposure'] }; });
    check('[guard] a holder that only writes from a listener is known by the file it called ctx.track from', lone.held.length === 0 && lone.v?.writer === 'holder', JSON.stringify(lone));

    const gone = await page.evaluate(() => { const e = window.engine; e.unuse('sea'); e.unuse('rain'); e.unuse('gradientSky'); step(2); return { snap: snapshot(), left: writers().leftovers, slots: e.describe('picture').picture.slots, level: e.stacks.get('sun.level').value() }; });
    check('[guard] removal leaves nothing behind: scene, post chain, hooks and fog are as before the parts', JSON.stringify(gone.snap) === JSON.stringify(empty), JSON.stringify([gone.snap, empty]));
    check('[guard] clean parts are not reported as leaving anything', gone.left.length === 0 && about(/picture-leftover|is gone, but/).length === 0, JSON.stringify(gone.left));
    check('their slots and shared changes went with them', gone.slots.fog === null && gone.slots.sun === null && gone.level === 1, JSON.stringify(gone));
    await page.close();

    // ---- the slot names and the engine's own modules
    ({ page, warnings, about } = await open('plain'));
    seen = await page.evaluate(() => {
      const e = window.engine, out = { slots: e.describe('picture').picture.slots };
      step(2);
      out.fogApi = e.fog === e.haze;
      const names = Object.keys(window.PICTURE_SLOTS).filter(s => s !== 'sky' && s !== 'fog');
      e.use({ name: 'allSlots', type: 'picture', provides: names, install: () => ({ mine: true }) });
      out.aliases = names.every(n => e[n]?.mine === true);
      try { e.use(new window.parts.GradientSky()); } catch (err) { out.second = err.message; }
      e.use({ name: 'mySky', type: 'picture', provides: ['sky'], install() {} }, { replaces: 'sky' });
      step(2);
      out.left = writers().leftovers;
      out.after = e.describe('picture').picture.slots.sky;
      return out;
    });
    check('[guard] the engine sky and a game\'s fog slot do not collide', seen.slots.sky === 'sky' && seen.slots.fog === 'haze' && seen.fogApi, JSON.stringify(seen));
    check('[guard] every slot name in the table can be taken: none clashes with an engine property', seen.aliases, JSON.stringify(seen));
    check('[guard] a part claiming the sky meets the engine\'s sky by name', /shared-taken|sky/.test(seen.second ?? '') && /gradientSky/.test(seen.second ?? '') && /replaces: 'sky'/.test(seen.second ?? ''), seen.second);
    check('[guard] the engine\'s own sky, swapped out with replaces, leaves nothing', seen.after === 'mySky' && seen.left.length === 0, JSON.stringify(seen.left));
    await page.close();

    // ---- collisions
    ({ page, warnings, about } = await open('together'));
    seen = await page.evaluate(() => { try { window.engine.use(window.clash.mist()); return null; } catch (err) { return err.message; } });
    check('[guard] two parts claim fog: refused at install, both named, the swap offered', /'mist'|mist/.test(seen ?? '') && /rain/.test(seen ?? '') && /replaces: 'fog'/.test(seen ?? ''), String(seen));
    const swap = await page.evaluate(() => { const e = window.engine; e.use(window.clash.haze(), { replaces: 'fog' }); step(2); const s = e.describe('picture').picture.slots.fog, drops = e.scene.getObjectByName('rainDrops'); return { s, drops: !!drops, far: e.scene.fog.far, left: writers().leftovers }; });
    check('[guard] replaces swaps the fog holder and the old part goes clean', swap.s === 'haze' && !swap.drops && swap.far === 90 && swap.left.length === 0, JSON.stringify(swap));
    await page.close();

    ({ page, warnings, about } = await open('none'));
    await page.evaluate(() => { const e = window.engine, sun = new window.THREE.DirectionalLight(); sun.name = 'sun'; e.scene.add(sun); step(1); e.use(window.clash.dawn(), window.clash.dusk()); step(4); });
    w = await page.evaluate(() => writers());
    let msg = about(/written twice/)[0] ?? '';
    check('[guard] two parts in one file write sun.intensity undeclared: both parts and lines named', /light:sun\.intensity/.test(msg) && /parts\/clash\.js:\d+ \(part 'dawn'\)/.test(msg) && /parts\/clash\.js:\d+ \(part 'dusk'\)/.test(msg), msg + JSON.stringify(w.conflicts));
    check('[guard] the warning gives the fix: claim it, or a shared value', /provides: \['sun'\]/.test(msg) && /engine\.stacks\.define/.test(msg) && /ctx\.mod/.test(msg), msg);
    await page.close();

    ({ page, warnings, about } = await open('together'));
    await page.evaluate(() => { const e = window.engine; step(2); e.use(window.clash.gust()); step(40); });
    w = await page.evaluate(() => writers());
    msg = about(/is held by/)[0] ?? '';
    check('[guard] a part writes a value another holds: holder, writer and both file:line named', /fog\.far is held by part 'rain'/.test(msg) && /parts\/rain\.js:\d+/.test(msg) && /parts\/clash\.js:\d+ \(part 'gust'\)/.test(msg), msg);
    check('[guard] the report gives the fix: delete, replaces, or a shared value', /delete the write at/.test(msg) && /replaces: 'fog'/.test(msg) && /engine\.stacks\.define/.test(msg) && /h\.change\(x\)/.test(msg), msg);
    check('[guard] a stray is marked as one in the writers list, and is no second "fight" report', w.held.some(h => h.value === 'fog.far' && h.holder === 'rain' && h.by === 'gust' && /rain\.js/.test(h.holderAt)) && !w.conflicts.some(c => c.value === 'fog.far'), JSON.stringify([w.held, w.conflicts]));
    check('[guard] one report per value and place, in the console and in the list', about(/fog\.far is held by/).length === 1 && w.held.filter(h => h.value === 'fog.far').length === 1, JSON.stringify(w.held));
    await page.evaluate(() => { window.engine.events.emit('gust:blow', {}); step(1); window.strayWrite(); step(1); });
    w = await page.evaluate(() => writers());
    const color = w.held.find(h => h.value === 'fog.color'), near = w.held.find(h => h.value === 'fog.near');
    check('[guard] a one-shot write from a part\'s listener is caught and named by its file', color?.by === 'gust' && /parts\/clash\.js:\d+/.test(color.at), JSON.stringify(w.held));
    check('[guard] a write outside any part is told apart from another part\'s', near && near.by === null && /picture-parts\/main\.js:\d+/.test(near.at) && about(/code outside any part/).length === 1, JSON.stringify(near));
    const text = await page.evaluate(() => window.engine.explain({ picture: 'fog.far' }).text);
    check('explain says stray or holder', /rain/.test(text) && /(stray|holds fog)/.test(text), text);
    await page.close();

    ({ page, warnings, about } = await open('together'));
    seen = await page.evaluate(() => { const e = window.engine; step(2); const before = snapshot(); e.use(window.clash.messy()); step(2); e.unuse('messy'); step(1); return { before, after: snapshot(), left: writers().leftovers }; });
    msg = about(/is gone, but/)[0] ?? '';
    check('[guard] a part removed without cleanup: named, with each thing it left', /part 'messy'/.test(msg) && /light 'flash'/.test(msg) && /object 'crate'/.test(msg) && /post effect 'messyTint'/.test(msg) && /hook/.test(msg), msg);
    check('[guard] each leftover says where it was added, and the fix is in the message', /parts\/clash\.js:\d+/.test(msg) && /ctx\.track/.test(msg) && seen.left[0]?.part === 'messy' && seen.left[0].left.length === 4, msg + JSON.stringify(seen.left));
    check('it only observes: the leftovers really are still there', seen.after.names.includes('crate') && seen.after.post.includes('messyTint'), JSON.stringify(seen.after));
    await page.close();

    // ---- the recipe's example, taken from the recipe
    const recipe = readFileSync(join(ENGINE, 'docs/recipes/62-picture-code.md'), 'utf8');
    const block = /```js\n(\/\/ picture\/harbor-fog\.js[\s\S]*?)```/.exec(recipe)?.[1] ?? '';
    ({ page, warnings, about } = await open('none'));
    seen = await page.evaluate(source => {
      const e = window.engine, before = snapshot();
      const part = new Function('THREE', source.replace(/^import .*$/m, '').replace('export const', 'const') + '; return harborFog;')(window.THREE);
      e.use(part({ far: 100 }));
      e.weather.set('rain', { seconds: 0 });
      step(3);
      const out = { far: e.scene.fog?.far, holder: e.describe('picture').picture.slots.fog, before };
      e.unuse('harborFog');
      step(1);
      return { ...out, after: snapshot(), left: writers().leftovers };
    }, block);
    check('[guard] the example in recipe 62 runs: it holds the fog, reads a signal, goes clean', block.length > 200 && seen.far === 40 && seen.holder === 'harborFog' && seen.left.length === 0 && JSON.stringify(seen.after) === JSON.stringify(seen.before), JSON.stringify(seen).slice(0, 400));
    await page.close();

    // ---- the same reports on the WebGPU renderer: they watch three.js values, no shader is involved
    ({ page, warnings, about } = await open('none&renderer=webgpu'));
    check('[guard] that page really asked for WebGPU (the page once ignored the word and this ran on WebGL)', await page.evaluate(() => window.engine.describe().renderer.requested) === 'webgpu');
    seen = await page.evaluate(() => { const e = window.engine, c = window.clash; e.use(c.haze()); step(2); e.use(c.gust()); step(3); e.use(c.messy()); step(2); e.unuse('messy'); return { kind: e.renderer.constructor.name, w: writers() }; });
    check('[guard] on WebGPU too: a stray write and a leftover are reported', seen.w.held.some(h => h.value === 'fog.far' && h.holder === 'haze' && h.by === 'gust') && seen.w.leftovers[0]?.left.length === 4, JSON.stringify([seen.kind, seen.w.held, seen.w.leftovers]));
    await page.close();

    // ---- edges
    ({ page, warnings, about } = await open('together'));
    seen = await page.evaluate(() => { const e = window.engine, out = {}, tryIt = f => { try { f(); return null; } catch (err) { return err.message; } };
      out.notIn = tryIt(() => e.unuse('nope'));
      out.needed = tryIt(() => e.unuse('gradientSky'));   // rain requires 'sun'
      e.use(window.clash.typo());
      return out; });
    check('[guard] unuse of a module not installed names what is', /nope/.test(seen.notIn ?? '') && /gradientSky/.test(seen.notIn ?? ''), seen.notIn);
    check('[guard] unuse refuses while another part requires its slot', /rain/.test(seen.needed ?? '') && /sun/.test(seen.needed ?? ''), seen.needed);
    check('[guard] a misspelt picture slot is warned about', about(/provides 'fgo'/).length === 1 && /provides: \['fog'\]/.test(about(/provides 'fgo'/)[0]), warnings.join(' | '));
    const table = await page.evaluate(() => Object.keys(window.PICTURE_SLOTS));
    const declared = /export type PictureSlot = ([^;]+);/.exec(readFileSync(join(ENGINE, 'types/core.d.ts'), 'utf8'))?.[1].match(/'(\w+)'/g).map(s => s.slice(1, -1));
    check('[guard] the type and the table list the same slots', JSON.stringify(table) === JSON.stringify(declared), JSON.stringify([table, declared]));
  } finally { await browser.close(); await server.close(); process.env.NODE_ENV = env; }
}
