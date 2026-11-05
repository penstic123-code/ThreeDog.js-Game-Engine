// R45 engine code fails in one shape
// Why: an AI reading an engine failure needs the same three things every time: a stable code, what to change, which page to read. A plain
// `throw new Error(text)` has none of them (the old hint table guessed them from the text with regexes, a second copy that drifted), and a bare
// console.warn repeats every frame and carries no fix. So in packages/engine code:
//   misuse (a wrong call, a typo)        -> throw codedError(code, message)   with an ERROR_CODES entry (core/base/errorCodes.js) saying where / why / how to fix
//   recoverable (a fallback was used)    -> warnOnce(coded(code, message))    (one dedupe, shared by all warnings, silenced by validate: false)
//   a game / module callback that threw  -> reportError(engine, err, where)   (the error tiers in core/base/errors.js)
// Flagged: `throw new Error(` / `throw new TypeError(` / `throw new RangeError(` and calls of console.warn / console.error, found in the syntax
// tree (comments and strings do not count). core/base/validate.js and core/base/errors.js are where warnOnce and reportError print, so they are exempt.
// Error, not warning: one plain throw invites the next.
// Allowlist: files with a genuine reason (ALLOW below), each with the reason. "It was like that" is not a reason.
import { ts, parse, visit, engineFiles, lineOf, P } from './_lib.mjs';

// [file under packages/engine, reason]
const ALLOW = [
  ['core/base/validate.js', 'warnOnce itself prints here'],
  ['core/base/errors.js', 'reportError itself prints here (the error tiers)'],
  ['core/threads/threadServe.js', 'runs inside a worker: no engine, no warnOnce switch; a failure without a task id has only the worker console'],
  ['render/shaderErrors.js', "replaces three.js's own shader-compile console.error: every failing program must print its full log, not once"],
  ['core/base/Events.js', 'an event bus used without an engine (no onError) has no error tiers to report to; with an engine it calls reportListenerError'],
];
const ERRORS = new Set(['Error', 'TypeError', 'RangeError']);

/** Plain throws and bare console calls in one source file: [{ what, node }] */
function plainFailures(sf) {
  const out = [];
  visit(sf, n => {
    if (ts.isThrowStatement(n) && n.expression && ts.isNewExpression(n.expression) && ts.isIdentifier(n.expression.expression)
      && ERRORS.has(n.expression.expression.text)) out.push({ what: `throw new ${n.expression.expression.text}(`, node: n });
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression)
      && n.expression.expression.text === 'console' && ['warn', 'error', 'info'].includes(n.expression.name.text)) out.push({ what: `console.${n.expression.name.text}(`, node: n });
  });
  return out;
}
/** Same on a text (the rule test) */
export const scanText = (text, file = 'mod.js') => plainFailures(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)).map(f => f.what);

const FIX = {
  throw: 'throw codedError(code, message) (core/base/errorHints.js) with an ERROR_CODES entry in core/base/errorCodes.js (reuse the module\'s code for the same kind of misuse); the message names the call and the fix',
  console: 'a recoverable problem: warnOnce(coded(code, message)) (core/base/validate.js); a note that is no problem: note(text, key?) (core/base/validate.js); a callback that threw: reportError(engine, err, where, { soft: true }) (core/base/errors.js)',
};

export default {
  id: 'R45', title: 'engine failure not in the one shape (codedError / warnOnce / reportError)',
  run() {
    const out = [], allow = new Set(ALLOW.map(([f]) => `${P.ENGINE_REL}/${f}`));
    let n = 0;
    for (const f of engineFiles()) {
      if (allow.has(f)) continue;
      for (const x of plainFailures(parse(f))) {
        n++;
        out.push({ level: 'error', file: f, line: lineOf(x.node), msg: `${x.what} in engine code: no code, no fix, no doc page for the reader`,
          fix: x.what.startsWith('throw') ? FIX.throw : FIX.console });
      }
    }
    out.note = `${n} plain throws / console calls, ${ALLOW.length} files allowlisted`;
    return out;
  },
};
