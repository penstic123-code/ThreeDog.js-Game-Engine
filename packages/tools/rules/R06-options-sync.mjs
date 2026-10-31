// R6 options-table consistency (two parts, both warnings)
// A. Fields of the d.ts options interface vs the runtime checkOptions(label, object, known keys):
//    in d.ts but not in checkOptions → a game written to the d.ts gets an "unknown option" hint at runtime;
//    in checkOptions but not in d.ts → npm run types reports the correct spelling as a "misspelled option", and the docs cannot find it.
//    How the matching d.ts type is found: derived from the conventional form of checkOptions' first argument (the label) —
//      'hud()'                → parameter 1 of hud(opts) in packages/engine/index.d.ts
//      'npcs.add()'           → the add method of the Engine npcs property type; parameter position = position of the checked variable in the JS function's parameters (if not found, the first object-typed parameter)
//      "flow.define('x')"     → the quoted part is ignored
//      'hud.marker().set()'   → the set method of marker's return type
//      'npcs.add() schedule'  → the schedule field of the parameter type (arrays use the element type); '.rule' likewise
//    Labels not in this form (e.g. 'timeline step') or types that cannot be resolved are skipped (the output shows the skip count).
// B. Names destructured from function parameters (function f({ a, b = 1 })) never read in the function body → warning (dead parameter);
//    only stored as this.x = x while nothing in the project (engine demo styles) reads .x → also a warning (catches things like NPC wander that are "declared but unused").
// Limitation: A only understands known-key arrays resolvable in the same file (literals, ...constants, ...Object.keys(constant)); B ignores variable shadowing and cannot see reads in a game repo.
import { ts, parse, visit, engineFiles, projectFiles, lineOf, read, stringArray, dtsProgram, abs, P } from './_lib.mjs';

// Allowlist: [label, key, reason] (part A); [file, name, reason] (part B)
const ALLOW_KEYS = [];
const ALLOW_PARAMS = [];

// ---------- d.ts type resolution ----------
function typeTools() {
  const program = dtsProgram(), checker = program.getTypeChecker();
  const exportsOf = f => { const sf = program.getSourceFile(abs(f)); const m = sf && checker.getSymbolAtLocation(sf); return m ? checker.getExportsOfModule(m) : []; };
  const indexFns = new Map(exportsOf(P.INDEX_DTS_REL).map(s => [s.name, s]));
  const engineSym = exportsOf(P.CORE_DTS_REL).find(s => s.name === 'Engine');
  const engineType = engineSym && checker.getDeclaredTypeOfSymbol(engineSym);
  const nn = t => checker.getNonNullableType(t);
  const prop = (t, name) => { t = nn(t); const p = checker.getPropertyOfType(t, name); return p ? checker.getTypeOfSymbol(p) : null; };
  const elem = t => { t = nn(t); return checker.isArrayType(t) ? checker.getTypeArguments(t)[0] : t; };
  const sigs = t => (t ? checker.getSignaturesOfType(nn(t), ts.SignatureKind.Call) : []);
  /** Field names of a type; null for Record/index signatures and non-objects */
  function fields(t) {
    t = nn(t);
    const parts = t.isUnion() ? t.types : [t];
    const names = new Set(); let any = false;
    for (const p of parts) {
      if (p.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.Undefined | ts.TypeFlags.Null)) continue;
      if (checker.getSignaturesOfType(p, ts.SignatureKind.Call).length && !checker.getPropertiesOfType(p).length) continue;
      if (checker.getIndexInfosOfType(p).length) return null;
      for (const s of checker.getPropertiesOfType(p)) { names.add(s.name); any = true; }
    }
    return any ? names : null;
  }
  const isObj = t => !!fields(t);
  return { indexFns, engineType, prop, elem, sigs, fields, isObj, checker };
}

