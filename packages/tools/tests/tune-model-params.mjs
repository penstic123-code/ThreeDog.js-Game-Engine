// threedog tune write, model params (tune.mjs planModelParams): a value tuned in the dev panel's models folder becomes the `default` of that
// field where the model is registered, in either registration shape, and nothing else in the file changes.
import { planModelParams } from '../tune.mjs';

export const name = 'tune write model params: panel values become the schema defaults at the registration (full and short field form)';

export async function run({ check }) {
  const src = `import { buildTree } from './art/tree.js';
export const pine = { build: buildTree, params: { height: { type: 'number', min: 1, max: 9, default: 3 }, leaf: 'color', kind: 'string' } };
export default [{ name: 'forest', models: { bush: { build: b => b, params: { size: { type: 'number' } } }, rock: () => null } }];
`;
  const p = planModelParams(src, { pine: { height: 4.5, leaf: '#335522' }, bush: { size: 2 }, rock: { x: 1 } });
  check('a full field gets its default replaced', p.after.includes("height: { type: 'number', min: 1, max: 9, default: 4.5 }"), p.after);
  check('a short field becomes the full form with the default (color as 0x)', p.after.includes("leaf: { type: \"color\", default: 0x335522 }"), p.after);
  check('a field without a default gets one; a model in a manifest object is found too', /size: \{ type: 'number', default: 2 \}/.test(p.after), p.after);
  check('a model without params is left alone; untouched fields stay', !p.done.includes('rock') && p.after.includes("kind: 'string'") && p.done.sort().join() === 'bush,pine', JSON.stringify(p.done));
  check('the diff names model, field and line', /@@ line 2 @@ pine\.params\.height/.test(p.diff), p.diff);
}
