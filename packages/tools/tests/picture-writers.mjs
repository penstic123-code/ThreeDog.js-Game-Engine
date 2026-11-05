// Who wrote a picture value (core/pictureWriters.js), on the real dev server: a bundle has no source lines, so only here do the answers mean anything.
// The page (packages/engine/tests/picture-writers/) wires picture/ parts through one engine.onRender, the case per-hook attribution cannot tell apart.
import { createServer } from 'vite';
import { launchBrowser } from '../browser.mjs';
import { ENGINE, viteOptions } from '../paths.mjs';

export const name = 'picture writers: last writer as file:line, conflict warning, not tracked says so (dev server)';

export async function run({ check }) {
  // a build earlier in this process (the engine specs) leaves NODE_ENV production, and the dev server would then serve import.meta.env.DEV false
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const server = await createServer(await viteOptions(ENGINE, { server: { port: 0, host: 'localhost' }, logLevel: 'error' }));
  await server.listen();
  const browser = await launchBrowser({ prefer: 'software' });
  try {
    const page = await browser.newPage();
    const warnings = [];
    page.on('console', m => { if (m.type() === 'warning' && /written twice/.test(m.text())) warnings.push(m.text()); });
    await page.goto(`${server.resolvedUrls.local[0]}tests/picture-writers/index.html`);
    await page.waitForFunction(() => window.engine?.ready, null, { timeout: 90000 });
    const step = n => page.evaluate(k => { window.engine.haltLoop(); for (let i = 0; i < k; i++) window.engine.step(1 / 60, { describe: false }); }, n);
    const values = () => page.evaluate(() => window.engine.describe('picture').picture.writers);
    await step(3);
    let w = await values();
    const v = k => w.values[k]?.at ?? '';
    check('[guard] one onRender, parts in separate files: each value names its own file', w.tracked && /picture\/lights\.js:\d+$/.test(v('light:sun.intensity')) && /picture\/sky\.js:\d+$/.test(v('fog.color')), JSON.stringify(w).slice(0, 500));
    check('[guard] a Color and a Vector3 changed in place are attributed, through three.js frames', /picture\/lights\.js:10$/.test(v('light:sun.color')) && /picture\/lights\.js:11$/.test(v('light:sun.position')), JSON.stringify([v('light:sun.color'), v('light:sun.position')]));
    check('fog values start with the line that assigned the fog', /picture\/sky\.js:4$/.test(v('fog.near')) && /picture\/sky\.js:4$/.test(v('scene.fog')), JSON.stringify([v('fog.near'), v('scene.fog')]));
    const off = await page.evaluate(() => {
      const e = window.engine, a = e.explain({ picture: 'material:box.color' }), b = e.explain({ picture: 'light:sun.shadow.bias' });
      window.picture.box.material.color.setHex(0xff0000);
      return { a, b, c: e.explain({ picture: 'material:box.color' }), d: window.picture.box.material.color.getHex(), e: e.explain({ picture: 'light:sun.intensity' }) };
    });
    check('[guard] a value set before tracking and a name outside the list both say not tracked, never a guess', /not tracked: set before/.test(off.a.text) && !off.a.ok && /not tracked/.test(off.b.text) && !off.b.ok, JSON.stringify([off.a.text, off.b.text]));
    check('a write made from the console has no source file and says so, and the write goes through', !off.c.ok && /no source file/.test(off.c.text) && off.d === 0xff0000, off.c.text);
    check('explain names the line for a tracked value', off.e.ok && /picture\/lights\.js:9/.test(off.e.text), off.e.text);
    check('[guard] steps in one function are no fight (copy then lerp on fog.color)', warnings.length === 0 && (await values()).conflicts.length === 0, warnings.join(' | '));

    for (const mode of ['nightOnly', 'dayOnly', 'nightOnly']) { await page.evaluate(m => { window.mode = m; }, mode); await step(2); }
    check('[guard] a value written from two states across frames is no fight', warnings.length === 0, warnings.join(' | '));

    await page.evaluate(() => { window.mode = 'fight'; });
    await step(40);
    w = await values();
    const c = w.conflicts.find(x => x.value === 'fog.far');
    check('[guard] two files writing fog.far in one frame: one warning naming both file:line', warnings.length === 1 && /fog\.far/.test(warnings[0]) && /picture\/sky\.js:\d+/.test(warnings[0]) && /picture\/rival\.js:\d+/.test(warnings[0]) && !!c, warnings.join(' | ') + JSON.stringify(w.conflicts));
    await step(40);
    check('[guard] the warning comes once per value', warnings.length === 1, String(warnings.length));
    const far = await page.evaluate(() => window.engine.scene.fog.far);
    check('[guard] nothing is blocked: the later write stands', far === 90, String(far));

    const before = (await values()).stacks;
    await step(60);
    const cost = (await values()).stacks - before;
    // 4 moving values, 3 components each, twice for fog.color: a stack on every write would be over 700 in 60 frames
    check('[guard] stacks stay sampled: a value written every frame gets about one look per 30 frames', cost < 80, String(cost));
    const list = await page.evaluate(() => window.engine.describe({ only: ['threePatches'] }).threePatches?.map(p => p.id) ?? window.engine.threePatches?.list().map(p => p.id));
    check('the change is listed with the others', !!list?.includes('picture-writers'), String(list));
  } finally { await browser.close(); await server.close(); process.env.NODE_ENV = env; }
}
