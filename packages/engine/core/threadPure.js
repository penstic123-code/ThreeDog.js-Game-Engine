// Pure functions for workers: a function is sent as its source text and recompiled, so it cannot carry closure variables, `this`, or imports.
// The main thread runs the SAME recompiled copy (not the original), so a function that reads an outside variable fails identically with threads on or off,
// instead of working in development (threads off) and breaking only on machines with workers. Worker-safe: no imports.
const PURE_STRINGS = {
  native: '{label}: must be a written-out function (not a built-in, bound or class method); it is sent to a worker as source text',
  async: '{label}: cannot be async or a generator; a worker batch needs the result immediately',
  parse: '{label}: could not be recompiled from its source text ({msg}); write it as (rec, dt) => { ... } or function (rec, dt) { ... }',
  closure: '{label} runs in a worker, so closures are not supported (outer variables are not sent with the source text); it only sees its own parameters and globals like Math: {msg}. {fix}',
  fixRecord: 'Put constants inside the function, or store the value on the record',
  // terrain functions get settings as data: terrain({ params }) arrives as n.params in every worker (modules/terrain)
  fixTerrain: 'Pass the values as data instead: terrain({ params: { hill: 30 }, height: (x, z, n) => n.params.hill * n.fbm(x * 0.004, z * 0.004) }), or put constants inside the function',
  unknown: '[threads] pure function {key} was not defined in this worker',
};
const fmt = (s, o) => s.replace(/\{(\w+)\}/g, (m, k) => o[k] ?? m);   // own copy: this file stays import-free for workers
/** Errors carry the stable code 'pure-function' (errorHints.js) as err.code and a [pure-function] tag */
const fixFor = label => /^terrain/.test(label) ? PURE_STRINGS.fixTerrain : PURE_STRINGS.fixRecord;
const pureError = msg => Object.assign(new Error(msg + ' [pure-function]'), { code: 'pure-function' });

/**
 * Recompile a function from its source in an empty scope.
 * @param {Function | string} fnOrSrc
 * @param {string} label
 * @returns {{ src: string, label: string, fn: Function, call: (...args: any[]) => any }}
 */
export function compilePure(fnOrSrc, label) {
  const src = typeof fnOrSrc === 'string' ? fnOrSrc : Function.prototype.toString.call(fnOrSrc);
  if (/\{\s*\[native code\]\s*\}$/.test(src) || /^class\b/.test(src)) throw pureError(fmt(PURE_STRINGS.native, { label }));
  if (/^async\b|^function\s*\*|^\*/.test(src)) throw pureError(fmt(PURE_STRINGS.async, { label }));
  let fn = null, used = src;
  // method shorthand `grow(rec, dt) { ... }` is not an expression; read it as a function expression instead
  for (const text of [src, 'function ' + src]) {
    try { fn = new Function('"use strict"; return (' + text + ');')(); used = text; break; }
    catch (err) { if (text !== src) throw pureError(fmt(PURE_STRINGS.parse, { label, msg: err.message })); }
  }
  const free = freeNames(used);
  // caught here, not on the first call: in a worker that call happens steps later and far from the line that registered the function
  if (free.length) throw pureError(fmt(PURE_STRINGS.closure, { label, fix: fixFor(label), msg: `it reads ${free.map(n => `'${n}'`).join(', ')}, which is neither its parameter nor a global` }));
  const call = (...args) => {
    try { return fn(...args); } catch (err) {
      if (err instanceof ReferenceError) throw pureError(fmt(PURE_STRINGS.closure, { label, fix: fixFor(label), msg: err.message }));
      throw err;
    }
  };
  return { src, label, fn, call };
}

const KEYWORDS = new Set(('break case catch const continue debugger default delete do else false finally for function if in instanceof let new null of return switch this throw '
  + 'true try typeof var void while yield arguments undefined NaN Infinity get set static async await').split(' '));
// Globals a worker has too (plain JavaScript, no DOM): a name outside this list, such as engine, window, document or localStorage, exists only on the main
// thread, so reading it would work with threads off and fail in a worker. A fixed list, not `name in globalThis`, so both behave the same.
const WORKER_GLOBALS = new Set(('Math JSON Number String Boolean Array Object Symbol BigInt Date RegExp Map Set WeakMap WeakSet Promise Reflect Error TypeError '
  + 'RangeError ReferenceError SyntaxError parseInt parseFloat isNaN isFinite Float32Array Float64Array Int8Array Int16Array Int32Array Uint8Array '
  + 'Uint8ClampedArray Uint16Array Uint32Array BigInt64Array BigUint64Array ArrayBuffer DataView structuredClone console encodeURIComponent '
  + 'decodeURIComponent atob btoa TextEncoder TextDecoder Intl').split(' '));
