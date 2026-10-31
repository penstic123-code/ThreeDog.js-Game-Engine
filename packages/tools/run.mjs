// One-shot test: npm test
// For each workspace (engine package + games/*; in a game's own repo, the game): build, open the pages and test pages in a headless browser, and
//   check item by item. Run it after changing code to see whether anything else broke.
//   Engine package: packages/engine/tests/specs.mjs (example pages + per-module test pages)
//   Games:          use tests/specs.mjs if present; otherwise a smoke test (every page opens, the engine is ready, no console errors)
//
// Install the browser once before first use: npx playwright install chromium
//   npm test                          all workspaces
//   npm test -- city settings         only test items whose names contain these words (searched across all workspaces); no match is a failure
//   npm test -- -w my-farm            one workspace only (also npm test -w games/my-farm, or run npm test inside the game directory)
// Adding tests: for the engine, add an item in packages/engine/tests/specs.mjs following the existing ones; for a game, write it in
//   <game>/tests/specs.mjs (export a specs array, same format). Tests written as data: <workspace>/tests/scenarios/*.json (scenario.mjs).
// A spec may set timeout (ms, default 120000); one stuck spec fails with "timed out" instead of stalling the suite.
// Page helpers every spec can use inside ev(): __t.warns(fn) → { value, warns } (console.warn lines during fn, sync or async, ops-guard
//   reminders about test setup left out), __t.frames(n), __t.until(cond, ms).
process.env.THREEDOG_TEST = '1';
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packTest } from './pack-test.mjs';
import { waitEngine } from './wait-engine.mjs';
import { scenarioSpecs } from './scenario.mjs';
import { launchBrowser, newGamePage, buildAndPreview, withTimeout } from './browser.mjs';
import { nearest } from './lib/text.mjs';
import { ENGINE, ENGINE_SPECS, TOOLS, ROOT, MODE, workspaces, workspaceOf, findWorkspace, rel } from './paths.mjs';

const SPEC_TIMEOUT = 120000;
const tSuite = Date.now();
// ops guard reminders seen in any page (gameplay state written outside fixed steps and ops), unique, listed in .threedog/ops-guard.log
const guardSeen = new Map();

/** Page-side test helpers (installed before any page script runs) */
function pageHelpers() {
  const GUARD = /outside a fixed step or an op/;
  window.__t = {
    async warns(fn) {
      const warns = [], orig = console.warn;
      console.warn = (...a) => { const m = a.map(String).join(' '); if (!GUARD.test(m)) warns.push(m); };
      try { return { value: await fn(), warns }; } finally { console.warn = orig; }
    },
    frames: (n = 2) => new Promise(r => { let k = 0; const h = window.engine.onFrame(() => { if (++k >= n) { h.remove(); r(); } }); }),
    async until(cond, ms = 10000) {
      const end = performance.now() + ms;
      while (performance.now() < end) { const v = await cond(); if (v) return v; await new Promise(r => setTimeout(r, 20)); }
      throw new Error(`__t.until: condition not met within ${ms} ms: ${String(cond).slice(0, 80)}`);
    },
  };
}

// Which workspaces to test: -w > the workspace of the current directory > all
const argv = process.argv.slice(2);
let targets = workspaces();
const wi = argv.findIndex(a => a === '-w' || a === '--workspace');
if (wi >= 0) {
  let dir;
  try { dir = findWorkspace(argv[wi + 1]); } catch (e) { console.error(e.message); process.exit(1); }
  if (!dir) { console.error(`workspace "${argv[wi + 1]}" not found. Available: ${targets.map(rel).join(', ')}`); process.exit(1); }
  targets = [dir]; argv.splice(wi, 2);
} else {
  const here = workspaceOf(process.cwd());
  if (here && targets.includes(here)) targets = [here];
}
if (!targets.length) { console.error(`✗ no workspace to test under ${ROOT} (a game needs package.json and main.js)`); process.exit(1); }
const only = argv.filter(a => !a.startsWith('-'));
const match = name => !only.length || only.some(o => name.includes(o));
// --update-snapshots: tests that use expectDescribe (describe-snapshot.mjs) write their baselines instead of comparing
if (argv.includes('--update-snapshots')) process.env.THREEDOG_UPDATE_SNAPSHOTS = '1';

