// Scenario tests: a test written as data. <workspace>/tests/scenarios/<name>.json sets up the scene, runs ops, advances time and checks
// describe() paths or a describe snapshot. `threedog test` runs every file as an item named "scenario: <name>"; the dev bridge runs one with
// `threedog scenario <name>` on the running page. Why data: steps are ops (no key timing, no walking), so a scenario reads like a play-by-play
// an AI can write and diff, and a misspelt op fails before anything runs instead of halfway.
//   { "name": "barter", "url": "/", "state": { "pos": "@fisher", "cutscene": "skip" },
//     "steps": [
//       { "op": "barter.buy", "args": { "shop": "fisher-basket", "item": "berry" } },          // expect defaults to "ok"
//       { "op": "barter.buy", "args": { "shop": "fisher-basket", "item": "berry" }, "expect": "soldOut" },
//       { "step": 0.5 },                                                                         // advance game seconds
//       { "press": "interact" },                                                                 // the one key test: key -> op
//       { "expect": { "inventory.items.berry": 1, "ui.dialogue": null } },                      // describe() paths
//       { "snapshot": "after-barter", "only": ["inventory"] } ] }                                // describe snapshot (tests/snapshots)
// state is engine.applyState params; "pos": "@id" stands next to world record id. The page is halted first: time moves only in step / press.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { closest } from './lib/text.mjs';
import { expectDescribe } from './describe-snapshot.mjs';
import { run as command } from './threedog/commands.mjs';
import { READY, atPath } from './threedog/pageFns.mjs';

const TOP = ['name', 'url', 'state', 'steps', 'version'];   // version: optional, 1
const KINDS = { op: ['op', 'args', 'actor', 'expect'], step: ['step'], press: ['press'], state: ['state'], expect: ['expect'], snapshot: ['snapshot', 'only', 'ignore', 'tolerance'] };
const TOL = 0.01;

// ── Functions executed in the page (sent as source, so self-contained) ──
// the wait for the engine is pageFns READY (one poll for the commands and the scenarios)
async function pagePrepare(a, e) {
  e.haltLoop();
  const s = { ...a.state };
  if (typeof s.pos === 'string' && s.pos.startsWith('@')) {
    const rec = e.world?.get(s.pos.slice(1));
    if (!rec) throw new Error(`state.pos "${s.pos}": no world record with this id`);
    s.pos = { x: rec.position.x + 1, z: rec.position.z };   // 1 m beside it: inside a typical interaction radius
  }
  if (Object.keys(s).length) {
    const r = await e.applyState(s);
    if (!r.ok) throw new Error('scenario state not applied: ' + r.refused.map(x => `${x.key}=${x.value} (${x.reason})`).join('; '));
  }
  e.step(1 / 60, { render: false });
  return [...e.ops.defs.keys()];
}
function pageOp(a) {
  const e = window.engine, r = e.ops.run(a.op, a.args ?? {}, { source: 'test', ...(a.actor && { actor: a.actor }) });
  const why = r.ok ? '' : e.explain({ op: a.op, args: a.args ?? {}, actor: a.actor }).text;
  let value; try { value = JSON.parse(JSON.stringify(r.value ?? null)); } catch { value = String(r.value); }
  return { ok: r.ok, code: r.code ?? null, value, why };
}
const pageStep = a => { const e = window.engine; e.step(a.seconds, { render: false }); return e.error ? `the engine stopped on an error: ${e.error.message}` : null; };
const pageState = async a => (await window.engine.applyState(a.state)).refused;
/** A scenario on a state that was not reached proves nothing, so a refused key stops it */
const refusedText = (where, refused) => `${where}: state not applied: ` + refused.map(x => `${x.key}=${x.value} (${x.reason})`).join('; ');
const pageDescribe = () => JSON.parse(JSON.stringify(window.engine.describe()));

function same(got, want) {
  if (want === null) return got == null;
  if (typeof want === 'number' && typeof got === 'number') return Math.abs(got - want) <= TOL;
  return JSON.stringify(sorted(got)) === JSON.stringify(sorted(want));   // object key order does not matter
}
const sorted = v => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;

/** Check the file shape (ops = null) before the page is touched, then every op name once the page lists them; throws with the fix */
function lint(sc, ops, file) {
  const where = `scenario ${file}`;
  for (const k of Object.keys(sc)) if (!TOP.includes(k)) throw new Error(`${where}: unknown field "${k}"${hint(k, TOP)}. Fields: ${TOP.join(', ')}`);
  if (sc.version !== undefined && sc.version !== 1) throw new Error(`${where}: "version" ${sc.version} is not supported (this runner reads version 1)`);
  if (!Array.isArray(sc.steps) || !sc.steps.length) throw new Error(`${where}: "steps" must be a non-empty array, e.g. [{ "op": "shop.buy", "args": {...} }]`);
  sc.steps.forEach((s, i) => {
    const kind = Object.keys(KINDS).find(k => k in s), w = `${where} step ${i + 1}`;
    if (!kind) throw new Error(`${w}: a step needs one of ${Object.keys(KINDS).join(', ')}${hint(Object.keys(s)[0], Object.keys(KINDS))}`);
    for (const k of Object.keys(s)) if (!KINDS[kind].includes(k)) throw new Error(`${w}: unknown field "${k}" in a ${kind} step${hint(k, KINDS[kind])}. Fields: ${KINDS[kind].join(', ')}`);
    if (kind === 'op' && ops && !ops.includes(s.op)) throw new Error(`${w}: no op '${s.op}'${hint(s.op, ops)}. Defined: ${ops.join(', ') || 'none'}`);
    if (kind === 'step' && !(s.step > 0)) throw new Error(`${w}: "step" is game seconds > 0, e.g. { "step": 0.5 }`);
    if (kind === 'expect' && (typeof s.expect !== 'object' || !s.expect)) throw new Error(`${w}: "expect" maps describe paths to values, e.g. { "inventory.items.film": 11 }`);
  });
}
const hint = (name, list) => { const c = name && closest(name, list); return c ? ` (did you mean '${c}'?)` : ''; };

