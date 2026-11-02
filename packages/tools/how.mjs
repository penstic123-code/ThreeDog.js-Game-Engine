// threedog how "<effect or task>": which API / recipe answers a task, from the docs alone (works offline) plus the live catalog when a dev page runs.
// Why plain token scoring and no fuzzy library: the result must be the same every run and explainable ("matched rain in the AI.md row"); an AI reads
// the top few hits. Sources: the AI.md entry table (one row per task: the best hit), the CONVENTIONS.md "One task, which entry" table (the owner of
// "which of several entries"), recipe headings with their first sentence, and the plain three.js answers: THREE.md (tables and numbered conventions)
// and the recipe 54 idiom table. Ranking: hits that match more of the typed words come first; among equal matches a plain three.js hit comes first
// (if three.js can do it, that is the answer), then an entry row (the one recommended entry for its task; a recipe section or technique example
// under it is the second read), then by score.
// Why each hit carries `at` (path#section) and `para`: progressive disclosure. The AI reads one paragraph of the matching section, not a whole
// recipe (they run to 28 KB); an AI.md row is resolved to the best-matching section of the recipe it points at.
// English only: the docs are English, and an AI asked in another language translates the task into English words first.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE, pickWorkspace } from './paths.mjs';
import { devServerInfo } from './devinfo.mjs';

/** Lower-case word / number tokens of a text */
export function tokens(s) {
  const out = [];
  for (const m of s.toLowerCase().matchAll(/[a-z0-9_.]{2,}/g)) out.push(m[0]);
  return out;
}
const STOP = new Set(['the', 'a', 'to', 'of', 'in', 'on', 'for', 'and', 'how', 'do', 'is', 'an', 'make', 'with', 'my']);

/** { main: the distinct tokens typed, stop words dropped } */
export function queryTokens(q) {
  return { main: [...new Set(tokens(q).filter(t => !STOP.has(t)))] };
}

/** Words match at a word start (so "rain" does not hit "terrain", "open" still hits "openWorld") */
const has = (t, w) => /^[a-z0-9_.]/.test(w) ? new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t) : t.includes(w);
/** Words of the query found in the text (each counts once) */
const matched = (text, { main }) => { const t = text.toLowerCase(); return main.filter(w => has(t, w)).length; };
const score = (text, qt) => matched(text, qt) * 3;
const clip = (s, n = 110) => { s = s.replace(/`/g, '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

const isRule = l => /^\|[\s|:-]+\|?$/.test(l);
/** Table rows and numbered conventions of a doc as plain three.js entries (header rows and rules skipped) */
function plainRows(file, where, out) {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!line.startsWith('|') || isRule(line) || isRule(lines[i + 1] ?? '')) return;   // a row followed by |---| is the header
    const c = line.split('|').slice(1, -1).map(x => x.trim());
    if (c.length < 2) return;
    out.push({ src: 'plain', plain: true, title: c[0], use: c.slice(1).filter(x => x && x !== '-').join(' · '), where, text: c.join(' ') });
  });
  // numbered conventions ("3. **Per-frame logic** ..."): one entry each
  for (const line of lines) {
    const m = /^(\d+)\.\s+\*\*(.+?)\*\*:?\s*(.*)/.exec(line);
    if (m) out.push({ src: 'plain', plain: true, title: m[2].replace(/[:.]$/, ''), use: m[3].replace(/^[\s,:;.]+/, ''), where: `${where} §${m[1]}`, text: m[2] + ' ' + m[3] });
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

/** All candidates from the docs: AI.md rows, recipe sections, plain three.js rows (THREE.md, recipe 54) */
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
      out.push({ src: 'recipe', title: m[2], h1, where: `recipes/${f}${m[1] === '#' ? '' : sec ? ` §${sec[1]}` : ` "${m[2]}"`}`, snip, name: m[2].replace(/^\d+\.\s*/, ''), text: m[2] + ' ' + snip, head: m[1] === '#' ? '' : h1,
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
  all.forEach((e, order) => {
    const s = score(e.text, qt) * (e.src === 'AI.md' || e.src === 'entry' ? 1.2 : 1) + (e.head ? score(e.head, qt) * 0.5 : 0);
    if (s > 0) hits.push({ s, n: matched(e.text + ' ' + (e.head ?? ''), qt), order, e });
  });
  const entry = e => e.src === 'AI.md' || e.src === 'entry' ? 1 : 0;
  hits.sort((a, b) => b.n - a.n || (b.e.plain ? 1 : 0) - (a.e.plain ? 1 : 0) || entry(b.e) - entry(a.e) || b.s - a.s || a.order - b.order);
  // at most 3 plain three.js hits, so the engine route for the same task (coordination: time, weather, saves...) stays in the list
  const seen = new Set(), out = [], plainMax = Math.max(1, max - 2);
  let plain = 0;
  for (const { s, e } of hits) {
    const open = e.src === 'AI.md' ? openSection(sections, e.where, qt) : e.src === 'recipe' ? e : null;
    if (seen.has(e.where + e.title) || (e.plain && plain >= plainMax)) continue;
    seen.add(e.where + e.title); if (e.plain) plain++;
    out.push({ score: Math.round(s * 10) / 10, line: e.src === 'AI.md' ? `AI.md · ${e.title} → ${clip(e.use, 90)} → ${e.where || 'AI.md'}`
      : e.src === 'entry' ? `CONVENTIONS.md "One task, which entry" · ${e.title} → ${clip(e.use, 260)}`
      : e.plain ? `plain three.js · ${clip(e.title, 60)} → ${clip(e.use, 100)} → ${e.where}` : `${e.where} · ${clip(e.name, 60)} — ${clip(e.snip)}`,
      at: open?.at ?? e.where.replace(/ (§\d+\w*|".*")$/, ''), para: open?.para ?? '' });
    if (out.length >= max) break;
  }
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

/** CLI body: threedog how "<task>" [-w game] */
export async function main(argv) {
  let dir, args;
  try { ({ dir, args } = pickWorkspace(argv)); } catch (e) { console.log('✗ ' + e.message); return 1; }
  const q = args.join(' ').trim();
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
  if (!res.length && !live.length) { console.log(`No match for "${q}". Describe the task in English words the docs use (e.g. "brush strokes", "colored shadows"), or read packages/engine/docs/AI.md (the task index).`); return 0; }
  live.forEach((l, i) => console.log(`${i + 1}. ${l}`));
  res.forEach((h, i) => console.log(format(h, live.length + i)));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(await main(process.argv.slice(2)));
