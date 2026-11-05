// THREE.md "Global changes" promises that everything else in three is untouched, so its table and the notePatch calls in the engine must name the same changes.
// Why from the source and not threePatches.list(): some changes are noted only on one renderer or on the dev server, and no single page sees them all.
import { walk, read, P } from '../rules/_lib.mjs';

export const name = 'THREE.md lists every notePatch id';

export async function run({ check }) {
  const noted = new Set();
  for (const f of ['core', 'render', 'modules', 'ui'].flatMap(d => walk(`${P.ENGINE_REL}/${d}`, ['.js']))) {
    const text = read(f);
    // the id is a string, or a constant of the same file
    for (const m of text.matchAll(/(?<!function )\bnotePatch\(\s*(?:'([\w-]+)'|(\w+))/g)) noted.add(m[1] ?? text.match(new RegExp(`\\b${m[2]} = '([\\w-]+)'`))?.[1] ?? `${m[2]} (${f})`);
  }
  const section = read(`${P.DOCS_REL}/THREE.md`).split(/^## /m).find(s => s.startsWith('What the engine changes in three.js')) ?? '';
  const listed = new Set([...section.matchAll(/^\| `([\w-]+)` \|/gm)].map(m => m[1]));
  check('[guard] both lists were read', noted.size > 10 && listed.size > 10, `${noted.size} notePatch ids, ${listed.size} THREE.md rows`);
  const missing = [...noted].filter(id => !listed.has(id)), extra = [...listed].filter(id => !noted.has(id));
  check('every notePatch id has a row in THREE.md', !missing.length, missing.join(', '));
  check('every THREE.md row is a notePatch id', !extra.length, extra.join(', '));
}
