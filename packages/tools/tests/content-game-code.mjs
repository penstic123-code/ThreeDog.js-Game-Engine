// Content checks read a game's whole code, not only its top-level files. Why: the template puts gameplay in game/, and a scan of the
// top-level files called every key action of such a game unused while game/weapons.js held engine.input.pressed('fire'). Offline, a throwaway game.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkGame } from '../content-check.mjs';
import { gameCodeFiles } from '../lib/text.mjs';

export const name = 'game code in game/: content checks see it, tests and comments do not count';

export async function run({ check }) {
  const dir = mkdtempSync(join(tmpdir(), 'td-gamecode-'));
  const write = (f, text) => writeFileSync(join(dir, f), text);
  try {
    for (const d of ['content', 'game', 'game/combat', 'tests', 'tests/specs']) mkdirSync(join(dir, d));
    write('main.js', "import { createEngine } from 'threedog';\nconst engine = createEngine({ renderer: 'webgpu' });\n");
    write('vite.config.js', "engine.input.pressed('dead');\n");
    write('content/actions.js', "export default { fire: { keys: ['Mouse0'], label: 'Fire' }, aim: { keys: ['Mouse1'], label: 'Aim' }, stow: { keys: ['KeyQ'], label: 'Stow' }, dead: { keys: ['KeyX'], label: 'Dead' }, tested: { keys: ['KeyT'], label: 'Tested' }, noted: { keys: ['KeyN'], label: 'Noted' } };\n");
    write('content/dialogues.js', "export default { radio: { nodes: { start: { text: 'Hello' } } } };\n");
    write('game/weapons.js', "export const step = engine => { if (engine.input.pressed('fire')) engine.vars.flags.armed = true; };\n// engine.input.pressed('noted');\n");
    write('game/combat/aim.js', "export const step = engine => { if (engine.input.released('aim')) engine.dialogue.start('radio'); };\nexport const add = (engine, o) => engine.interactions.add(o, { action: 'stow' });\n");
    write('tests/specs/fire.mjs', "engine.input.pressed('tested');\n");

    const files = gameCodeFiles(dir).map(f => f.slice(dir.length + 1).replaceAll('\\', '/'));
    check('the game\'s code is every file at any depth, without tests and the vite config',
      files.includes('main.js') && files.includes('game/combat/aim.js') && !files.some(f => f.startsWith('tests/') || f.startsWith('vite.')), files.join());

    const { errors, warnings } = await checkGame(dir), unused = warnings.filter(w => /never uses it/.test(w)).map(w => /key action (\w+)/.exec(w)[1]).sort();
    check('no errors in the throwaway game', errors.length === 0, errors.join(' | '));
    check('an action read in game/, by released or named by an interaction counts as used; one read only in vite config, tests or a comment does not',
      unused.join() === 'dead,noted,tested', unused.join());
    check('a dialogue named in game/ is not called unused', !warnings.some(w => /dialogue radio/.test(w)), warnings.join(' | '));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
