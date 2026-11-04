// R35 (no style table in engine code) and R48 (who may write a renderer-wide picture value), on fixture text and on the real engine.
import { LEVEL, tableReaches, default as r35 } from '../rules/R35-module-defaults.mjs';
import { strayWrites, WRITERS, default as r48 } from '../rules/R48-picture-writers.mjs';
import r14 from '../rules/R14-direct-material.mjs';
import { ts } from '../rules/_lib.mjs';

export const name = 'rules R14, R35 and R48: direct materials, style table, picture writers';

const sf = text => ts.createSourceFile('x.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

export async function run({ check }) {
  const hits = text => tableReaches('m.js', text.split('\n')).map(x => x.msg);
  check('R35 sees every entry of the style table', ['engine.look.fog.set({})', 'this.engine.style.grid', 'e.look.sky', "makeMaterial('x')", 'defineLookPart(e, {})'].every(l => hits(l).length === 1));
  check('R35 leaves DOM styles, the mouse and plain words alone', hits('el.style.top = 0; input.look.x; e.target.style; neutralMaterial("x")').length === 0);
  check('R35 skips comments and strings: an error text may name the old entry', hits('// engine.look.fog\n * makeMaterial()\nthrow new Error("engine.look is gone");').length === 0);
  check('R35 sees optional chains and a one-line destructuring', ['eng?.style?.lighting', 'const { style } = engine;', 'const { a, look } = this.engine;'].every(l => hits(l).length === 1));
  check('R35 leaves a destructured options object alone', hits('const { style: styleIn, canvas } = opts;').length === 0);
  const kinds = text => tableReaches('m.js', [text]).map(x => x.kind).join();
  check('R35 keeps engine.look apart from the table, so each can be raised alone', kinds('engine.style.x') === 'table' && kinds("makeMaterial('x')") === 'table' && kinds('engine.look.x') === 'layer');
  check('R35 is an error for both kinds and nothing is left to move', LEVEL.table === 'error' && LEVEL.layer === 'error' && r35.run().length === 0, JSON.stringify(r35.run().slice(0, 3)));

  check('R14 lets render/neutral.js make its material and reports nothing else there', r14.run().filter(x => /render\/neutral\.js$/.test(x.file)).length === 0);

  const writes = (file, text) => strayWrites(file, sf(text)).map(x => x.msg);
  check('R48 reports a module that writes exposure, the shadow switch or environment strength',
    ['r.toneMappingExposure = 1;', 'e.renderer.shadowMap.enabled = true;', 'r.shadowMap.type = 1;', 'scene.environmentIntensity = 2;'].every(t => writes('packages/engine/modules/x/a.js', t).length === 1));
  check('R48 leaves reads, a comparison and other shadow fields alone', writes('packages/engine/modules/x/a.js', 'const a = r.toneMappingExposure; a === r.shadowMap.enabled; light.shadow.mapSize = 2;').length === 0);
  check('R48 allows a listed file for its prop only', writes('packages/engine/core/shadows.js', 'r.shadowMap.enabled = true;').length === 0 &&
    writes('packages/engine/core/shadows.js', 'r.toneMappingExposure = 2;').length === 1);
  check('R48 rows all give a reason', WRITERS.every(w => w[2]?.length > 10));
  check('R48 passes on the engine as it is', r48.run().filter(x => x.level === 'error').length === 0, JSON.stringify(r48.run().slice(0, 3)));
}
