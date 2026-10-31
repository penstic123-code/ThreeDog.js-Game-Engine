// Command execution layer: shared by the dev bridge command line (threedog describe|step|press…) and future scenario tests.
// It depends on a single driver: { evaluate(src, arg), screenshot(), reload?() }
//   evaluate(src, arg)  run function source src (a string) in the page with arg, returning its JSON result (it may be async)
//   screenshot()        returns a PNG Buffer
//   reload()            optional: reload the page and wait for the engine to be ready (without it, location.reload inside evaluate)
// The dev bridge's driver forwards these three to the dev server; a scenario test implements the same three with Playwright's page.
//
// run(driver, command, args array, { dir }) → { ok, text }. text is English, at most 3 lines, read directly by the AI.
// Functions executed in the page must be self-contained (sent via toString()); the 3rd argument brief is injected by page().
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { saveSnapshot, compareSnapshot } from '../describe-snapshot.mjs';
import { hintFor } from 'threedog/error-hints';

/** Wait for the engine to be ready (right after the page opens / reloads, commands arrive first) */
const READY = async () => {
  for (let i = 0; i < 600 && !window.engine?.stateApplied; i++) await new Promise(r => setTimeout(r, 100));
  if (!window.engine?.stateApplied) throw new Error('no ready engine in the page (is this a game page?)');
  return window.engine;
};

/**
 * One-line scenario: player position / time and weather / nearby / quest (runs in the page). Picks only what best tells "what is going on now"; ask describe
 * for details
 */
const BRIEF = e => {
  const d = e.describe(), p = d.player, t = d.time, w = d.weather, flags = [];
  if (d.cutscene) flags.push('in cutscene');
  if (d.ui?.dialogue) flags.push('in dialogue');
  if (d.ui?.windows?.length) flags.push('windows open ' + d.ui.windows.map(x => x.id || x).slice(0, 2).join(', '));
  if (d.error) flags.push('engine error ' + String(d.error).slice(0, 60));
  if (d.loading?.failed?.length) flags.push('load failed ' + d.loading.failed.map(f => f.name).slice(0, 3).join(', ') + ' (threedog loading)');
  const l1 = [p && `Player (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) ${p.inWater ? 'in water' : 'on ' + (p.groundName || p.ground || 'ground')}`,
    t && `${t.clock} day ${t.day}`, w?.label, ...flags].filter(Boolean).join(' · ');
  const near = (d.nearby || []).slice(0, 3).map(n => `${n.name} ${n.dist} m${n.use ? ' (interactable)' : ''}`).join(', ');
  const q = d.quests?.active?.[0];
  return [l1, near && 'Nearby: ' + near, q && `Quest: ${q.title}: ${q.step}`].filter(Boolean);
};

/** Wrap fn(arg, engine, brief) into the source evaluate takes */
const page = fn => `async a => { const engine = await (${READY})(); return (${fn})(a, engine, ${BRIEF}); }`;
/** Only waits for window.engine to exist: `loading` must answer while start() is still running or stuck */
const ATTACHED = async () => {
  for (let i = 0; i < 300 && !window.engine?.loading; i++) await new Promise(r => setTimeout(r, 100));
  if (!window.engine?.loading) throw new Error('no engine in the page (is this a game page? main.js should set window.engine = engine before start())');
  return window.engine;
};

const KEY = /^(Key[A-Z]|Digit\d|Arrow(Up|Down|Left|Right)|Space|Enter|Escape|Tab|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Backspace|F\d+|Numpad\w+|Mouse[0-4])$/;

