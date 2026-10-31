// The content source-line walker (vite/vite-threedog-content-src.js) and the id writer built on it (content-ids.mjs), no browser.
// Why a unit test: "defined in content/props.js:14" and `threedog content ids --write` both trust the walker's index -> node mapping; an off-by-one
// there sends an author to the wrong line or writes an id into the wrong entry, and no browser test would notice.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseAst } from 'vite';
import { contentSrcCode, exportedLiteral } from '../vite/vite-threedog-content-src.js';
import { planIds } from '../content-ids.mjs';
import { checkGame } from '../content-check.mjs';

export const name = 'content source walker: line tables per index / key, spreads, const exports; content ids writes the dev-warning ids; renames are checked';

const tableOf = code => {
  const { out, defaultExpr } = contentSrcCode(parseAst(code), code, 'content/x.js');
  return { out: out.map(s => JSON.parse(s.slice(s.indexOf(', ') + 2, -2))), def: defaultExpr && { line: defaultExpr.line, type: defaultExpr.node.type } };
};

export async function run({ check }) {
  // export default <array>: the plugin wraps it (defaultExpr); lines come from the same table() at transform time
  const arr = "// head\nexport default [\n  { model: 'a' },\n\n  { model: 'b' },\n  ...more,\n  { model: 'c' },\n];\nconst more = [];\n";
  const a = tableOf(arr), node = exportedLiteral(parseAst(arr));
  check('export default [ … ]: the default literal is found at its line (wrapped, not registered)', a.def?.type === 'ArrayExpression' && a.def.line === 2 && !a.out.length, JSON.stringify(a));
  check('exportedLiteral gives that array; element starts map to their lines', node?.type === 'ArrayExpression' && arr.slice(0, node.elements[1].start).split('\n').length === 5, String(node?.type));
  // const + export default name: registered with an index -> line table that stops at a spread
  const named = "const props = [\n  { model: 'a' },\n  { model: 'b' }, ...x, { model: 'c' },\n];\nexport default props;\nexport const startItems = { berry: 2,\n  film: 1 };\n";
  const n = tableOf(named);
  const t = n.out.find(o => o.line === 5), s = n.out.find(o => o.line === 6);
  check('export default <const>: index table, entries after a spread fall back to the export line', JSON.stringify(t?.at) === '{"0":2,"1":3}', JSON.stringify(n.out));
  check('export const x = { … }: key table', JSON.stringify(s?.at) === '{"berry":6,"film":7}', JSON.stringify(s));
  check('exportedLiteral resolves export default <name> to the const literal', exportedLiteral(parseAst(named))?.type === 'ArrayExpression');

  // content ids: a throwaway game; the ids written are the ones the engine gives today (missingIds in content/ids.js)
  const dir = mkdtempSync(join(tmpdir(), 'td-ids-'));
  try {
    mkdirSync(join(dir, 'content'));
    writeFileSync(join(dir, 'main.js'), '\n');
    writeFileSync(join(dir, 'content/items.js'), "export default { berry: { name: 'Berry' } };\n");
    writeFileSync(join(dir, 'content/templates.js'), "export default { chest: { model: 'chest', state: { opened: false } }, fence: { model: 'fence' } };\n");
    writeFileSync(join(dir, 'content/pickups.js'), "export default [\n  { item: 'berry', x: 1, z: 2 },\n  { id: 'named', item: 'berry', x: 0, z: 0 },\n  {item: 'berry', x: 3, z: 3},\n];\n");
    writeFileSync(join(dir, 'content/props.js'), "const gen = [{ template: 'chest', x: 9, z: 9 }];\nexport default [\n  { template: 'fence', x: 0, z: 0 },\n  { template: 'chest', x: 1, z: 1 },\n  ...gen,\n];\n");
    writeFileSync(join(dir, 'content/renames.js'), "export default { 'chest:9': 'chest:1', 'pickup:berry:0': 'x', gone: null, old: 'nowhere', h: 'a#1', lv: 'town/door' };\n");
    const { errors } = await checkGame(dir), bad = re => errors.some(e => re.test(e));
    check('[guard] renames: a source content still defines, a target no entry has and a # target are errors; null and level-node targets pass',
      bad(/pickup:berry:0 is renamed but content still defines it/) && bad(/old -> nowhere: no content entry/) && bad(/h -> a#1/) && !bad(/chest:9/) && !bad(/gone/) && !bad(/town\/door/), errors.join('\n'));
    const plan = await planIds(dir);
    const lines = plan.files.flatMap(f => f.lines).join('\n');
    check('dry run lists -/+ lines with the index ids (pickups by item and index, stateful templates only)',
      lines.includes("+ { id: 'pickup:berry:0', item: 'berry', x: 1, z: 2 },") && lines.includes("+ { id: 'pickup:berry:2', item: 'berry', x: 3, z: 3},")
        && lines.includes("+ { id: 'chest:1', template: 'chest', x: 1, z: 1 },") && !lines.includes('fence:0') && !lines.includes("- { id: 'named'"), lines);
    check('an entry after a spread is listed for hand editing, not written', plan.manual.length === 1 && /props\.js\[2\]/.test(plan.manual[0]) && /chest:2/.test(plan.manual[0]), JSON.stringify(plan.manual));
    check('a dry run writes nothing', !readFileSync(join(dir, 'content/props.js'), 'utf8').includes("id: 'chest:1'"));
    const orig = readFileSync(join(dir, 'content/pickups.js'), 'utf8'), norm = x => x.replace(/ id: '[^']+',/g, '').replace(/\{ /g, '{');
    for (const f of plan.files) writeFileSync(f.path, f.after);   // what --write does
    const p2 = readFileSync(join(dir, 'content/pickups.js'), 'utf8');
    check('written files still parse and keep every other byte', !!parseAst(p2) && p2 !== orig && norm(p2) === norm(orig), p2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
