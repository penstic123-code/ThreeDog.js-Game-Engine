// engine.describeText(): write describe() as plain English for an AI to read, summary first to save context.
//   describeText()                       summary (at most 30 lines): standard lines, the 5 nearest things, one line per module with its key counts and state
//   describeText({ path: 'world.byKind' }) one part of describe() as JSON (a dotted path)
//   describeText({ full: true })          every nearby thing and every module's full data
// describe() itself (the object) is always complete.
// Always English, whatever the locale: it is developer output, not player-facing. Ground and weather names come from the
// describe result (groundName / weather.label, via the string tables) so no style pack's names are hardcoded here.
const STRINGS = {
  head: '[Game state] running {s} s{flags}',
  actions: 'Can do (engine.ops): {list}',
  error: '[Error, gameplay frozen] {where}: {message}',
  errorHint: ' | Code: {code} | Fix: {fix} Read: {docs}', disabled: 'Disabled presentation modules (they threw): {list}',
  paused: ', paused', headless: ', headless', notReady: ', still loading',
  waiting: 'Loading: {waiting} ({pending} pending, {done}/{total} done)', loadFailed: 'Load failed{blocked}: {list}', blocked: ' (start blocked)',
  loadWarn: 'Loaded with missing references: {list}',
  time: 'Time: {clock}, day {day}, {season}, {dayNight}',
  day: 'daytime', night: 'night',
  weather: 'Weather: {name}{changing} (rain {rain}, snow {snow}, fog {fog}){shown}',
  weatherShown: ', on screen: {what}', rainShown: 'raindrops', snowShown: 'snowflakes',
  changing: ', transitioning ({pct}%)',
  player: 'Player: ({x}, {y}, {z}), ground {ground}, {water}, state {state}',
  inWater: 'in water', dry: 'not in water', noPlayer: 'Player: none',
  camera: 'Camera: {type}, position ({x}, {y}, {z}), focus ({fx}, {fz}){over}',
  override: ', taken over by "{owner}"',
  cutscene: 'Cutscene: {n} playing{skip}',
  skippable: ' (skippable)',
  dialogue: 'Dialogue: {speaker}: "{text}"{choices}',
  choices: ' Choices: {list}',
  windows: 'Open windows: {list}', inputLocked: ' (game input locked)',
  nearHead: 'Within {r} m ({n}, by distance):',
  nearNone: 'Within {r} m: nothing',
  nearItem: '  - {name} [{kind}] {dist} m, {dir}, {rel}{use}',
  use: ', interact: {label}',
  modules: 'Modules: {list}',
  perf: 'Perf: fps {fps}, CPU {cpu} ms/frame, draw calls {calls}, triangles {tris}{chunks}',
  chunks: ', chunks loaded {loaded} / visible {visible} / queued {queued}',
  extra: '{name}: {json}',
  more: '... ({n} more lines omitted)',
  nearMore: '  ... {n} more',
  expand: 'More: describeText({ path: \'<module>\' }) for one part, describeText({ full: true }) for everything (CLI: threedog describe <path> / --full)',
  noPath: 'describe() has no "{path}"; top-level keys: {keys}',
  none: 'none',
  state: { idle: 'standing', walk: 'walking', run: 'running', jump: 'jumping', fall: 'falling', swim: 'swimming' },
  kind: { npc: 'NPC', pickup: 'pickup', interactable: 'interactable', trigger: 'trigger', entity: 'entity' },
  dir: { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' },
  rel: { front: 'ahead', 'front-right': 'ahead right', right: 'right', 'back-right': 'behind right', back: 'behind', 'back-left': 'behind left', left: 'left', 'front-left': 'ahead left' },
  season: { spring: 'spring', summer: 'summer', autumn: 'autumn', winter: 'winter' },
  camType: { follow: 'follow camera', first: 'first person', fixed: 'fixed camera', rts: 'top-down strategy camera' },
};
import { fmt } from './validate.js';
import { r1 } from './math.js';

const NEAR_SUMMARY = 5, LINE = 110;
const tr = (table, k) => (k != null && STRINGS[table][k]) || (k ?? STRINGS.none);
const n1 = v => (typeof v === 'number' ? r1(v) : v);
// Standard fields get sentences above; data from other modules is squeezed into one JSON line
const SHOWN = new Set(['nearbyRadius', 'ready', 'error', 'disabledModules', 'loading', 'time', 'player', 'camera', 'nearby', 'actions', 'ui', 'cutscene',
  'modules', 'perf', 'weather']);
const argText = a => Object.entries(a || {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`).join(' ');

/** One module's data in a line: scalars as k=v, arrays as k[n], objects as k{n keys} (nested data is one describeText({ path }) away) */
function summary(v) {
  if (v == null || typeof v !== 'object') return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  const one = x => (typeof x === 'string' && x.length > 24 ? x.slice(0, 23) + '…' : x);
  const parts = Object.entries(v).map(([k, x]) => x == null || typeof x !== 'object' ? `${k}=${one(x)}`
    : Array.isArray(x) ? `${k}[${x.length}]` : `${k}{${Object.keys(x).length}}`);
  const s = parts.join(', ');
  return s.length > LINE ? s.slice(0, LINE - 1) + '…' : s;
}

/** describe() at a dotted path as JSON text, or why there is nothing there */
function atPath(d, path) {
  let v = d;
  for (const k of path.split('.')) v = v?.[k];
  return v === undefined ? fmt(STRINGS.noPath, { path, keys: Object.keys(d).join(', ') }) : `${path}: ${JSON.stringify(v, null, 1)}`;
}

/**
 * Write the describe() result as English text: a summary (at most maxLines lines), one part (path), or everything (full).
 * @param {any} d  a describe() result
 * @param {{ full?: boolean, path?: string, maxLines?: number }} [opts]
 */
export function describeText(d, { full = false, path, maxLines = 30 } = {}) {
  if (path) return atPath(d, path);
  const L = [], t = d.time;
  const flags = (t.paused ? STRINGS.paused : '') + (t.headless ? STRINGS.headless : '') + (d.loading.done ? '' : STRINGS.notReady);
  if (d.error) L.push(fmt(STRINGS.error, d.error) + (d.error.fix ? fmt(STRINGS.errorHint, { code: d.error.code, fix: d.error.fix, docs: d.error.docs.join(', ') }) : ''));
  L.push(fmt(STRINGS.head, { s: t.elapsed, flags }));
  const ld = d.loading;
  if (!ld.done) L.push(fmt(STRINGS.waiting, { waiting: ld.waiting, pending: ld.counts.pending, done: ld.counts.done, total: ld.counts.total }));
  if (ld.failed.length) L.push(fmt(STRINGS.loadFailed, { blocked: ld.blocked ? STRINGS.blocked : '', list: ld.failed.map(f => `${f.kind} "${f.name}" ${f.error.url ?? ''} ${f.error.message}${f.fallback ? ` -> ${f.fallback}` : ''}`).join('; ') }));
  if (ld.warnings.length) L.push(fmt(STRINGS.loadWarn, { list: ld.warnings.map(w => `"${w.name}" missing ${w.missing.join(', ')}`).join('; ') }));
  if (d.disabledModules?.length) L.push(fmt(STRINGS.disabled, { list: d.disabledModules.join(', ') }));
  if (t.clock) L.push(fmt(STRINGS.time, { clock: t.clock, day: t.day, season: tr('season', t.season), dayNight: t.isDay ? STRINGS.day : STRINGS.night }));
  const w = d.weather;
  if (w) L.push(fmt(STRINGS.weather, { name: w.label ?? w.name, rain: n1(w.rain), snow: n1(w.snow), fog: n1(w.fog),
    changing: w.progress < 1 ? fmt(STRINGS.changing, { pct: Math.round(w.progress * 100) }) : '',
    shown: w.rainVisible || w.snowVisible ? fmt(STRINGS.weatherShown, { what: [w.rainVisible && STRINGS.rainShown, w.snowVisible && STRINGS.snowShown].filter(Boolean).join(', ') }) : '' }));
  const p = d.player;
  const water = p?.inWater ? STRINGS.inWater : STRINGS.dry;
  L.push(p ? fmt(STRINGS.player, { ...p, ground: p.groundName ?? p.ground, water, state: tr('state', p.state) }) : STRINGS.noPlayer);
  const c = d.camera;
  L.push(fmt(STRINGS.camera, { type: tr('camType', c.type), x: c.x, y: c.y, z: c.z, fx: c.focus.x, fz: c.focus.z, over: c.override ? fmt(STRINGS.override, { owner: c.override }) : '' }));
  if (d.cutscene) L.push(fmt(STRINGS.cutscene, { n: d.cutscene.count, skip: d.cutscene.skippable ? STRINGS.skippable : '' }));
  const dl = d.ui.dialogue;
  if (dl) L.push(fmt(STRINGS.dialogue, { speaker: dl.speaker, text: dl.text, choices: dl.choices.length ? fmt(STRINGS.choices, { list: dl.choices.map((x, i) => `${i + 1}. ${x}`).join(' ') }) : '' }));
  if (d.ui.windows.length || d.ui.inputLocked) L.push(fmt(STRINGS.windows, { list: d.ui.windows.join(', ') || STRINGS.none }) + (d.ui.inputLocked ? STRINGS.inputLocked : ''));
  const r = d.nearbyRadius;
  L.push(d.nearby.length ? fmt(STRINGS.nearHead, { r, n: d.nearby.length }) : fmt(STRINGS.nearNone, { r }));
  const near = full ? d.nearby : d.nearby.slice(0, NEAR_SUMMARY);
  for (const it of near) L.push(fmt(STRINGS.nearItem, { name: it.name, kind: tr('kind', it.kind), dist: it.dist, dir: tr('dir', it.dir), rel: tr('rel', it.rel), use: it.use ? fmt(STRINGS.use, { label: it.use }) : '' }));
  if (near.length < d.nearby.length) L.push(fmt(STRINGS.nearMore, { n: d.nearby.length - near.length }));
  if (d.actions) L.push(fmt(STRINGS.actions, { list: d.actions.map(a => `${a.ok ? '✓' : '✗'} ${a.op}${a.args && Object.keys(a.args).length ? ' ' + argText(a.args) : ''}${a.ok ? '' : ` (${a.reason})`}`).join(' · ') }));
  const pf = d.perf;
  L.push(fmt(STRINGS.perf, { fps: pf.fps ?? '-', cpu: pf.cpuMs ?? '-', calls: pf.drawCalls, tris: pf.triangles, chunks: pf.chunks ? fmt(STRINGS.chunks, pf.chunks) : '' }));
  L.push(fmt(STRINGS.modules, { list: d.modules.join(', ') }));
  for (const k in d) if (!SHOWN.has(k)) L.push(fmt(STRINGS.extra, { name: k, json: full ? JSON.stringify(d[k]) : summary(d[k]) }));
  if (full) return L.join('\n');
  if (L.length > maxLines - 1) { const cut = L.length - maxLines + 2; L.splice(maxLines - 2, cut, fmt(STRINGS.more, { n: cut })); }
  L.push(STRINGS.expand);
  return L.join('\n');
}
