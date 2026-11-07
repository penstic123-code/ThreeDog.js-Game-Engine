// The look of the shared flight scene (packages/engine/tests/sky-courier/) switched twice with the real starter pictures, on the real dev server: the writers tracker that says
// picture-leftover exists only there, so a bundle could never show a false one. Public API only: what a game can see of the scene, the post chain and describe.
import { createServer } from 'vite';
import { launchBrowser } from '../browser.mjs';
import { ENGINE, viteOptions } from '../paths.mjs';

export const name = 'sky courier: the look switched twice leaves nothing and no false leftover hint (dev server)';

export async function run({ check }) {
  const env = process.env.NODE_ENV;   // see tests/picture-writers.mjs: an earlier build leaves production here
  process.env.NODE_ENV = 'development';
  const server = await createServer(await viteOptions(ENGINE, { server: { port: 0, host: 'localhost' }, logLevel: 'error' }));
  await server.listen();
  const browser = await launchBrowser({ prefer: 'software' });
  try {
    const page = await browser.newPage(), warnings = [];
    page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text()); });
    page.on('pageerror', err => warnings.push('PAGE ERROR ' + err.message));
    await page.goto(`${server.resolvedUrls.local[0]}tests/sky-courier/index.html?renderer=webgpu`);
    await page.waitForFunction(() => window.ready === true, null, { timeout: 90000 });
    const r = await page.evaluate(() => {
      const e = window.engine, g = window.game, out = {};
      e.haltLoop();
      const step = n => { for (let i = 0; i < n; i++) e.step(1 / 60, { describe: false }); };
      const snap = () => { const names = []; e.scene.traverse(o => names.push(o.name || o.type));
        return { names: names.sort(), post: e.post.list().map(p => p.name), fog: !!e.scene.fog, background: !!e.scene.background, tone: e.renderer.toneMapping, picture: e.picture?.constructor === Object }; };
      step(5);
      out.before = snap();
      e.use(g.brightLook()); step(3);
      out.first = snap(); out.slots = e.describe('picture').picture.slots;
      e.use(g.asciiLook(), { replaces: 'picture' }); step(3);
      out.other = snap();
      e.use(g.brightLook(), { replaces: 'picture' }); step(3);
      out.again = snap();
      e.unuse('brightCartoon'); step(3);
      out.after = snap();
      const w = e.describe('picture').picture.writers;
      out.tracked = w.tracked; out.leftovers = w.leftovers;
      return out;
    });
    const J = v => JSON.stringify(v), diff = (a, b) => [...a.filter(n => !b.includes(n)).map(n => '-' + n), ...b.filter(n => !a.includes(n)).map(n => '+' + n)];
    check('the tracker runs, so silence means something', r.tracked === true, J(r.tracked));
    check('the two looks differ', J(r.first.names) !== J(r.other.names) || J(r.first.post) !== J(r.other.post), J(diff(r.first.names, r.other.names)));
    check('[guard] back on the first look: the same scene, post chain and values as the first time', J(r.again) === J(r.first), J([diff(r.first.names, r.again.names), r.first.post, r.again.post, r.first.tone, r.again.tone]));
    check('[guard] the look gone: the scene as it was before any', J(r.after) === J(r.before), J([diff(r.before.names, r.after.names), r.before.post, r.after.post, r.before.fog, r.after.fog, r.before.tone, r.after.tone]));
    check('[guard] no leftover in describe', r.leftovers.length === 0, J(r.leftovers));
    const said = warnings.filter(w => /picture-leftover|picture-held|picture-conflict|PAGE ERROR/.test(w));
    check('[guard] no leftover or stray hint in the console', said.length === 0, said.join(' | ').slice(0, 900));
  } finally {
    await browser.close();
    await server.close();
    process.env.NODE_ENV = env;
  }
}
