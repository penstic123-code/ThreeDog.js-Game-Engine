// Content validation for game content kinds and the newer quest shapes (no browser): a throwaway game folder in the OS temp dir
// goes through checkGame (content-check) and the GAMEMAP kind section, so both read the same contentFiles() + rules.js kinds table.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkGame } from '../content-check.mjs';
import { loadGame } from '../content-check/load.mjs';
import { kindMapLines } from '../content-check/kinds.mjs';

export const name = 'content-check: game content kinds (rules.js kinds), quest all / optional / fail, positions with floor';

const FILES = {
  'main.js': "engine.quests.start('q1'); engine.quests.start('q2');\n",
  'content/rules.js': `export default { kinds: {
    recipes: { desc: 'crafting recipes', load() {}, map: d => Object.entries(d).map(([id, r]) => id + ' -> ' + r.makes),
      check(data, ctx) { for (const [id, r] of Object.entries(data)) if (!ctx.data.items?.[r.makes]) ctx.err('recipe ' + id + ' makes unknown item ' + r.makes); } },
    waves: { desc: 'enemy waves', load() {} },
    towers: { desc: 'no load: main.js imports the file itself' },
    items: { desc: 'clash', load() {} },
  } };\n`,
  'content/items.js': "export default { bread: { name: 'Bread' } };\n",
  'content/recipes.js': "export default { toast: { makes: 'bred' }, loaf: { makes: 'bread' } };\n",
  'content/waves.js': "export default [{ id: 'w1' }, { id: 'w2' }];\n",
  'content/towers.js': "export default { arrow: { cost: 1 } };\n",
  'content/enemies.js': 'export default {};\n',
  'content/quests.js': `export default {
    q1: { title: 'a', steps: [{ text: 's', done: { flag: 'x' }, optional: true }], onFail: { setFlag: 'y' } },
    q2: { title: 'b', steps: [{ all: [{ text: 'p', done: { flag: 'x' }, optional: true }] }], fail: { flagg: 'z' } },
  };\n`,
  'content/props.js': "export default [{ model: 'm', x: 0, z: 0, floor: 'two' }];\n",
};

