// The interact key end to end, by a real key press. Why not through ops: the op always worked; what broke was a game where E reaches nothing while check, smoke,
// describe and ops all passed. So the guards press the keyboard, and the no-key case asserts every tool tells the truth.
const setup = async (ev, keys) => ev(async keys => {
  await __t.until(() => engine.stateApplied, 10000);
  if (keys !== undefined) engine.input.bind('interact', keys);
  const p = engine.actorPosition(), m = new window.THREE.Mesh();
  m.position.set(p.x + 0.5, p.y ?? 0, p.z); m.name = 'key-test'; engine.scene.add(m);
  window.used = 0;
  engine.interactions.add(m, { id: 'key-test', label: 'Pick up', onUse: () => { window.used++; } });
  return { offers: engine.ops.list({ available: true }).filter(o => o.name === 'interaction.use'), code: engine.ops.can('interaction.use', { id: 'key-test' }) };
}, keys);
const prompt = ev => ev(() => document.querySelector('.threedog-prompt')?.textContent ?? '');

export const specs = [
  {
    name: '[guard] interact key: a real E press uses the thing, and a rebound key keeps working (the old one stops)',
    url: '/tests/ui/index.html?mode=default&play',
    async run({ page, check, ev, frames }) {
      await setup(ev);
      await frames(3);
      check('the prompt names the key', (await prompt(ev)).startsWith('E'), await prompt(ev));
      await page.keyboard.press('KeyE'); await frames(4);
      check('E uses it', await ev(() => window.used) === 1);
      await ev(() => { engine.input.rebind('interact', ['KeyF']); });
      await frames(2);
      check('the prompt follows the rebind', (await prompt(ev)).startsWith('F'), await prompt(ev));
      await page.keyboard.press('KeyE'); await frames(4);
      await page.keyboard.press('KeyF'); await frames(4);
      check('only the new key uses it; a rebind is no error', await ev(() => window.used) === 2 && await ev(() => !engine.error), String(await ev(() => engine.error?.message)));
    },
  },
  {
    name: '[guard] interact key: a press that does nothing is on the record, with who holds the input',
    url: '/tests/ui/index.html?mode=default&play',
    async run({ page, check, ev, frames }) {
      await setup(ev);
      await frames(3);
      const last = () => ev(() => { const r = engine.ops.recent('interaction.use').at(-1); return r && { ok: r.ok, code: r.code, args: r.args, source: r.source }; });
      await ev(() => { window.lock = engine.input.push('dialog', { owner: 'dialogue' }); });
      await frames(2);
      await page.keyboard.press('KeyE'); await frames(4);
      const locked = await last();
      check('locked: E uses nothing, and the refusal names the context', await ev(() => window.used) === 0 && locked?.code === 'inputLocked' && locked.args.by === 'dialog' && locked.source === 'player', JSON.stringify(locked));
      check('the failure report of threedog test prints it', (await ev(() => __t.state())).some(l => l.includes('inputLocked by dialog')), JSON.stringify(await ev(() => __t.state())));
      await ev(() => { window.lock.remove(); });
      await frames(2);
      await ev(() => { for (const it of engine.interactions.items) it.enabled = () => false; });
      await page.keyboard.press('KeyE'); await frames(4);
      const none = await last();
      check('nothing in reach: the press is logged as nothingNear', none?.code === 'nothingNear', JSON.stringify(none));
    },
  },
  {
    name: '[guard] interact key: with no key at all the game keeps running, E does nothing, every tool says so, and code can still use it (a click-only game)',
    url: '/tests/uinokey/index.html',
    async run({ page, check, ev, frames }) {
      const before = await setup(ev);
      await frames(3);
      const r = await ev(() => ({ error: engine.error, frozen: engine.frozen, text: engine.describeText({ full: true }), unbound: engine.describe().input.unbound }));
      check('no key is not an error: play goes on', !r.error && !r.frozen, JSON.stringify(r.error));
      check('describe does not call it interactable', !r.text.includes('[interactable]') && r.text.includes('no key bound'), r.text.split('\n').filter(l => l.includes('Pick up')).join(' | '));
      check('describe().input.unbound lists it', r.unbound.includes('interact'), JSON.stringify(r.unbound));
      check('ops offer nothing no key reaches', before.offers.length === 0, JSON.stringify(before));
      check('code asking for it may run it', before.code.ok, JSON.stringify(before));
      const text = await prompt(ev);
      check('the prompt shows no empty key name', text && !text.startsWith(' ') && !text.startsWith('·'), JSON.stringify(text));
      await page.keyboard.press('KeyE'); await frames(4);
      check('E did nothing', await ev(() => window.used) === 0);
      await ev(() => engine.ops.run('interaction.use', { id: 'key-test' }));
      check('the op from code uses it', await ev(() => window.used) === 1);
    },
  },
  {
    name: '[guard] interact key: bound to [] on purpose is no error, the prompt shows only the label and a click still uses it',
    url: '/tests/uinokey/index.html',
    async run({ page, check, ev, frames }) {
      await setup(ev, []);
      await frames(3);
      check('no dev stop', await ev(() => !engine.error), String(await ev(() => engine.error?.message)));
      check('the prompt is the label alone', await prompt(ev) === 'Pick up', await prompt(ev));
      await page.click('.threedog-prompt'); await frames(3);
      check('a click on the prompt uses it', await ev(() => window.used) === 1);
    },
  },
];
