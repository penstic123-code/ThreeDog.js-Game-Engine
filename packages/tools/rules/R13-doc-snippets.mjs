// R13 type-check of code blocks in docs (warning): the ```js blocks in packages/engine/docs/recipes/*.md and packages/engine/docs/api/*.md are copied by the AI;
// if an API is renamed or its parameters change and the docs lag behind, the copy is wrong. Each block is extracted into its own temporary .js file and checked by TypeScript against the engine d.ts.
// Handling incomplete snippets:
//   - a prelude declaration file provides the usual top-level variables: engine / e (Engine), THREE (any), dt (number), opts / game (any)
//   - import 'xxx/engine/index.js' (any relative path) is redirected to the real packages/engine/index.js; other unresolved imports and undefined names (TS2304/2552/2307) are not reported
//   - blocks with syntax errors (with … ellipses, or just a piece of an object) are skipped whole and only counted in the summary
//   - web (DOM) type errors are not reported (same as npm run types)
// Output: doc file + block number + line within the block + the reason (TypeScript's original text).
// Limitation: variables without a type (such as const npc = … inside the snippet) are only checked as far as the d.ts lets TypeScript infer.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ts, walk, read, abs, dtsFiles, P } from './_lib.mjs';

// Allowlist: [doc file, block number (from 1), fragment of the original error text (null = skip the whole block), reason]
const ALLOW = [
  [`${P.RECIPES_REL}/11-vehicles.md`, 1, '(number | boolean)[]', 'in JS, [[x, z, true, false]].map(([x, z, steer, drive]) => …) destructuring is inferred as (number|boolean), a TypeScript inference limit, not a doc mistake'],
];
const IGNORE_CODES = new Set([18004, 2304, 2552, 2307, 2792, 2583, 2580, 1375, 1378, 2451, 2300, 2393]);
const DOM = /HTML\w*Element|CSSStyleDeclaration|EventTarget|'Element'|Window|globalThis|'Document'/;

export default {
  id: 'R13', title: 'Type-check of doc code blocks',
  run() {
    const docs = [...walk(P.RECIPES_REL, ['.md']), ...walk(P.API_DIR_REL, ['.md'])];
    const dir = mkdtempSync(join(tmpdir(), 'threedog-r13-'));
    const blocks = [];   // { doc, n, startLine, file }
    try {
      for (const doc of docs) {
        const L = read(doc).split('\n');
        let inBlock = false, start = 0, buf = [], n = 0;
        L.forEach((line, i) => {
          if (!inBlock && /^\s*```js\s*$/.test(line)) { inBlock = true; start = i + 2; buf = []; n++; return; }
          if (inBlock && /^\s*```\s*$/.test(line)) {
            inBlock = false;
            if (ALLOW.some(([d, k, frag]) => d === doc && k === n && frag == null)) return;
            const code = buf.join('\n').replace(/(from\s+|import\s*\(\s*)(['"])(?:[^'"]*engine\/index\.js|@threedog\/engine)\2/g, (m, a, q) => `${a}${q}${abs(P.INDEX_JS_REL)}${q}`);
            const file = join(dir, `${doc.replace(/[/.]/g, '_')}__${n}.js`);
            writeFileSync(file, code + '\nexport {};\n');
            blocks.push({ doc, n, startLine: start, file });
            return;
          }
          if (inBlock) buf.push(line);
        });
      }
      const prelude = join(dir, 'prelude.d.ts');
      writeFileSync(prelude, `import type { Engine } from '${abs(P.INDEX_JS_REL)}';\ndeclare global {\n  const engine: Engine;\n  const e: Engine;\n  const THREE: any;\n  const dt: number;\n  const opts: any;\n  const game: any;\n}\nexport {};\n`);
      const program = ts.createProgram([prelude, ...dtsFiles().map(abs), ...blocks.map(b => b.file)], {
        allowJs: true, checkJs: true, noEmit: true, strict: false, noImplicitAny: false, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [],
      });
      const out = [];
      let skipped = 0;
      for (const b of blocks) {
        const sf = program.getSourceFile(b.file);
        if (program.getSyntacticDiagnostics(sf).length) { skipped++; continue; }
        for (const d of program.getSemanticDiagnostics(sf)) {
          if (IGNORE_CODES.has(d.code)) continue;
          const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
          if (DOM.test(msg) || ALLOW.some(([doc, k, frag]) => doc === b.doc && k === b.n && frag && msg.includes(frag))) continue;
          const line = d.start != null ? sf.getLineAndCharacterOfPosition(d.start).line : 0;
          const src = sf.text.split('\n')[line]?.trim().slice(0, 60);
          out.push({ level: 'warn', file: b.doc, line: b.startLine + line, msg: `js code block #${b.n}: ${msg.slice(0, 160)} (TS${d.code})  ${src}`,
            fix: 'follow the d.ts (the matching page in packages/engine/docs/api/) and fix the doc; if the d.ts is missing it, fix the d.ts and run npm run map' });
        }
      }
      out.note = `checked ${blocks.length} code blocks (${docs.length} docs), skipped ${skipped} with syntax errors (snippets/ellipses)`;
      return out;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};
