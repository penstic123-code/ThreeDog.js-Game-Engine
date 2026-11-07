// Finding test items: every <workspace>/tests/specs/*.mjs, each exporting `specs` (an array of { name, url, run }), and every
//   packages/tools/tests/*.mjs exporting { name, run }. The runner (run.mjs) and the doc check (rule R18) read the same list, so a file that is
//   there runs and its names count; there is no hand list to keep. A file that gives nothing runnable or a name used twice throws.
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rel } from '../paths.mjs';

/** Pixel reads in a run() body: a test that has any compares what the renderer drew, so it stays on software rendering (same pixels on every machine) */
const PIXEL_SRC = /page\.screenshot|readPixels|readRenderTargetPixels|getImageData|toDataURL|toBlob/;
/** spec.software: true / false decides; unset: looked up in the source of run() (helpers defined elsewhere are not seen there, so specs that use them set it) */
export const needsSoftware = spec => spec.software ?? PIXEL_SRC.test(String(spec.run));
/**
 * Why a spec is on software rendering although it never asked, or null. Software is many times slower, so a spec that was fine on the GPU can time
 * out the moment it gains a screenshot, and the timeout alone does not say why (14 minutes lost in a real game).
 */
export const softwareWhy = spec => spec.software === undefined && needsSoftware(spec)
  ? `its run() reads pixels (${String(spec.run).match(PIXEL_SRC)[0]}), so it runs on software rendering, which is much slower: set software: false on the spec for a real GPU picture (pixels then differ per machine), or take the picture with threedog shot --gpu`
  : null;

/** Throw when names repeat. `where(item)` names the file an item came from, for the message */
export function noDuplicateNames(items, where, what) {
  const seen = new Map(), dup = [];
  for (const s of items) { if (seen.has(s.name)) dup.push(`${JSON.stringify(s.name)} (${seen.get(s.name)} and ${where(s)})`); else seen.set(s.name, where(s)); }
  if (dup.length) throw new Error(`${dup.length} ${what} name(s) used twice: ${dup.slice(0, 5).join('; ')}${dup.length > 5 ? '; ...' : ''}`);
}

/** Browser-only names: a ReferenceError on one of these in a spec file (or what it imports) is the top-level-DOM mistake COMMANDS.md describes */
const BROWSER_GLOBAL = /^(document|window|navigator|location|localStorage|sessionStorage|self|screen|requestAnimationFrame|HTMLElement|HTMLCanvasElement|Image|Audio|Worker|AudioContext)\b/;
/** One line for a spec file that failed to load: which file, which import threw, why, the fix. Importing threedog itself works in Node (COMMANDS.md); only top-level browser globals fail */
function importFailure(path, e) {
  const msg = String(e?.message ?? e).split('\n')[0], at = /file:\/\/\/[^\s)]+?\.m?js(?=:\d)/.exec(String(e?.stack ?? '').split('\n').slice(1).join('\n'));
  const where = at ? fileURLToPath(at[0]) : path, own = resolve(where) === resolve(path);
  const dom = e instanceof ReferenceError && BROWSER_GLOBAL.test(msg);
  return `${rel(path)}: could not be imported (${msg}${own ? '' : `; thrown in ${rel(where)}, which it imports`}).`
    + ` A spec file and what it imports run in Node, not in the page${dom ? ': their top level cannot touch document or window' : ''}.`
    + (dom ? ' Fix: move that code into a function (run() or a helper called from it), move plain data into a file of its own, or read the value in the page through ev().' : '');
}

/**
 * A workspace's spec items, sorted by file name: [{ spec, file }] (file: name inside tests/specs/). Empty when there is no tests/specs/.
 *   Order carries no meaning: every item opens its own page in a fresh browser context, items run side by side, and spec.serial (not the
 *   position) is what keeps one alone.
 * A file that cannot be loaded (import throws, wrong exports) throws, unless `problems` (an array) is given: then one message per file goes
 *   into it and the other files still load, so one broken file does not hide the rest (run.mjs fails the round, rule R18 keeps the names).
 */
export async function workspaceSpecs(dir, problems = null) {
  const specDir = join(dir, 'tests', 'specs');
  const out = [];
  for (const file of existsSync(specDir) ? readdirSync(specDir).filter(f => f.endsWith('.mjs')).sort() : []) {
    const path = join(specDir, file), start = out.length;
    try {
      let mod;
      try { mod = await import(pathToFileURL(path).href); } catch (e) { throw new Error(importFailure(path, e)); }
      // a file that is there but gives nothing runnable is a mistake (a misspelled export, an empty array), not a file to skip
      if (!Array.isArray(mod.specs) || !mod.specs.length) throw new Error(`${rel(path)}: exports no test items (needs \`export const specs = [{ name, url, run }, ...]\`; exports: ${Object.keys(mod).join(', ') || 'none'})`);
      for (const [i, s] of mod.specs.entries()) {
        const bad = !s || typeof s !== 'object' ? 'is not an object' : typeof s.name !== 'string' || !s.name ? 'has no name' : typeof s.url !== 'string' ? 'has no url' : typeof s.run !== 'function' ? 'has no run()' : '';
        if (bad) throw new Error(`${rel(path)}: specs[${i}]${s?.name ? ` ("${s.name}")` : ''} ${bad}`);
        out.push({ spec: s, file });
      }
    } catch (e) {
      if (!problems) throw e;
      out.length = start;   // none of a broken file's items run
      problems.push(e.message);
    }
  }
  noDuplicateNames(out.map(x => x.spec), s => out.find(x => x.spec === s).file, `${rel(dir) || dir}: test item`);
  return out;
}

/** The tools' own tests, sorted by file name: [{ test, file }] (test: the module, { name, run, optIn? }) */
export async function toolTests(dir) {
  const out = [];
  for (const file of existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.mjs')).sort() : []) {
    const t = await import(pathToFileURL(join(dir, file)).href);
    if (typeof t.name !== 'string' || !t.name || typeof t.run !== 'function') throw new Error(`${rel(join(dir, file))}: a tools test exports \`name\` (a string) and \`run({ check, browser })\` (exports: ${Object.keys(t).join(', ') || 'none'})`);
    out.push({ test: t, file });
  }
  noDuplicateNames(out.map(x => x.test), t => out.find(x => x.test === t).file, 'tools test');
  return out;
}
