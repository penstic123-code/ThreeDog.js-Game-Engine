// R37 module options without a params schema (error): readParams is the one validator of module options
// A module definition (an object literal with name: '...' and install) built by a factory that takes an options parameter (opts / options / all)
// should carry `params` (a readParams schema), so engine.catalog(name) shows the options and their defaults and a misspelled one throws in dev.
// Error: every module is on params now, so a new factory that falls back to a hand-written checkOptions key list is caught at once. Fix: `readParams(name, PARAMS, opts)` at the top of the factory
// and `params: PARAMS, options: opts` on the definition (keysSchema(KEYS) is the quick form when the values take several shapes).
import { ts, parse, visit, engineFiles, lineOf, hasProp, OPT_NAMES, factoryOf } from './_lib.mjs';

const isModuleDef = obj => hasProp(obj, 'install') && obj.properties.some(p => p.name?.getText() === 'name' && ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer));
const optionsParam = fn => fn.parameters.find(p => ts.isIdentifier(p.name) && OPT_NAMES.has(p.name.text));

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
        out.push({ level: 'error', file: f, line: lineOf(n), msg: `module ${name} takes options but has no params schema (engine.catalog shows none)`,
          fix: "readParams(name, PARAMS, opts) at the top of the factory and `params: PARAMS, options: opts` on the definition (keysSchema(KEYS) is the quick form)" });
      });
    }
    out.note = `${out.length} modules still without params, ${withParams} with`;
    return out;
  },
};