// ── Functions executed in the page ─────────────────────────────────────
const PAGE = {
  describe: (a, e, brief) => {
    if (a.all) return e.describeText({ full: true });   // everything: every nearby thing, every module's full data
    if (a.full) return e.describeText();   // the summary (at most 30 lines)
    if (!a.path) return brief(e).join('\n');
    let v = e.describe();
    for (const k of a.path.split('.')) v = v?.[k] ?? (k === 'position' && v && 'x' in v ? { x: v.x,
      y: v.y, z: v.z } : undefined);   // player.position gives {x,y,z}
    if (v === undefined) throw new Error(`describe has no "${a.path}"; top-level keys: ${Object.keys(e.describe()).join(', ')}`);
    return JSON.stringify(v, null, 1).slice(0, a.max);
  },
  step: (a, e, brief) => {
    e.pause();   // stop a real-time page first, so the real-time loop and step do not both advance it
    e.step(a.seconds, { render: false });
    e.step(1 / 60);   // render one frame so the picture matches the state
    const b = brief(e).slice(0, 2);
    if (!e.headless) b.push('page is paused (threedog resume restores real-time running)');
    return b.join('\n');
  },
  press: (a, e, brief) => {
    const inp = e.input;
    let code = a.key;
    const action = inp.actions.has(code) ? code : null;
    if (action) code = inp.keysOf(code).find(k => !k.startsWith('Pad'));
    else if (/^[a-z]$/i.test(code)) code = 'Key' + code.toUpperCase();
    else if (/^\d$/.test(code)) code = 'Digit' + code;
    else if (!new RegExp(a.valid).test(code)) throw new Error(`Unknown "${a.key}". Action names: ${[...inp.actions.keys()].slice(0, 14).join(', ')}…; or a key code such as KeyE, Space, Escape`);
    if (!code) throw new Error(`action "${a.key}" has no keyboard key`);
    e.pause();
    // Actions go through the public input.simulate (same path as a real key press: the fixed snapshot and the frame "just pressed" see it).
    // A raw key code is sent as a real keyboard event: the engine's own window listener takes it, no private input call
    const down = on => action ? inp.simulate(action, on) : dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code }));
    down(true);
    e.step(a.seconds, { render: false });
    down(false);
    e.step(1 / 60);
    const b = brief(e).slice(0, 2), hold = a.seconds > 0.1;
    b[0] = `${hold ? 'Held' : 'Pressed'} ${a.key}${code === a.key ? '' : ' (' + code + ')'}${hold ? ' for ' + a.seconds + ' s' : ''} · ` + b[0];
    if (!e.headless) b.push('page is paused (threedog resume restores real-time running)');
    return b.join('\n');
  },
  state: async (a, e, brief) => { await e.applyState(a.params); e.step(1 / 60); return brief(e).slice(0, 2).join('\n'); },
  eval: async (a, e) => {
    const AsyncFunction = (async () => {}).constructor;   // the function body is async, so await works directly inside
    let v;
    try { v = await new AsyncFunction('engine', 'return (' + a.expr + ')')(e); }   // try it as an expression first
    catch (err) { if (!(err instanceof SyntaxError)) throw err; v = await new AsyncFunction('engine',
      a.expr)(e); }   // otherwise as statements (multi-line needs its own return)
    if (v === undefined) return '(no return value)';
    try { return JSON.stringify(v, (k, x) => typeof x === 'function' ? '[function]' : x, 1).slice(0, a.max); } catch { return String(v).slice(0, a.max); }
  },
  resume: (a, e) => { e.resume(); return 'Real-time running resumed'; },
  settled: async (a, e) => { await e.ui.settled?.(); return true; },   // fading UI parts (the loading screen) finished: snap waits for it
  raw: (a, e) => e.describe(),   // the whole describe() object, compared in node (describe-snapshot.mjs)
  // op: raw key=value strings are converted by the op's args shape (n=2 -> 2, position=3,0,-2 -> [3, 0, -2]);
  // runs as source 'bridge' between steps, so no game time passes
  op: (a, e, brief) => {
    const d = e.ops.defs.get(a.name), shape = d?.shape || {}, args = {};
    const conv = (v, t) => t === 'int' || t === 'number' ? Number(v) : t === 'bool' ? v === 'true' : t === 'position' ? v.split(',').map(Number)
      : t === 'string' || t === 'id' ? v : (() => { try { return JSON.parse(v); } catch { return v; } })();
    for (const [k, v] of a.pairs) args[k] = conv(v, shape[k]?.type);
    // explain op: same arg conversion, nothing runs
    if (a.explain) { const x = e.explain({ op: a.name, args }); return { ok: x.ok, text: x.text, detail: x.detail }; }
    const r = e.ops.run(a.name, args, { source: 'bridge' });
    if (e.paused) e._render(1 / 60);   // show the result without advancing game time
    const bag = e.inventory ? 'Bag ' + (e.inventory.list().slice(0, 6).map(x => `${x.id}×${x.count}`).join(' ') || 'empty') : '';
    const head = r.ok ? `✓ ${a.name}${r.value === undefined ? '' : ' → ' + JSON.stringify(r.value).slice(0, 80)}`
      : `✗ ${a.name}: ${r.reason}${d?.reasons?.[r.reason] ? ' (' + d.reasons[r.reason] + ')' : ''}`;
    return { ok: r.ok, text: [head + (bag ? ' · ' + bag : ''), ...brief(e).slice(0, 2)].join('\n') };
  },
  ops: (a, e) => {
    const fmtArgs = x => Object.entries(x || {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`).join(' ');
    const all = e.ops.list();
    if (!all.length) return 'No ops defined (engine.ops.define(name, { can, run }), see recipes/23-ops.md)';
    const now = e.ops.list({ available: true });
    const shown = now.slice(0, 12).map(o => `${o.ok ? '✓' : '✗'} ${o.name}`
      + `${o.args && Object.keys(o.args).length ? ' ' + fmtArgs(o.args) : ''}${o.ok ? '' : ' (' + o.reason + ')'}`);
    const free = all.filter(o => o.args && !e.ops.defs.get(o.name).offers).map(o => `${o.name} ${fmtArgs(o.args)}`);
    const freeLine = free.length ? 'Free-form args: ' + free.slice(0, 6).join(' · ') : '';
    return [shown.join(' · ') || 'Nothing on offer right now', freeLine].filter(Boolean).join('\n');
  },
  brief: (a, e, brief) => brief(e).join('\n'),
  inspect: (a, e) => {
    const r = e.inspect(a.at), args = x => Object.entries(x || {}).map(([k, v]) => ` ${k}=${v}`).join('');
    return [`${r.actor} at (${r.at.x}, ${r.at.z}) · near: ${r.near.slice(0, 4).map(n => `${n.name} ${n.dist} m`).join(', ') || 'nothing'}`,
      r.ops.map(o => `${o.ok ? '✓' : '✗'} ${o.op}${args(o.args)}${o.ok ? '' : ` (${o.reason}${o.why ? ': ' + o.why : ''})`}`).join(' · ') || 'No ops on offer',
      r.thing?.edit && `${r.thing.id}: ${r.thing.edit}`].filter(Boolean).join('\n');
  },
  explain: (a, e) => { const r = e.explain({ [a.key]: a.value }); return { ok: r.ok, text: r.text, detail: r.detail }; },
  // pick: screen pixels (from the canvas top-left) -> the thing under them (engine.pick(...).thing): record id, kind, template, where it was authored
  pick: (a, e) => {
    const r = e.renderer.domElement.getBoundingClientRect(), h = e.pick(a.x / r.width * 2 - 1, 1 - a.y / r.height * 2, { targets: 'all' });
    if (!h) return { ok: false, text: `Nothing under (${a.x}, ${a.y}) (canvas ${Math.round(r.width)}x${Math.round(r.height)} px; sky, terrain and vegetation are not picked)` };
    const t = h.thing, p = h.point, f = Object.entries(t.fields || {}).slice(0, 6).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
    const head = t.id ? `${t.id} (kind ${t.kind}${t.template ? ', template ' + t.template : ''})` : `scenery mesh "${t.mesh ?? '?'}" (no world record)`;
    return { ok: true, text: [`✓ ${head} at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) · material ${t.material ?? '-'}${t.model ? ' · model ' + JSON.stringify(t.model) : ''}`,
      t.edit ?? (t.id ? 'no source known (a record added from code)' : 'part of a level model or added with engine.add'), f && 'fields '
        + f].filter(Boolean).join('\n'), thing: t };
  },
  // loading: the same view as describe().loading, or one task with its source; formatted in node so the hint table applies
  loading: (a, e) => (a.name ? { task: e.loading.get(a.name) } : { view: e.loading.view(), ready: e.ready }),
};

const ev = (d, name, arg) => d.evaluate(page(PAGE[name]), arg);
const evAttached = (d, name, arg) => d.evaluate(`async a => (${PAGE[name]})(a, await (${ATTACHED})())`, arg);
const num = (s, name) => { const n = parseFloat(s); if (!(n > 0)) throw new Error(`${name} must be a positive number, e.g. threedog ${name === 'seconds' ? 'step 2' : '…'}`); return n; };
const lines = (s, n = 3) => String(s).split('\n').slice(0, n).join('\n');
const MAX = 500;   // default output cap (characters); add --max N for more

/** Read what errors.log gained since the last read, and remember the position */
function newErrors(dir) {
  const log = join(dir, '.threedog/errors.log'), cur = join(dir, '.threedog/errors.cursor');
  if (!existsSync(log)) return [];
  const size = statSync(log).size, from = existsSync(cur) ? +readFileSync(cur, 'utf8') : 0;
  writeFileSync(cur, String(size));
  const text = readFileSync(log).subarray(from > size ? 0 : from).toString('utf8');   // read from the start if the log was truncated / cleared on restart
  return text.split(/\n(?=\[browser)/).map(s => s.trim()).filter(s => s.startsWith('[browser'));
}

/** key=value arguments of op / explain op → [[key, value]]; a word without = is an error, not a silent { "": value } */
function opPairs(args) {
  return args.map(kv => {
    const i = kv.indexOf('=');
    if (i < 1) throw new Error(`op arguments are key=value, e.g. n=2 (got "${kv}"); in PowerShell quote commas: "position=3,0,-2"`);
    return [kv.slice(0, i), kv.slice(i + 1)];
  });
}

/** Strip options such as --max N / --full, returning { rest, opt } */
function options(args) {
  const rest = [], opt = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max') opt.max = +args[++i]; else if (args[i] === '--full') opt.full = true; else if (args[i] === '--all') opt.all = true;
    else if (args[i] === '--only') opt.only = args[++i].split(',').filter(Boolean);
    else if (args[i] === '--ignore') opt.ignore = args[++i].split(',').filter(Boolean);
    else if (args[i] === '--tolerance') opt.tolerance = +args[++i];
    else if (args[i] === '--file') opt.file = args[++i];
    else if (args[i] === '--for') opt.for = args[++i]; else rest.push(args[i]);
  }
  return { rest, opt };
}

export const COMMANDS = {
  describe: 'compact scenario description (--full for the describeText summary, --all for everything, describe player.x for one item, --max characters)',
  step: 'advance N game seconds: step 2',
  press: 'press a key or action: press interact / press KeyE / press e (held 0.1 s, then renders 1/60 s; --for 0.02 shortens the hold)',
  hold: 'hold for N seconds: hold moveForward 1.5',
  state: 'change the scenario: state time=18:30 weather=rain pos=40,-20',
  eval: 'evaluate an expression in the page (engine is available, await works; multi-line statements need their own return): eval ' +
    '"engine.sky.timeOfDay"; long scripts: eval --file path',
  js: 'alias of eval (the command has no eval in it, so the Bash sandbox does not block it): js "engine.sky.timeOfDay" / js --file path',
  'snap-describe': 'describe snapshot instead of a screenshot: snap-describe save|diff name [--only a,b] [--ignore x.y] [--tolerance 0.5]',
  snap: 'save a screenshot to .threedog/shots/name.png (snap name)',
  errors: 'read page errors added since the last read (known classes come with the cause and the doc page)',
  reload: 'reload the page',
  resume: 'resume real-time running (the page is paused after step / press)',
  ops: 'what the player can do now (each op offer checked with can): ✓ shop.buy shop=bakery item=bread · ✗ … (reason)',
  op: 'run an op as source bridge (no time passes): op shop.buy shop=bakery item=bread n=2 (values converted by the op args shape)',
  inspect: 'what is around the player (or inspect npc_3 / inspect 10,-4) and which ops it can do now, with reasons',
  pick: 'what is at screen pixel x,y (from the canvas top-left): pick 480,270 -> record id, kind, template, where it is defined (content file:line), fields',
  explain: 'why: explain op shop.buy shop=bakery item=bread (can it run; --full adds its last attempt) / explain quest first-light (where it is stuck)',
  scenario: 'run one scenario test (tests/scenarios/<name>.json) on this page: scenario barter (prints failed checks; the scenario leaves the page paused)',
  loading: 'what loading waits for / what failed / does it block the start (answers while start() is stuck); loading hero: one task with its manifest and path',
};

/** loading command text: line 1 status, line 2 the failures, line 3 the hint for the first failure */
function loadingText({ view: v, ready }) {
  const c = v.counts, head = v.done ? `${v.ok ? '✓' : '✗'} Loading finished${ready ? '' : ' (start() not finished)'}, ${c.done}/${c.total} ok${c.failed ? `, ${c.failed} failed` : ''}`
    : `… ${v.blocked ? 'BLOCKED, ' : ''}waiting: ${v.waiting} (${c.pending} pending, ${c.done}/${c.total} done)`;
  const fail = v.failed.map(f => `${f.critical ? '✗ critical' : '! fell back'} ${f.kind} "${f.name}" ${f.error.url ?? ''} ${f.error.message}${f.fallback ? ` -> ${f.fallback}` : ''}`);
  const warn = v.warnings.map(w => `! "${w.name}" missing ${w.missing.join(', ')}`);
  const h = v.failed.length ? hintFor(v.blocked ? 'Startup blocked: 1 critical item' : 'Asset failed to load') : v.warnings.length
    ? hintFor('Asset loaded with missing references') : null;
  const lines3 = [head, [...fail, ...warn].join(' · ').slice(0, 300), h && `-> Possible cause: ${h.cause.slice(0, 160)} Read: ${h.docs.join(', ')}`];
  return { ok: v.ok && !v.blocked, text: lines3.filter(Boolean).join('\n') };
}

/** Run one command. On failure throws an Error (message is English, for the AI to read) */
export async function run(driver, cmd, args = [], { dir = process.cwd() } = {}) {
  const { rest, opt } = options(args), max = opt.max || MAX;
  switch (cmd) {
    case 'describe': {
      const text = await ev(driver, 'describe', { full: opt.full, all: opt.all, path: rest[0], max });
      return { ok: true, text: opt.full || opt.all || rest[0] ? text : lines(text) };
    }
    case 'step': {
      const seconds = num(rest[0] ?? 1, 'seconds');
      return { ok: true, text: `✓ Stepped ${seconds} s · ` + lines(await ev(driver, 'step', { seconds }), 3) };
    }
    case 'press': case 'hold': {
      if (!rest[0]) throw new Error(`Usage: threedog ${cmd} action-or-key${cmd === 'hold' ? ' seconds' : ''}, e.g. threedog ${cmd} interact`);
      const seconds = cmd === 'hold' ? num(rest[1] ?? 1, 'seconds') : opt.for !== undefined ? num(opt.for, '--for seconds') : 0.1;
      return { ok: true, text: '✓ ' + lines(await ev(driver, 'press', { key: rest[0], seconds, valid: KEY.source }), 3) };
    }
    case 'state': {
      const stray = rest.find(kv => !kv.includes('='));
      if (stray && /^-?[\d.]+$/.test(stray)) throw new Error(`"${stray}" is a stray number: in PowerShell a comma splits the argument, so quote coordinates, e.g. "pos=1,-8"`);
      const params = Object.fromEntries(rest.map(kv => { const i = kv.indexOf('='); if (i < 1) throw new Error(`arguments must be key=value, e.g. time=18:30 (got "${kv}")`); return [kv.slice(0,
        i), kv.slice(i + 1)]; }));
      if (params.pos !== undefined && !/^-?[\d.]+,-?[\d.]+$/.test(params.pos)) throw new Error(`pos must be two numbers x,z (got "${params.pos}"). In PowerShell quote the comma: threedog state "pos=1,-8"`);
      if (!Object.keys(params).length) throw new Error('Usage: threedog state time=18:30 weather=rain pos=40,-20 (also wait= cutscene=skip state=name)');
      return { ok: true, text: '✓ Set · ' + lines(await ev(driver, 'state', { params }), 3) };
    }
    case 'eval': case 'js': {
      // --file: keep the script in a file, avoiding PowerShell / Bash quoting and multi-line problems
      if (opt.file && !existsSync(opt.file)) throw new Error(`Script file not found: "${opt.file}" (path relative to the current directory)`);
      const expr = opt.file ? readFileSync(opt.file, 'utf8') : rest.join(' ');
      if (!expr.trim()) throw new Error('Usage: threedog js "engine.sky.timeOfDay" or threedog js --file script.js (same as eval)');
      return { ok: true, text: '✓ ' + await ev(driver, 'eval', { expr, max }) };
    }
    case 'snap': {
      await ev(driver, 'settled', {});   // like threedog shot: never capture the loading screen mid-fade
      const png = await driver.screenshot(), name = (rest[0] || 'snap').replace(/[^\w一-龥.-]+/g, '-');
      mkdirSync(join(dir, '.threedog/shots'), { recursive: true });
      writeFileSync(join(dir, `.threedog/shots/${name}.png`), png);
      return { ok: true, text: `✓ Screenshot .threedog/shots/${name}.png (${(png.length / 1024).toFixed(0)} KB)\n` + lines(await ev(driver, 'brief', {}), 2) };
    }
    case 'snap-describe': {
      const [mode, name] = rest, snapDir = join(dir, 'tests', 'snapshots');
      if (!['save', 'diff'].includes(mode) || !name) throw new Error('Usage: threedog snap-describe save|diff name [--only a,b] [--ignore x.y] ' +
        '[--tolerance 0.5], e.g. snap-describe save market-noon --only player,quests');
      const d = await ev(driver, 'raw', {}), o = { only: opt.only, ignore: opt.ignore, tolerance: opt.tolerance };
      if (mode === 'save') { saveSnapshot(snapDir, name, d, o); return { ok: true, text: `✓ Baseline saved: tests/snapshots/${name}.describe.json` }; }
      const r = compareSnapshot(snapDir, name, d, o);
      return { ok: r.ok, text: r.ok ? `✓ describe "${name}" matches the baseline` : '✗ ' + r.text };
    }
    case 'errors': {
      const list = newErrors(dir);
      if (!list.length) return { ok: true, text: '✓ No new errors' };
      // Each error: head + message on one line, then (for known classes) a line with the likely cause and the doc page to read
      // Log entry (vite-error-relay.js): head line, then the page's own text with a "page| " prefix (page path, message, at, stack), then the engine hint
      const one = s => {
        const [head, ...rest] = s.split('\n'), page = rest.filter(l => l.startsWith('page| ')).map(l => l.slice(6));
        const end = page.findIndex((l, i) => i > 0 && /^\s*at /.test(l)), msg = page.slice(1, end < 0 ? undefined : end).join('\n');
        const h = hintFor(msg.replace(/\n\s*(Possible cause|Read):.*/g, ''));
        const code = msg.match(/\[([a-z][\w-]*)\]/)?.[1];   // coded engine errors end their message with [code]
        return ((code ? `[${code}] ` : '') + `${head.trim()} ${page[0] ?? ''} ${msg.split('\n')[0]}`).slice(0, 160)
          + (h ? `\n  -> Possible cause: ${h.cause} Read: ${h.docs.join(', ')}` : '');
      };
      const more = list.length > 2 ? `\n…${list.length - 2} more, see .threedog/errors.log` : '';
      return { ok: false, text: `✗ ${list.length} new error${list.length === 1 ? '' : 's'}\n` + list.slice(0, 2).map(one).join('\n') + more };
    }
    case 'reload':
      if (driver.reload) await driver.reload(); else await driver.evaluate('() => { setTimeout(() => location.reload(), 0); return 1; }');
      return { ok: true, text: '✓ Page reloaded' };
    case 'resume':
      return { ok: true, text: '✓ ' + await ev(driver, 'resume', {}) };
    case 'ops':
      return { ok: true, text: lines(await ev(driver, 'ops', {}), 3) };
    case 'op': {
      if (!rest[0]) throw new Error('Usage: threedog op name key=value …, e.g. threedog op shop.buy shop=bakery item=bread (threedog ops lists what is ' +
        'possible)');
      const r = await ev(driver, 'op', { name: rest[0], pairs: opPairs(rest.slice(1)) });
      return { ok: r.ok, text: lines(r.text, 3) };
    }
    case 'inspect': {
      const at = rest[0] && /^-?[\d.]+,-?[\d.]+$/.test(rest[0]) ? rest[0].split(',').map(Number) : rest[0];
      return { ok: true, text: lines(await ev(driver, 'inspect', { at }), 3) };
    }
    case 'pick': {
      const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(rest[0] ?? '');
      if (!m) throw new Error('Usage: threedog pick x,y (screen pixels from the canvas top-left), e.g. threedog pick 480,270 (in PowerShell quote it: ' +
        '"480,270")');
      const r = await ev(driver, 'pick', { x: Number(m[1]), y: Number(m[2]) });
      return { ok: r.ok, text: lines(r.text, 3) };
    }
    case 'explain': {
      if (!rest[1]) throw new Error('Usage: threedog explain op shop.buy key=value … / threedog explain quest first-light');
      const r = rest[0] === 'op' ? await ev(driver, 'op', { name: rest[1], explain: true, pairs: opPairs(rest.slice(2)) })
        : await ev(driver, 'explain', { key: rest[0], value: rest[1] });
      // --full adds the detail (last attempt, events around it)
      return { ok: r.ok, text: (r.ok ? '✓ ' : '✗ ') + lines(r.text, 3) + (opt.full && r.detail ? '\n' + String(r.detail).slice(0, max) : '') };
    }
    case 'loading': {
      if (!rest[0]) return loadingText(await evAttached(driver, 'loading', {}));
      const { task } = await evAttached(driver, 'loading', { name: rest[0] });
      if (!task) throw new Error(`No loading task named "${rest[0]}"; threedog loading lists pending and failed ones (manifest asset names, module names, track() names)`);
      return { ok: task.phase !== 'failed', text: JSON.stringify(task, null, 1).slice(0, max) };
    }
    default:
      throw new Error(`No command "${cmd}". Available: ${Object.keys(COMMANDS).join(', ')}`);
  }
}
