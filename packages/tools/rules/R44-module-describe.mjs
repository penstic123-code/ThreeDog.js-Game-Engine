// R44 an engine module without a describe hook
// Why: engine.describe() is how an AI checks a module did its job without a screenshot ("is the music playing", "how many bodies sleep").
// A module that reports nothing is a blind spot: the AI has to guess or read three.js objects. So every module definition in packages/engine/modules
// (an object literal with name: '...' and install) carries `describe`, a compact state the AI needs to verify behaviour (core/Describe.js header).
// Error, not warning: a new module without one is caught at once instead of piling up like the old list did.
// Allowlist: a module that genuinely holds no state of its own, with the reason (ALLOW below). Keep it short; "it is small" is not a reason.
import { ts, parse, visit, engineFiles, lineOf, P, hasProp } from './_lib.mjs';

// [module name, reason]: modules that hold nothing an AI would check
const ALLOW = [];

const nameOf = obj => obj.properties.find(p => p.name?.getText() === 'name' && ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer))?.initializer.text;
/** Module definitions in one source file without describe: [{ name, node }] (exported so the rule test runs on fixture text) */
export function missingDescribe(sf) {
  const out = [];
  visit(sf, n => {
    if (!ts.isObjectLiteralExpression(n) || !hasProp(n, 'install')) return;
    const name = nameOf(n);
    if (!name || hasProp(n, 'describe')) return;
    out.push({ name, node: n });
  });
  return out;
}
/** Same on a text (the rule test) */
export const scanText = (text, file = 'mod.js') => missingDescribe(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)).map(m => m.name);

export default {
  id: 'R44', title: 'engine module without a describe hook',
  run() {
    const out = [], allow = new Map(ALLOW);
    let n = 0;
    for (const f of engineFiles()) {
      if (!f.startsWith(P.MODULES_REL + '/')) continue;
      for (const m of missingDescribe(parse(f))) {
        if (allow.has(m.name)) continue;
        n++;
        out.push({ level: 'error', file: f, line: lineOf(m.node), msg: `module ${m.name} has no describe hook: engine.describe() says nothing about it`,
          fix: 'add describe(e, ctx) { return { ...compact state an AI checks... }; } to the definition (see core/Describe.js), or add it to ALLOW in this rule with the reason it holds no state' });
      }
    }
    out.note = `${n} modules without describe, ${ALLOW.length} allowlisted`;
    return out;
  },
};
