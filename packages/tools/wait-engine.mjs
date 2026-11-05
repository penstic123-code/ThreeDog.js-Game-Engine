// Wait for the engine in the page to be ready: the ONE wait of every tool that opens a game page in node (shot, gallery, capture, perf, npm test,
// pack checks). The dev bridge waits inside the page instead (threedog/pageFns.mjs READY), with the same fail-fast rule.
// A timeout does not just say "Timeout 90000ms exceeded": it waits in two stages and says the reason and fix for the one that failed.
//   Stage 1 (grace, 40 s by default): the page must have window.engine. An uncaught page error ends the wait at once, quoting the error with
//     the engine's own fix; only a page that threw nothing and has no engine gets the "window.engine = engine" hint.
//   Stage 2 (timeout): engine is attached, wait for its stateApplied / ready. A cold start with software rendering + world generation can take a minute, so this stage is long
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hintFor } from 'threedog/error-hints';
import { oneLine } from './lib/oneline.mjs';   // the engine's own fix text for a "[code]" message (plain data, public subpath)

// Uncaught page errors per page, recorded from the moment the page is made (newGamePage calls trackPageErrors).
// Why from creation and not from waitEngine: main.js runs during page.goto, so an error on its first lines (a missing module, a bad content file)
// fired before any waitEngine listener existed; the wait then sat out the whole grace and blamed a missing window.engine.
const uncaught = new WeakMap();
/** Start recording the page's uncaught errors (page errors and unhandled rejections; console.error is not fatal). Returns the live list. @param {import('playwright').Page} page */
export function trackPageErrors(page) {
  let list = uncaught.get(page);
  if (!list) { list = []; uncaught.set(page, list); page.on('pageerror', e => list.push(e)); }
  return list;
}

// Requests in flight per page (fetch, scripts, images, models; not websockets / event streams: those stay open). waitLoaded's quiet check reads it:
// game code after `await engine.start()` that awaits a model is invisible to the scene until the file arrives
const inflight = new WeakMap();
/** Start counting the page's open requests (newGamePage calls it). @param {import('playwright').Page} page */
export function trackRequests(page) {
  if (inflight.has(page)) return;
  const open = new Set();
  inflight.set(page, open);
  page.on('request', r => { if (!['websocket', 'eventsource'].includes(r.resourceType())) open.add(r); });
  for (const ev of ['requestfinished', 'requestfailed']) page.on(ev, r => open.delete(r));
}

/** The error that stopped the page, with its [code] and the engine's own fix text when the engine knows it (core/errorHints.js) */
function fatalText(e, when) {
  const head = String(e?.stack || e).split('\n').slice(0, 3).join('\n    '), h = hintFor(e?.message ?? e);
  return `the page threw ${when} (stopped waiting at once):\n    ${head}\n`
    + (h ? `  Fix [${h.id}]: ${h.cause}\n  Read: ${h.docs.join(', ')}` : '  Fix: the error above stops main.js; fix it first');
}

const FIX ='in main.js, before await engine.start(), write: window.engine = engine; (under the dev server engine.start() attaches it automatically, but npm test / the built version do not)';