/** What the page really loads: the same content folder under different content/index.js files */
async function listedCases(dir, check) {
  const index = join(dir, 'content', 'index.js');
  const try_ = async src => { writeFileSync(index, src); const { errors, warnings } = await checkGame(dir); return { errors: errors.filter(e => /index\.js: /.test(e)), all: errors, warnings }; };
  const head = "import items from './items.js'; import waves from './waves.js'; import recipes from './recipes.js'; import quests from './quests.js'; import props from './props.js';\n";
  const noRules = await try_(head + 'export default { items, waves, recipes, quests, props };\n');
  check('[guard] a kind listed in content/index.js without `rules` is an error: a green check means the page can load its content',
    noRules.errors.some(e => /lists "waves" but not `rules`.*unknown content "waves"/.test(e)), noRules.errors.join('\n'));
  const ok = await try_(head + "import rules from './rules.js';\nexport default { items, waves, recipes, quests, props, rules };\n");
  check('with `rules` listed the same game has no index error, and no file is called unlisted', !ok.errors.length && !ok.warnings.some(w => /not listed/.test(w)), [...ok.errors, ...ok.warnings].join('\n'));
  check('[guard] a file the index leaves out is no content: one warning, no error',
    !ok.all.some(e => /enemies\.js/.test(e)) && ok.warnings.filter(w => /enemies\.js/.test(w)).length === 1, [...ok.all, ...ok.warnings].join('\n'));
  const listsIt = await try_("import enemies from './enemies.js';\nexport default { enemies };\n");
  check('[guard] the same file listed in the index is the unknown-content error', listsIt.all.some(e => /enemies\.js: unknown content "enemies"/.test(e)), listsIt.all.join('\n'));
  const glob = await try_("import { contentParts } from 'threedog';\nconst props = contentParts(import.meta.glob('./props/*.js', { eager: true }));\nexport default { props, /* waves, */ waves2: 1 };\n");
  check('index.js is read as source, so import.meta.glob is fine, comments are skipped, and an unknown name is the loader\'s error',
    glob.errors.some(e => /unknown content "waves2"/.test(e)) && !glob.errors.some(e => /waves"/.test(e)), glob.errors.join('\n'));
  const short = await try_("import items from './items.js';\nimport rules from './rules.js';\nexport default { items, rules };\n");
  check('an engine file or a kind with load that index.js leaves out is a warning naming the file', short.warnings.some(w => /quests\.js: is not listed/.test(w)) && short.warnings.some(w => /waves\.js: is not listed/.test(w)) && !short.errors.length, short.warnings.join('\n'));
  // the shape lib pull writes: a spread inside a value is no spread of the export, and the names after a nested } still count
  const nested = await try_("import items from './items.js';\nimport waves from './waves.js';\nimport rules from './rules.js';\nexport default { items: { ...items, extra: 1 }, rules, waves };\n");
  check('[guard] content/index.js is read past a nested object: names after it are listed, a file left out is still named', nested.warnings.some(w => /quests\.js: is not listed/.test(w)) && !nested.warnings.some(w => /waves\.js: is not listed/.test(w)), nested.warnings.join('\n'));
  const spread = await try_("import rest from './rest.js';\nexport default { ...rest };\n");
  check('an export that spreads something in is not guessed at', !spread.errors.length && !spread.warnings.some(w => /not listed/.test(w)), spread.warnings.join('\n'));
  rmSync(index);
}

/** What the flag warnings and the props shape say, on a game of their own */
async function flagCases(check) {
  const dir = mkdtempSync(join(tmpdir(), 'threedog-flags-'));
  try {
    mkdirSync(join(dir, 'content'));
    writeFileSync(join(dir, 'main.js'), "if (flags.seen === true) go();\n");
    writeFileSync(join(dir, 'content/dialogues.js'), "export default { a: { nodes: { start: { text: 'x', choices: [{ text: 'y', if: { flag: 'seen' } }, { text: 'z', if: { notFlag: 'never' } }] } } } };\n");
    writeFileSync(join(dir, 'content/props.js'), "export default { a: { model: 'm' } };\n");
    const { errors, warnings } = await checkGame(dir);
    check('[guard] a flag code only compares is still never set', warnings.some(w => /story flag seen.*can never be met/.test(w)), warnings.join('\n'));
    check('[guard] notFlag of a flag nothing sets always holds, it is not "never met"', warnings.some(w => /story flag never.*always holds/.test(w)), warnings.join('\n'));
    check('[guard] props.js that exports an object is the "must export a list" error', errors.some(e => /props\.js must export a list/.test(e)), errors.join('\n'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export async function run({ check }) {
  await flagCases(check);
  const dir = mkdtempSync(join(tmpdir(), 'threedog-kinds-'));
  try {
    mkdirSync(join(dir, 'content'));
    for (const [f, src] of Object.entries(FILES)) writeFileSync(join(dir, f), src);
    const { errors, warnings } = await checkGame(dir);
    const has = re => errors.some(e => re.test(e));
    check('[guard] a registered kind file is read (not "unknown"), an unregistered one is refused with how to register it',
      !errors.some(e => /recipes\.js: unknown content|waves\.js: unknown content/.test(e)) && has(/enemies\.js: unknown content "enemies".*kinds: \{ enemies:/), errors.join('\n'));
    check('[guard] a kind with no load is a legal shape: nothing is said about it', ![...errors, ...warnings].some(l => /kind "towers"|towers\.js/.test(l)), [...errors, ...warnings].join('\n'));
    check("the kind's own check runs and points at its file", has(/recipes\.js: recipe toast makes unknown item bred/) && !has(/recipe loaf/), errors.join('\n'));
    check('a kind named like an engine file is an error', has(/kind "items" is an engine content file name/), errors.join('\n'));
    check('quests: optional on a plain step, only-optional parallel step, bad fail word are errors; onFail without fail warns',
      has(/step #1 of quest q1 has optional/) && has(/step #1 of quest q2 has only optional goals/) && has(/fail of quest q2 has an unknown word "flagg"/)
      && warnings.some(w => /quest q1 has onFail but no fail/.test(w)), [...errors, ...warnings].join('\n'));
    check('positions: floor must be a number', has(/floor of prop #1 must be a number/), errors.join('\n'));
    await listedCases(dir, check);
    const { data } = await loadGame(dir);
    const map = kindMapLines(data, s => s).join('\n');
    check('GAMEMAP lists each kind with map() lines or its ids', map.includes('**recipes**') && map.includes('toast -> bred') && map.includes('2 entries: w1, w2'), map);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
