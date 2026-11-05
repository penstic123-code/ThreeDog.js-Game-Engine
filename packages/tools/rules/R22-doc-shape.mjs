// R22 the hand-written docs keep their shape: each sentence in one place, entry docs stay small.
// Detection:
//   1. AI.md entry table (error, engine repository): every public engine namespace (an Engine property whose type has methods, read from the d.ts
//      with the program shared with R18) appears as `engine.<name>` in the "One thing, one entry point" table, and every row's last column names
//      a recipe file that exists. Adding a public API means adding its row and recipe section in the same commit.
//      The game template's "Already here" table is generated from AI.md rows (lib/default-layer.mjs); a key without a row is an error.
//   2. Sizes: AI.md over 11 KB and the game template's CLAUDE.md over 7.25 KB (as new-game writes it, every placeholder filled) are errors (both are read every session, so they stay indexes and
//      correctness rules; detail moves to the recipe it belongs to). A game's DESIGN.md over 8 KB and STATUS.md over 4 KB are warnings.
//      Plus a size budget for all shipped AI docs: hand-written (recipes and the rest) and generated (API.md, api/, CODEMAP.md).
//   3. Duplicates (warn): one sentence of 12 or more words in two hand-written docs (AI.md, recipes, READMEs, CLAUDE.md files, .claude/rules,
//      game docs). Both places are printed; keep it in the one that owns the topic and link from the other.
//   4. Copied passages (error): a run of 30 or more words that appears in two docs (all of 3's docs plus COMMANDS, THREE and PERF). Why an
//      error: a copied paragraph is a second source of the same fact; one copy gets fixed, the other goes stale, and the AI reads both.
//   5. Recipe summaries (error): a recipe over 15 KB starts with an "**In this recipe**:" line of at most 5 lines, so `threedog how` and a
//      reader see what is inside before opening it.
// Known limits: the duplicate check compares normalised sentences (case, markdown marks and spacing ignored), so a reworded copy passes.
import { existsSync, statSync } from 'node:fs';
import { defaultLayer } from '../lib/default-layer.mjs';
import { render } from '../lib/scaffold.mjs';
import { join } from 'node:path';
import { walk, read, abs, rel, P, engineApi } from './_lib.mjs';
import { docFiles } from './R18-doc-refs.mjs';

const AI_REL = `${P.DOCS_REL}/AI.md`, AI_MAX = 11 * 1024, TPL_CLAUDE_MAX = 7.25 * 1024, DESIGN_MAX = 8 * 1024, STATUS_MAX = 4 * 1024, MIN_WORDS = 12;
// Size budget of what ships to an AI (set a little above the size after the 2026-11-05 cuts; growing past it is a decision, so raise it in the same change as the reason):
// hand-written = recipes + the docs/*.md that people write (not API.md or CODEMAP.md); generated = API.md + api/ + CODEMAP.md
const HAND_MAX = 840 * 1024, GENERATED_MAX = 340 * 1024, GENERATED_FILES = new Set(['API.md', 'CODEMAP.md']);
const kb = n => (n / 1024).toFixed(1) + ' KB';
const PASSAGE = 30, SUMMARY_OVER = 15 * 1024;

