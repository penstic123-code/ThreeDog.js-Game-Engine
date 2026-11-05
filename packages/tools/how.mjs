// threedog how "<effect or task>": which API / recipe answers a task, from the docs alone (works offline) plus the live catalog when a dev page runs.
// Why plain token scoring and no fuzzy library: the result must be the same every run and explainable ("matched rain in the AI.md row"); an AI reads
// the top few hits. Sources: the AI.md entry table (one row per task: the best hit), the CONVENTIONS.md "One task, which entry" table (the owner of
// "which of several entries"), recipe headings with their first sentence, and the plain three.js answers: THREE.md (tables and numbered conventions)
// and the recipe 54 idiom table. Ranking: each typed word weighs by how rare it is in the docs (so "game", "player" in a whole sentence barely
// count and "fps", "sidescroller" decide), a synonym from how-words.mjs or a plural / -ing stem counts a little less than the word itself, and a
// word only starting a longer word ("save" in "saveable") counts little. Hits that cover more of the query's weight come first; at about the same
// cover a plain three.js hit comes first (if three.js can do it, that is the answer), then an entry row (the one recommended entry for its task;
// a recipe section or technique example under it is the second read), then by score. A query nothing covers well is said so (weak), with the
// words the docs never use and where to read instead.
// Why each hit carries `at` (path#section) and `para`: progressive disclosure. The AI reads one paragraph of the matching section, not a whole
// recipe (they run to 28 KB); an AI.md row is resolved to the best-matching section of the recipe it points at.
// English only: the docs are English, and an AI asked in another language translates the task into English words first.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE, command } from './paths.mjs';
import { devServerInfo } from './devinfo.mjs';
import { STOP as STOP_WORDS, SYNONYMS } from './how-words.mjs';

/** Lower-case word / number tokens of a text */
export function tokens(s) {
  const out = [];
  for (const m of s.toLowerCase().matchAll(/[a-z0-9_.]{2,}/g)) out.push(m[0].replace(/\.+$/, ''));
  return out.filter(t => t.length >= 2);
}
const STOP = new Set(STOP_WORDS);
// synonym groups, looked up in lower case: each word points at the one group it belongs to (a word belongs to one group only; how-words.mjs says why)
const GROUP = new Map();
for (const g of SYNONYMS) for (const w of g) GROUP.set(w.toLowerCase(), g.map(x => x.toLowerCase()));

/** One typed word as a "concept": the word, its plural-stripped stem, and its synonym group (a synonym hit counts a little less than the typed word) */
function concept(w) {
  const own = new Set([w]);
  if (w.length > 4 && w.endsWith('es')) own.add(w.slice(0, -2));
  if (w.length > 3 && w.endsWith('s')) own.add(w.slice(0, -1));
  for (const suf of ['ing', 'ed']) if (w.length > suf.length + 2 && w.endsWith(suf)) {   // jumping -> jump, running -> runn -> run
    const s = w.slice(0, -suf.length); own.add(s); if (/([b-df-hj-np-tv-z])\1$/.test(s)) own.add(s.slice(0, -1));
  }
  const syn = new Set();
  for (const x of own) for (const s of GROUP.get(x) ?? []) if (!own.has(s)) syn.add(s);
  // weights: a typed word 1, its stem without the plural 0.9 (a line with "seasons" as typed ranks above one that only says season), a synonym 0.8
  return { word: w, alts: [...[...own].map(a => ({ a, k: a === w ? 1 : 0.9 })), ...[...syn].map(a => ({ a, k: 0.8 }))] };
}

