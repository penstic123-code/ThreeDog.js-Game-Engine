// R11 detaching a self-built mesh without releasing it (should be engine.remove) (warning, heuristic)
// API convention (see "Removing objects" in packages/engine/docs/AI.md): engine.remove(obj) = delete completely (detach, cancel the raycast registration, free geometry and material; shared assets are skipped);
// obj.removeFromParent() / group.remove(obj) only take it off, leaving geometry and material in video memory and the raycast registration in place.
// Criteria (in packages/engine/modules):
//   1. Find detach calls: <engine>.detach(X) (e / engine / this.engine / xx.engine), X.removeFromParent(), <scene|group|parent|object|root>.remove(X)
//      (<engine>.remove(X) is the right form and is not reported)
//   2. If the same function already releases by hand (any .dispose( call, engine.remove(X)) → not reported (the author is releasing one by one)
//   3. Report only if X looks like the module's own mesh: the last name segment is mesh / root / object / model / visual / points / helper / group or the like;
//      or the file assigns that name from new / a function call; or X is a parameter of the enclosing function (e.g. dispose: o => … of stream).
// Limitation: a purely textual heuristic with no data-flow tracking: if X is an object handed in by the game (the game releases it), it is a false positive (use the allowlist);
//      releasing in another function (e.g. a separate dispose() method after detaching) is also a false positive.
import { esc } from '../lib/text.mjs';
import { ts, parse, visit, engineFiles, lineOf, read, E, P } from './_lib.mjs';

// Allowlist: [file, removed expression, reason]
const ALLOW = [
  [E('modules/content/models.js'), 'o', 'unloading a prop or template instance only takes it off: geometry and material are a prototype shared by same-model records and are cloned again on approach (releasing them would break other copies)'],
  [E('modules/level/nodes.js'), 'c', 'a tagged level node leaves the level root to become a world record: its model is placed again when the record streams back in (a shared prototype), so it is only taken off'],
  [E('modules/level/nodes.js'), 'o', 'a level record node is only taken off when its record streams out: it is re-added from the nodes map on approach, so geometry and material must stay'],
];
const ENGINE_RECV = /^(e|engine|this\.engine|this\.e|[\w.]+\.engine)$/;
const OBJ_RECV = /(scene|group|Group|parent|object|root)\??$/;

function enclosingFn(n) { for (let p = n.parent; p; p = p.parent) if (ts.isFunctionLike(p) && p.body && !ts.isArrowFunction(p)) return p; return n.getSourceFile(); }
function isParam(n, name) { for (let p = n.parent; p; p = p.parent) if (ts.isFunctionLike(p) && p.parameters.some(x => x.name.getText() === name)) return true; return false; }

export default {
  id: 'R11', title: 'Detaching a self-built mesh without releasing it (should be engine.remove)',
  run() {
    const out = [];
    for (const f of engineFiles().filter(f => P.under(f, P.MODULES_REL))) {
      const text = read(f);
      visit(parse(f), n => {
        if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
        const m = n.expression.name.text, recv = n.expression.expression.getText();
        let X = null, how = '';
        if (m === 'removeFromParent' && n.arguments.length === 0) { X = recv; how = `${X}.removeFromParent()`; }
        else if (m === 'remove' && n.arguments.length === 1 && !ts.isStringLiteral(n.arguments[0]) && !ts.isNumericLiteral(n.arguments[0])) {
          if (!ENGINE_RECV.test(recv) && OBJ_RECV.test(recv)) { X = n.arguments[0].getText(); how = `${recv}.remove(${X})`; }
        }
        if (!X || ALLOW.some(([af, x]) => af === f && x === X)) return;
        const body = enclosingFn(n).getText(), x = esc(X.replace(/\?/g, ''));
        if (new RegExp(`\\.dispose\\(|\\.remove\\([^)]*${x}`).test(body.replace(/\?/g, ''))) return;
        const last = X.replace(/\?/g, '').split('.').pop();
        const meshy = /^_?(mesh|root|object|obj|model|visual|points|helper|group|debugGroup|line|sprite)$/i.test(last);
        const created = meshy || new RegExp(`\\b${esc(last)}\\s*(=(?!=)|:)\\s*[^,;\\n]*?(new\\s|\\w\\()`).test(text);
        if (!created && !isParam(n, X)) return;
        out.push({ level: 'warn', file: f, line: lineOf(n), msg: `${how} only detaches without releasing (${X} looks like this module's own mesh)`,
          fix: 'use engine.remove(the same object) (detach + cancel the raycast registration + free geometry and material; shared asset-cache ones are skipped); use engine.detach only when it will be added back later' });
      });
    }
    return out;
  },
};
