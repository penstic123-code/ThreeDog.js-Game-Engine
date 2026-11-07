// Rule R65 on fixture texts: a dropped registration is found, a tracked, forwarded or key-pressing one is not, and the engine's modules pass.
import { ts } from '../rules/_lib.mjs';
import rule, { loose } from '../rules/R65-registration-leaves.mjs';

export const name = 'rule R65: a registration leaves with its module';

const names = text => loose(ts.createSourceFile('f.js', text, ts.ScriptTarget.Latest, true)).map(r => r.name).join();

export async function run({ check }) {
  check('a dropped world.present is found', names("e.world.present('k', { build });\n") === 'present');
  check('a handle kept in a field is still found: the tag says who gives it back', names('this.h = e.rays.addProvider(fn);\n') === 'addProvider');
  check('inside ctx.track it passes', names("ctx.track(e.input.touchButton('a', 'b'));\n") === '');
  check('inside a destructured track it passes', names("track(w.simulate('k', o));\n") === '');
  check('a method of the same name only forwards', names('class W { present(k, o) { return this._v.present(k, o); } }\n') === '');
  check('input.simulate presses a key', names("e.input.simulate('jump');\n") === '');
  check('every engine module passes', rule.run().length === 0, JSON.stringify(rule.run().slice(0, 3)));
}