/**
 * Names a function's source reads that it neither declares nor gets from the worker-safe globals (a static scan: strings, comments and template text are
 * skipped;
 * property names after '.', object keys and shorthand methods are not reads). Errs on the side of missing a name rather than flagging a valid one.
 * @param {string} src
 */
function freeNames(src) {
  // numbers go too: the name scan below would read 'e9' out of 1e9 and 'xff' out of 0xff
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, ' 0 ').replace(/(?<![\w$])\.?\d[\w.]*/g, ' 0 ');
  const declared = new Set(), add = s => { for (const m of s.matchAll(/[A-Za-z_$][\w$]*/g)) declared.add(m[0]); };
  // parameters (function, arrow, catch) and let / const / var / function / class names, destructuring included; default values are over-collected, which only hides names
  for (const m of code.matchAll(/function\b[^(]*\(([^)]*)\)|\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*=>|([A-Za-z_$][\w$]*)\s*=>|catch\s*\(([^)]*)\)/g)) add(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '');
  for (const m of code.matchAll(/\b(?:let|const|var)\s+/g)) for (const t of declarators(code, m.index + m[0].length)) add(t);
  for (const m of code.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{/g)) if (!/^(if|for|while|switch|catch|with|function)$/.test(m[1])) add(m[2]);   // shorthand method parameters
  const out = new Set();
  // (?<![\w$]): the e9 of 1e9, the xff of 0xff and the n of 10n are parts of a number, not names; an identifier never starts right after a digit
  for (const m of code.matchAll(/(?<![\w$])[A-Za-z_$][\w$]*/g)) {
    const n = m[0], before = code.slice(0, m.index).trimEnd(), after = code.slice(m.index + n.length).trimStart();
    if (declared.has(n) || KEYWORDS.has(n) || WORKER_GLOBALS.has(n) || /\.$/.test(before)) continue;
    if (/[{,]$/.test(before) && /^(:|\()/.test(after)) continue;   // object key or shorthand method
    out.add(n);
  }
  return [...out];
}

/**
 * Binding targets of one let / const / var statement starting at i: `a = 1, { b, c } = o, d` gives 'a ', '{ b, c } ', 'd'. Declarators are split
 * at commas outside brackets (a minifier joins consecutive declarations into one statement, so every one counts, not only the first); the
 * statement ends at a ';' or a closing bracket outside them. `for (const x of list)` ends the target at of / in.
 * @param {string} code
 * @param {number} i
 */
function declarators(code, i) {
  const out = [], cut = t => t.split(/\b(?:of|in)\b/)[0];
  let depth = 0, start = i, target = null;
  for (; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') { if (--depth < 0) break; }
    else if (depth === 0 && ch === '=' && target === null && code[i + 1] !== '=' && code[i + 1] !== '>' && !/[=!<>]/.test(code[i - 1])) target = code.slice(start, i);
    else if (depth === 0 && (ch === ',' || ch === ';')) {
      out.push(cut(target ?? code.slice(start, i))); target = null; start = i + 1;
      if (ch === ';') return out;
    }
  }
  out.push(cut(target ?? code.slice(start, i)));
  return out;
}

/** Collect the ArrayBuffers of typed arrays in a reply (a few levels deep) so postMessage moves them instead of copying. Shared buffers are skipped: they are already visible everywhere. */
export function transferables(v, out = [], depth = 0) {
  if (!v || typeof v !== 'object' || depth > 3) return out;
  if (ArrayBuffer.isView(v)) { if (v.buffer instanceof ArrayBuffer && !out.includes(v.buffer)) out.push(v.buffer); return out; }
  for (const k in v) transferables(v[k], out, depth + 1);
  return out;
}

/**
 * Handler for pure-function batches (also the body of core/pureWorker.js; engine.threads.pureLane() uses it as the local handler).
 * { def: key, src, label } compiles once; { call: key, items: [[...args], ...] } calls fn(...args) for each item and replies with each item's arguments after the call
 * (functions such as world far change their first argument in place) and its return value.
 */
export function pureHandler() {
  const fns = new Map();
  return msg => {
    if (msg.def) { fns.set(msg.def, compilePure(msg.src, msg.label)); return null; }
    const p = fns.get(msg.call);
    if (!p) throw pureError(PURE_STRINGS.unknown.replace('{key}', msg.call));
    return msg.items.map(args => { const value = p.call(...args); return { args, value }; });
  };
}
