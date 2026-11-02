// Functions the threedog commands run inside the game page (sent as source via toString, so each is self-contained) and the helpers that send them.
// The command layer that calls them is commands.mjs.


/** Wait for the engine to be ready (right after the page opens / reloads, commands arrive first) */
// Same rule as the node-side wait (wait-engine.mjs): an uncaught error while there is no engine ends the wait at once and is quoted
// (window.__threedogUncaught is kept by the dev error relay, vite/vite-error-relay.js); the "no engine" text only when nothing threw.
export const READY = async () => {
  const threw = () => !window.engine && window.__threedogUncaught?.length;
  for (let i = 0; i < 600 && !window.engine?.stateApplied && !threw(); i++) await new Promise(r => setTimeout(r, 100));
  if (threw()) throw new Error('the page threw before the engine existed: ' + window.__threedogUncaught.at(-1).slice(0, 400));
  if (!window.engine?.stateApplied) throw new Error('no ready engine in the page (is this a game page?)');
  return window.engine;
};

/**
 * One-line scenario: player position / time and weather / nearby / quest (runs in the page). Picks only what best tells "what is going on now"; ask describe
 * for details
 */
export const BRIEF = e => {
  const d = e.describe(), p = d.player, t = d.time, w = d.weather, flags = [];
  if (d.cutscene) flags.push('in cutscene');
  if (d.ui?.dialogue) flags.push('in dialogue');
  if (d.ui?.windows?.length) flags.push('windows open ' + d.ui.windows.map(x => x.id || x).slice(0, 2).join(', '));
  // engine.error is an object { where, message, code, at } (core/errors.js): String() of it printed "engine error [object Object]"
  if (d.error) flags.push(`engine error ${d.error.code ? `[${d.error.code}] ` : ''}${d.error.where}: ${(m => m.length > 400 ? m.slice(0, 200) + ' … ' + m.slice(-197) : m)(String(d.error.message))}${d.error.at ? ` (${d.error.at})` : ''}`);
  if (d.loading?.failed?.length) flags.push('load failed ' + d.loading.failed.map(f => f.name).slice(0, 3).join(', ') + ' (threedog loading)');
  const l1 = [p && `Player (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) ${p.inWater ? 'in water' : 'on ' + (p.groundName || p.ground || 'ground')}`,
    t?.clock != null && `${t.clock}${t.day != null ? ' day ' + t.day : ''}`, w?.label, ...flags].filter(Boolean).join(' · ');
  const near = (d.nearby || []).slice(0, 3).map(n => `${n.name} ${n.dist} m${n.use ? ' (interactable)' : ''}`).join(', ');
  const q = d.quests?.active?.[0];
  return [l1, near && 'Nearby: ' + near, q && `Quest: ${q.title}: ${q.step}`].filter(Boolean);
};

/**
 * What bears on a picture, printed under every `threedog shot` and `threedog snap` (one formatter for both): time and day / night, weather,
 * the camera with its focus, and a page error or failed load if any. Why not describeText: a ~15-line state block after every picture buried
 * the look lines; the rest is one command away (threedog describe). Self-contained: it is serialized into the page.
 */
export const PICTURE = e => {
  const d = e.describe(), t = d.time, w = d.weather, c = d.camera, r = v => Math.round(v * 10) / 10;
  const err = d.error && `engine error ${d.error.code ? `[${d.error.code}] ` : ''}${d.error.where}: ${String(d.error.message).slice(0, 200)}`;
  return [
    t?.clock != null && `Time: ${t.clock}${t.day != null ? `, day ${t.day}` : ''}${t.isDay != null ? (t.isDay ? ', daytime' : ', night') : ''}`,
    w && `Weather: ${w.name ?? w.label}${w.progress < 1 ? `, changing (${Math.round(w.progress * 100)}%)` : ''}`,
    c && `Camera: ${c.type}${c.override ? ` (override ${c.override})` : ''}, position (${r(c.x)}, ${r(c.y)}, ${r(c.z)})${c.focus ? `, focus (${r(c.focus.x)}, ${r(c.focus.z)})` : ''}`,
    err, d.loading?.failed?.length && 'load failed ' + d.loading.failed.map(f => f.name).slice(0, 3).join(', ') + ' (threedog loading)',
    'More: threedog describe (--full for the state summary)',
  ].filter(Boolean);
};

/** The page's run state after a step or test command: running / title-frozen / test-paused / paused(by owners) / loading (engine.runState) */
const RUN = e => { const r = e.runState; return 'Run state: ' + (r.state === 'paused' ? `paused(by ${r.owners.join(', ')})` : r.state) + (r.state === 'test-paused' && !e.headless ? ' (threedog resume restores real-time running)' : ''); };

