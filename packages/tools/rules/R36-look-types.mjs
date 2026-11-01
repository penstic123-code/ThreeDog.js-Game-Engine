// R36 look part params match their hand-written type (types/core.d.ts): engine.look.<part> is typed LookPart<Look<Part>>, and the keys of
// Look<Part> must be the param keys the defineLookPart spec declares (dotted keys by their first segment: 'sun.intensity' -> sun).
// Why: the spec is the source of truth at runtime (set() rejects an unknown key), the d.ts is what an editor offers; the two drifted
// (LookFog lacked height / falloff, LookShadow lacked bias, normalBias, snap ...: review r2 arch #3, consistency #12). Comparing keys is a
// smaller tool than generating the types and catches the same drift.
// Detection: the AST of each defineLookPart call in engine code (params inline or a same-file const, as R35); the d.ts `Look` interface maps
//   a part id to its Look<Part> type. Parts typed as a plain LookPart or a Record (materials, weather, post: keys made at runtime) are skipped.
// Level: error (engine code and its own d.ts).
import fs from 'node:fs';
import path from 'node:path';
import { ts, parse, visit, constInit, engineFiles, ROOT, P } from './_lib.mjs';

const resolve = (sf, n) => (n && ts.isIdentifier(n) ? constInit(sf, n.text) : n);
const propName = p => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null);

/** Top-level member names of a `{ ... }` body (nested braces / generics skipped) */
function topKeys(body) {
  const keys = new Set();
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if ('{<(['.includes(c)) depth++;
    else if ('}>)]'.includes(c)) depth--;
    else if (depth === 0 && /[A-Za-z_]/.test(c) && (i === 0 || /[\s;]/.test(body[i - 1]))) {
      const m = /^(\w+)\??:/.exec(body.slice(i));
      if (m) { keys.add(m[1]); i += m[0].length - 1; }
    }
  }
  return keys;
}

/** { partId: { type, keys } } from types/core.d.ts */
function declared() {
  const file = path.join(ROOT, P.ENGINE_REL, 'types', 'core.d.ts');
  const text = fs.readFileSync(file, 'utf8'), out = {};
  const look = /export interface Look \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? '';
  for (const [, id, type] of look.matchAll(/^\s*(\w+): LookPart<(Look\w+)>;/gm)) {
    const at = text.indexOf(`export interface ${type} {`);
    if (at < 0) continue;
    let i = text.indexOf('{', at) + 1, depth = 1;   // one line or several: read to the matching brace
    const start = i;
    for (; i < text.length && depth; i++) depth += text[i] === '{' ? 1 : text[i] === '}' ? -1 : 0;
    out[id] = { type, keys: topKeys(text.slice(start, i - 1).replace(/\/\*[\s\S]*?\*\//g, '')) };
  }
  return { file: path.relative(ROOT, file).replace(/\\/g, '/'), out };
}

export default {
  id: 'R36', title: 'Look part params match their Look<Part> type in types/core.d.ts',
  run() {
    const out = [], { file: dts, out: types } = declared();
    for (const f of engineFiles()) {
      const sf = parse(f);
      if (!/defineLookPart\s*\(/.test(sf.text)) continue;
      visit(sf, n => {
        if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== 'defineLookPart') return;
        const spec = resolve(sf, n.arguments[1]);
        if (!spec || !ts.isObjectLiteralExpression(spec)) return;
        const sp = new Map(spec.properties.filter(ts.isPropertyAssignment).map(p => [propName(p), p]));
        const id = sp.get('id')?.initializer?.text, t = types[id];
        const params = resolve(sf, sp.get('params')?.initializer);
        if (!t || !params || !ts.isObjectLiteralExpression(params)) return;
        const keys = new Set(params.properties.filter(ts.isPropertyAssignment).map(p => propName(p)?.split('.')[0]).filter(Boolean));
        const missing = [...keys].filter(k => !t.keys.has(k)), extra = [...t.keys].filter(k => !keys.has(k));
        if (missing.length || extra.length) out.push({ level: 'error', file: f, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          msg: `look.${id} params and ${t.type} (${dts}) differ:${missing.length ? ` not typed: ${missing.join(', ')}` : ''}${extra.length ? `; typed but no param: ${extra.join(', ')}` : ''}`,
          fix: `edit ${t.type} in ${dts} to list exactly the spec's params (dotted keys by their first segment)` });
      });
    }
    out.note = `${Object.keys(types).length} typed parts compared`;
    return out;
  },
};
