// threedog report [--out file] [--scenario]: one file another AI can rerun a problem from. Engine version, seed, tick, describe(), recent ops, errors with hints, modules and
// capability state, the steps to reproduce, and a scenario derived from the ops. It reads what errors, describe, explain and catalog read; it keeps no record of its own.
// With no page attached it still writes what the files know (version, errors, installed modules) and says what is missing: it never opens a browser for this.
// What leaves the machine goes through scrub(): no tokens, no absolute user paths.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ENGINE, ROOT, rel } from '../paths.mjs';
import { pageAttached } from '../devinfo.mjs';
import { parseOptions } from '../lib/cli-args.mjs';
import { esc, gameCodeFiles, read } from '../lib/text.mjs';
import { installedCalls } from '../gamemap/text.mjs';
import { bridgeDriver } from './connect.mjs';
import { currentErrors, isError } from './errorlog.mjs';

/** Ops and errors kept: what led up to the problem, not the whole session */
const MAX_OPS = 30, MAX_ERRORS = 10, MAX_EXPLAINED = 3;
/** Op sources a scenario can run again. A 'game' op is one the game's own code runs: replayed, it would run twice */
const REPLAYED = ['player', 'bridge', 'test'];
const FIXED = 60;
const SECRET_KEY = /token|secret|passw|auth|cookie|api[-_]?key|credential/i;
const SECRET_PAIR = /\b(token|secret|password|passwd|api[-_]?key|auth)=[^&\s"']+/gi;
const BEARER = /\bBearer\s+[\w.~+/-]+=*/g;
const USER_PATH = /(?:[A-Za-z]:[\\/]+Users[\\/]+|\/(?:Users|home)\/)[^\\/\s"'()]+/g;

/** A folder as a regex that matches it with either slash and any case of letters (Windows paths come back both ways) */
const folderRe = p => new RegExp(esc(p.replace(/[\\/]+$/, '')).replace(/\\?[\\/]+/g, '[\\\\/]+'), 'gi');

/** A function that makes a value safe to hand over: secret keys emptied, secret pairs and absolute paths in strings replaced. Longest folder first, so a game inside the home folder reads <game> */
export function scrubber(folders) {
  const known = Object.entries(folders).filter(([, p]) => p).sort((a, b) => b[1].length - a[1].length).map(([name, p]) => [folderRe(p), `<${name}>`]);
  const text = s => {
    for (const [re, name] of known) s = s.replace(re, name);
    return s.replace(SECRET_PAIR, '$1=<removed>').replace(BEARER, 'Bearer <removed>').replace(USER_PATH, '<home>');
  };
  const walk = v => typeof v === 'string' ? text(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [text(k), SECRET_KEY.test(k) ? '<removed>' : walk(x)])) : v;
  return walk;
}

/** Runs in the page (sent as source, so self-contained) */
const pageFacts = async ([maxOps, maxExplained]) => {
  const e = window.engine, plain = v => JSON.parse(JSON.stringify(v ?? null)), all = e.ops.recent(), ops = all.slice(-maxOps);
  const refused = ops.filter(o => !o.ok && o.depth === 0).slice(-maxExplained).map(o => { try { return { op: o.name, args: o.args, why: e.explain({ op: o.name, args: o.args, actor: o.actor }).text }; } catch (err) { return { op: o.name, why: String(err) }; } });
  return plain({ url: location.pathname, seed: e.random.seed, tick: e.time.tick, run: e.runState.state, error: e.error ? String(e.error.message) : null, describe: e.describe(), ops, cut: all.length > ops.length,
    refused, catalog: e.catalog(), slots: e.saves.list() });
};

/**
 * A scenario verify can run, from the op history: the player's and the bridge's top-level ops with the time between them; a refused op expects its code again.
 * null with no such op. Ops a game's own code ran, or ones run inside another op, happen by themselves on the rerun.
 */
export function scenarioFrom(ops, url) {
  const steps = [];
  let tick = null;
  for (const o of ops) {
    if (o.depth > 0 || !REPLAYED.includes(o.source)) continue;
    if (tick !== null && o.tick > tick) steps.push({ step: Math.round((o.tick - tick) / FIXED * 1000) / 1000 });
    tick = o.tick;
    steps.push({ op: o.name, ...(Object.keys(o.args ?? {}).length && { args: o.args }), ...(o.actor && o.actor !== 'player' && { actor: o.actor }), ...(!o.ok && { expect: o.code }) });
  }
  return steps.length ? { name: 'report', url, state: {}, steps } : null;
}

/** The ordered steps to rerun it */
function reproduce(facts, game, scenario) {
  if (!facts) return [`threedog play${game}: no page was attached, so the ops and the state below are missing. Attach one and run threedog report again.`];
  return [`createEngine({ seed: ${facts.seed} }) in main.js, so engine.random gives the same numbers.`, `threedog play${game}, then threedog reload for a clean page at ${facts.url}.`,
    ...(scenario ? [`Save the "scenario" field as tests/scenarios/report.json (threedog report --scenario does) and run threedog verify report${game}.`] : ['No op to replay: follow the state in "state".']),
    `Compare with tick ${facts.tick} and the "errors" below; threedog explain answers why for one op or value.`];
}

/** The report as an object, every field already scrubbed */
export function buildReport({ version, facts, errors, installed, game = '' }, scrub) {
  const rows = Array.isArray(facts?.catalog) ? facts.catalog : [], scenario = facts ? scenarioFrom(facts.ops, facts.url) : null;
  return scrub({ format: 1, engine: { version }, page: facts ? { url: facts.url, seed: facts.seed, tick: facts.tick, run: facts.run, stoppedOn: facts.error } : null,
    steps: reproduce(facts, game, scenario), errors: errors.map(({ id, kind, tick, code, message, source, count, hint }) => ({ id: `E${id}`, kind, tick, code, message, source, count, hint })),
    refused: facts?.refused ?? [], ops: facts?.ops ?? [], modules: facts ? rows.filter(r => r.kind !== 'capability') : installed.map(id => ({ id, state: 'in the code, not read from a page' })),
    capabilities: rows.filter(r => r.kind === 'capability'), saves: facts?.slots ?? [], state: facts?.describe ?? null, scenario,
    notIncluded: [...(facts?.cut ? [`ops before the last ${MAX_OPS}: the scenario starts after them`] : []), 'the picture (threedog snap)', 'save contents (threedog can export a slot: engine.saves.exportFile)', 'real key timing: ops replay directly'] });
}

/** threedog report: writes the file and says where, in three lines */
export async function reportCommand(dir, args, { page } = {}) {
  const { opt } = parseOptions(args, { flags: ['scenario'], values: ['out'] });
  const driver = await pageAttached(dir) ? bridgeDriver(dir, { page }) : null;
  const facts = driver ? await driver.evaluate(pageFacts.toString(), [MAX_OPS, MAX_EXPLAINED]) : null;
  const errors = currentErrors(dir).slice(-MAX_ERRORS), game = dir === ROOT ? '' : ` -w ${rel(dir).split('/').pop()}`;
  const report = buildReport({ version: JSON.parse(readFileSync(join(ENGINE, 'package.json'), 'utf8')).version, facts, errors, game,
    installed: driver ? [] : installedCalls(gameCodeFiles(dir).map(read).join('\n')) }, scrubber({ game: dir, root: ROOT, engine: ENGINE, home: homedir() }));
  const file = resolve(dir, opt.out ?? `.threedog/reports/report-${facts ? 't' + facts.tick : 'no-page'}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(report, null, 1));
  const lines = [`✓ report: ${rel(file)} (${facts ? `tick ${facts.tick}, seed ${facts.seed}, ${report.ops.length} ops` : 'no page attached: no state, ops or seed'}, ${errors.filter(isError).length} errors)`];
  if (report.scenario && opt.scenario) {
    const out = join(dir, 'tests/scenarios/report.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report.scenario, null, 1));
    lines.push(`Scenario: threedog verify report${game}`);
  } else if (report.scenario) lines.push(`Scenario: ${report.scenario.steps.length} steps in the file; --scenario writes it for threedog verify`);
  return { ok: true, text: lines.join('\n'), data: { file: rel(file), scenario: !!report.scenario } };
}