/** The last few page errors: the errors array the caller collected, or .threedog/errors.log under dir (written by the dev server) */
function recentErrors(dir, errors) {
  if (errors?.length) return errors.slice(-3).map(s => '    ' + oneLine(s));
  const log = dir && join(dir, '.threedog/errors.log');
  if (!log || !existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n').filter(l => l.trim()).slice(-4).map(l => '    ' + l.slice(0, 160));
}

/**
 * @param {import('playwright').Page} page  best made with newGamePage (it records errors from creation); any other page is tracked from this call on
 * @param {{ field?: 'stateApplied'|'ready', timeout?: number, grace?: number, dir?: string, errors?: string[] }} [o]
 *   field: which engine field to wait for to be true; dir is where to find .threedog/errors.log; errors are the page errors the caller already collected
 */
export async function waitEngine(page, { field = 'stateApplied', timeout = 90000, grace = 40000, dir, errors } = {}) {
  const fail = async (why, fix) => {
    const s = await page.evaluate(() => ({ url: location.href, has: !!window.engine, ready: window.engine?.ready, applied: window.engine?.stateApplied })).catch(() => ({ url: page.url(), has: false }));
    const errs = recentErrors(dir, errors);
    throw new Error([`timed out waiting for the engine in the page: ${why}`,
      `  page ${s.url} · window.engine ${s.has ? 'attached' : 'missing'}${s.has ? ` · engine.ready=${s.ready} · stateApplied=${s.applied}` : ''}`,
      errs.length ? '  recent page errors:\n' + errs.join('\n') : '  no page errors recorded',
      '  Fix: ' + fix].join('\n'));
  };
  const seen = trackPageErrors(page);
  // the first uncaught error at index >= from, polled from the shared list (errors from before this call count too); null when `wait` wins
  let timer;
  const thrown = from => new Promise(res => { const look = () => (seen.length > from ? res(seen[from]) : (timer = setTimeout(look, 50))); look(); });
  // the losing waitForFunction still rejects later (its timeout): caught here so it is not an unhandled rejection
  const race = async (wait, from) => { const w = wait.then(() => null); w.catch(() => {}); try { return await Promise.race([w, thrown(from)]); } finally { clearTimeout(timer); } };
  const has = f => page.evaluate(k => !!window.engine?.[k], f).catch(() => false);
  const g = Math.min(grace, timeout);
  // Stage 1. An uncaught error before window.engine exists almost always means main.js died: waiting out the grace only delays the same answer.
  // One last look for window.engine first: an unrelated script may throw while the game still starts.
  let err = null;
  try { err = await race(page.waitForFunction(() => !!window.engine, null, { timeout: g }), 0); }
  catch { await fail(`no window.engine on the page within ${Math.round(g / 1000)} s, and the page threw no error`, `${FIX}; or this page is not a game page (it creates no engine)`); }
  if (err && !(await page.evaluate(() => !!window.engine).catch(() => false))) throw new Error(fatalText(err, 'before window.engine existed'));
  // Stage 2. A critical asset that failed stops start() for good: stop waiting at once and say which file (engine.loading, core/Loading.js).
  // A new uncaught error here (start() rejected, a module threw while starting) also ends the wait, after one second's look whether the engine got ready anyway
  // Errors already seen count on a page not ready yet: the dev bridge calls this before every command, so an error from before the call (the page died at start)
  // was never "new", and each command sat out the whole timeout. On a ready page an old error means nothing, so only a new one is looked at
  err = null;
  const from = await has(field) ? seen.length : 0;
  try { err = await race(page.waitForFunction(f => window.engine?.[f] || window.engine?.loading?.view().blocked, field, { timeout }), from); }
  catch { await fail(`window.engine exists, but ${field} stayed falsy for ${Math.round(timeout / 1000)} s, and the page threw no error`,
    'engine.start() did not finish or is stuck: not calling await engine.start() has this effect' + (field === 'stateApplied' ? '; a very large wait= in the URL also waits long' : '')); }
  if (err) {
    await new Promise(r => setTimeout(r, 1000));
    if (!(await has(field)) && !(await page.evaluate(() => !!window.engine?.loading?.view().blocked).catch(() => false)))
      throw new Error(fatalText(err, `while the engine was starting (${field} never came)`));
  }
  const failed = await page.evaluate(() => (window.engine.loading?.view().blocked ? window.engine.loading.view().failed : null));
  if (failed) await fail(`start() is blocked: ${failed.map(f => `${f.kind} "${f.name}" ${f.error.url ?? ''} ${f.error.message}`).join('; ').slice(0, 300)}`,
    'fix the path or the file; if the game can run without it, remove critical: true from its manifest entry (threedog loading shows every failure)');
}

const QUIET_MS = 300, TAIL_MS = 10000;
/** How much is in the scene: what the quiet wait watches, and what a shot compares afterwards @param {import('playwright').Page} page */
export const sceneCounts = page => page.evaluate(() => {
  let objects = 0, lights = 0; const mats = new Set();
  window.engine.scene.traverse(o => { objects++; if (o.isLight) lights++; if (o.material) for (const m of [].concat(o.material)) mats.add(m); });
  return { objects, lights, materials: mats.size };
});
/**
 * Stop when the page refused a value this tool put in its URL (--weather rian): a URL has no caller to answer, and the page goes on in the game's default.
 * @param {import('playwright').Page} page @param {string[]} asked  the keys the user named: the tool's own (cutscene) are not theirs to hear about
 */
export async function refuseState(page, asked) {
  const refused = (await page.evaluate(() => engine.stateRefused)).filter(r => asked.includes(r.key));
  if (refused.length) throw new Error(`the page did not take ${refused.map(r => `${r.key}=${r.value} (${r.reason})`).join('; ')}: this would be a picture of something else`);
}

/**
 * After waitEngine: step (no render) until engine.loading.view().done, so a shot never shows a half-built world (terrain chunks, models still arriving).
 * Headless pages only advance on step, so waiting without stepping would never finish. Past timeout (wall ms) it throws naming what is still pending.
 * Then wait for the game's own code after `await engine.start()`: start() resolving says nothing about lamps added after a later await, and a shot
 * of that moment silently lacked them. Quiet = no request in flight and the scene's object / light / material counts unchanged for QUIET_MS
 * (no step meanwhile: only the page's own promises move). Capped at TAIL_MS (a page that never goes quiet is shot as it is, and says so).
 * → { tail: { ms, objects, lights, materials, quiet } }: how long the code after start() kept changing the scene, and by how much.
 * A game that adds things after a pause with no request in flight can still come after the quiet window: shot counts again once the picture is taken
 * @param {import('playwright').Page} page
 * @param {{ timeout?: number }} [o]
 */
export async function waitLoaded(page, { timeout = 120000 } = {}) {
  const end = Date.now() + timeout;
  while (!(await page.evaluate(() => {
    const done = window.engine.loading.view().done;
    if (!done) for (let i = 0; i < 4; i++) window.engine.step(1 / 30, { render: false, describe: false });
    return done;
  }))) {
    if (Date.now() > end) {
      const v = await page.evaluate(() => ({ ...window.engine.loading.view(), queued: window.engine.describe().perf?.chunks?.queued }));
      throw new Error(`loading did not finish within ${Math.round(timeout / 1000)} s, no screenshot taken: ${v.waiting}${v.queued ? `: ${v.queued} chunks queued` : ''}`
        + ` (${v.counts.pending} pending: ${v.pending.map(t => `${t.kind} ${t.name}`).join(', ').slice(0, 200)})
  Fix: a module that never reports ready, or raise --load-timeout if it is only slow`);
    }
    await new Promise(r => setTimeout(r, 16));   // yield so worker results come back between steps
  }
  const open = inflight.get(page) ?? new Set(), same = (a, b) => a.objects === b.objects && a.lights === b.lights && a.materials === b.materials;
  const t0 = Date.now(), first = await sceneCounts(page);
  let last = first, busy = open.size ? t0 : null;   // busy: the last moment a request was open or the counts moved
  while (Date.now() - (busy ?? t0) < QUIET_MS && Date.now() - t0 < TAIL_MS) {
    await new Promise(r => setTimeout(r, 50));
    const now = await sceneCounts(page);
    if (open.size || !same(now, last)) busy = Date.now();
    last = now;
  }
  return { tail: { ms: busy ? busy - t0 : 0, objects: last.objects - first.objects, lights: last.lights - first.lights, materials: last.materials - first.materials,
    quiet: Date.now() - (busy ?? t0) >= QUIET_MS } };
}
