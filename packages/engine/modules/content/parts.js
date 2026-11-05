// One content kind split over several files (content/props/forest.js, town.js…), joined at runtime the way the tools join it
// (packages/tools/content-check/load.mjs loadGame): parts in file-name order, arrays concatenated, objects merged, a key defined in two files an error.
// Why a helper and not a hand-written `[...forest, ...town]` in content/index.js: the order must be the same everywhere (an entry without a written id
// gets its position in the joined array as id, and content check, write-back and the game must agree on it), and the dev line table must keep
// naming the right file ("defined in content/props/town.js:14").
//   content/index.js:  const props = contentParts(import.meta.glob('./props/*.js', { eager: true }));
import { DEV } from '../../core/base/validate.js';
import { codedError } from '../../core/base/errorHints.js';

/**
 * Join the modules of one content folder into one array / object (what a single content/<kind>.js would export).
 * @param {Record<string, { default: any }>} modules  path -> module, as vite's import.meta.glob(…, { eager: true }) gives it
 * @returns {any}
 */
export function contentParts(modules) {
  const list = Object.entries(modules).filter(([p]) => !/(^|\/)index\.js$/.test(p)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const values = list.map(([p, m]) => [p, m?.default ?? m]);
  const arrays = values.filter(([, v]) => Array.isArray(v)).length;
  if (arrays && arrays !== values.length) throw codedError('content-id', `contentParts: ${values.map(([p]) => p).join(', ')} mix arrays and objects; every file of one kind exports the same shape`);
  const src = DEV ? globalThis.__threedogSrc : null, at = {};
  let out;
  if (arrays || !values.length) {
    out = [];
    for (const [, v] of values) {
      const t = src?.get(v);
      if (t) v.forEach((_, i) => { at[out.length + i] = `${t.file}:${t.at[i] ?? t.line}`; });   // "file:line" per joined index: the parts are different files
      out.push(...v);
    }
  } else {
    out = {};
    const owner = {};
    for (const [p, v] of values) for (const k of Object.keys(v || {})) {
      if (k in owner) throw codedError('content-id', `content: "${k}" is defined in both ${owner[k]} and ${p}; an id must be unique across the files of one kind`);
      owner[k] = p; out[k] = v[k];
      const t = src?.get(v);
      if (t) at[k] = `${t.file}:${t.at[k] ?? t.line}`;
    }
  }
  if (src && Object.keys(at).length) src.set(out, { file: '', line: 0, at });
  return out;
}
