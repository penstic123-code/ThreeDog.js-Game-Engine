// R35 no hidden look defaults (packages/engine/docs/recipes/52-look.md): every param of a defineLookPart(engine, { params }) spec
//   · declares default (the value the engine uses when nobody sets it), and
//   · when that default changes the picture, says why it is there and off (how to turn it off); a default that changes nothing is marked neutral: true.
// Level: error in engine code (core / modules / render / ui), warning in style packs and games (third-party parts are told, not blocked).
// Detection: the AST of each defineLookPart call; params is an object literal written inline or a const in the same file, each param an object
//   literal (const ids resolve too). Known limit: params built at runtime (spread of an imported object, a computed key) are not seen; the
//   runtime still throws for a missing default (core/look/part.js).
// Why: a default that changes the picture but appears nowhere (placeholder lights without a sky, the cloud-shadow patch on every material)
//   is the first thing that surprises a game; declared, describe().look and engine.catalog('look.<part>') show it with its off switch.
import { ts, walk, parse, lineOf, visit, constInit, engineFiles, isEngineCode, P } from './_lib.mjs';

const resolve = (sf, n) => (n && ts.isIdentifier(n) ? constInit(sf, n.text) : n);
const propName = p => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null);
const propsOf = obj => new Map(obj.properties.filter(p => ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)).map(p => [propName(p), p]));

function check(file, out) {
  const sf = parse(file), level = isEngineCode(file) ? 'error' : 'warn';
  visit(sf, n => {
    if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== 'defineLookPart') return;
    const spec = resolve(sf, n.arguments[1]);
    if (!spec || !ts.isObjectLiteralExpression(spec)) return;
    const sp = propsOf(spec), id = sp.get('id')?.initializer?.text ?? '?';
    const params = resolve(sf, sp.get('params')?.initializer);
    if (!params || !ts.isObjectLiteralExpression(params)) return;
    for (const p of params.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const key = propName(p), v = resolve(sf, p.initializer);
      if (!v || !ts.isObjectLiteralExpression(v)) continue;
      const f = propsOf(v), neutral = f.get('neutral')?.initializer?.kind === ts.SyntaxKind.TrueKeyword;
      const missing = ['default', ...(neutral ? [] : ['why', 'off'])].filter(k => !f.has(k));
      if (missing.length) out.push({ level, file, line: lineOf(p), msg: `look.${id} param ${key} has no ${missing.join(' / ')}`,
        fix: "every look param declares default; a default that changes the picture adds why: 'what it is for' and off: 'how to turn it off' (or neutral: true when it changes nothing)" });
    }
  });
}

export default {
  id: 'R35', title: 'Look part defaults are declared (default, and why / off when they change the picture)', game: true,
  run() {
    const out = [];
    const files = new Set([...engineFiles(), ...walk(P.STYLES_REL, ['.js', '.mjs']), ...P.SOURCE_DIRS_REL.flatMap(d => walk(d, ['.js', '.mjs']))]);
    for (const f of files) if (/defineLookPart\s*\(/.test(parse(f).text)) check(f, out);
    return out;
  },
};