/** Smoke test when a game has no specs: one item per page */
const smokeSpecs = dir => readdirSync(dir).filter(f => f.endsWith('.html')).sort().map(f => ({
  name: `smoke: ${basename(dir)} ${f === 'index.html' ? '/' : '/' + f}`,
  url: f === 'index.html' ? '/' : '/' + f,
  async run({ check, ev }) {
    check('engine started, URL parameters applied, modules installed', await ev(() => !!engine.stateApplied && engine.modules.size > 0));
  },
}));
async function specsOf(dir) {
  const file = dir === ENGINE ? ENGINE_SPECS : join(dir, 'tests', 'specs.mjs');
  // scenario tests (tests/scenarios/*.json, see scenario.mjs) join the workspace's own items
  return [...(existsSync(file) ? (await import(pathToFileURL(file).href)).specs : smokeSpecs(dir)), ...scenarioSpecs(dir)];
}

let pass = 0, fail = 0, ran = 0;
const seenNames = [];
/** Print one item's results and add them to the totals */
function report(name, results, t0, extra = '') {
  const bad = results.filter(r => !r.ok);
  console.log(`\n${bad.length ? '✗' : '✓'} ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s${extra})`);
  for (const r of results) console.log(`   ${r.ok ? '✓' : '✗'} ${r.label}${r.detail && !r.ok ? '  → ' + r.detail : ''}`);
  pass += results.length - bad.length; fail += bad.length; ran++;
}
const collect = () => { const results = []; return { results, check: (label, ok, detail = '') => results.push({ label, ok: !!ok, detail }) }; };

// Plan first (no browser yet), so a filter that matches nothing fails at once with the closest names
const plan = [];   // [dir, specs to run]
for (const dir of targets) { const all = await specsOf(dir); seenNames.push(...all.map(s => s.name)); plan.push([dir, all.filter(s => match(s.name))]); }
// The tools' own tests (need a dev server and the like, not part of any workspace): packages/tools/tests/*.mjs, exporting { name, async run({ check,
//   browser }), optIn? }. Only in the monorepo, and not with -w or inside a game directory. optIn: slow tests that run only when named
const TOOL_TESTS = join(TOOLS, 'tests'), toolTests = [];
if (MODE === 'monorepo' && targets.length === workspaces().length && existsSync(TOOL_TESTS)) for (const f of readdirSync(TOOL_TESTS).filter(f => f.endsWith('.mjs')).sort()) {
  const t = await import(pathToFileURL(join(TOOL_TESTS, f)).href);
  seenNames.push(t.name);
  if (match(t.name) && (!t.optIn || only.some(o => t.name.includes(o)))) toolTests.push(t);
}
const packs = targets.filter(d => d !== ENGINE).map(d => [d, `pack: ${rel(d) || basename(d)}`]);
seenNames.push(...packs.map(p => p[1]));
if (only.length && !plan.some(p => p[1].length) && !toolTests.length && !packs.some(p => match(p[1]))) {
  console.log(`\n✗ no test name contains ${only.map(o => `"${o}"`).join(' or ')}. Close: ${only.flatMap(o => nearest(o, seenNames, 3)).map(n => `"${n}"`).join(', ') || '(none)'}`);
  console.log(`\nTotal: 0 items matched, failed (${((Date.now() - tSuite) / 1000).toFixed(1)} s)`);
  process.exit(1);
}

