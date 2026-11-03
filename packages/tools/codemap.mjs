// Generates the code map packages/engine/docs/CODEMAP.md: npm run map
// Engine-level reference, read when needed (reading order is in docs/AI.md): which modules exist and their per-frame order, what each engine
//   file or module folder does, who emits / listens to which events, key actions, i18n key groups and style keys. Scanned from the engine
//   package only (games and their style/ folders have their own GAMEMAP), so it never goes stale and never names a game.
// Size budget: --check fails above BUDGET; shorten summaries or move detail to api/ instead of raising it.
// npm run check verifies the map is up to date (and also generates core/events.generated.js from EventMap).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import * as P from './paths.mjs';
import { read, uniq, walk as walkAll, summary, oneSentence, splitTop } from './lib/text.mjs';
const { opt: OPT } = P.cli(process.argv.slice(2), { workspace: false, flags: ['check'] });

const { rel } = P, OUT = P.abs(P.CODEMAP_REL);
const BUDGET = 28 * 1024;   // raised from 22 KB (user, 2026-11-03): the WebGPU route adds files; trim by structure, not by cutting summaries
const isEngine = r => r === P.INDEX_JS_REL || P.ENGINE_CODE_DIRS_REL.some(d => P.under(r, d));
const walk = d => walkAll(d, { skip: ['tests', 'vite.config.js'] });
const files = [P.abs(P.INDEX_JS_REL), ...P.ENGINE_CODE_DIRS_REL.flatMap(d => walk(P.abs(d)))];   // engine package only: a look is a game's own style/ folder
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
  for (const m of code.matchAll(/name: '(\w+)',\s*(?:type: '\w+',\s*)?(?:provides: \[[^\]]*\],\s*)?label\b/g)) {   // type / provides may stand before label
    const def = code.slice(m.index, m.index + 600).split(/\binstall\s*\(/)[0];
    const list = k => (def.match(new RegExp(`\\b${k}: \\[([^\\]]*)\\]`))?.[1] || '').replace(/['\s]/g, '').split(',').filter(Boolean);
    const optObj = def.match(/\boptional: \{([^}]*)\}/)?.[1];
    mods.push({ name: m[1], file: r, requires: list('requires'), optional: optObj ? [...optObj.matchAll(/(\w+):/g)].map(x => x[1]) : list('optional'),
      stage: def.match(/\bstage: '(\w+)'/)?.[1] || 'late', before: list('before'), after: list('after'), type: def.match(/\btype: '(\w+)'/)?.[1] ?? '?' });
  }
  if (/rigModule\(/.test(text)) for (const m of text.matchAll(/export function (\w+Camera)/g)) mods.push({ name: 'cameraRig', file: r, alias: m[1] });

  for (const m of code.matchAll(/events\.emit\((?:[^'"`)]*\?\s*)?'([\w:]+)'(?:\s*:\s*'([\w:]+)')?/g)) { addEv(m[1], 'emit', r); if (m[2]) addEv(m[2], 'emit', r); }
  for (const m of code.matchAll(/(?:events|\bev)\.(?:on|once)\('([\w:]+)'/g)) addEv(m[1], 'on', r);
  // input actions modules declare (input.action / ctx.input.action): name, context, text key. Modules bind no keys (presets.bindings has them);
  //   when the name is a variable, use the destructuring default in the same file (such as { action = 'quests' }). Game content actions are in GAMEMAP
  if (P.under(r, P.MODULES_REL) && !P.under(r, `${P.MODULES_REL}/content`)) {
    const defaults = {};
    for (const m of code.matchAll(/[{,]\s*(\w+) = ('[\w.]+'|\[[^\]\n]*\])/g)) defaults[m[1]] ??= m[2];
    const lit = a => /^'[\w.]+'$/.test(a) ? a.slice(1, -1) : null;
    for (const m of code.matchAll(/input\.action\(/g)) {
      const [a, o = ''] = splitTop(code.slice(m.index + m[0].length));
      const action = lit(a) ?? (defaults[a] ? `${lit(defaults[a])} (parameter ${a})` : a.replace(/\s+/g, ''));
      const field = k => o.match(new RegExp(`\\b${k}: '([\\w.]+)'`))?.[1] ?? (new RegExp(`\\b${k}\\b`).test(o) ? '(variable)' : null);
      actions.push({ action, context: field('context') ?? 'walk', label: field('label') ?? '', file: r });
    }
  }
  // the one default preset (core/inputDefaults.js): the basics, context walk
  for (const m of text.matchAll(/^\s+(\w+): Object\.freeze\(\[([^\]]*)\]\),/gm)) if (r.endsWith('inputDefaults.js')) actions.push({ action: `${m[1]} (default ${m[2].replace(/'/g, '')})`, context: 'walk', label: `input.${m[1]}`, file: r });
  // i18n keys (only the zh-CN table is read; the key names are the same)
  const zh = [...text.matchAll(/'zh-CN':\s*\{([\s\S]*?)\n?\s*\},?\s*(?:en|\n)/g)].map(m => m[1]).join(' ');
  const keys = uniq([...zh.matchAll(/'([\w]+\.[\w.]+)':/g)].map(m => m[1]));
  if (keys.length) i18n[r] = keys;
  for (const m of text.matchAll(/\b(?:engine|e|this\.engine)\.style\.(\w+)|\bSTYLE\.(\w+)/g)) (styleKeys[m[1] || m[2]] ||= new Set()).add(r);
}

const md = [];
md.push('# Code map (generated)', '',
  '> Generated by `threedog map`. Read after `AI.md`; API details: `api/<module>.md`.', '');
// Stage order is read from the engine source (STAGES in core/modules.js), not copied here
const STAGES = Object.fromEntries([...read(P.abs(`${P.CORE_REL}/modules.js`)).match(/const STAGES = \{([^}]*)\}/)[1].matchAll(/(\w+): (\d+)/g)].map(m => [m[1], +m[2]]));
const rig = mods.find(m => m.name === 'cameraRig' && !m.alias);   // cameras share one rigModule definition: each camera row uses its fields
for (const m of mods) if (m.alias) Object.assign(m, { requires: rig.requires, optional: rig.optional, stage: rig.stage, before: rig.before, after: rig.after });
const modRows = mods.filter(m => m !== rig).sort((a, b) => STAGES[a.stage] - STAGES[b.stage]);
md.push('## Modules (installed with engine.use)', '',
  'Each module\'s requires, order, params, ops, saves: `threedog catalog <module>`.', '',
  'Type = what the module may own (core/moduleTypes.js): world, look, actor, rules, ui, net, tool.', '',
  '| Module (engine.xxx) | Type | File |', '|---|---|---|');
for (const m of modRows) md.push(`| ${m.alias ? `${m.name} (${m.alias}())` : m.name} | ${m.type} | ${sp(m.file)} |`);

// Files: one row per file for index.js, core/, render/, ui/ (opened by name); one row per folder for modules/* (summary from its index.js)
md.push('', '## Files', '');
const groups = new Map();
for (const f of fileRows) {
  const s = sp(f.r), parts = s.split('/');
  const key = parts[0] === 'modules' && parts.length > 2 ? parts.slice(0, 2).join('/') + '/' : parts.length > 1 ? parts[0] + '/' : './';
  (groups.get(key) ?? groups.set(key, []).get(key)).push({ ...f, s, name: s.slice(key === './' ? 0 : key.length) });
}
let lastTop = null;
for (const [dir, rows] of groups) {
  const top = dir.split('/')[0];
  if (top === 'modules') {
    if (lastTop !== top) md.push('', `**${top}/** (one line per folder: what it does; its files besides the index.js / contract.js every module has)`);
    const head = rows.find(r => r.name === 'index.js') ?? rows.slice().sort((a, b) => b.size - a.size)[0];
    md.push(`- ${dir.slice(top.length + 1)} ${oneSentence(head.sum, 64)} — ${rows.filter(r => r.name !== 'index.js' && r.name !== 'contract.js').map(r => r.name).join(', ')}`);
  } else {
    md.push('', `**${dir}**`);
    // a subfolder (core/look/, render/fx/) gets one line like a module folder: its index.js (or largest file) says what it is, then its files.
    // why: the map has a size budget (BUDGET); listing every file of a subfolder crowds out the rest, and the folder's file names are enough to find the one to read
    const sub = new Map();
    for (const r of rows) {
      const i = r.name.indexOf('/');
      if (i < 0) { md.push(`- ${r.name}${oneSentence(r.sum, 60) ? ': ' + oneSentence(r.sum, 60) : ''}`); continue; }
      const k = r.name.slice(0, i + 1);
      if (!sub.has(k)) { sub.set(k, []); md.push(k); }   // placeholder line, filled below so the folder keeps its sorted place
      sub.get(k).push({ ...r, name: r.name.slice(i + 1) });
    }
    for (const [k, list] of sub) {
      const head = list.find(r => r.name === 'index.js') ?? list.slice().sort((a, b) => b.size - a.size)[0];
      md[md.indexOf(k)] = `- ${k} ${oneSentence(head.sum, 60)} — ${list.filter(r => r.name !== 'index.js').map(r => r.name).join(', ')}`;
    }
  }
  lastTop = top;
}
md.push('', '## Events (internal emitters and listeners; arguments are in api/events.md)',
  '', '| Event | Emitted by | Listened by |', '|---|---|---|');
for (const [n, v] of Object.entries(events).sort()) md.push(`| ${n} | ${uniq(v.emit.map(who)).join(', ') || '(the game)'} | ${uniq(v.on.map(who)).join(', ') || '—'} |`);
md.push('', '## Input actions (engine.input)', '', 'Modules declare actions without keys; the game binds them (createEngine({ bindings }), engine.input.bind, presets.bindings.*). Only the basics have default keys.', '',
  '| Action | Context | Text key | Declared at |', '|---|---|---|---|');
for (const a of actions) md.push(`| ${a.action} | ${a.context} | ${a.label} | ${who(a.file)} |`);
md.push('', '## i18n key groups (engine.t; full keys are in each string table)', '');
for (const [f, keys] of Object.entries(i18n)) {
  const by = keys.reduce((a, k) => { const p = k.split('.')[0]; a[p] = (a[p] || 0) + 1; return a; }, {});
  md.push(`- ${sp(f)}: ${Object.entries(by).map(([p, n]) => `${p}.* (${n})`).join(', ')}`);
}
md.push('', '## Style keys (who reads engine.style.xxx)', '', '| Key | Read in |', '|---|---|');
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
if (OPT.check) {
  const cur = existsSync(OUT) ? read(OUT) : '';   // read normalizes line endings (lib/text.mjs)
  if (cur !== content) { console.log(`✗ ${P.CODEMAP_REL} is not up to date, run npm run map`); process.exit(1); }
  if ((existsSync(EV_OUT) ? read(EV_OUT) : '') !== evContent) { console.log(`✗ ${P.EVENTS_GEN_REL} does not match EventMap, run npm run map`); process.exit(1); }
  if (size > BUDGET) { console.log(`✗ CODEMAP is ${kb(size)} > ${kb(BUDGET)} budget: shorten file summaries (first comment line) or move detail to api/`); process.exit(1); }
  console.log(`✓ code map (${kb(size)}) and event name list are up to date`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, content);
  writeFileSync(EV_OUT, evContent);
  console.log(`Generated ${P.CODEMAP_REL} (${kb(size)}, ${mods.length} modules, ${Object.keys(events).length} events, ${actions.length} input actions)`);
}
