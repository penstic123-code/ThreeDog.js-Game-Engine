// Doc rule tests (no browser): R18 finds stale names in fixture docs and lets placeholders through; R22 checks the AI.md entry table;
// the GAMEMAP template section renders templates, placements, spawns and a missing op.
import { checkDoc, context } from '../rules/R18-doc-refs.mjs';
import { entryTable, sentences, passages } from '../rules/R22-doc-shape.mjs';
import { templateLines, declaredEvents, eventLines } from '../gamemap/extra.mjs';
import { RECIPES_REL } from '../paths.mjs';

export const name = 'doc rules: R18 references, R22 entry table and copied passages, GAMEMAP templates';

export async function run({ check }) {
  const ctx = await context(), doc = `${RECIPES_REL}/99-fixture.md`;
  const errs = text => checkDoc(doc, text, ctx);
  const has = (r, re) => r.some(x => re.test(x.msg));
  check('R18: a stale test name is an error with close names', has(errs('Run `npm test -- zzz-no-such-test`.'), /matches no test/));
  check('R18: a real test name passes', !errs('Run `npm test -- "dev bridge"`.').length);
  check('R18: an unknown event warns, a real one passes', has(errs('Listen to `quest:doen`.'), /did you mean `quest:done`/) && !errs('Listen to `quest:done`.').length);
  check('R18: placeholder paths and clock times pass', !errs('Edit `games/<game>/content/npcs.js` or `recipes/NN-x.md`; open at `18:30`.').length);
  check('R18: a monorepo path in a shipped doc is an error', has(errs('See `packages/engine/docs/AI.md`.'), /monorepo path/));
  check('R18: a missing recipe path suggests the right one', has(errs('Read `recipes/02-npcs.md`.'), /did you mean/));
  check('R18: unknown CLI command / npm script', has(errs('`npx threedog descibe`'), /did you mean `threedog describe`/) && has(errs('`npm run chek`'), /npm run check/));
  check('R18: engine member typo warns with a suggestion', has(errs('Call `engine.clok.after(2, fn)`.'), /engine\.clock/) && has(errs('`engine.clock.aftr`'), /engine\.clock\.after/));
  // [守] 引擎文档里的 API 名必须真实存在：AI 把文档里的名字当事实抄，改名必须连文档一起改，所以在 docs/ 下是 error 不是 warn
  check('R18: an unknown engine member in an engine recipe is an error, `look.x` is read as engine.look.x',
    errs('Call `engine.clok.after(2, fn)`.').some(x => x.level === 'error') && has(errs('`look.materals.glow`'), /engine\.look\.materials/) && !errs('`look.materials.glow`').length);
  check('R18: an ignore marker skips the line', !errs('`npm test -- zzz` <!-- r18-ignore-line -->').length);
  // R22
  const table = rows => `## One thing, one entry point\n| To do | Use | Recipe |\n|---|---|---|\n${rows}\n## Next\n`;
  const exists = r => r === 'recipes/02-npc.md';
  check('R22: a namespace without a row is named', entryTable(table('| Talk | `engine.dialogue` | `recipes/02-npc.md` |'), ['dialogue', 'quests'], exists).some(x => /engine\.quests/.test(x.msg)));
  check('R22: a row pointing at a missing recipe is an error', entryTable(table('| Talk | `engine.dialogue` | `recipes/03-nope.md` |'), ['dialogue'], exists).some(x => /does not exist/.test(x.msg)));
  check('R22: a complete table passes', !entryTable(table('| Talk | `engine.dialogue` | `recipes/02-npc.md` |'), ['dialogue'], exists).length);
  check('R22: sentences of 12+ words are compared, short ones and code are not',
    sentences('One two three four five six seven eight nine ten eleven twelve.\nShort one.\n```\na b c d e f g h i j k l m\n```').length === 1);
  // [守] 一个事实一个出处：30 个词以上的段落出现在两份文档里就报错，29 个词或代码块里的不算
  const w = n => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  check('R22: a 30-word passage in two docs is found once, 29 words is not, code blocks are not',
    passages([['a.md', `Intro.\n${w(40)}\n`], ['b.md', `Other.\n${w(35)} tail\n`]]).length === 1 && !passages([['a.md', w(29)], ['b.md', w(29)]]).length
    && !passages([['a.md', '```\n' + w(40) + '\n```'], ['b.md', '```\n' + w(40) + '\n```']]).length);
  // GAMEMAP templates / events
  const c = { templates: { crate: { model: 'crate', collide: true, interact: { op: 'crate.open', label: 'open' }, container: { capacity: 6 }, state: { open: false } } },
    props: [{ template: 'crate', place: 'home', x: 1, z: 2 }, { model: 'tree', x: 0, z: 0 }] };
  const rows = templateLines(c, [], f => f).join('\n');
  check('GAMEMAP: a template row shows model, op, container, state and placements', /\| crate \| crate \| true \| crate\.open \/ open/.test(rows) && /6 slots/.test(rows) && /open=false/.test(rows) && /1 placed \(home\)/.test(rows), rows);
  check('GAMEMAP: an interact op the game never defines is flagged', /op "crate\.open" not defined/.test(rows));
  const ev = eventLines({ 'door:open': { emit: ['main.js'], on: [] } }, new Map([['door:close', { args: '[]', doc: '', file: 'events.d.ts' }]])).join('\n');
  check('GAMEMAP: undeclared and never-emitted events are flagged', /emitted but not declared/.test(ev) && /declared but never emitted/.test(ev), ev);
  check('GAMEMAP: no d.ts means no declared events', declaredEvents(RECIPES_REL, f => f).size === 0);
}
