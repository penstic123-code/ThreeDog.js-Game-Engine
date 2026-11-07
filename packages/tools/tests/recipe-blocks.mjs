// Every ```js block in the recipes parses, and every name it imports from a package exists (no browser).
// Why: an AI copies recipe code as it is. A block that does not parse (a string broken over two lines, a "..." where code should be) or that
// imports a name the package does not export fails on the first run, and the AI then guesses. `threedog check` R13 type-checks the blocks but
// silently skips one that does not parse, and it cannot see names imported from 'threedog' (the bare name does not resolve from its temp
// folder), so neither mistake showed anywhere. Recipe 56 goes further and runs its blocks on WebGPU (engine spec recipe-56); running every
// recipe's blocks would need a page per recipe (content, assets, modules), so this is the cheap check that covers all of them.
// A block that is on purpose only a piece (the inside of an object, a line with an ellipsis) is fenced ```js fragment: still highlighted as
// JS and not presented as code to paste. A fragment still parses, alone or as the inside of an object or array, or says where it is cut with
// an ellipsis: a broken one would fall out of R13 and show nothing. Its imports are checked like any block's. Engine names in every block: R18.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { ENGINE } from '../paths.mjs';

export const name = 'recipe code blocks: every js block parses and imports only names its package exports (fragments fenced js fragment)';

/** The ```js blocks of a markdown text: [{ n, line, code }]; with fragments: true also the ```js fragment ones, marked fragment: true */
export function jsBlocks(text, { fragments = false } = {}) {
  const out = []; let at = -1, buf = [], piece = false;
  text.split('\n').forEach((l, i) => {
    const open = at < 0 && /^\s*```js(\s+fragment)?\s*$/.exec(l);
    if (open) { at = i + 2; buf = []; piece = !!open[1]; return; }
    if (at >= 0 && /^\s*```\s*$/.test(l)) { if (!piece || fragments) out.push({ n: out.length + 1, line: at, code: buf.join('\n'), fragment: piece }); at = -1; return; }
    if (at >= 0) buf.push(l);
  });
  return out;
}

/** The first syntax error of a block as "line: message", or '' */
export function syntaxError(code) {
  const sf = ts.createSourceFile('block.mjs', code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const d = sf.parseDiagnostics?.[0];
  if (!d) return '';
  const ln = sf.getLineAndCharacterOfPosition(d.start).line;
  return `+${ln}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')} | ${code.split('\n')[ln]?.trim().slice(0, 80)}`;
}

/** A fragment nothing can read: it parses neither alone nor as the inside of an object or array, and no ellipsis says where it is cut */
export function brokenFragment(code) {
  if (/\.\.\.\s*[,}\])]|…/.test(code)) return '';
  return [code, `({\n${code}\n})`, `[\n${code}\n]`].every(syntaxError) ? syntaxError(code) : '';
}

/** Named imports of a block from packages (relative paths and made-up example packages are not checked): [{ from, names }] */
export function packageImports(code) {
  const out = [];
  for (const m of code.matchAll(/^\s*import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/gm)) {
    const from = m[2];
    if (from.startsWith('.') || !/^(three|threedog|@threedog\/)/.test(from)) continue;
    out.push({ from, names: m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean) });
  }
  return out;
}

export async function run({ check }) {
  const dir = join(ENGINE, 'docs', 'recipes'), files = readdirSync(dir).filter(f => f.endsWith('.md')).sort();
  const bad = [], missing = [], mods = new Map();
  let blocks = 0;
  for (const f of files) {
    for (const b of jsBlocks(readFileSync(join(dir, f), 'utf8'), { fragments: true })) {
      blocks++;
      const err = b.fragment ? brokenFragment(b.code) : syntaxError(b.code);
      if (err) { bad.push(`${f} block ${b.n} (line ${b.line}) ${err}`); continue; }
      for (const { from, names } of packageImports(b.code)) {
        if (!mods.has(from)) mods.set(from, await import(from).then(m => new Set(Object.keys(m)), e => e));
        const exp = mods.get(from);
        if (exp instanceof Error) { missing.push(`${f} block ${b.n}: cannot import '${from}' (${exp.message.slice(0, 80)})`); continue; }
        for (const n of names) if (!exp.has(n)) missing.push(`${f} block ${b.n} (line ${b.line}): '${from}' has no export ${n}`);
      }
    }
  }
  check(`the recipes have js blocks to check (${blocks})`, blocks > 150, String(blocks));
  check('every ```js block of the recipes parses (a piece on purpose is fenced ```js fragment and is a readable piece)', !bad.length, bad.join('\n'));
  check('every name a recipe block imports from three / threedog / @threedog/* exists', !missing.length, missing.join('\n'));
  // self-check: the checker itself must catch the kind of error recipe 43 had (a line break inside a string) and an export name that does not exist
  check('the checker catches a string broken over two lines, a made-up import name and a fragment that is no piece of js',
    !!syntaxError("const s = '#include <a>\n...';") && packageImports("import { nope } from 'threedog';")[0]?.names[0] === 'nope'
    && !!brokenFragment('attribute float aLife;') && !brokenFragment("slot: 'color',\nglsl: 'a',"));
}
