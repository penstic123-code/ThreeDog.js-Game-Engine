// R5 engine.onFrame / onFixed called directly in a module with the return value dropped → warning.
// Why: dropping the returned cancel handle means the callback can never be removed (it keeps running after the module unloads or the object is deleted); also engine.profile() times per module,
//       and an onFrame callback is not counted under the module name, so you cannot see who is slow.
// Criteria (syntax tree): in packages/engine/modules and packages/engine/ui, `xxx.onFrame(...)` / `xxx.onFixed(...)` standing alone as a statement (return value not assigned to anything).
//   In a constructor / install it means "resident for every module": use the module's frame / fixed hook instead; elsewhere it means "one more per call": the handle must be kept and removed.
// Limitation: keeping the return value but never calling it is not detected here.
import { ts, parse, visit, engineFiles, lineOf, E, reE } from './_lib.mjs';

// Allowlist: [file, snippet contained in the line, reason]
const ALLOW = [
  [E('ui/UI.js'), 'f.done', 'fadeScreen is attached once per engine (WeakMap cache), no module hook available'],
];

function where(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isConstructorDeclaration(p)) return { ctx: 'constructor', resident: true };
    if ((ts.isMethodDeclaration(p) || ts.isPropertyAssignment(p) || ts.isFunctionDeclaration(p)) && p.name) {
      const n = p.name.getText();
      return { ctx: n === 'install' ? 'install' : `${n}()`, resident: n === 'install' };
    }
  }
  return { ctx: 'file top level', resident: true };
}

export default {
  id: 'R5', title: 'onFrame/onFixed attached directly in a module',
  run() {
    const out = [];
    for (const f of engineFiles().filter(f => reE('(modules|ui)\\/').test(f))) {
      visit(parse(f), n => {
        if (!ts.isExpressionStatement(n) || !ts.isCallExpression(n.expression)) return;
        const c = n.expression.expression;
        if (!ts.isPropertyAccessExpression(c) || !/^on(Frame|Fixed)$/.test(c.name.text)) return;
        const text = n.getText();
        if (ALLOW.some(([af, frag]) => af === f && text.includes(frag))) return;
        const { ctx, resident } = where(n), hook = c.name.text === 'onFrame' ? 'frame' : 'fixed';
        out.push({ level: 'warn', file: f, line: lineOf(n), msg: `${c.getText()}(…) in the ${ctx} does not keep the returned cancel handle`,
          fix: resident ? `use the module's ${hook}(dt, e) hook (profile can count it); if you must, this._off = ${c.getText()}(…) and call it on delete/unload`
            : `const off = ${c.getText()}(…), then call off() when done, otherwise every call attaches one more callback` });
      });
    }
    return out;
  },
};
