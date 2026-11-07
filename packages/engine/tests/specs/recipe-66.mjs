// Recipe 66 (docs/recipes/66-common-tasks.md): every section is run. Its game block builds a real engine, then its check block runs with the globals of `threedog js --file`
// (engine, step, assert, expect), through the same page function. threedog how prints these sections whole, so a stale one would mislead every AI that asks.
import { readFileSync } from 'node:fs';
import { jsBlocks, rewriteImports } from './recipe-56.mjs';
import { ev } from '@threedog/tools/page-fns';
import { pageDriver } from '@threedog/tools/scenario';

const DOC = new URL('../../docs/recipes/66-common-tasks.md', import.meta.url);
const TASKS = ['Pickup', 'Custom picture piece', 'Saved game value', 'Input action', 'Rain effect', 'Custom NPC behaviour', 'Custom path source', 'Two areas built in code', 'Climb a ladder'];
/** A section's parts: the first line is its heading */
const sections = text => text.split(/^## /m).slice(1).map(s => ({ title: s.split('\n')[0], blocks: jsBlocks(s), nofit: /\*\*When it does not fit:\*\*/.test(s) }));

// A section "In an existing game" holds only the lines to add, so it runs on a bare engine the way a game's main.js would hold them; what it declares reaches the check block
const HOST = "const T = __mod('threedog'), engine = T.createEngine({ canvas: document.getElementById('view'), bindings: { ...T.presets.bindings.walk, ...T.presets.bindings.interact } });";
const existing = s => {
  const code = s.blocks[0].code;
  if (!s.title.startsWith('In an existing game')) return code;
  const names = [...code.matchAll(/^const (\w+) =/gm)].map(m => m[1]);
  return [HOST, code, `Object.assign(window, { engine, ${names.join(', ')} });`, 'await engine.start();'].join('\n');
};

export const specs = [
  {
    name: '[guard] recipe 66: every common task example runs whole, with its check and cleanup',
    url: '/tests/recipe-66/index.html',
    software: false,   // nothing reads pixels
    timeout: 240000,
    async run({ check, ev: pageEv, page }) {
      const all = sections(readFileSync(DOC, 'utf8'));
      check('the most asked tasks each have a section', TASKS.every(t => all.some(s => s.title.startsWith(t))), all.map(s => s.title).join(' | '));
      check('each section has a game block, a check block and the next route', all.every(s => s.blocks.length === 2 && s.nofit), all.filter(s => s.blocks.length !== 2 || !s.nofit).map(s => s.title).join(' | '));
      check('each example stays short', all.every(s => s.blocks.every(b => b.code.split('\n').length <= 16)), all.filter(s => s.blocks.some(b => b.code.split('\n').length > 16)).map(s => s.title).join(' | '));
      check('each check block shows a cleanup', all.every(s => /cleanup/.test(s.blocks[1]?.code ?? '')), all.filter(s => !/cleanup/.test(s.blocks[1]?.code ?? '')).map(s => s.title).join(' | '));
      const driver = pageDriver(page), failed = [];
      for (const s of all) {
        const game = await pageEv(code => window.runGame(code), rewriteImports(existing(s)));
        if (!game.ok) { failed.push(`${s.title}: ${game.error}`); continue; }
        const r = await ev(driver, 'steps', { src: s.blocks[1].code, wait: 30 });
        const bad = (r.res ?? []).filter(x => !x.ok).map(x => `${x.msg}: ${x.detail}`);
        if (r.threw) bad.push(`threw ${r.threw}`);
        if (!r.res?.length) bad.push(`no check ran: ${JSON.stringify(r).slice(0, 200)}`);
        if (bad.length) failed.push(`${s.title}: ${bad.join('; ')}`);
      }
      check(`all ${all.length} sections run and their checks pass`, !failed.length, failed.join('\n'));
    },
  },
];