/** Word stream of a markdown text without code blocks: [{ w, line }] (inline code kept as one word, so a copied call counts) */
export function words(text) {
  const out = []; let fence = false;
  text.split('\n').forEach((raw, i) => {
    if (/^\s*```/.test(raw)) { fence = !fence; return; }
    if (fence || /^\s*\|?[\s|:-]+\|?\s*$/.test(raw)) return;
    const flat = raw.replace(/`[^`]*`/g, m => m.replace(/\s+/g, '_')).replace(/[*_#>|]/g, ' ');
    for (const w of flat.toLowerCase().match(/[\p{L}\p{N}'-]+/gu) || []) out.push({ w, line: i + 1 });
  });
  return out;
}

/** Runs of PASSAGE+ words shared by two texts: [{ fa, la, fb, lb, text }] (one per run, not one per overlapping window) */
export function passages(files) {
  const first = new Map(), out = [];
  for (const [f, text] of files) {
    const ws = words(text);
    let lastHit = -2;
    for (let i = 0; i + PASSAGE <= ws.length; i++) {
      const key = ws.slice(i, i + PASSAGE).map(x => x.w).join(' ');
      const seen = first.get(key);
      if (!seen) { first.set(key, { f, line: ws[i].line }); continue; }
      if (seen.f === f) continue;
      if (i !== lastHit + 1) out.push({ fa: seen.f, la: seen.line, fb: f, lb: ws[i].line, text: key.split(' ').slice(0, 10).join(' ') });
      lastHit = i;
    }
  }
  return out;
}

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
    // the column names recipes by file, with or without the folder ("06-clock-events.md" or `recipes/06-clock-events.md`)
    const m = last.match(/(?:recipes\/)?(\d\d-[\w.-]+\.md)/), rec = m && `recipes/${m[1]}`;
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
      const tpl = `${P.TOOLS_REL}/templates/game/CLAUDE.md`, layer = defaultLayer(text);
      // the template's "Already here" table is cut from AI.md rows (lib/default-layer.mjs): a row that was renamed or removed breaks the cut, and the size counts the table
      for (const k of layer.missing) out.push({ level: 'error', file: AI_REL, line: 0, msg: `the new-game CLAUDE.md table takes the AI.md row starting "${k}", and none does`, fix: `rename the key in ${P.TOOLS_REL}/lib/default-layer.mjs to the row's new start, or drop it` });
      // measured as new-game writes it: the renderer words (WebGPU route text) and the gameplay note count too, in the longest of the four variants;
      // it once measured only the table and the file a game really reads was 7.2 KB against a 6.5 KB limit
      const ts = existsSync(abs(tpl)) ? Math.max(...[false, true].flatMap(webgl => [false, true].map(openWorld => Buffer.byteLength(render(read(tpl), { name: 'game', openWorld, webgl }))))) : 0;
      if (ts > TPL_CLAUDE_MAX) out.push({ level: 'error', file: tpl, line: 0, msg: `the game template's CLAUDE.md is ${kb(ts)} > ${kb(TPL_CLAUDE_MAX)}`, fix: 'every game reads it every session: keep correctness rules and one-line pointers, move steps into the recipe that owns them' });
      const sizeOf = fs => fs.reduce((n, f) => n + statSync(abs(f)).size, 0);
      const docs = walk(P.DOCS_REL, ['.md']), isGen = f => GENERATED_FILES.has(f.split('/').pop()) || f.startsWith(`${P.API_DIR_REL}/`);
      const hand = sizeOf(docs.filter(f => !isGen(f))), gen = sizeOf(docs.filter(isGen));
      if (hand > HAND_MAX) out.push({ level: 'error', file: AI_REL, line: 0, msg: `hand-written AI docs (recipes, AI.md, CONVENTIONS, COMMANDS, THREE, PERF, MIGRATING) are ${kb(hand)} > ${kb(HAND_MAX)}`, fix: 'merge or cut before adding: a fact lives in one place; raise HAND_MAX in R22-doc-shape.mjs only with the reason in the same change' });
      if (gen > GENERATED_MAX) out.push({ level: 'error', file: AI_REL, line: 0, msg: `generated docs (API.md, api/, CODEMAP.md) are ${kb(gen)} > ${kb(GENERATED_MAX)}`, fix: 'the public surface grew: see docs/testing/api-count.md; raise GENERATED_MAX in R22-doc-shape.mjs only with the reason' });
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
    // AGENTS.md of a game is a generated copy of its CLAUDE.md (lib/scaffold.mjs): left out here on purpose, it would only repeat every sentence
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
    // 4. copied passages (the same game scoping as 3: a game's files are compared only with files of the same game)
    const all = [...docs, ...[`${P.DOCS_REL}/COMMANDS.md`, `${P.DOCS_REL}/THREE.md`, `${P.DOCS_REL}/PERF.md`].filter(f => existsSync(abs(f)))];
    const groups = new Map();
    for (const f of new Set(all)) { const g = gameOf(f) ?? ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push([f, read(f)]); }
    for (const list of groups.values()) for (const p of passages(list))
      out.push({ level: 'error', file: p.fb, line: p.lb, msg: `a passage of ${PASSAGE}+ words is also in ${p.fa}:${p.la} ("${p.text} …")`, fix: 'one source per fact: keep the passage in the doc that owns the topic, replace this copy with one line and a link' });
    // 5. long recipes carry a summary of what is inside
    if (P.MODE === 'monorepo') for (const f of walk(P.RECIPES_REL, ['.md'])) {
      const text = read(f);
      if (Buffer.byteLength(text) <= SUMMARY_OVER) continue;
      const L = text.split('\n'), at = L.findIndex(l => /^\*\*In this recipe\*\*:/.test(l));
      let n = 0; if (at >= 0) while (at + n < L.length && L[at + n].trim()) n++;
      if (at < 0 || at > 3 || n > 5) out.push({ level: 'error', file: f, line: 1, msg: at < 0 || at > 3 ? `recipe is ${kb(Buffer.byteLength(text))} with no "**In this recipe**:" summary under its title` : `the "In this recipe" summary is ${n} lines (at most 5)`, fix: 'add one to five lines under the title naming what the sections cover' });
    }
    out.note = `${docs.size} docs compared for repeated sentences, ${all.length} for copied passages`;
    return out;
  },
};
