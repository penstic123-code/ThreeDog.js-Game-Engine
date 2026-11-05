// Fuzz (fast-check) at the places outside data enters the running engine: corrupt saves, applyState / URL parameters, random input orders.
// Expected for bad data: a coded error or a refusal; never a silent freeze, a changed state after a refused call, a throw out of the call, or a hang.
// Fixed seed (the normal suite repeats); the long run for a release: FC_RUNS=300 FC_SEED=<n> threedog test "Fuzz" (docs/plans/release-checklist.md).
// A failure prints the shrunk case; keep it as a fixed guard in the "Fuzz regressions" item at the end of this file.
// The content writer's fuzz is a tools test (packages/tools/tests/fuzz-content-write.mjs, no browser).
let fc = null, missing = '';
try { fc = await import('fast-check'); } catch (e) { missing = e.message.split('\n')[0]; }

const RUNS = Number(process.env.FC_RUNS) || 20;
const SEED = process.env.FC_SEED != null ? Number(process.env.FC_SEED) : 20261105;
const PAGE = '/?threedog-headless';

// One case gets FC_CASE_MS (default 60 s). A case that goes over is a reported failure with its input, so a hang is a case to replay, not a silent wait.
// After a timeout the page may be stuck in a real loop; later cases then fail at once instead of piling up behind it.
const CASE_MS = Number(process.env.FC_CASE_MS) || 60000;
async function prop(check, label, arb, runOnce) {
  if (!fc) { console.log(`  SKIP ${label}: fast-check not installed (${missing})`); check(`${label} (skipped: fast-check missing)`, true); return; }
  let stuck = null, n = 0;
  const r = await fc.check(fc.asyncProperty(arb, async v => {
    if (stuck) throw new Error(`earlier case hung: ${stuck}`);
    const no = ++n; let timer;
    const limit = new Promise(res => { timer = setTimeout(() => res(`HANG: case #${no} took over ${CASE_MS} ms (a page loop or a promise that never ends); input ${JSON.stringify(v)}`), CASE_MS); });
    const t0 = Date.now();
    try { const bad = await Promise.race([runOnce(v), limit]); if (process.env.FC_TRACE) console.log(`  [${label}] case #${no} ${Date.now() - t0} ms ${JSON.stringify(v).slice(0, 160)}`); if (bad) { if (String(bad).startsWith('HANG:')) stuck = bad; throw new Error(bad); } } finally { clearTimeout(timer); }
  }), { numRuns: RUNS, seed: SEED });
  check(r.failed ? label : `${label} (${r.numRuns} cases)`, !r.failed, r.failed ? `${r.errorInstance?.message ?? r.error}\n  shrunk: ${JSON.stringify(r.counterexample[0])}\n  seed: ${r.seed}  path: ${r.counterexamplePath}   replay: FC_SEED=${r.seed} threedog test "Fuzz"` : '');
}

// ---- saves: one good save, then a mutation of its text or of one value inside it ----
const odd = () => fc.oneof(fc.constant(null), fc.constant([]), fc.constant({}), fc.constantFrom(1e308, -1e308, -1, 0, 1e-320, 2 ** 53, 'abc', '', true), fc.jsonValue({ maxDepth: 2 }));
const saveMutation = () => fc.oneof(
  fc.record({ kind: fc.constant('cut'), at: fc.double({ min: 0, max: 1, noNaN: true }) }),
  fc.record({ kind: fc.constant('flip'), at: fc.double({ min: 0, max: 1, noNaN: true }), ch: fc.constantFrom('}', '{', '"', ',', 'x', '\u0000') }),
  fc.record({ kind: fc.constant('delete'), pick: fc.nat(500) }),
  fc.record({ kind: fc.constant('replace'), pick: fc.nat(500), v: odd() }),
  fc.record({ kind: fc.constant('addKey'), pick: fc.nat(500), k: fc.constantFrom('__proto__', 'constructor', 'unknown', '0', ''), v: odd() }),
  fc.record({ kind: fc.constant('swap'), pick: fc.nat(500), pick2: fc.nat(500) }),
);

