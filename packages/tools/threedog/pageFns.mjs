// Functions the threedog commands run inside the game page (sent as source via toString, so each is self-contained) and the helpers that send them.
// The command layer that calls them is commands.mjs.


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

export const KEY = new RegExp('^(Key[A-Z]|Digit\\d|Arrow(Up|Down|Left|Right)|Space|Enter|Escape|Tab|Shift(Left|Right)|Control(Left|Right)|'
  + 'Alt(Left|Right)|Backspace|F\\d+|Numpad\\w+|Mouse[0-4])$');

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
    else if (!new RegExp(a.valid).test(code)) throw new Error(`Unknown "${a.key}". Action names: ${[...inp.actions.keys()].slice(0, 14).join(', ')}…; `
      + 'or a key code such as KeyE, Space, Escape');
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
      r.ops.map(o => `${o.ok ? '✓' : '✗'} ${o.op}${args(o.args)}`
      + (o.ok ? '' : ` (${o.reason}${o.why ? ': ' + o.why : ''})`)).join(' · ') || 'No ops on offer',
      r.thing?.edit && `${r.thing.id}: ${r.thing.edit}`].filter(Boolean).join('\n');
  },
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
  // loading: the same view as describe().loading, or one task with its source; formatted in node so the hint table applies
  loading: (a, e) => (a.name ? { task: e.loading.get(a.name) } : { view: e.loading.view(), ready: e.ready }),
};

export const ev = (d, name, arg) => d.evaluate(page(PAGE[name]), arg);
export const evAttached = (d, name, arg) => d.evaluate(`async a => (${PAGE[name]})(a, await (${ATTACHED})())`, arg);