/** { main: the distinct tokens typed, stop words dropped; concepts: each with its stem and synonyms } */
export function queryTokens(q) {
  const main = [...new Set(tokens(q).filter(t => !STOP.has(t)))], concepts = main.map(concept);
  // each typed word counts on its own: fps no longer lists slow among its synonyms (slow is a word of its own), or one slow in a text counts twice,
  // and a networking recipe that mentions slow in passing would beat the performance line that says both slow and fps
  const typed = new Set(concepts.flatMap(c => c.alts.filter(x => x.k > 0.8).map(x => x.a)));
  for (const c of concepts) c.alts = c.alts.filter(x => x.k > 0.8 || !typed.has(x.a));
  return { main, concepts };
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reCache = new Map();
/** How well word w hits text t: 1 = a whole word ("save", "saves", "saving", camelCase "openWorld"), 0.4 = only the start of a longer word
 *  ("save" in "saveable"), 0 = no hit. Why the split: word-start matching keeps "rain" out of "terrain", and the whole-word check keeps
 *  "save" from ranking a "saveable" mesh row above the save system. Case matters only for the camelCase boundary, so t keeps its case. */
function hit(t, w) {
  if (!/^[a-z0-9_]/.test(w)) return t.toLowerCase().includes(w) ? 1 : 0;
  let re = reCache.get(w);
  if (!re) reCache.set(w, re = new RegExp('(^|[^a-zA-Z0-9])' + esc(w) + '([a-zA-Z0-9]*)', 'gi'));
  let best = 0;
  for (const m of t.matchAll(re)) {
    const rest = m[2];
    // the word as typed or as a camelCase part 1, a variant with an ending (saves, saved, lighting) 0.9: "save" goes to the saving line before a line that only says saved
    const v = !rest || /^[A-Z]/.test(rest) ? 1 : /^(s|es|ed|d|ing|er|ers|ly)$/.test(rest) ? 0.9 : 0.4;
    best = Math.max(best, v);
    if (best === 1) break;
  }
  return best;
}
// camelCase names are also split into words and searched again: presets.player.thirdPerson must match "third person", sideScroller still matches "sidescroller" (the pass over the raw text)
const camelCache = new Map();
const camelSplit = t => { let s = camelCache.get(t); if (s === undefined) { s = t.replace(/([a-z0-9])([A-Z])/g, '$1 $2'); camelCache.set(t, s === t ? null : s); } return s; };
/** How well a concept hits a text: the best of its alternatives (typed word 1, synonym 0.8; whole word 1, word start 0.4) */
const conceptHit = (text, c) => {
  const split = camelSplit(text);
  let b = 0;
  // a split part is half a word of a code name (the time of uTimeOfDay), a little weaker than a word in prose, so one uniform name does not beat the line that says "time of day"
  for (const { a, k } of c.alts) { const h = Math.max(hit(text, a), split ? hit(split, a) * 0.75 : 0) * k; if (h > b) b = h; if (b === 1) break; }
  return b;
};
/** Words of the query found in the text (each counts once; used where a plain count is enough: which section of a recipe to open) */
const matched = (text, qt) => qt.concepts.filter(c => conceptHit(text, c) > 0).length;
/** Weighted hit: each concept counts by how rare it is in the docs (qt.w, set in search) times how well it hits */
const score = (text, qt) => qt.concepts.reduce((s, c, i) => s + conceptHit(text, c) * qt.w[i], 0);
const clip = (s, n = 110) => { s = s.replace(/`/g, '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const isRule = l => /^\|[\s|:-]+\|?$/.test(l);
/**
 * Table rows and numbered conventions of a doc (header rows and rules skipped). Only a table whose first header names plain three.js
 * ("You write (plain three.js)", "three.js idiom") gives plain three.js entries; the other tables and the numbered conventions name engine
 * APIs used with three.js (engine.rigid.addBox, engine.terrainDraw.meshes...), so they are labelled 'engine + three.js' and never get the plain-first rank.
 */
function plainRows(file, where, out) {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf8').split('\n');
  let adopt = false, plainTable = false, skip = false;   // adopt: inside the "You write (plain three.js) | The engine does | The one line" table; skip: the "| id |" list of changes to three.js (a reference, describe().threePatches, not a task answer)
  lines.forEach((line, i) => {
    if (!line.startsWith('|') || isRule(line) || isRule(lines[i + 1] ?? '')) {   // a row followed by |---| is the header
      if (isRule(lines[i + 1] ?? '')) { adopt = /^\|\s*You write/.test(line); plainTable = /^\|[^|]*three\.js/i.test(line); skip = /^\|\s*id\s*\|/.test(line); }
      return;
    }
    if (skip) return;
    const c = line.split('|').slice(1, -1).map(x => x.trim());
    if (c.length < 2) return;
    // in the adoption table only the first column names the task; the other two describe what the engine then does (save, light, post, scene...)
    // and would make every row a tie-winning "plain three.js" hit for words that belong to an engine route
    out.push({ src: plainTable ? 'plain' : 'three', plain: plainTable, title: c[0], use: c.slice(1).filter(x => x && x !== '-').join(' · '), where, text: adopt ? c[0] : c.join(' ') });
  });
  // numbered conventions ("3. **Per-frame logic** ..."): one entry each
  for (const line of lines) {
    const m = /^(\d+)\.\s+\*\*(.+?)\*\*:?\s*(.*)/.exec(line);
    if (m) out.push({ src: 'three', plain: false, title: m[2].replace(/[:.]$/, ''), use: m[3].replace(/^[\s,:;.]+/, ''), where: `${where} §${m[1]}`, text: m[2] + ' ' + m[3] });
  }
}

/** GitHub-style heading anchor: "4b. Third-person action" -> "4b-third-person-action" */
export const slug = h => h.toLowerCase().replace(/`/g, '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/ /g, '-');
/** The first prose paragraph from line i (code, tables and the next heading end it), at most ~480 chars */
function paragraph(lines, i) {
  const out = [];
  for (; i < lines.length && !/^#/.test(lines[i]); i++) {
    const l = lines[i];
    if (l.startsWith('```') || l.startsWith('|') || l.startsWith('<!--') || !l.trim()) { if (out.length) break; continue; }
    out.push(l.trim());
  }
  const t = out.join(' ');
  return t.length > 480 ? t.slice(0, 479) + '…' : t;
}
/** A section's own text (to score which section of a recipe an AI.md row should open) */
function sectionText(lines, i) { let t = ''; for (; i < lines.length && !/^#/.test(lines[i]); i++) t += lines[i] + ' '; return t; }

/** All candidates from the docs: AI.md rows, recipe sections, THREE.md and recipe 54 rows (plain three.js, or engine + three.js) */
export function docEntries(docsDir) {
  const out = [], ai = join(docsDir, 'AI.md');
  if (existsSync(ai)) {
    for (const line of readFileSync(ai, 'utf8').split('\n')) {
      if (!line.startsWith('|') || /^\|[\s|:-]+\|?$/.test(line) || /^\|\s*To do\s*\|/i.test(line)) continue;
      const c = line.split('|').slice(1, -1).map(x => x.trim());
      if (c.length < 2) continue;
      // the recipe column is a pointer, not task words: "content-actions-save.md" must not make the content row answer "save game"
      // the last column names recipes by file ("06-clock-events.md, 08-weather-sky.md"): give the first its folder
      const where = c.length > 2 ? c[c.length - 1].replace(/`/g, '').replace(/^(?:recipes\/)?(\d\d-)/, 'recipes/$1') : '';
      out.push({ src: 'AI.md', title: c[0], use: c.length > 2 ? c[1] : '', where, text: (c.length > 2 ? c.slice(0, -1) : c).join(' ') });
    }
  }
  // CONVENTIONS.md "One task, which entry": | Task | First | Go down a layer when | (the detail AI.md rows leave out)
  const conv = join(docsDir, 'CONVENTIONS.md');
  if (existsSync(conv)) {
    const L = readFileSync(conv, 'utf8').split('\n'), i0 = L.findIndex(l => /^#+ One task, which entry/.test(l));
    for (let i = i0 + 1; i0 >= 0 && i < L.length && !/^#/.test(L[i]); i++) {
      const line = L[i];
      if (!line.startsWith('|') || isRule(line) || isRule(L[i + 1] ?? '')) continue;
      const c = line.split(/(?<!\\)\|/).slice(1, -1).map(x => x.trim());
      if (c.length < 3) continue;
      out.push({ src: 'entry', title: c[0], use: `${c[1]}; else ${c[2]}`, where: 'CONVENTIONS.md#one-task-which-entry', text: c.join(' ') });
    }
  }
  const rdir = join(docsDir, 'recipes');
  if (existsSync(rdir)) for (const f of readdirSync(rdir).filter(x => x.endsWith('.md')).sort()) {
    const lines = readFileSync(join(rdir, f), 'utf8').split('\n');
    let h1 = '';
    lines.forEach((l, i) => {
      const m = /^(#{1,3})\s+(.*)/.exec(l);
      if (!m) return;
      if (m[1] === '#') h1 = m[2];
      let snip = ''; for (let j = i + 1; j < lines.length && !/^#/.test(lines[j]); j++) if (lines[j].trim() && !lines[j].startsWith('```') && !lines[j].startsWith('|')) { snip = lines[j]; break; }
      const sec = /^(\d+)\./.exec(m[2]);
      // snip is shown but only some of it ranks: an "In this recipe" list names every section, so the top of a recipe would outrank the section that
      // answers; a bullet speaks for one item of a list, so one word in an example ("one street lamp shot out") would decide for the whole section
      const ranks = !/^\*\*In this recipe\*\*|^\s*[-*] /.test(snip);
      out.push({ src: 'recipe', title: m[2], h1, where: `recipes/${f}${m[1] === '#' ? '' : sec ? ` §${sec[1]}` : ` "${m[2]}"`}`, snip, name: m[2].replace(/^\d+\.\s*/, ''), text: ranks ? m[2] + ' ' + snip : m[2], head: m[1] === '#' ? '' : h1,
        at: `recipes/${f}${m[1] === '#' ? '' : '#' + slug(m[2])}`, para: paragraph(lines, i + 1), body: sectionText(lines, i + 1) });
    });
  }
  plainRows(join(docsDir, 'THREE.md'), 'THREE.md', out);
  plainRows(join(docsDir, 'recipes', '54-three-idioms.md'), 'recipes/54-three-idioms.md', out);
  return out;
}

/** The best `max` hits for a query: [{ score, line }] (ties keep document order, so the output is stable) */
export function search(docsDir, q, max = 5) {
  const qt = queryTokens(q), hits = [], all = docEntries(docsDir), sections = all.filter(e => e.src === 'recipe');
  // a word weighs by its rarity (simple IDF): words found everywhere, like game or player in a long query, count for almost nothing; rare ones like fps or sidescroller decide the order.
  // why not a plain count: the old version weighed every word the same, so game / find in "game is slow, find why fps drops" ranked action games and new-game above the performance recipe
  const N = all.length;
  // rarity counts the typed word (and its stem) only, not its synonyms: a group joins slow, fps and perf, and counting the whole group would make a rare word like fps "common"
  const own = c => ({ alts: c.alts.filter(x => x.k > 0.8) });
  // a typed word the docs never use but whose synonym they do (rainy, rain) falls back to the group: alone it would count as the rarest word there is and be reported as unknown
  const entriesWith = c => all.reduce((n, e) => n + (conceptHit(e.text, c) > 0 ? 1 : 0), 0);
  qt.w = qt.concepts.map(c => Math.log(1 + N / (1 + (entriesWith(own(c)) || entriesWith(c)))));
  const total = qt.w.reduce((a, b) => a + b, 0) || 1;
  all.forEach((e, order) => {
    const s = score(e.text, qt) * (e.src === 'AI.md' || e.src === 'entry' ? 1.2 : 1) + (e.head ? score(e.head, qt) * 0.5 : 0);
    // cov: how much of the query's weight this entry covers by itself (its recipe's top title does not count, it only orders within s); compared in steps of 0.05, and only within one step (mostly: the same words matched)
    // does the old rule apply, "plain three.js first, then the recommended entry". Why the top title does not count: "bullet time on enemies" would beat the engine.mod line because the action recipe's title has enemy
    if (s > 0) hits.push({ s, cov: score(e.text, qt) / total, order, e });
  });
  const entry = e => e.src === 'AI.md' || e.src === 'entry' ? 1 : 0, band = h => Math.round(h.cov * 20);
  hits.sort((a, b) => band(b) - band(a) || (b.e.plain ? 1 : 0) - (a.e.plain ? 1 : 0) || entry(b.e) - entry(a.e) || b.s - a.s || a.order - b.order);
  // at most 3 plain three.js hits, so the engine route for the same task (coordination: time, weather, saves...) stays in the list
  const seen = new Set(), out = [], plainMax = Math.max(1, max - 2);
  let plain = 0;
  for (const { s, e } of hits) {
    const open = e.src === 'AI.md' ? openSection(sections, e.where, qt) : e.src === 'recipe' ? e : null;
    if (seen.has(e.where + e.title) || (e.plain && plain >= plainMax)) continue;
    seen.add(e.where + e.title); if (e.plain) plain++;
    out.push({ score: Math.round(s * 10) / 10, line: e.src === 'AI.md' ? `AI.md · ${e.title} → ${clip(e.use, 90)} → ${e.where || 'AI.md'}`
      : e.src === 'entry' ? `CONVENTIONS.md "One task, which entry" · ${e.title} → ${clip(e.use, 260)}`
      : e.plain ? `plain three.js · ${clip(e.title, 60)} → ${clip(e.use, 100)} → ${e.where}`
      : e.src === 'three' ? `engine + three.js · ${clip(e.title, 60)} → ${clip(e.use, 100)} → ${e.where}` : `${e.where} · ${clip(e.name, 60)} — ${clip(e.snip)}`,
      at: open?.at ?? e.where.replace(/ (§\d+\w*|".*")$/, ''), para: open?.para ?? '' });
    if (out.length >= max) break;
  }
  // say so when the match is weak: when the listed hits together cover less than a third of the query's weight (a long query has ten words, covering half is hard, and a half threshold calls right answers 'not found'), mark it weak; the CLI then says no good match before listing the closest, so an AI does not take a filler result as the answer
  // the verdict reads the whole list, not the first line: a query's words often sit in different rows, and judged on one row alone a small rewording of that row turned a right answer into "no match"
  const listed = hits.slice(0, max), cover = qt.concepts.reduce((s, c, i) => s + Math.max(0, ...listed.map(h => conceptHit(h.e.text, c))) * qt.w[i], 0) / total;
  out.weak = out.length > 0 && cover < Math.min(1 / 3, 2 / qt.concepts.length); // long queries: two words' weight is already a lead
  out.unknown = qt.concepts.filter((c, i) => qt.w[i] >= Math.log(1 + N) - 1e-9).map(c => c.word); // words that appear nowhere in the docs
  out.closestRow = hits.find(h => h.e.src === 'AI.md')?.e.title ?? '';
  return out;
}

/** The section of the recipe an AI.md row points at ("recipes/30-templates.md §5", a #anchor, or the file) that best matches the query */
function openSection(sections, where, qt) {
  const file = /recipes\/[\w.-]+\.md/.exec(where)?.[0];
  if (!file) return null;
  const mine = sections.filter(x => x.at.split('#')[0] === file);
  const anchor = /#([\w-]+)/.exec(where)?.[1], sec = / §(\d+\w*)/.exec(where)?.[1], quoted = / "(.+?)"/.exec(where)?.[1];
  const named = mine.find(x => (anchor && x.at.endsWith('#' + anchor)) || (sec && x.title.startsWith(sec + '.')) || (quoted && x.title.startsWith(quoted)));
  if (named) return named;
  // a heading that names more of the typed words wins (body words break ties); else the file's top (its H1 and its summary paragraph).
  // Body words alone never pick a section (a long worked example mentions everything), and one shared word of a longer task ("game" of
  // "save game") is not enough: the heading must name two of the typed words, or the one word typed
  let best = mine[0] ?? null, top = 0;
  const need = Math.min(2, qt.main.length);
  for (const x of mine.slice(1)) { const t = matched(x.title, qt); if (t < need) continue; const n = t * 100 + matched(x.body, qt); if (n > top) { top = n; best = x; } }
  return best;
}

/** One hit as printed: the line, then where to read (path#section) and that paragraph */
export function format(h, i) {
  return `${i + 1}. ${h.line}` + (h.at ? `\n   read: ${h.at}` : '') + (h.para ? `\n   ${h.para}` : '');
}

/** What to try when nothing fits: drop the words the docs never use, use 2-4 task words, or read the closest AI.md row */
export function tryNext(res) {
  const drop = res.unknown?.length ? `The docs never use: ${res.unknown.map(w => `"${w}"`).join(', ')}. ` : '';
  const row = res.closestRow ? `the closest is "${res.closestRow}"` : 'one row per task';
  return `${drop}Try 2-4 English task words (e.g. "perf", "save game", "rigid push", "2d lights"), or read the table in packages/engine/docs/AI.md ("One thing, one entry point"; ${row}).`;
}

/**
 * Library entries (name, summary) that answer the query, as printed lines with the pull command. Why a separate list and not part of search():
 * the library is the user's own folder, so the same docs give the same ranking on every machine; library hits are listed after the docs hits and
 * never above the one recommended entry. A hit must cover at least half of the typed words (all of them when there are two or fewer).
 * @param {{ name: string, kind?: string, summary?: string }[]} list entries (lib.entries(libraryDir()))
 */
export function libraryHits(list, q, max = 3) {
  const { concepts } = queryTokens(q);
  if (!concepts.length) return [];
  const need = Math.ceil(concepts.length / 2), out = [];
  for (const e of list) {
    const text = `${e.name.replace(/[-_]/g, ' ')} ${e.summary ?? ''}`, n = concepts.filter(c => conceptHit(text, c) > 0).length;
    if (n >= need) out.push({ n, e });
  }
  out.sort((a, b) => b.n - a.n || a.e.name.localeCompare(b.e.name));
  return out.slice(0, max).map(({ e }) => `library · ${e.name} (${e.kind ?? 'other'}) — ${clip(e.summary ?? '', 90)} → threedog lib pull ${e.name}`);
}

/** CLI body: threedog how "<task>" [-w game] */
export async function main(argv) {
  let dir, rest;
  try { ({ dir, rest } = command(argv, { positional: true })); } catch (e) { console.log('✗ ' + e.message); return 1; }
  const q = rest.join(' ').trim();
  if (!q) { console.log('Usage: threedog how "<effect or task>"   (e.g. how "rain", how "save game")'); return 1; }
  const res = search(join(ENGINE, 'docs'), q);
  // live catalog (modules / ops whose name matches a typed word) when a dev page is running; any failure just means "no page", docs answer alone
  let live = [];
  // only when a page is already attached: execute() would otherwise make the dev server open a headless Chromium just to answer a docs search
  const dev = devServerInfo(dir), attached = dev.state === 'live' && await fetch(`http://localhost:${dev.port}/__threedog/cmd`, { method: 'POST',
    headers: { 'x-threedog-token': dev.token }, body: '{"op":"ping"}', signal: AbortSignal.timeout(1500) }).then(r => r.json()).then(j => j.value?.live || j.value?.headless, () => false);
  if (attached) {
    try {
      const { execute } = await import('./threedog/dispatch.mjs'), word = queryTokens(q).main.find(w => /^[a-z]/.test(w));
      const r = word && await Promise.race([execute(dir, 'catalog', ['--find', word]), new Promise(res2 => setTimeout(res2, 4000, null))]);
      if (r?.ok && Array.isArray(r.data)) live = r.data.slice(0, 3).map(m => `live catalog · ${m.id} (${m.kind}${m.ops?.length ? ', ops: ' + m.ops.slice(0, 4).map(o => o.name ?? o).join(', ') : ''}) → threedog catalog ${m.id}`);
    } catch { /* no page */ }
  }
  // the user's library, read last: a missing or broken library is no reason to fail a docs search
  let lib = [];
  try { const L = await import('./lib.mjs'); lib = libraryHits(L.entries(L.libraryDir()), q); } catch { /* no library */ }
  if (!res.length && !live.length && !lib.length) { console.log(`No match for "${q}". ${tryNext(res)}`); return 0; }
  if (res.weak) console.log(`No good match for "${q}": the closest hits below cover less than a third of it. ${tryNext(res)}\n`);
  live.forEach((l, i) => console.log(`${i + 1}. ${l}`));
  res.forEach((h, i) => console.log(format(h, live.length + i)));
  lib.forEach((l, i) => console.log(`${live.length + res.length + i + 1}. ${l}`));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(await main(process.argv.slice(2)));