/** In the page: store a mutated copy of a good save, load it. Returns null or a message */
async function saveCase(mut) {
  const S = engine.saves, P = () => { const p = engine.player?.position; return p ? [p.x, p.y, p.z] : null; };
  const snap = () => JSON.stringify({ p: P(), f: engine.vars.flags, c: engine.vars.counters, w: [...engine.world.records.keys()].sort(), r: engine.random.state });
  if (!S._json.get('fz-good')) { engine.step(0.5, { describe: false }); await S.save('fz-good'); }
  engine.error = null; engine.stacks.get('freeze').release('error');
  if (!(await S.load('fz-good'))) return 'the good save does not load';
  const raw = S._json.get('fz-good'), obj = JSON.parse(raw), paths = [];
  const walk = (o, path) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { paths.push([...path, k]); walk(o[k], [...path, k]); } };
  walk(obj, []);
  const at = (p, up = 0) => p.slice(0, p.length - up).reduce((o, k) => o[k], obj);
  let text;
  if (mut.kind === 'cut') text = raw.slice(0, Math.floor(raw.length * mut.at));
  else if (mut.kind === 'flip') { const i = Math.floor((raw.length - 1) * mut.at); text = raw.slice(0, i) + mut.ch + raw.slice(i + 1); }
  else {
    const p = paths[mut.pick % paths.length], last = p[p.length - 1], parent = at(p, 1);
    if (mut.kind === 'delete') Array.isArray(parent) ? parent.splice(+last, 1) : delete parent[last];
    else if (mut.kind === 'replace') parent[last] = mut.v;
    else if (mut.kind === 'addKey') { const target = parent[last] && typeof parent[last] === 'object' ? parent[last] : parent; Object.defineProperty(target, mut.k, { value: mut.v, enumerable: true, writable: true, configurable: true }); }
    else if (mut.kind === 'swap') { const q = paths[mut.pick2 % paths.length], pa = at(q, 1), a = parent[last]; parent[last] = pa[q[q.length - 1]]; pa[q[q.length - 1]] = a; }
    text = JSON.stringify(obj);
  }
  await S._put('fz-bad', text, Date.now());
  const goodText = S._json.get('fz-good'), before = snap(), t0 = performance.now();
  let reason, ok, threw = null;
  try { reason = S.check('fz-bad'); } catch (e) { return `check() threw: ${e.message}`; }
  try { ok = await Promise.race([S.load('fz-bad'), new Promise((_, rej) => setTimeout(() => rej(new Error('load hung for 5 s')), 5000))]); } catch (e) { threw = e; }
  const after = snap(), errored = engine.error, held = engine.stacks.get('freeze').names();
  const note = `(${mut.kind}, check: ${reason}, ok: ${ok})`;
  engine.error = null; engine.stacks.get('freeze').release('error');
  if (threw) return `load threw instead of returning false ${note}: ${threw.message}`;
  if (S._json.get('fz-good') !== goodText) return `a load changed another stored save ${note}`;
  if (held.includes('threedog:load')) return `the load freeze stayed on ${note}`;
  if (errored && !ok) return `a refused load left a gameplay error: ${errored.message} ${note}`;
  if (ok === false && after !== before) return `load returned false but the game changed ${note}\n   before ${before}\n   after  ${after}`;
  if (ok === true && reason != null) return `load succeeded where check() said '${reason}' ${note}`;
  const p = P(); if (p && !p.every(Number.isFinite)) return `the loaded player position is not finite: ${p} ${note}`;
  try { engine.step(0.2, { describe: false }); } catch (e) { return `stepping after a ${ok ? 'good' : 'refused'} load threw: ${e.message} ${note}`; }
  if (performance.now() - t0 > 20000) return 'too slow';
  return null;
}

