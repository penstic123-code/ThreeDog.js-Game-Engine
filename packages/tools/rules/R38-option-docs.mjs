// R38 module options without a JSDoc description (warning count; `threedog catalog <id>` shows "(no doc)" for them)
// The catalog takes each option's type and sentence from the metadata (metadata.mjs reads the generated api page's "Options" lines), which come from the
// options typedef's JSDoc, so the description is written once. A module whose factory takes options and declares `params` should have an
// Options section on its page, and every option line there should carry a sentence.
// Fix: add the options typedef (`@typedef {{ key?: type }}` with a `/** sentence */` per key, or an interface in types/*.d.ts), then `npm run map`.
import { metadata } from 'threedog/metadata';
import { ts, parse, visit, engineFiles, lineOf, hasProp, OPT_NAMES, factoryOf } from './_lib.mjs';

export default {
  id: 'R38', title: 'module options without a description',
  run() {
    const out = [];
    let ok = 0;
    for (const f of engineFiles()) {
      if (!f.includes('/modules/')) continue;
      visit(parse(f), n => {
        if (!ts.isObjectLiteralExpression(n) || !hasProp(n, 'install') || !hasProp(n, 'params')) return;
        const nameProp = n.properties.find(p => p.name?.getText() === 'name');
        if (!nameProp || !ts.isPropertyAssignment(nameProp) || !ts.isStringLiteralLike(nameProp.initializer)) return;
        const fn = factoryOf(n);
        if (!fn || !fn.parameters.some(p => ts.isIdentifier(p.name) && OPT_NAMES.has(p.name.text))) return;
        const m = metadata.modules[nameProp.initializer.text], name = nameProp.initializer.text;
        if (!m?.documented) {
          out.push({ level: 'warn', file: f, line: lineOf(n), msg: `module ${name}: no documented options (no "Options" section on its api page)`,
            fix: 'give the factory a typed @param {XOptions} opts whose keys have /** sentence */ comments, then npm run map' });
          return;
        }
        const bare = Object.keys(m.params ?? {}).filter(k => !m.params[k].desc);
        if (bare.length) out.push({ level: 'warn', file: f, line: lineOf(n), msg: `module ${name}: ${bare.length} option(s) without a description: ${bare.join(', ')}`,
          fix: 'add a /** sentence */ above each key of the options typedef, then npm run map' });
        else ok++;
      });
    }
    out.note = `${out.length} modules with undocumented options, ${ok} fully documented`;
    return out;
  },
};
