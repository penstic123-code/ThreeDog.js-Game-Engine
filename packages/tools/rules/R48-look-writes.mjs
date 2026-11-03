// R48 a registered three.js look property is written by engine code only inside that look part's apply.
// Why: a look part (defineLookPart) owns a three.js property so that every layer (style, game, effect, settings, debug) and describe().look agree on
//   who set it. A second engine writer elsewhere (a module that sets renderer.toneMappingExposure on its own) is invisible to the layers: describe
//   says 'style' while something else is on screen, and the part's next apply silently overwrites it. One writer per property keeps that true.
// Criteria: in engine code (core / modules / render / ui), an assignment `<anything>.<prop> = ...` for a prop in PROPS below is an error unless it is
//   inside the apply of the defineLookPart call with that part id, or inside a function of the same file that apply reaches (called by name,
//   directly or through other functions of that file: apply often delegates, e.g. look.env's apply calls _envApply).
// PROPS: the three.js properties whose names are distinctive enough to match by name. Generic names (intensity, color, near, far) are not
//   listed: they would match unrelated objects; their parts are guarded by the runtime (core/owned.js yields to an outside write).
// ALLOW: writes outside apply that are not a second decision, each with its reason. Add an entry only with a reason a reviewer accepts.
import { ts, parse, visit, lineOf, engineFiles } from './_lib.mjs';

/** three.js property path (last segments of the assignment target) -> the look part id that owns it */
const PROPS = {
  toneMappingExposure: 'tone',
  'shadowMap.enabled': 'shadow',
  'shadowMap.type': 'shadow',
  environmentIntensity: 'env',
};

/** [file suffix, prop, reason]: writes outside the owning apply that are allowed */
const ALLOW = [
  ['core/startup.js', '*', 'the WebGL fallback copies every renderer setting onto the new renderer: a copy of the current value, not a decision'],
  ['modules/sky/frame.js', 'toneMappingExposure', 'the exposure driver (keyframes / a function set through look.tone) evaluated by the time-of-day system each frame, gated by its owned entry'],
  ['render/lights.js', 'environmentIntensity', 'the room-environment baseline the engine supplies without a sky; it marks the env part owned (markOwned) right after'],
];

const allowed = (file, prop) => ALLOW.some(([f, p]) => file.endsWith(f) && (p === '*' || p === prop));

/** 'a.b.c' for a property access chain ending the assignment target (only the names, no calls) */
function tail(node) {
  const names = [];
  for (let n = node; n && ts.isPropertyAccessExpression(n); n = n.expression) names.unshift(n.name.text);
  return names;
}
const propOf = target => {
  const names = tail(target);
  for (const k of Object.keys(PROPS)) { const want = k.split('.'); if (names.length >= want.length && want.every((w, i) => names[names.length - want.length + i] === w)) return k; }
  return null;
};

/** Function-like bodies of a file by name: function declarations, `name: function / arrow / method`, `const name = arrow` */
function namedFunctions(sf) {
  const out = new Map(), add = (name, node) => { if (!out.has(name)) out.set(name, []); out.get(name).push(node); };
  visit(sf, n => {
    if (ts.isFunctionDeclaration(n) && n.name) add(n.name.text, n);
    else if (ts.isMethodDeclaration(n) && n.name && ts.isIdentifier(n.name)) add(n.name.text, n);
    else if ((ts.isPropertyAssignment(n) || ts.isVariableDeclaration(n)) && n.name && ts.isIdentifier(n.name) && n.initializer
      && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) add(n.name.text, n.initializer);
  });
  return out;
}
/** Every node range apply reaches inside this file: apply itself plus the named functions it calls, transitively */
function reached(apply, fns) {
  const seen = new Set(), ranges = [], queue = [apply];
  while (queue.length) {
    const body = queue.pop();
    if (seen.has(body)) continue;
    seen.add(body); ranges.push([body.getStart(), body.getEnd()]);
    visit(body, n => {
      if (!ts.isCallExpression(n)) return;
      const c = n.expression, name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : null;
      for (const f of (name && fns.get(name)) || []) queue.push(f);
    });
  }
  return ranges;
}

function check(file, out) {
  const sf = parse(file);
  if (!Object.keys(PROPS).some(k => sf.text.includes(k.split('.').at(-1)))) return;
  // part id -> ranges inside which its props may be written
  const fns = namedFunctions(sf), ok = new Map();
  visit(sf, n => {
    if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== 'defineLookPart') return;
    const spec = n.arguments[1];
    if (!spec || !ts.isObjectLiteralExpression(spec)) return;
    const prop = name => spec.properties.find(p => p.name && ts.isIdentifier(p.name) && p.name.text === name);
    const id = prop('id')?.initializer, apply = prop('apply');
    if (!id || !ts.isStringLiteral(id) || !apply) return;
    ok.set(id.text, [...(ok.get(id.text) ?? []), ...reached(apply, fns)]);
  });
  visit(sf, n => {
    if (!ts.isBinaryExpression(n) || n.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
    const key = propOf(n.left);
    if (!key || allowed(file, key)) return;
    const part = PROPS[key], at = n.getStart();
    if ((ok.get(part) ?? []).some(([a, b]) => at >= a && at < b)) return;
    out.push({ level: 'error', file, line: lineOf(n), msg: `${key} is written outside the apply of look part '${part}'`,
      fix: `write it through the part: engine.look.${part}.set({ ... }) (or move the write into that part's apply); a copy that is not a decision goes in R48's ALLOW with its reason` });
  });
}

export default {
  id: 'R48', title: 'A registered three.js look property is written only inside its look part\'s apply',
  run() {
    const out = [];
    for (const f of engineFiles()) check(f, out);
    return out;
  },
};
