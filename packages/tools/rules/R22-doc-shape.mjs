// R22 the hand-written docs keep their shape: each sentence in one place, entry docs stay small.
// Detection:
//   1. AI.md entry table (error, engine repository): every public engine namespace (an Engine property whose type has methods, read from the d.ts
//      with the program shared with R18) appears as `engine.<name>` in the "One thing, one entry point" table, and every row's last column names
//      a recipe file that exists. Adding a public API means adding its row and recipe section in the same commit.
//   2. Sizes: AI.md over 20 KB is an error (it is an index). A game's DESIGN.md over 8 KB and STATUS.md over 4 KB are warnings.
//   3. Duplicates (warn): one sentence of 12 or more words in two hand-written docs (AI.md, recipes, READMEs, CLAUDE.md files, .claude/rules,
//      game docs). Both places are printed; keep it in the one that owns the topic and link from the other.
// Known limits: the duplicate check compares normalised sentences (case, markdown marks and spacing ignored), so a reworded copy passes.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { walk, read, abs, rel, P, engineApi } from './_lib.mjs';
import { docFiles } from './R18-doc-refs.mjs';

const AI_REL = `${P.DOCS_REL}/AI.md`, AI_MAX = 20 * 1024, DESIGN_MAX = 8 * 1024, STATUS_MAX = 4 * 1024, MIN_WORDS = 12;
const kb = n => (n / 1024).toFixed(1) + ' KB';

/** Problems with AI.md's entry table and size (exported for the rule tests) */
export function entryTable(text, namespaces, recipeExists) {
  const out = [], L = text.split('\n');
  const start = L.findIndex(l => /^## One thing, one entry point/.test(l));
  if (start < 0) return [{ level: 'error', line: 0, msg: 'AI.md has no "## One thing, one entry point" section', fix: 'restore the entry table: | To do | Use | Recipe |' }];
  let end = L.findIndex((l, i) => i > start && /^## /.test(l)); if (end < 0) end = L.length;
  const rows = L.slice(start + 1, end).map((l, i) => [l, start + 2 + i]).filter(([l]) => /^\|/.test(l) && !/^\|\s*-/.test(l) && !/^\|\s*To do\s*\|/.test(l));
  const table = rows.map(r => r[0]).join('\n');
  for (const ns of namespaces) if (!new RegExp(`engine\\.${ns}\\b`).test(table))
    out.push({ level: 'error', line: start + 1, msg: `public namespace \`engine.${ns}\` has no row in AI.md's entry table`, fix: `add a one-line row "| task | \`engine.${ns}\` | \`recipes/NN-x.md\` |" and a section in that recipe` });
  for (const [row, n] of rows) {
    const cells = row.split(/(?<!\\)\|/).slice(1, -1), last = cells[cells.length - 1] || '';
    const rec = last.match(/recipes\/[\w.-]+\.md/)?.[0];
    if (!rec) out.push({ level: 'error', line: n, msg: 'entry row without a recipe in its last column', fix: 'point the row at the recipe that teaches the task (`recipes/NN-x.md`)' });
    else if (!recipeExists(rec)) out.push({ level: 'error', line: n, msg: `entry row points at \`${rec}\`, which does not exist`, fix: 'fix the recipe name' });
  }
  return out;
}

/** Normalised sentences of 12+ words in a markdown text: [{ key, line }] (code blocks skipped) */
export function sentences(text) {
  const out = []; let fence = false;
  text.split('\n').forEach((raw, i) => {
    if (/^\s*```/.test(raw)) { fence = !fence; return; }
    if (fence) return;
    const flat = raw.replace(/`[^`]*`/g, m => m.replace(/\s+/g, '_')).replace(/[*_#>|]/g, ' ');
    for (const s of flat.split(/(?<=[.!?;:。])\s+/)) {
      const words = s.toLowerCase().match(/[\p{L}\p{N}'-]+/gu) || [];
      if (words.length >= MIN_WORDS) out.push({ key: words.join(' '), line: i + 1 });
    }
  });
  return out;
}

export default {
  id: 'R22', title: 'Doc shape: entry table, sizes, one place per sentence', game: true,
  run() {
    const out = [];
    // 1-2. AI.md
    if (P.MODE === 'monorepo' && existsSync(abs(AI_REL))) {
      const text = read(AI_REL), size = Buffer.byteLength(text);
      if (size > AI_MAX) out.push({ level: 'error', file: AI_REL, line: 0, msg: `AI.md is ${kb(size)} > ${kb(AI_MAX)}`, fix: 'AI.md is an index: keep one line per row and convention, move the detail into the recipe (or CONVENTIONS.md)' });
      const ns = engineApi().namespaces.map(n => n.name);
      for (const r of entryTable(text, ns, rec => existsSync(join(abs(P.DOCS_REL), rec)))) out.push({ ...r, file: AI_REL });
    }
    // 2. game docs
    const gameDocs = [...P.gameDirs(), ...(P.MODE === 'monorepo' ? [abs(`${P.TOOLS_REL}/templates/game`)] : [])];
    for (const d of gameDocs) for (const [f, max, where] of [['DESIGN.md', DESIGN_MAX, 'docs/design/<system>.md'], ['STATUS.md', STATUS_MAX, 'docs/plans/<feature>.md']]) {
      const p = join(d, f);
      if (existsSync(p) && statSync(p).size > max) out.push({ level: 'warn', file: rel(p), line: 0, msg: `${f} is ${kb(statSync(p).size)} > ${kb(max)}`, fix: `keep ${f} a short index: move the detail into ${where} and link it` });
    }
    // 3. duplicated sentences
    const docs = new Set(docFiles().filter(f => !/\/(COMMANDS|THREE|PERF)\.md$/.test(f)));
    for (const f of ['CLAUDE.md', ...walk('.claude/rules', ['.md']), ...P.gameDirs().map(d => rel(join(d, 'CLAUDE.md'))), `${P.TOOLS_REL}/templates/game/CLAUDE.md`]) if (existsSync(abs(f))) docs.add(f);
    // a game's docs start as copies of the template and quote the engine docs: compare a game's file only with files of the same game
    const gameRoots = [...P.gameDirs().map(d => rel(d)).filter(Boolean).map(r => r + '/'), `${P.TOOLS_REL}/templates/game/`];
    const gameOf = f => gameRoots.find(r => f.startsWith(r)) ?? null;
    const seen = new Map();
    for (const f of docs) for (const s of sentences(read(f))) {
      const first = seen.get(s.key);
      if (!first) seen.set(s.key, { f, line: s.line });
      else if (first.f !== f && gameOf(f) === gameOf(first.f)) out.push({ level: 'warn', file: f, line: s.line, msg: `same sentence as ${first.f}:${first.line} ("${s.key.split(' ').slice(0, 8).join(' ')} …")`, fix: 'keep it in the doc that owns the topic and link to it from the other' });
    }
    out.note = `${docs.size} docs compared for repeated sentences`;
    return out;
  },
};
