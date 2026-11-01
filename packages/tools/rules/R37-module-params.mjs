// R37 module options without a params schema (the todo count of decision 2026-11-01 #1: readParams is the one validator)
// A module definition (an object literal with name: '...' and install) built by a factory that takes an options parameter (opts / options / all)
// should carry `params` (a readParams schema), so engine.catalog(name) shows the options and their defaults and a misspelled one throws in dev.
// Warning only: each hit is a module still on the hand-written checkOptions key list. Fix: `readParams(name, PARAMS, opts)` at the top of the factory
// and `params: PARAMS, options: opts` on the definition (keysSchema(KEYS) is the quick form when the values take several shapes).
import { ts, parse, visit, engineFiles, lineOf } from './_lib.mjs';

const OPT_NAMES = new Set(['opts', 'options', 'all']);
const hasProp = (obj, name) => obj.properties.some(p => p.name?.getText() === name);
const isModuleDef = obj => hasProp(obj, 'install') && obj.properties.some(p => p.name?.getText() === 'name' && ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer));
const optionsParam = fn => fn.parameters.find(p => ts.isIdentifier(p.name) && OPT_NAMES.has(p.name.text));
function factoryOf(n) { for (let p = n.parent; p; p = p.parent) if (ts.isFunctionLike(p) && !ts.isMethodDeclaration(p)) return p; return null; }

export default {
  id: 'R37', title: 'module options without a params schema',
  run() {
    const out = [];
    let withParams = 0;
    for (const f of engineFiles()) {
      if (!f.includes('/modules/')) continue;
      visit(parse(f), n => {
        if (!ts.isObjectLiteralExpression(n) || !isModuleDef(n)) return;
        const fn = factoryOf(n);
        if (!fn || !optionsParam(fn)) return;   // takes no options: nothing to describe
        if (hasProp(n, 'params')) { withParams++; return; }
        const name = n.properties.find(p => p.name?.getText() === 'name').initializer.text;
        out.push({ level: 'warn', file: f, line: lineOf(n), msg: `module ${name} takes options but has no params schema (engine.catalog shows none)`,
          fix: "readParams(name, PARAMS, opts) at the top of the factory and `params: PARAMS, options: opts` on the definition (keysSchema(KEYS) is the quick form)" });
      });
    }
    out.note = `${out.length} modules still without params, ${withParams} with`;
    return out;
  },
};
