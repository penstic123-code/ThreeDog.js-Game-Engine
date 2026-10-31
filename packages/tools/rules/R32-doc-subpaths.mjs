// Detection: R32 every 'threedog/...' import named in the docs resolves. A game following a recipe imports from the package by name; a subpath that
// package.json "exports" does not list fails in Vite and Node (e.g. 'threedog/core/threadServe.js' before the './worker' entry existed).
// Reads packages/engine/docs/**/*.md and packages/engine/**/*.js (comments and JSDoc included) for 'threedog/<sub>' and checks <sub> against the
// exports map (exact keys and "./x/*" patterns). Level: error.
// Known limits: only quoted specifiers starting with threedog/; engine-relative paths in engine-internal files are not checked here.
import { readFileSync } from 'node:fs';
import { walk, read, abs, P } from './_lib.mjs';

export default {
  id: 'R32', title: "Docs and comments import only exported 'threedog/...' subpaths",
  run() {
    const exp = Object.keys(JSON.parse(readFileSync(abs(`${P.ENGINE_REL}/package.json`), 'utf8')).exports || {});
    const ok = sub => exp.some(k => k === './' + sub || (k.endsWith('/*') && ('./' + sub).startsWith(k.slice(0, -1))));
    const out = [];
    const files = [...walk(`${P.ENGINE_REL}/docs`, ['.md']), ...walk(P.ENGINE_REL, ['.js']).filter(f => !/\/(node_modules|tests|dist)\//.test(f))];
    for (const f of files) {
      read(f).split('\n').forEach((l, i) => {
        for (const m of l.matchAll(/['"`]threedog\/([\w./*-]+)['"`]/g)) {
          if (!ok(m[1])) out.push({ level: 'error', file: f, line: i + 1, msg: `'threedog/${m[1]}' is not in package.json exports (${exp.join(', ')})`,
            fix: 'use an exported entry (threedog, threedog/worker, threedog/styles/<name>, threedog/error-hints) or add the entry to exports' });
        }
      });
    }
    out.note = `exports: ${exp.join(', ')}`;
    return out;
  },
};
