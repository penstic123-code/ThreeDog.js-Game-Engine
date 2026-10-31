// Source-text helpers shared by the generators, rules and the test runner (codemap, gamemap, check, R18, run): one walk with one skip set,
// the file summary, bracket pairing, top-level argument splitting, and "did you mean" suggestions.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SKIP_DIRS } from '../paths.mjs';

export const read = f => readFileSync(f, 'utf8');
export const uniq = a => [...new Set(a)];

/**
 * Files under d (sorted, recursive) whose name matches exts (default .js / .mjs). skip adds names to SKIP_DIRS;
 * skipDir(name, path) can veto more folders.
 */
export function walk(d, { exts = /\.(js|mjs)$/, skip = [], skipDir } = {}, out = []) {
  if (!existsSync(d)) return out;
  const no = new Set([...SKIP_DIRS, ...skip]);
  for (const f of readdirSync(d).sort()) {
    if (no.has(f)) continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (!skipDir?.(f, p)) walk(p, { exts, skip, skipDir }, out); }
    else if (exts.test(p)) out.push(p);
  }
  return out;
}

/** The description at the top of a file: the first comment block, up to two lines (// or /** style) */
export function summary(text) {
  const out = [];
  for (const l of text.split('\n')) {
    const m = l.match(/^\s*\/\/\s?(.*)$/) || l.match(/^\s*\/?\*+\s?(.*?)\s*\*?\/?$/);
    if (!m) { if (out.length) break; else continue; }
    if (m[1].trim()) out.push(m[1].trim());
    if (out.length >= 2) break;
  }
  return out.join(' ');
}

/**
 * The first sentence of a summary, max n characters. A header that ends in ':' followed by a numbered list keeps the first item
 * ("Asset management: asset manifest…" instead of "Asset management: 1").
 */
export function oneSentence(s, n = 70) {
  let t = s.replace(/\|/g, '/');
  t = t.replace(/:\s*1[.)]\s*/, ': ');
  t = t.split(/\.(?:\s|$)|。/)[0].replace(/:\s*$/, '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** The content inside the matching brackets after the first `open` at or after `from`; null if none */
export function balanced(text, open, from = 0) {
  return balancedAt(text, open, from)?.body ?? null;
}
function balancedAt(text, open, from) {
  const i = text.indexOf(open, from); if (i < 0) return null;
  let d = 0;
  for (let j = i + open.length - 1; j < text.length; j++) {
    if ('([{'.includes(text[j])) d++;
    else if (')]}'.includes(text[j]) && --d === 0) return { body: text.slice(i + open.length, j), index: i, end: j };
  }
  return null;
}
/** Every bracketed body after `open` (grids.add( … ) called several times): [{ body, index }] */
export function balancedAll(text, open) {
  const out = [];
  for (let at = 0, b; (b = balancedAt(text, open, at)); at = b.end) out.push(b);
  return out;
}

/** Split arguments at top-level commas (commas inside brackets and quotes do not count; stops at an unmatched closing bracket) */
export function splitTop(src) {
  const out = []; let d = 0, q = null, cur = '';
  for (const ch of src) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') q = ch;
    else if ('([{'.includes(ch)) d++;
    else if (')]}'.includes(ch)) { if (d === 0) break; d--; }
    else if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Damerau-Levenshtein distance (adjacent swaps count as one edit) */
export function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

/** The entry of list closest to name; null if too far (the limit scales with length unless maxDist is given) */
export function closest(name, list, maxDist) {
  name = String(name);
  const limit = maxDist ?? (name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3);
  let best = null, bd = Infinity;
  for (const c of list) { if (c === name) continue; const dd = distance(name, String(c)); if (dd < bd) { bd = dd; best = c; } }
  return bd <= limit ? best : null;
}

/** The n entries of list nearest to name, nearest first (substring matches rank first); for "close:" hints where nothing matched */
export function nearest(name, list, n = 3) {
  const q = String(name).toLowerCase();
  const score = c => { const s = String(c).toLowerCase(); return s.includes(q) || q.includes(s) ? 0 : distance(q, s.slice(0, Math.max(q.length, 1) + 4)); };
  return uniq(list).map(c => [c, score(c)]).sort((a, b) => a[1] - b[1]).slice(0, n).map(x => x[0]);
}