// ---- applyState: parameters from a URL are strings, from a game anything ----
const stateValue = () => fc.oneof(fc.string({ maxLength: 12 }), fc.double(), fc.integer(), fc.boolean(), fc.constant(null), fc.constantFrom('18:30', '25:99', '-1', '1e999', 'NaN', '40,-20', ',', '1,2,3', 'rain', 'skip', 'home', '__proto__'),
  fc.record({ x: fc.double(), z: fc.double() }), fc.array(fc.double(), { maxLength: 3 }));
const stateParams = () => fc.dictionary(fc.constantFrom('time', 'season', 'weather', 'pos', 'at', 'save', 'wait', 'cutscene', 'view', 'play', 'state', 'unknownKey', 'Time', '__proto__'), stateValue(), { maxKeys: 4 });

async function stateCase(params) {
  // fresh deletes saves and is a different promise (own item below); wait is capped so one case stays fast
  const p = { ...params }; delete p.fresh; if (p.wait != null && !(+p.wait < 5)) delete p.wait;
  engine.error = null; engine.stacks.get('freeze').release('error');
  const t0 = performance.now();
  let r, threw = null;
  try { r = await Promise.race([engine.applyState(p), new Promise((_, rej) => setTimeout(() => rej(new Error('applyState hung for 8 s')), 8000))]); } catch (e) { threw = e; }
  const pos = engine.player?.position, bad = [];
  if (threw && !(threw.code || /applyState|state|expected|unknown|takes/i.test(threw.message))) bad.push(`threw an uncoded, unexplained error: ${threw.message}`);
  if (!threw && !(r && r.ok !== undefined && Array.isArray(r.refused))) bad.push(`resolved to ${JSON.stringify(r)} instead of { ok, refused }`);
  if (!threw && r.ok === false && !r.refused.length) bad.push('ok:false with nothing refused');
  if (pos && ![pos.x, pos.y, pos.z].every(Number.isFinite)) bad.push(`the player is at a non-finite position ${[pos.x, pos.y, pos.z]}`);
  if (engine.error && !threw) bad.push(`left a gameplay error: ${engine.error.message}`);
  try { engine.step(0.1, { describe: false }); } catch (e) { bad.push(`stepping afterwards threw: ${e.message}`); }
  engine.error = null; engine.stacks.get('freeze').release('error');
  return bad.length ? bad.join('; ') + `  (threw: ${threw?.message ?? 'no'}; result ${JSON.stringify(r)})` : null;
}

// ---- random input orders: keys, clicks, pause, menus, dialogue, in any order ----
const KEYS = ['Escape', 'Enter', 'KeyE', 'Space', 'KeyW', 'KeyA', 'ArrowUp', 'ArrowDown', 'Tab', 'KeyI', 'KeyP', 'KeyM'];
const inputStep = () => fc.oneof(
  { arbitrary: fc.record({ t: fc.constant('key'), k: fc.constantFrom(...KEYS), hold: fc.integer({ min: 0, max: 3 }) }), weight: 6 },
  { arbitrary: fc.record({ t: fc.constant('click'), x: fc.integer({ min: -50, max: 1400 }), y: fc.integer({ min: -50, max: 900 }) }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('open'), what: fc.constantFrom('pause', 'inventory', 'settings', 'title', 'nosuch') }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('close'), what: fc.constantFrom('pause', 'inventory', 'settings', 'title', 'nosuch') }), weight: 2 },
  { arbitrary: fc.record({ t: fc.constant('frames'), n: fc.integer({ min: 1, max: 6 }) }), weight: 3 },
  { arbitrary: fc.record({ t: fc.constant('dialogue'), lines: fc.integer({ min: 0, max: 3 }), choices: fc.integer({ min: 0, max: 3 }) }), weight: 2 },
);

