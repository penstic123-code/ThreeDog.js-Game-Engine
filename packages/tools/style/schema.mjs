// The style field schema, read from packages/engine/types/style.d.ts (the one source of truth for which keys a style has), so `style check`
// never keeps a second list that drifts. Only the shape this file uses is parsed: `export interface X {` blocks whose properties start at two
// spaces of indent, inline `{ a?: T; b: T }` object types, and `Omit<X, ...>` / `Partial<X>` wrappers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE } from '../paths.mjs';

const OPEN = '{([<', CLOSE = '})]>';

/** Entries at brace depth 1 of an inline type text such as `{ color?: ColorLike; shade?: ColorLike }`: key -> its type text */
function inlineProps(t) {
  const props = {}; let depth = 0, key = null, from = 0;
  const end = i => { if (key) props[key] = t.slice(from, i).trim().replace(/[;,]$/, ''); key = null; };
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '=' && t[i + 1] === '>') { i++; continue; }   // arrow of a function type is not a closing >
    if (depth === 1 && !key && /[\w$]/.test(ch) && !/[\w$]/.test(t[i - 1] ?? ' ')) {
      const m = /^([\w$]+)\??\s*:/.exec(t.slice(i));
      if (m) { key = m[1]; from = i + m[0].length; i = from - 1; continue; }
    }
    if (OPEN.includes(ch)) depth++;
    else if (CLOSE.includes(ch)) { depth--; if (depth === 0) end(i); }
    else if (depth === 1 && ch === ';') end(i);
  }
  return props;
}

/** Split `Type; other?: Type2;` into the first type and the extra fields on the same line (only `;` outside (), {}, [], <> and quotes) */
function topLevelFields(rest) {
  const out = [], cuts = []; let depth = 0, q = null;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (q) { if (c === q && rest[i - 1] !== '\\') q = null; continue; }
    if (c === "'" || c === '"' || c === '`') q = c;
    else if ('({[<'.includes(c)) depth++;
    else if (')}]>'.includes(c) && !(c === '>' && rest[i - 1] === '=')) depth--;
    else if (c === ';' && depth === 0 && /^\s*[\w$]+\??:/.test(rest.slice(i + 1))) cuts.push(i);
  }
  let from = 0; const parts = [];
  for (const i of cuts) { parts.push(rest.slice(from, i)); from = i + 1; }
  parts.push(rest.slice(from));
  out.push(parts[0]);
  for (const part of parts.slice(1)) { const m = /^\s*([\w$]+)\??:\s*([\s\S]*)$/.exec(part); if (m) out.push({ name: m[1], type: m[2] }); }
  return out;
}

/**
 * Parse style.d.ts: { interfaces: name -> { keys: Set, open: bool, props: key -> type text }, materialTypes: string[] }
 * `open` = the interface has an index signature (`[prop: string]: any`), so unknown keys are legal there.
 */
export function loadSchema() {
  const text = readFileSync(join(ENGINE, 'types', 'style.d.ts'), 'utf8');
  const interfaces = {};
  for (const m of text.matchAll(/^export interface (\w+) \{\n([\s\S]*?)\n\}/gm)) {
    const props = {}; let open = false, cur = null;
    for (const line of m[2].split('\n')) {
      const p = /^ {2}([\w$]+)\??:\s*(.*)$/.exec(line);
      if (/^ {2}\[\w+: string\]/.test(line)) { open = true; cur = null; }
      else if (p) {
        // `color?: ColorLike; shade?: ColorLike;` on one line: split at top-level `;` followed by another `name?:`
        const [first, ...more] = topLevelFields(p[2]);
        cur = p[1]; props[cur] = first;
        for (const f of more) { cur = f.name; props[cur] = f.type; }
      }
      else if (cur && /^ {3,}/.test(line) && !/^\s*(\/\/|\/?\*)/.test(line)) props[cur] += ' ' + line.trim();
    }
    interfaces[m[1]] = { keys: new Set(Object.keys(props)), open, props };
  }
  const mt = /export type MaterialType = Loose<([^>]+)>/.exec(text);
  return { interfaces, materialTypes: mt ? [...mt[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : [] };
}

/** The child spec of property `key` of `spec`: { keys, open, props } for a nested object with known keys, or null (Record, function, scalar...) */
export function childOf(schema, spec, key) {
  const t = spec.props[key]?.trim();
  if (!t) return null;
  const named = /^(?:Omit<|Partial<)?(Style\w*|MaterialSpec)\b/.exec(t);
  if (named && schema.interfaces[named[1]]) return schema.interfaces[named[1]];
  if (t.startsWith('{') && !/^\{\s*\[/.test(t)) {
    const props = inlineProps(t);
    return { keys: new Set(Object.keys(props)), open: false, props };
  }
  return null;
}
