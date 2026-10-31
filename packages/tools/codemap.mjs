// Generates the code map packages/engine/docs/CODEMAP.md: npm run map
// Engine-level reference, read when needed (reading order is in docs/AI.md): which modules exist and their per-frame order, what each engine
//   file or module folder does, who emits / listens to which events, key actions, i18n key groups and style pack keys. Scanned from the engine
//   and its style packs only (games have their own GAMEMAP), so it never goes stale and never names a game.
// Size budget: --check fails above BUDGET; shorten summaries or move detail to api/ instead of raising it.
// npm run check verifies the map is up to date (and also generates core/events.generated.js from EventMap).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import * as P from './paths.mjs';
import { read, uniq, walk as walkAll, summary, oneSentence, splitTop } from './lib/text.mjs';

const { rel } = P, OUT = P.abs(P.CODEMAP_REL);
const BUDGET = 22 * 1024;
const isEngine = r => r === P.INDEX_JS_REL || P.ENGINE_CODE_DIRS_REL.some(d => P.under(r, d));
const walk = d => walkAll(d, { skip: ['tests', 'vite.config.js'] });
const files = [P.abs(P.INDEX_JS_REL), ...P.ENGINE_CODE_DIRS_REL.flatMap(d => walk(P.abs(d))), ...walk(P.abs(P.STYLES_REL))];
const sp = p => p.slice(P.ENGINE_REL.length + 1);   // package-relative path (core/Input.js)
/** Who: a module folder name (dialogue), else the package-relative path (core/Events.js) */
const who = r => { const s = sp(r); return s.startsWith('modules/') ? s.split('/')[1] : s; };

const mods = [], fileRows = [], events = {}, actions = [], i18n = {}, styleKeys = {};
const addEv = (name, kind, f) => { (events[name] ||= { emit: [], on: [] })[kind].push(f); };