const browser = await launchBrowser();
try {
  for (const [dir, list] of plan) {
    if (!list.length) continue;
    process.env.THREEDOG_SNAP_DIR = join(dir, 'tests', 'snapshots');   // where this workspace's describe baselines live
    console.log(`\n━━ ${rel(dir) || basename(dir)}: building…`);
    const server = await buildAndPreview(dir);
    try {
      for (const spec of list) {
        const errors = [];
        // tests assert zh-CN strings; the engine default 'auto' follows this locale
        const page = await newGamePage(browser, { errors, locale: 'zh-CN' });
        await page.addInitScript(pageHelpers);
        page.on('console', m => {
          if (m.type() !== 'warning' || !m.text().includes('outside a fixed step or an op')) return;
          const k = m.text().split('\n')[0];
          // test scripts setting up state are not game code
          if (!guardSeen.has(k) && !k.includes('eval at evaluate')) guardSeen.set(k, `${rel(dir)} · ${spec.name}`);
        });
        const { results, check } = collect();
        const t0 = Date.now();
        let startup = null;
        try {
          await withTimeout((async () => {
            await page.goto(server.base + spec.url);
            await waitEngine(page, { timeout: 60000, errors });
            startup = await page.evaluate(() => engine.startup);
            // frames(n): wait for the engine's loop to run n more frames (a key press is read on the next frame; software rendering is slow,
            //   so waiting by frames is more reliable than by milliseconds)
            const frames = (n = 2) => page.evaluate(n => window.__t.frames(n), n);
            await spec.run({ page, check, frames, ev: (fn, arg) => page.evaluate(fn, arg), wait: ms => page.waitForTimeout(ms) });
          })(), spec.timeout ?? SPEC_TIMEOUT, 'spec');
        } catch (e) { check('run error', false, String(e).split('\n')[0]); }
        // spec.expectErrors (regex): errors this test deliberately provokes (such as the error-level test); matches do not count
        const unexpected = spec.expectErrors ? errors.filter(m => !spec.expectErrors.test(m)) : errors;
        check('no console errors', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));
        // Startup timing: open to playable / start() to playable, slowest modules
        const slow = startup && Object.entries(startup.modules).map(([n, t]) => [n,
          (t.init ?? 0) + (t.ready ?? 0)]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n, t]) => `${n} ${t}`).join(', ');
        report(spec.name, results, t0, startup ? `; startup ${startup.totalMs}/${startup.startMs} ms, slowest ${slow || '-'}` : '');
        await page.close().catch(() => {});
      }
    } finally { await server.close(); }
  }
  for (const { name, run } of toolTests) {
    const { results, check } = collect(), t0 = Date.now();
    try { await run({ check, browser }); } catch (e) { check('run error', false, String(e).split('\n')[0]); }
    report(name, results, t0);
  }
  // Works after packaging: each game is built for production once and started from dist only (see pack-test.mjs); the name contains "pack"
  for (const [dir, label] of packs) {
    if (!match(label)) continue;
    console.log(`\n━━ ${rel(dir) || basename(dir)}: production build + serving dist…`);
    const t0 = Date.now();
    const { name, results } = await packTest(dir, browser);
    report(name, results, t0);
  }
} finally { await browser.close(); }

if (guardSeen.size) {
  mkdirSync(join(ROOT, '.threedog'), { recursive: true });
  writeFileSync(join(ROOT, '.threedog/ops-guard.log'), [...guardSeen].map(([k, v]) => `${k}\n    in ${v}`).join('\n') + '\n');
  console.log(`\nops guard: ${guardSeen.size} places change gameplay state outside fixed steps and ops (list: .threedog/ops-guard.log)`);
}
const took = (Date.now() - tSuite) / 1000;
const time = took >= 90 ? `${(took / 60).toFixed(1)} min` : `${took.toFixed(1)} s`;
console.log(`\nTotal: ${pass + fail} checks in ${ran} items, ${pass} passed, ${fail} failed (${time})`);
process.exit(fail ? 1 : 0);