/** In the page: play the steps in order. After every step the game must still step, hold no freeze nobody owns, and a closed part must hold nothing */
async function inputCase(steps) {
  const E = engine, fz = E.stacks.get('freeze'), canvas = document.querySelector('canvas');
  const key = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
  const NAMES = ['pause', 'inventory', 'settings', 'title', 'nosuch'];
  if (!E.dialogue) E.use(threedogThreads.all.dialogue());
  E.dialogue.define('fz', { start: { text: 'hello', next: 'b' }, b: { text: 'pick', choices: [{ text: 'one', next: 'c' }, { text: 'two' }, { text: 'bye', next: 'start' }] }, c: { text: 'end' } });
  // every sequence starts from a fresh run with every part closed (shrinking needs independent cases)
  E.error = null; fz.release('error');
  E.dialogue.end(); for (const n of NAMES) try { E.ui.close(n); } catch { /* not a part */ }
  await E.session.newGame(); for (const n of NAMES) try { E.ui.close(n); } catch { /* not a part */ }
  const parts = () => NAMES.filter(n => { try { return E.ui.isOpen(n); } catch { return false; } });
  const log = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i], here = `step ${i} ${JSON.stringify(s)}`;
    log.push(s.t === 'key' ? s.k : s.t);
    try {
      if (s.t === 'key') { key('keydown', s.k); E.step(0.03 * (1 + s.hold), { describe: false }); key('keyup', s.k); }
      else if (s.t === 'click') { const el = document.elementFromPoint(s.x, s.y); el?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: s.x, clientY: s.y })); }
      else if (s.t === 'open') { try { E.ui.open(s.what); } catch (er) { if (!(er.code || /not a modal|ui-misuse|no part/i.test(er.message))) return `${here}: ui.open threw an unexplained ${er.message}`; } }
      else if (s.t === 'close') E.ui.close(s.what);
      else if (s.t === 'frames') E.step(0.05 * s.n, { describe: false });
      else if (s.t === 'dialogue') { E.dialogue.start('fz'); for (let k = 0; k < s.lines + s.choices; k++) { if (!E.dialogue.active) { E.ops.run('dialogue.choose', { index: 0 }, { source: 'test' }); break; } E.dialogue._finishTyping(); if (k >= s.lines) E.ops.run('dialogue.choose', { index: k % 3 }, { source: 'test' }); else E.dialogue._advance?.(); } }
      E.step(0.02, { describe: false });
    } catch (er) { return `${here}: threw ${er.message}`; }
    if (E.error) { const m = E.error.message; E.error = null; fz.release('error'); return `${here}: raised a gameplay error: ${m}`; }
  }
  // the end: close everything the sequence opened; then nothing may still hold the game (a freeze left behind = a silent hang)
  E.dialogue.end(); for (const n of parts()) E.ui.close(n);
  E.step(0.1, { describe: false });
  const held = fz.names().filter(n => n !== 'threedog:test');
  if (held.length) return `after closing everything, the game is still held by: ${held.join(', ')} (steps: ${log.join(' ')})`;
  const left = (E.input._stack ?? []).filter(c => !String(c.name ?? c).startsWith('win-'));   // win-*: a panel window the click opened on purpose
  if (left.length > 1) return `input contexts left behind: ${JSON.stringify(left.map(c => c.name ?? c))}`;
  const p = E.player?.position; if (p && ![p.x, p.y, p.z].every(Number.isFinite)) return `player position is not finite: ${[p.x, p.y, p.z]}`;
  return null;
}

