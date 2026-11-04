// R13 type-check of code blocks in docs (warning): the ```js blocks in packages/engine/docs/recipes/*.md and packages/engine/docs/api/*.md are copied by the AI;
// if an API is renamed or its parameters change and the docs lag behind, the copy is wrong. Each block is extracted into its own temporary .js file and checked by TypeScript against the engine d.ts.
// Handling incomplete snippets:
//   - a prelude declaration file provides the usual top-level variables: engine / e (Engine), THREE (any), dt (number), opts / game (any)
//   - import 'threedog' and 'xxx/engine/index.js' (any relative path) are redirected to the real packages/engine/index.js: a block importing from 'threedog' was typed any, so
//     createEngine({ style }) and interactions({ keys }) passed. Other unresolved imports and undefined names (TS2304/2552/2307) are not reported
//   - an option a function does not take (TS2353, TS2561 with a "did you mean") is an error, the rest warnings: it throws when copied, so it is a block that can never run
//   - a canary block with a wrong option runs with the docs and must be reported, else this rule is the error: it once went blind on Windows, where the engine's path in
//     the import strings held backslashes, every block was typed any, and nobody could tell from its output
//   - a relative import into a folder the game template does not have (./style/index.js) is an error: the copy fails on load
//   - blocks with syntax errors (with … ellipses, or just a piece of an object) are skipped whole and only counted in the summary
//   - web (DOM) type errors are not reported (same as npm run types)
// Output: doc file + block number + line within the block + the reason (TypeScript's original text).
// Limitation: variables without a type (such as const npc = … inside the snippet) are only checked as far as the d.ts lets TypeScript infer.
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ts, walk, read, abs, dtsFiles, P } from './_lib.mjs';

// Allowlist: [doc file, block number (from 1), fragment of the original error text (null = skip the whole block), reason]
const ALLOW = [
  [`${P.RECIPES_REL}/11-vehicles.md`, 1, '(number | boolean)[]', 'in JS, [[x, z, true, false]].map(([x, z, steer, drive]) => …) destructuring is inferred as (number|boolean), a TypeScript inference limit, not a doc mistake'],
];
// the folders of templates/game, plus what recipes name as a game's own helper folder
const TEMPLATE_DIRS = new Set([...readdirSync(abs(`${P.TOOLS_REL}/templates/game`), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)]);
// forward slashes: it goes inside an import string, where a Windows backslash is an escape and the import silently stops resolving
const INDEX = abs(P.INDEX_JS_REL).replaceAll('\\', '/');
const CANARY = '<canary>', UNKNOWN_OPTION = new Set([2353, 2561]);
const IGNORE_CODES = new Set([18004, 2304, 2552, 2307, 2792, 2583, 2580, 1375, 1378, 2451, 2300, 2393]);
const DOM = /HTML\w*Element|CSSStyleDeclaration|EventTarget|'Element'|Window|globalThis|'Document'/;

export default {
  id: 'R13', title: 'Type-check of doc code blocks',
  run() {
    const docs = [...walk(P.RECIPES_REL, ['.md']), ...walk(P.API_DIR_REL, ['.md'])];
    const dir = mkdtempSync(join(tmpdir(), 'threedog-r13-'));
    const blocks = [], bad = [];   // { doc, n, startLine, file }; findings made while reading the blocks
    try {
      for (const doc of docs) {
        const L = read(doc).split('\n');
        let inBlock = false, start = 0, buf = [], n = 0;
        L.forEach((line, i) => {
          if (!inBlock && /^\s*```js\s*$/.test(line)) { inBlock = true; start = i + 2; buf = []; n++; return; }
          if (inBlock && /^\s*```\s*$/.test(line)) {
            inBlock = false;
            if (ALLOW.some(([d, k, frag]) => d === doc && k === n && frag == null)) return;
            const code = buf.join('\n').replace(/(from\s+|import\s*\(\s*)(['"])(?:[^'"]*engine\/index\.js|@threedog\/engine|threedog)\2/g, (m, a, q) => `${a}${q}${INDEX}${q}`);
            for (const m of code.matchAll(/\bfrom\s+['"]\.\/([\w-]+)\/[^'"]+['"]/g)) if (!TEMPLATE_DIRS.has(m[1])) bad.push({ level: 'error', file: doc, line: start + code.slice(0, m.index).split('\n').length - 1, msg: `js code block #${n}: imports ./${m[1]}/, a folder new games do not have`, fix: `use a folder of the game template (${[...TEMPLATE_DIRS].join(', ')}), or create the file in the same recipe and add it to R13's list` });
            const file = join(dir, `${doc.replace(/[/.]/g, '_')}__${n}.js`);
            writeFileSync(file, code + '\nexport {};\n');
            blocks.push({ doc, n, startLine: start, file });
            return;
          }
          if (inBlock) buf.push(line);
        });
      }
      const canary = join(dir, 'canary.js');
      writeFileSync(canary, `import { createEngine } from '${INDEX}';\ncreateEngine({ canvas: null, notAnOption: 1 });\nexport {};\n`);
      blocks.push({ doc: CANARY, n: 1, startLine: 1, file: canary });
      const prelude = join(dir, 'prelude.d.ts');
      writeFileSync(prelude, `import type { Engine } from '${INDEX}';\ndeclare global {\n  const engine: Engine;\n  const e: Engine;\n  const THREE: any;\n  const dt: number;\n  const opts: any;\n  const game: any;\n}\nexport {};\n`);
      const program = ts.createProgram([prelude, ...dtsFiles().map(abs), ...blocks.map(b => b.file)], {
        allowJs: true, checkJs: true, noEmit: true, strict: false, noImplicitAny: false, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [],
      });
      const out = bad;
      let skipped = 0, sang = false;
      for (const b of blocks) {
        const sf = program.getSourceFile(b.file);
        if (program.getSyntacticDiagnostics(sf).length) { skipped++; continue; }
        for (const d of program.getSemanticDiagnostics(sf)) {
          if (IGNORE_CODES.has(d.code)) continue;
          if (b.doc === CANARY) { sang = true; continue; }
          const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
          if (DOM.test(msg) || ALLOW.some(([doc, k, frag]) => doc === b.doc && k === b.n && frag && msg.includes(frag))) continue;
          const line = d.start != null ? sf.getLineAndCharacterOfPosition(d.start).line : 0;
          const src = sf.text.split('\n')[line]?.trim().slice(0, 60);
          out.push({ level: UNKNOWN_OPTION.has(d.code) ? 'error' : 'warn', file: b.doc, line: b.startLine + line, msg: `js code block #${b.n}: ${msg.slice(0, 160)} (TS${d.code})  ${src}`,
            fix: 'follow the d.ts (the matching page in packages/engine/docs/api/) and fix the doc; if the d.ts is missing it, fix the d.ts and run npm run map' });
        }
      }
      if (!sang) out.push({ level: 'error', file: P.RECIPES_REL, line: 0, msg: 'R13 no longer sees the engine types: a canary block with a wrong option passed, so doc blocks are unchecked', fix: 'see how the block imports resolve in R13-doc-snippets.mjs' });
      out.note = `checked ${blocks.length} code blocks (${docs.length} docs), skipped ${skipped} with syntax errors (snippets/ellipses)`;
      return out;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};