/** label → { base, steps: [{call}|{prop}], tail: [fields…] } */
function parseLabel(label) {
  const s = label.replace(/\(\s*(['"`]).*?\1\s*\)/g, '()').replace(/\$\{[^}]*\}/g, 'X');
  const m = s.match(/^([A-Za-z_]\w*)((?:\.\w+|\(\))*)((?:[ .]\w+)*)\s*$/);
  if (!m || !m[2].includes('()')) return null;
  const steps = [...m[2].matchAll(/\.(\w+)|\(\)/g)].map(x => (x[1] ? { prop: x[1] } : { call: true }));
  return { base: m[1], steps, tail: m[3].trim() ? m[3].trim().split(/[ .]+/) : [] };
}

function resolveParamType(T, label, paramIndex) {
  const p = parseLabel(label);
  if (!p) return null;
  let t, steps = p.steps;
  if (steps[0]?.call && T.indexFns.has(p.base)) {
    const sym = T.indexFns.get(p.base);
    t = T.checker.getTypeOfSymbol(sym.flags & ts.SymbolFlags.Alias ? T.checker.getAliasedSymbol(sym) : sym);
  } else {
    if (!T.engineType) return null;
    t = T.prop(T.engineType, p.base);
  }
  for (let i = 0; i < steps.length && t; i++) {
    const s = steps[i], last = i === steps.length - 1;
    if (s.prop) { t = T.prop(t, s.prop); continue; }
    const sig = T.sigs(t)[0];
    if (!sig) return null;
    if (!last) { t = sig.getReturnType(); continue; }
    const params = sig.getParameters().map(x => T.checker.getTypeOfSymbol(x));
    t = paramIndex != null && params[paramIndex] && T.isObj(params[paramIndex]) ? params[paramIndex] : params.find(T.isObj);
  }
  for (const f of p.tail) { if (!t) return null; t = T.prop(T.elem(t), f); t = t && T.elem(t); }
  return t || null;
}

function enclosingFn(n) { for (let p = n.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return p; return null; }
/** Position of the checked variable in the outer function's parameters (opts = {} counts too) */
function paramIndexOf(call) {
  const arg = call.arguments[1];
  if (!arg || !ts.isIdentifier(arg)) return null;
  for (let fn = enclosingFn(call); fn; fn = enclosingFn(fn)) {
    const i = fn.parameters.findIndex(p => ts.isIdentifier(p.name) && p.name.text === arg.text);
    if (i >= 0) return i;
  }
  return null;
}

function partA(out, stats) {
  const T = typeTools();
  for (const f of engineFiles()) {
    const sf = parse(f);
    visit(sf, n => {
      if (!ts.isCallExpression(n) || n.expression.getText() !== 'checkOptions' || n.arguments.length < 3) return;
      const labelNode = n.arguments[0];
      const label = labelNode.getText().slice(1, -1);
      const known = stringArray(sf, n.arguments[2]);
      const t = resolveParamType(T, label, paramIndexOf(n));
      const dts = t && T.fields(t);
      if (!dts) { stats.skipped.push(`${f}:${lineOf(n)} ${label}`); return; }
      stats.matched++;
      const js = new Set(known.vals);
      const allow = k => ALLOW_KEYS.some(([l, kk]) => l === label && kk === k);
      const onlyDts = [...dts].filter(k => !js.has(k) && !allow(k));
      const onlyJs = [...js].filter(k => !dts.has(k) && !allow(k));
      if (onlyDts.length && known.complete) out.push({ level: 'warn', file: f, line: lineOf(n), msg: `${label}: in d.ts but unknown to checkOptions: ${onlyDts.join(', ')}`,
        fix: 'add these keys to the known keys of checkOptions (if they are really supported), otherwise delete them from the d.ts' });
      if (onlyJs.length) out.push({ level: 'warn', file: f, line: lineOf(n), msg: `${label}: known to checkOptions but missing from d.ts: ${onlyJs.join(', ')}`,
        fix: 'add these fields (with JSDoc) to the matching options interface in the d.ts, otherwise delete them from the known keys' });
    });
  }
}

// ---------- B: destructured parameters never read ----------
function partB(out) {
  const readCache = new Map();
  const readAnywhere = prop => {
    if (!readCache.has(prop)) {
      const re = new RegExp(`\\.${prop}\\b(?!\\s*=[^=>])`);
      readCache.set(prop, projectFiles().filter(f => !P.under(f, P.TOOLS_REL) && !P.under(f, P.ENGINE_TESTS_REL)).some(f => read(f).split('\n').some(l => re.test(l.replace(/\/\/.*$/, '')))));
    }
    return readCache.get(prop);
  };
  for (const f of engineFiles()) {
    visit(parse(f), fn => {
      if (!ts.isFunctionLike(fn) || !fn.body) return;
      for (const param of fn.parameters) {
        if (!ts.isObjectBindingPattern(param.name)) continue;
        for (const el of param.name.elements) {
          if (el.dotDotDotToken || !ts.isIdentifier(el.name)) continue;
          const name = el.name.text;
          if (ALLOW_PARAMS.some(([af, n]) => af === f && n === name)) continue;
          const refs = [];
          const scan = node => visit(node, x => {
            if (!ts.isIdentifier(x) || x.text !== name || x === el.name) return;
            const p = x.parent;
            if (ts.isPropertyAccessExpression(p) && p.name === x) return;
            if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) && p.name === x) return;
            if (ts.isBindingElement(p) && p.propertyName === x) return;
            refs.push(x);
          });
          scan(fn.body);
          for (const other of fn.parameters) if (other !== param) scan(other);
          for (const other of param.name.elements) if (other !== el && other.initializer) scan(other.initializer);
          const where = `${fn.name?.getText() || (ts.isConstructorDeclaration(fn) ? 'constructor' : 'anonymous function')}`;
          if (!refs.length) {
            out.push({ level: 'warn', file: f, line: lineOf(el), msg: `parameter ${name} of ${where} is destructured but never used`, fix: `implement it, or delete it from the parameters, the checkOptions known keys and the d.ts together` });
            continue;
          }
          // only stored as this.x = name: check whether anything in the project reads .x
          const stored = refs.map(r => r.parent).filter(p => ts.isBinaryExpression(p) && p.right.getText() === name && p.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isPropertyAccessExpression(p.left) && p.left.expression.kind === ts.SyntaxKind.ThisKeyword);
          if (stored.length === refs.length) {
            const prop = stored[0].left.name.text;
            if (!readAnywhere(prop)) out.push({ level: 'warn', file: f, line: lineOf(el), msg: `parameter ${name} of ${where} is only stored as this.${prop}, and nothing in the project reads .${prop}`,
              fix: `implement it (read this.${prop}), or delete it from the parameters, the checkOptions known keys and the d.ts together` });
          }
        }
      }
    });
  }
}

export default {
  id: 'R6', title: 'd.ts vs checkOptions table, dead parameters',
  run() {
    const out = [], stats = { matched: 0, skipped: [] };
    partA(out, stats);
    partB(out);
    out.note = `${stats.matched} checkOptions calls matched, ${stats.skipped.length} skipped because the label cannot be resolved to a d.ts type (add --verbose for the list)`;
    out.verbose = stats.skipped;
    return out;
  },
};