/**
 * Run one scenario through a driver ({ evaluate(src, arg) }, the same one the dev bridge commands use). Results go to check(label, ok, detail).
 * Stops at the first failed step: later steps build on it and would only repeat the failure.
 * Returns { layers }: per step that ran, which layer it exercised ('direct' = op / describe call, 'simulated-input' = bridge press event);
 * time steps and state changes check nothing and are not listed. Scenarios have no real-browser-input or pixel step, so those layers never appear here.
 * @param {{ evaluate(src: string, arg?: any): Promise<any> }} driver
 * @param {any} sc parsed scenario JSON
 * @param {{ check: (label: string, ok: boolean, detail?: string) => void, file?: string, snapDir?: string, onPrepared?: () => Promise<void> }} opts
 */
export async function runScenario(driver, sc, { check, file = sc.name, snapDir, onPrepared }) {
  const ev = (fn, arg) => driver.evaluate(fn.toString(), arg);
  lint(sc, null, file);   // a malformed file fails before the page state changes
  const ops = await ev(`async a => (${pagePrepare})(a, await (${READY})())`, { state: sc.state ?? {} });
  lint(sc, ops, file);
  await onPrepared?.();   // evidence takes its baseline here: scenario state applied, no step run yet
  const layers = [];
  for (const [i, s] of sc.steps.entries()) {
    const n = `${i + 1}. `;
    let ok = true;
    const layer = 'op' in s || 'expect' in s || 'snapshot' in s ? 'direct' : 'press' in s ? 'simulated-input' : null;
    if (layer) layers.push({ step: i + 1, layer });
    if ('op' in s) {
      const want = s.expect ?? 'ok', r = await ev(pageOp, s), got = r.ok ? 'ok' : r.code;
      ok = got === want;
      check(`${n}${s.op} ${JSON.stringify(s.args ?? {})} -> ${want}`, ok, `got ${got}${r.why ? ': ' + r.why : ''}`);
    } else if ('step' in s) { const why = await ev(pageStep, { seconds: s.step }); ok = !why; if (!ok) check(`${n}step ${s.step}`, false, why); }
    else if ('press' in s) { const r = await command(driver, 'press', [String(s.press)]); ok = r.ok; if (!ok) check(`${n}press ${s.press}`, false, r.text); }
    else if ('state' in s) { const refused = await ev(pageState, { state: s.state }); ok = !refused.length; if (!ok) check(`${n}state`, false, refusedText('state', refused)); }
    else if ('expect' in s) {
      const d = await ev(pageDescribe);
      for (const [path, want] of Object.entries(s.expect)) {
        const got = atPath(d, path), good = same(got, want);
        ok &&= good;
        check(`${n}${path} = ${JSON.stringify(want)}`, good, `got ${JSON.stringify(got) ?? 'nothing'}`);
      }
    } else {
      const { snapshot, ...o } = s;
      let good = true;
      await expectDescribe({ check: (l, g, dt) => { good = g; check(n + l, g, dt); }, ev }, snapshot, { ...o, dir: snapDir });
      ok = good;
    }
    if (!ok) break;
  }
  return { layers };
}

/** Scenario files of a workspace (tests/scenarios/*.json) */
export function scenarioFiles(dir) {
  const d = join(dir, 'tests', 'scenarios');
  return existsSync(d) ? readdirSync(d).filter(f => f.endsWith('.json')).sort().map(f => join(d, f)) : [];
}
export const readScenario = f => JSON.parse(readFileSync(f, 'utf8'));

/** Playwright page as a driver (same shape as the dev bridge driver) */
export const pageDriver = page => ({
  evaluate: (src, arg) => page.evaluate(([s, a]) => (0, eval)('(' + s + ')')(a), [src, arg]),
  screenshot: () => page.screenshot(),
});

/** One test item per scenario file, for the test runner (run.mjs) */
export const scenarioSpecs = dir => scenarioFiles(dir).map(f => {
  const sc = readScenario(f), file = basename(f);
  return { name: `scenario: ${sc.name ?? file}`, url: sc.url ?? '/', run: ({ page, check }) => runScenario(pageDriver(page), sc, { check, file, snapDir: join(dir, 'tests', 'snapshots') }) };
});
