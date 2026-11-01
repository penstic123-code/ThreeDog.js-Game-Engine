// R38 module options without a JSDoc description (warning count; `threedog catalog <id>` shows "(no doc)" for them)
// The catalog takes each option's type and sentence from the generated api page (docs/api/<module>.md "Options" lines), which comes from the
// options typedef's JSDoc, so the description is written once. A module whose factory takes options and declares `params` should have an
// Options section on its page, and every option line there should carry a sentence.
// Fix: add the options typedef (`@typedef {{ key?: type }}` with a `/** sentence */` per key, or an interface in types/*.d.ts), then `npm run map`.
import { ts, parse, visit, engineFiles, lineOf, abs } from './_lib.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { API_DIR_REL } from '../paths.mjs';

const OPT_NAMES = new Set(['opts', 'options', 'all']);
const hasProp = (obj, name) => obj.properties.some(p => p.name?.getText() === name);
function factoryOf(n) { for (let p = n.parent; p; p = p.parent) if (ts.isFunctionLike(p) && !ts.isMethodDeclaration(p)) return p; return null; }

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
        const name = nameProp.initializer.text, page = abs(`${API_DIR_REL}/${name}.md`);
        const lines = existsSync(page) ? readFileSync(page, 'utf8').split(/\r?\n/) : [];
        const at = lines.findIndex(l => /^- Options\b/.test(l));
        if (at < 0) {
          out.push({ level: 'warn', file: f, line: lineOf(n), msg: `module ${name}: no documented options (no "Options" section on its api page)`,
            fix: 'give the factory a typed @param {XOptions} opts whose keys have /** sentence */ comments, then npm run map' });
          return;
        }
        const bare = [];
        for (let i = at + 1; i < lines.length && /^\s+-\s/.test(lines[i]); i++) {
          const m = /^\s+-\s+`([\w$]+)\??:[^`]*`\s*$/.exec(lines[i]);
          if (m) bare.push(m[1]);
        }
        if (bare.length) out.push({ level: 'warn', file: f, line: lineOf(n), msg: `module ${name}: ${bare.length} option(s) without a description: ${bare.join(', ')}`,
          fix: 'add a /** sentence */ above each key of the options typedef, then npm run map' });
        else ok++;
      });
    }
    out.note = `${out.length} modules with undocumented options, ${ok} fully documented`;
    return out;
  },
};