/**
 * Value at a describe path: 'player.x', 'nearby[0].name', 'player.position' (-> { x, y, z }). The ONE parser: describe <path> and a scenario's
 * expect keys both use it (it runs in the page for describe, so it is self-contained).
 */
export const atPath = (obj, path) => String(path).split(/\.|(?=\[)/).filter(Boolean).reduce((v, k) => v == null ? undefined
  : v[k.startsWith('[') ? +k.slice(1, -1) : k] ?? (k === 'position' && typeof v === 'object' && 'x' in v ? { x: v.x, y: v.y, z: v.z } : undefined), obj);

/** Wrap fn(arg, engine, brief, run, at) into the source evaluate takes */
const page = fn => `async a => { const engine = await (${READY})(); return (${fn})(a, engine, ${BRIEF}, ${RUN}, ${atPath}); }`;
/** Only waits for window.engine to exist: `loading` must answer while start() is still running or stuck */
const ATTACHED = async () => {
  for (let i = 0; i < 300 && !window.engine?.loading && !window.__threedogUncaught?.length; i++) await new Promise(r => setTimeout(r, 100));
  if (!window.engine && window.__threedogUncaught?.length) throw new Error('the page threw before the engine existed: ' + window.__threedogUncaught.at(-1).slice(0, 400));
  if (!window.engine?.loading) throw new Error('no engine in the page (is this a game page? main.js should set window.engine = engine before start())');
  return window.engine;
};

export const KEY = new RegExp('^(Key[A-Z]|Digit\\d|Arrow(Up|Down|Left|Right)|Space|Enter|Escape|Tab|Shift(Left|Right)|Control(Left|Right)|'
  + 'Alt(Left|Right)|Backspace|F\\d+|Numpad\\w+|Mouse[0-4])$');

// ── Functions executed in the page ─────────────────────────────────────
const PAGE = {
  describe: (a, e, brief, run, at) => {
    if (a.all) return e.describeText({ full: true });   // everything: every nearby thing, every module's full data
    if (a.full) return e.describeText();   // the summary (at most 30 lines)
    if (!a.path) return brief(e).join('\n');
    const v = at(e.describe(), a.path);
    if (v === undefined) throw new Error(`describe has no "${a.path}"; top-level keys: ${Object.keys(e.describe()).join(', ')}`);
    return JSON.stringify(v, null, 1).slice(0, a.max);
  },
  step: (a, e, brief, run) => {
    e.pause('threedog', { kind: 'test' });   // stop a real-time page first, so the real-time loop and step do not both advance it
    e.step(a.seconds, { render: false });
    e.step(1 / 60);   // render one frame so the picture matches the state
    const b = brief(e).slice(0, 2);
    b.push(run(e));
    return b.join('\n');
  },
  press: (a, e, brief, run) => {
    const inp = e.input;
    let code = a.key;
    const action = inp.actions.has(code) ? code : null;
    if (action) code = inp.keysOf(code).find(k => !k.startsWith('Pad'));
    else if (/^[a-z]$/i.test(code)) code = 'Key' + code.toUpperCase();
    else if (/^\d$/.test(code)) code = 'Digit' + code;
    else if (!new RegExp(a.valid).test(code)) throw new Error(`Unknown "${a.key}". Action names: ${[...inp.actions.keys()].slice(0, 14).join(', ')}…; `
      + 'or a key code such as KeyE, Space, Escape');
    if (!code) throw new Error(`action "${a.key}" has no keyboard key`);
    e.pause('threedog', { kind: 'test' });
    // Actions go through the public input.simulate (same path as a real key press: the fixed snapshot and the frame "just pressed" see it).
    // A raw key code is sent as a real keyboard event: the engine's own window listener takes it, no private input call
    const down = on => action ? inp.simulate(action, on) : dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code }));
    down(true);
    e.step(a.seconds, { render: false });
    down(false);
    e.step(1 / 60);
    const b = brief(e).slice(0, 2), hold = a.seconds > 0.1;
    b[0] = `${hold ? 'Held' : 'Pressed'} ${a.key}${code === a.key ? '' : ' (' + code + ')'}${hold ? ' for ' + a.seconds + ' s' : ''} · ` + b[0];
    b.push(run(e));
    return b.join('\n');
  },
  // skip: engine.skip({ to | seconds }): the jump itself is the op time.skip; the sky clock moves, no fixed steps run
  skip: async (a, e, brief, run) => {
    e.pause('threedog', { kind: 'test' });
    const v = await e.skip(a.opts);
    e.step(1 / 60);
    return [`Skipped ${a.desc}` + (v === null || v === undefined ? '' : ' → ' + JSON.stringify(v).slice(0, 80)), ...brief(e).slice(0, 2), run(e)].join('\n');
  },
  state: async (a, e, brief) => { await e.applyState(a.params); e.step(1 / 60); return brief(e).slice(0, 2).join('\n'); },
  // js / eval and checks scripts (js --file steps.js) share this one function, so both see the same globals: engine, step(seconds = 1/60) (pauses the
  // real-time loop first, like the step command), log(...), assert(cond, msg), expect(v, msg).toBe/toEqual/toBeCloseTo/toBeGreaterThan(x, msg).
  // Checks mode (the script calls assert / expect, steps.mjs): a failed check is recorded and the script goes on; a throw ends it and counts as one
  // failure; returns the records, steps.mjs prints them. Plain mode (a.plain): the source is tried as an expression first, a throw propagates, and the
  // return value comes back as JSON text cut at a.max.
  steps: async (a, e) => {
    const AsyncFunction = (async () => {}).constructor, res = [], logs = [];   // the function body is async, so await works directly inside
    const show = v => { try { return JSON.stringify(v); } catch { return String(v); } };
    const rec = (ok, msg, detail) => { res.push({ ok, msg: msg || 'check ' + (res.length + 1), detail: ok ? '' : detail }); };
    const assert = (c, msg) => rec(!!c, msg, 'assert failed');
    // the message goes on the matcher (expect(v).toBe(x, msg)) or on expect (expect(v, msg).toBe(x)); the matcher's wins
    const expect = (v, em) => ({
      toBe: (x, m) => rec(Object.is(v, x), m ?? em, `expected ${show(x)}, got ${show(v)}`),
      toEqual: (x, m) => rec(show(v) === show(x), m ?? em, `expected ${show(x)}, got ${show(v)}`),
      toBeCloseTo: (x, tol = 0.01, m) => rec(Math.abs(v - x) <= tol, m ?? em, `expected ${x} ± ${tol}, got ${show(v)}`),
      toBeGreaterThan: (x, m) => rec(v > x, m ?? em, `expected > ${show(x)}, got ${show(v)}`),
    });
    const step = (s = 1 / 60) => { e.pause('threedog', { kind: 'test' }); e.step(s, { render: false }); e.step(1 / 60); };
    const log = (...x) => logs.push(x.map(y => typeof y === 'string' ? y : show(y)).join(' '));
    const run = body => new AsyncFunction('engine', 'assert', 'expect', 'step', 'log', body)(e, assert, expect, step, log);
    if (a.plain) {
      let v;
      try { v = await run('return (' + a.src + ')'); }   // try it as an expression first
      catch (err) { if (!(err instanceof SyntaxError)) throw err; v = await run(a.src); }   // otherwise as statements (multi-line needs its own return)
      let text = '(no return value)';
      if (v !== undefined) {
        try { text = JSON.stringify(v, (k, x) => typeof x === 'function' ? '[function]' : x, 1).slice(0, a.max); } catch { text = String(v).slice(0, a.max); }
      }
      return { logs, text };
    }
    let value, threw = null;
    try { value = await run(a.src); }
    catch (err) { threw = String(err?.message ?? err); }
    return { res, logs, threw, value: value === undefined ? undefined : show(value)?.slice(0, 300) };
  },
  resume: (a, e, brief, run) => { e._resume('threedog'); return 'Real-time running resumed\n' + run(e); },
  // fading UI parts (the loading screen) finished: snap waits for it. Then, on a paused page (headless, step-driven), draw the current state once
  // without advancing game time: at tick 0 nothing had been drawn yet and snap read a black canvas (shot steps one frame before reading; the
  // same rule here, minus the game time, because snap must not change the running game)
  settled: async (a, e) => { await e.ui.settled?.(); if (e.paused) e._render(1 / 60); return true; },
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
      : `✗ ${a.name}: ${r.code}${d?.reasons?.[r.code] ? ' (' + d.reasons[r.code] + ')' : ''}`;
    return { ok: r.ok, text: [head + (bag ? ' · ' + bag : ''), ...brief(e).slice(0, 2)].join('\n') };
  },
  ops: (a, e) => {
    const fmtArgs = x => Object.entries(x || {}).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`).join(' ');
    const all = e.ops.list();
    if (!all.length) return 'No ops defined (engine.ops.define(name, { can, run }), see recipes/23-ops.md)';
    const now = e.ops.list({ available: true });
    const shown = now.slice(0, 12).map(o => `${o.ok ? '✓' : '✗'} ${o.name}`
      + `${o.args && Object.keys(o.args).length ? ' ' + fmtArgs(o.args) : ''}${o.ok ? '' : ' (' + o.code + ')'}`);
    const free = all.filter(o => o.args && !e.ops.defs.get(o.name).offers).map(o => `${o.name} ${fmtArgs(o.args)}`);
    const freeLine = free.length ? 'Free-form args: ' + free.slice(0, 6).join(' · ') : '';
    return [shown.join(' · ') || 'Nothing on offer right now', freeLine].filter(Boolean).join('\n');
  },
  brief: (a, e, brief) => brief(e).join('\n'),
  // a source string, not a function: PICTURE is spliced in here because the page wrapper only passes brief / run / at
  picture: `(a, e) => (${PICTURE})(e).join('\\n')`,
  catalog: (a, e) => ({ data: e.catalog(a.id ?? (a.find ? { find: a.find } : undefined)), ids: [...e.modules.keys()], ops: [...e.ops.defs.keys()] }),
  inspect: (a, e) => {
    if (a.at === 'materials' || a.at === 'perf') return e.inspect[a.at]().text;   // threedog inspect materials | perf (engine.inspect.materials / perf)
    const r = e.inspect(a.at), args = x => Object.entries(x || {}).map(([k, v]) => ` ${k}=${v}`).join('');
    return [`${r.actor} at (${r.at.x}, ${r.at.z}) · near: ${r.near.slice(0, 4).map(n => `${n.name} ${n.dist} m`).join(', ') || 'nothing'}`,
      r.ops.map(o => `${o.ok ? '✓' : '✗'} ${o.op}${args(o.args)}`
      + (o.ok ? '' : ` (${o.code}${o.why ? ': ' + o.why : ''})`)).join(' · ') || 'No ops on offer',
      r.thing?.edit && `${r.thing.id}: ${r.thing.edit}`].filter(Boolean).join('\n');
  },
  scene: (a, e) => { const r = e.inspect.scene({ hidden: a.hidden, limit: a.limit }); return { ok: true, text: r.text, data: { camera: r.camera, counts: r.counts, items: r.items, truncated: r.truncated } }; },
  explain: (a, e) => { const r = e.explain({ [a.key]: a.value }); return { ok: r.ok, text: r.text, detail: r.detail }; },
  // pick: screen pixels (from the canvas top-left) -> the thing under them (engine.pick(...).thing): record id, kind, template, where it was authored
  pick: (a, e) => {
    const r = e.renderer.domElement.getBoundingClientRect(), h = e.pick(a.x / r.width * 2 - 1, 1 - a.y / r.height * 2, { targets: 'all' });
    if (!h) return { ok: false, text: `Nothing under (${a.x}, ${a.y}) `
      + `(canvas ${Math.round(r.width)}x${Math.round(r.height)} px; sky, terrain and vegetation are not picked)` };
    const t = h.thing, p = h.point, f = Object.entries(t.fields || {}).slice(0, 6).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
    const head = t.id ? `${t.id} (kind ${t.kind}${t.template ? ', template ' + t.template : ''})` : `scenery mesh "${t.mesh ?? '?'}" (no world record)`;
    return { ok: true, text: [`✓ ${head} at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) `
        + `· material ${t.material ?? '-'}${t.model ? ' · model ' + JSON.stringify(t.model) : ''}`,
      t.edit ?? (t.id ? 'no source known (a record added from code)' : 'part of a level model or added with engine.add'), f && 'fields '
        + f].filter(Boolean).join('\n'), thing: t };
  },
  // thing: engine.thing(id).explain() as JSON text (the same object tests and describe read)
  thing: (a, e) => { try { const d = e.thing(a.id).explain(); return { ok: true, text: JSON.stringify(d, null, 1), data: d }; } catch (x) { return { ok: false, text: String(x.message ?? x) }; } },
  // loading: the same view as describe().loading, or one task with its source; formatted in node so the hint table applies
  loading: (a, e) => (a.name ? { task: e.loading.get(a.name) } : { view: e.loading.view(), ready: e.ready }),
};

export const ev = (d, name, arg) => d.evaluate(page(PAGE[name]), arg);
export const evAttached = (d, name, arg) => d.evaluate(`async a => (${PAGE[name]})(a, await (${ATTACHED})())`, arg);
