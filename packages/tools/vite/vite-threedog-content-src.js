// "Defined in content/props.js:14": tags each content module with its own line table, so engine.inspect / engine.pick can name the file and line
// of an authored entry (edit that line to change the level for good; runtime ops change only the session).
// Dev and test builds only (npm run dev, npm test / shot / perf): a production build is untouched, so the table costs nothing in a release.
// Transform (files `<anything>/content/<name>.js`, outside node_modules): for `export default <array | object literal>` and `export const x = <literal>`,
//   append `(globalThis.__threedogSrc ??= new WeakMap()).set(<value>, { file, line, at: { <index | key>: line } })`.
//   The table lives in a WeakMap keyed by the exported object itself: no enumerable keys are added, so content-check, JSON and equality are untouched.
//   Entries after a spread (`...more`) or a value built by code (`Array.from(...)`, a loop) get the line of the export (it points at the generator).
// The engine reads it at content load (modules/content/ids.js srcOf) and records id → 'file:line' (engine.world.origin).
import { relative } from 'node:path';

const CONTENT_RE = /[\\/]content[\\/][^\\/]+\.js$/;

/** Line number (1-based) of each character offset: binary search over line starts */
function lineIndex(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) starts.push(i + 1);
  return off => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= off) lo = m; else hi = m - 1; } return lo + 1; };
}

/** { index | key: line } for an array / object literal; null for anything else */
function table(node, lineOf) {
  const at = {};
  if (node?.type === 'ArrayExpression') {
    for (let i = 0; i < node.elements.length; i++) {
      const el = node.elements[i]; if (!el) continue;
      if (el.type === 'SpreadElement') break;   // indexes after a spread are unknown: they fall back to the export line
      at[i] = lineOf(el.start);
    }
    return at;
  }
  if (node?.type === 'ObjectExpression') {
    for (const p of node.properties) {
      if (p.type !== 'Property') continue;
      const k = p.key.type === 'Identifier' && !p.computed ? p.key.name : p.key.type === 'Literal' ? String(p.key.value) : null;
      if (k != null) at[k] = lineOf(p.start);
    }
    return at;
  }
  return null;
}

/** The registration code for the module's exported literals (empty string when there is nothing to tag) @param {any} ast @param {string} code @param {string} file */
export function contentSrcCode(ast, code, file) {
  const lineOf = lineIndex(code), out = [], reg = (expr, node, line) => {
    const at = table(node, lineOf) ?? {};
    out.push(`__tdSrc(${expr}, ${JSON.stringify({ file, line, at })});`);
  };
  const consts = new Map();   // top-level const name -> init node (for export default name)
  for (const s of ast.body) if (s.type === 'VariableDeclaration') for (const d of s.declarations) if (d.id.type === 'Identifier' && d.init) consts.set(d.id.name, d.init);
  let defaultExpr = null;
  for (const s of ast.body) {
    if (s.type === 'ExportDefaultDeclaration') {
      const d = s.declaration;
      if (d.type === 'Identifier') reg(d.name, consts.get(d.name), lineOf(s.start));
      else if (d.type === 'ArrayExpression' || d.type === 'ObjectExpression' || d.type === 'CallExpression') defaultExpr = { node: d, line: lineOf(s.start) };
    } else if (s.type === 'ExportNamedDeclaration' && s.declaration?.type === 'VariableDeclaration') {
      for (const d of s.declaration.declarations) if (d.id.type === 'Identifier' && d.init && /^(Array|Object)Expression$/.test(d.init.type)) reg(d.id.name, d.init, lineOf(s.start));
    }
  }
  return { out, defaultExpr };
}

// a function declaration: hoisted, so `export default __tdSrc(...)` above it can call it
const HELPER = 'function __tdSrc(v, t) { if (v && typeof v === "object") (globalThis.__threedogSrc ??= new WeakMap()).set(v, t); return v; }';

/** @returns {import('vite').Plugin} */
export default function threedogContentSrc() {
  let root = process.cwd(), on = false;
  return {
    name: 'threedog-content-src',
    enforce: 'post',
    configResolved(c) { root = c.root; on = c.command === 'serve' || !!process.env.THREEDOG_TEST; },   // never in a production build
    transform(code, id) {
      if (!on || id.includes('node_modules') || !CONTENT_RE.test(id.split('?')[0])) return null;
      let ast;
      try { ast = this.parse(code); } catch { return null; }   // not plain JS (another plugin's output we cannot read): leave it untagged
      const file = relative(root, id.split('?')[0]).replace(/\\/g, '/');
      const { out, defaultExpr } = contentSrcCode(ast, code, file);
      if (!out.length && !defaultExpr) return null;
      let s = code;
      if (defaultExpr) {   // export default <literal>  ->  export default __tdSrc(<literal>, table)
        const { node, line } = defaultExpr, at = table(node, lineIndex(code)) ?? {};
        s = s.slice(0, node.start) + '__tdSrc(' + s.slice(node.start, node.end) + `, ${JSON.stringify({ file, line, at })})` + s.slice(node.end);
      }
      return { code: s + '\n' + HELPER + '\n' + out.join('\n') + '\n', map: null };
    },
  };
}