for (const f of files) {
  const text = read(f), r = rel(f);
  fileRows.push({ r, sum: summary(text), size: text.length });
  const code = text.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');   // drop comment lines (examples in comments do not count)
  if (!isEngine(r)) { for (const m of text.matchAll(/\b(?:engine|e|this\.engine)\.style\.(\w+)|\bSTYLE\.(\w+)/g)) (styleKeys[m[1] || m[2]] ||= new Set()).add(r); continue; }

  // Module definition: take a stretch from name: 'x', label, and look for each field separately (field order is not fixed)
  for (const m of code.matchAll(/name: '(\w+)',\s*label\b/g)) {
    const def = code.slice(m.index, m.index + 600).split(/\binstall\s*\(/)[0];
    const list = k => (def.match(new RegExp(`\\b${k}: \\[([^\\]]*)\\]`))?.[1] || '').replace(/['\s]/g, '').split(',').filter(Boolean);
    const optObj = def.match(/\boptional: \{([^}]*)\}/)?.[1];
    mods.push({ name: m[1], file: r, requires: list('requires'), optional: optObj ? [...optObj.matchAll(/(\w+):/g)].map(x => x[1]) : list('optional'),
      stage: def.match(/\bstage: '(\w+)'/)?.[1] || 'late', before: list('before'), after: list('after') });
  }
  if (/rigModule\(/.test(text)) for (const m of text.matchAll(/export function (\w+Camera)/g)) mods.push({ name: 'cameraRig', file: r, alias: m[1] });

  for (const m of code.matchAll(/events\.emit\((?:[^'"`)]*\?\s*)?'([\w:]+)'(?:\s*:\s*'([\w:]+)')?/g)) { addEv(m[1], 'emit', r); if (m[2]) addEv(m[2], 'emit', r); }
  for (const m of code.matchAll(/(?:events|\bev)\.(?:on|once)\('([\w:]+)'/g)) addEv(m[1], 'on', r);
  // key actions: when the argument is a variable, use the destructuring default in the same file (such as { action = 'quests', keys = ['KeyJ'] });
  //   keys from game content (the content loader) are in GAMEMAP
  if (!P.under(r, `${P.MODULES_REL}/content`)) {
    const defaults = {};
    for (const m of code.matchAll(/[{,]\s*(\w+) = ('[\w.]+'|\[[^\]\n]*\])/g)) defaults[m[1]] ??= m[2];
    const lit = a => /^'[\w.]+'$/.test(a) ? a.slice(1, -1) : null;
    for (const m of code.matchAll(/input\.define\(/g)) {
      const [a, k, l] = splitTop(code.slice(m.index + m[0].length));
      const action = lit(a) ?? (defaults[a] ? `${lit(defaults[a])} (parameter ${a})` : a.replace(/\s+/g, ''));
      const keys = defaults[k] ? `${defaults[k]} (parameter ${k})` : k.replace(/\s+/g, '');
      actions.push({ action, keys, label: lit(l) ?? l, file: r });
    }
  }
  for (const m of text.matchAll(/^\s+(\w+): \[\[([^\]]*)\], '([\w.]+)'\]/gm)) actions.push({ action: m[1], keys: `[${m[2]}]`, label: m[3], file: r });
  // i18n keys (only the zh-CN table is read; the key names are the same)
  const zh = [...text.matchAll(/'zh-CN':\s*\{([\s\S]*?)\n?\s*\},?\s*(?:en|\n)/g)].map(m => m[1]).join(' ');
  const keys = uniq([...zh.matchAll(/'([\w]+\.[\w.]+)':/g)].map(m => m[1]));
  if (keys.length) i18n[r] = keys;
  for (const m of text.matchAll(/\b(?:engine|e|this\.engine)\.style\.(\w+)|\bSTYLE\.(\w+)/g)) (styleKeys[m[1] || m[2]] ||= new Set()).add(r);
}

const md = [];
md.push('# Code map (generated, do not edit by hand)', '',
  '> `npm run map` scans the engine source. Read when needed, after `AI.md` and the game\'s `GAMEMAP.md`; API details are in `API.md` and `api/<module>.md`. Paths are relative to the package.', '');
// Stage order is read from the engine source (STAGES in core/modules.js), not copied here
const STAGES = Object.fromEntries([...read(P.abs(`${P.CORE_REL}/modules.js`)).match(/const STAGES = \{([^}]*)\}/)[1].matchAll(/(\w+): (\d+)/g)].map(m => [m[1], +m[2]]));
const rig = mods.find(m => m.name === 'cameraRig' && !m.alias);   // cameras share one rigModule definition: each camera row uses its fields
for (const m of mods) if (m.alias) Object.assign(m, { requires: rig.requires, optional: rig.optional, stage: rig.stage, before: rig.before, after: rig.after });
const modRows = mods.filter(m => m !== rig).sort((a, b) => STAGES[a.stage] - STAGES[b.stage]);
const join_ = a => a.length ? a.join(', ') : '—';
md.push('## Modules (installed with engine.use)', '',
  `Per-frame hook order: by stage (${Object.keys(STAGES).join(' → ')}; none = late), then before / after, then install order.`, '',
  '| Module (engine.xxx) | File | Requires | Optional | Stage | Within stage |', '|---|---|---|---|---|---|');
for (const m of modRows) md.push(`| ${m.alias ? `${m.name} (${m.alias}())` : m.name} | ${sp(m.file)} | ${join_(m.requires)} | ${join_(m.optional)} | ${m.stage} | ${[m.before.length ? 'before ' + m.before.join(', ') : '', m.after.length ? 'after ' + m.after.join(', ') : ''].filter(Boolean).join('; ') || '—'} |`);

// Files: one row per file for index.js, core/, render/, ui/ (opened by name); one row per folder for modules/* and styles/* (summary from its index.js)
md.push('', '## Files', '');
const groups = new Map();
for (const f of fileRows) {
  const s = sp(f.r), parts = s.split('/');
  const key = (parts[0] === 'modules' || parts[0] === 'styles') && parts.length > 2 ? parts.slice(0, 2).join('/') + '/' : parts.length > 1 ? parts[0] + '/' : './';
  (groups.get(key) ?? groups.set(key, []).get(key)).push({ ...f, s, name: s.slice(key === './' ? 0 : key.length) });
}
let lastTop = null;
for (const [dir, rows] of groups) {
  const top = dir.split('/')[0];
  if (top === 'modules' || top === 'styles') {
    if (lastTop !== top) md.push('', `**${top}/** (one line per folder: what it does; its files)`);
    const head = rows.find(r => r.name === 'index.js') ?? rows.slice().sort((a, b) => b.size - a.size)[0];
    md.push(`- ${dir.slice(top.length + 1)} ${oneSentence(head.sum, 80)} — ${rows.map(r => r.name).join(', ')}`);
  } else {
    md.push('', `**${dir}**`);
    for (const r of rows) md.push(`- ${r.name}${oneSentence(r.sum, 60) ? ': ' + oneSentence(r.sum, 60) : ''}`);
  }
  lastTop = top;
}
md.push('', '## Events (internal emitters and listeners; arguments are in api/events.md)',
  '', '| Event | Emitted by | Listened by |', '|---|---|---|');
for (const [n, v] of Object.entries(events).sort()) md.push(`| ${n} | ${uniq(v.emit.map(who)).join(', ') || '(the game)'} | ${uniq(v.on.map(who)).join(', ') || '—'} |`);
md.push('', '## Key actions (engine.input)', '', '| Action | Default keys | Text key | Registered at |', '|---|---|---|---|');
for (const a of actions) md.push(`| ${a.action} | ${a.keys.replace(/\|/g, '/')} | ${a.label} | ${who(a.file)} |`);
md.push('', '## i18n key groups (engine.t; full keys are in each string table)', '');
for (const [f, keys] of Object.entries(i18n)) {
  const by = keys.reduce((a, k) => { const p = k.split('.')[0]; a[p] = (a[p] || 0) + 1; return a; }, {});
  md.push(`- ${sp(f)}: ${Object.entries(by).map(([p, n]) => `${p}.* (${n})`).join(', ')}`);
}
md.push('', '## Style pack keys (who reads engine.style.xxx)', '', '| Key | Read in |', '|---|---|');
for (const [k, s] of Object.entries(styleKeys).sort()) md.push(`| ${k} | ${uniq([...s].map(who)).join(', ')} |`);
md.push('');
const content = md.join('\n');

// Event name list core/events.generated.js: generated from interface EventMap in types/core.d.ts (the single source of event names),
// used by Events.js for dev-time spell checking. After changing EventMap, regenerate with npm run map; npm run check verifies it is up to date.
const EV_OUT = P.abs(P.EVENTS_GEN_REL);
const dts = read(P.abs(P.CORE_DTS_REL));
const evStart = dts.search(/export interface EventMap\b/), evBlock = dts.slice(evStart, dts.indexOf('\n}', evStart));   // the header may say 'extends GameEvents'
const evNames = [...evBlock.matchAll(/^  '([\w:]+)':/gm)].map(m => m[1]);
const evContent = [`// Generated, do not edit by hand: npm run map generates it from EventMap in ${P.CORE_DTS_REL} (the single source of event names).`,
  '// Event names emitted by the engine and modules, used by Events.js for dev-time spell checking.', 'export const ENGINE_EVENTS = [',
  ...evNames.map(n => `  '${n}',`), '];', ''].join('\n');

const kb = n => (n / 1024).toFixed(1) + ' KB', size = Buffer.byteLength(content);
if (process.argv.includes('--check')) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (cur !== content) { console.log(`✗ ${P.CODEMAP_REL} is not up to date, run npm run map`); process.exit(1); }
  if ((existsSync(EV_OUT) ? readFileSync(EV_OUT, 'utf8') : '') !== evContent) { console.log(`✗ ${P.EVENTS_GEN_REL} does not match EventMap, run npm run map`); process.exit(1); }
  if (size > BUDGET) { console.log(`✗ CODEMAP is ${kb(size)} > ${kb(BUDGET)} budget: shorten file summaries (first comment line) or move detail to api/`); process.exit(1); }
  console.log(`✓ code map (${kb(size)}) and event name list are up to date`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, content);
  writeFileSync(EV_OUT, evContent);
  console.log(`Generated ${P.CODEMAP_REL} (${kb(size)}, ${mods.length} modules, ${Object.keys(events).length} events, ${actions.length} key actions)`);
}