export const specs = [
  {
    name: 'Fuzz regressions: shrunk cases the fuzz found stay fixed [guard]',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const S = engine.saves, out = {};
        engine.step(0.5, { describe: false });
        await S.save('fzr-good');
        const edit = async (to, fn) => { const s = JSON.parse(S._json.get('fzr-good')); fn(s); await S._put(to, JSON.stringify(s), Date.now()); };
        const clear = () => { out.err = out.err || engine.error?.message; engine.error = null; engine.stacks.get('freeze').release('error'); };
        // 1. a 'scene' part that is not { set, removed } threw a code error (frozen gameplay); it is a damaged save: refused, rolled back
        await edit('fzr-scene', s => { s.parts.scene = { set: 5, removed: 'x' }; });
        out.scene = { ok: await S.load('fzr-scene'), err: engine.error?.message }; clear();
        // 2. a record whose jump is a number (the character writes its jump state into the record in place) threw in saveMotion
        await edit('fzr-jump', s => { s.parts.world.records.player.jump = 0.15; s.parts.world.records.player.safe = 5; });
        const w = await __t.warns(async () => {
          out.jump = { ok: await S.load('fzr-jump'), err: engine.error?.message };
          try { engine.step(0.3, { describe: false }); } catch (e) { out.jump.step = e.message; }
        });
        out.jump.err ??= engine.error?.message; clear();
        out.jumpWarns = w.warns.filter(m => /character motion/.test(m));   // the repair is reported, naming the field (warnOnce: the first time in a page)
        // 3. a far position (pos z = -3.6e178 from a URL): the chunk loops never advanced and the page froze for good. Now a coded refusal, and the game goes on
        out.far = {};
        try { engine.player.placeAt({ x: 1e-227, z: -3.6e178 }); out.far.placed = true; } catch (e) { out.far.code = e.code; }
        try { engine.step(0.2, { describe: false }); out.far.stepped = true; } catch (e) { out.far.step = e.message; }
        const fp = engine.player.position; out.far.finite = [fp.x, fp.y, fp.z].every(Number.isFinite) && Math.abs(fp.z) < 1e9;
        // 4. a world record whose motion is a number (FC_SEED=777): the fixed step threw "Cannot create property 'vx' on number" and froze the game. Refused at load
        await edit('fzr-motion', s => { s.parts.world.records.player.motion = 25; });
        out.motion = { ok: await S.load('fzr-motion'), err: engine.error?.message };
        try { engine.step(0.3, { describe: false }); } catch (e) { out.motion.step = e.message; }
        out.motion.err ??= engine.error?.message; clear();
        return out;
      });
      check('[guard] a world record with a number as its motion is refused at load (load false), and the fixed step raises no gameplay error', r.motion.ok === false && !r.motion.err && !r.motion.step, JSON.stringify(r.motion));
      check('[guard] a damaged scene part is refused: load false, no gameplay error', r.scene.ok === false && !r.scene.err, JSON.stringify(r.scene));
      check('[guard] a record with a number where the jump state goes loads and steps without a gameplay error', !r.jump.err && !r.jump.step, JSON.stringify(r.jump));
      check('[guard] a record with a bad jump / safe is reported once, naming the field, and the game keeps running', r.jumpWarns.length >= 1 && r.jumpWarns.some(m => /'jump'/.test(m)), JSON.stringify(r.jumpWarns));
      check('[guard] a position far past float precision is refused with a code (no freeze), the game steps on and the player stays put', !!r.far.code && !r.far.placed && r.far.stepped && r.far.finite, JSON.stringify(r.far));
    },
  },
  {
    name: 'Fuzz: random orders of keys, clicks, pause / menu open and close, and dialogue steps never raise a gameplay error and leave no freeze behind once everything is closed',
    software: false,
    url: PAGE,
    timeout: 240000,
    async run({ check, ev }) {
      await prop(check, 'random input orders', fc && fc.array(inputStep(), { maxLength: 25 }), steps => ev(inputCase, steps));
    },
  },
  {
    name: 'Fuzz: corrupt, truncated and mutated saves are refused (load false, check() says why) or load clean; the game never changes on a refusal, never freezes, never hangs',
    url: PAGE,
    timeout: 240000,
    async run({ check, ev }) {
      await prop(check, 'any mutation of a good save', fc && fc.array(saveMutation(), { minLength: 1, maxLength: 1 }), ([m]) => ev(saveCase, m));
    },
  },
  {
    name: 'Fuzz: applyState with random keys and values (strings as a URL gives them, numbers, NaN, objects) returns { ok, refused } or throws a named error; the player stays at a finite place',
    url: PAGE,
    timeout: 240000,
    async run({ check, ev }) {
      await prop(check, 'random applyState parameters', fc && stateParams(), p => ev(stateCase, p));
    },
  },
];

