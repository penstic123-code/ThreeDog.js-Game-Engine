// R47 module types (error): every engine module definition in packages/engine/modules declares a type from core/moduleTypes.js (MODULE_TYPES),
// and a 'world' type module draws nothing: the files that define world modules have no scene.add( and no renderer. in code.
// Why static as well as at runtime: engine.use already throws for a missing type, but only for the modules a test installs; this reads them all.
// The world rule is per defining file, not per folder, because one folder may hold both halves (modules/weather: Weather.js is the state,
// weatherDraw.js the picture). Drawing for a world module goes in its drawing half, which reads the state.
// Known limits: a definition is an object literal with name: '...' and label or install (like R16); a world module that draws from a helper
// file it imports is not followed.
import { ts, parse, visit, walk, read, codeOnly, strValue, lines, P } from './_lib.mjs';

/** the type names, read from the engine source so this rule never keeps its own copy */
function typeNames() {
  const src = read(`${P.CORE_REL}/moduleTypes.js`);
  const body = src.match(/export const MODULE_TYPES = \{([\s\S]*?)\n\};/)?.[1] ?? '';
  return [...body.matchAll(/^\s+(\w+):/gm)].map(m => m[1]);
}

export default {
  id: 'R47', title: 'Every engine module declares its type; world modules draw nothing',
  run() {
    const out = [], types = typeNames();
    for (const f of walk(P.MODULES_REL)) {
      const sf = parse(f), defs = [];
      visit(sf, n => {
        if (!ts.isObjectLiteralExpression(n)) return;
        const prop = k => n.properties.find(p => ts.isPropertyAssignment(p) && (p.name.text ?? p.name.getText()) === k);
        const keys = n.properties.map(p => p.name?.text ?? p.name?.getText());
        const name = prop('name') && strValue(prop('name').initializer);
        if (!name || !(keys.includes('label') || keys.includes('install'))) return;
        defs.push({ name, type: prop('type') && strValue(prop('type').initializer), line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
      });
      for (const d of defs) if (!types.includes(d.type)) out.push({ level: 'error', file: f, line: d.line,
        msg: `module ${d.name} has ${d.type ? `type '${d.type}', which is not a module type` : 'no type'}`,
        fix: `add type: '<${types.join(' | ')}>' to its definition (what it may own: core/moduleTypes.js)` });
      if (!defs.some(d => d.type === 'world')) continue;
      lines(f).forEach((raw, i) => {
        const code = codeOnly(raw);
        if (/\bscene\.add\(|\brenderer\./.test(code)) out.push({ level: 'error', file: f, line: i + 1,
          msg: `a world module file draws (${code.match(/\bscene\.add\(|\brenderer\./)[0]})`,
          fix: 'a world module holds state only: draw it from a picture module that reads the state (see modules/weather/weatherDraw.js)' });
      });
    }
    return out;
  },
};
