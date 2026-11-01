// Command execution layer: shared by the dev bridge command line (threedog describe|step|press…) and future scenario tests.
// It depends on a single driver: { evaluate(src, arg), screenshot(), reload?() }
//   evaluate(src, arg)  run function source src (a string) in the page with arg, returning its JSON result (it may be async)
//   screenshot()        returns a PNG Buffer
//   reload()            optional: reload the page and wait for the engine to be ready (without it, location.reload inside evaluate)
// The dev bridge's driver forwards these three to the dev server; a scenario test implements the same three with Playwright's page.
//
// run(driver, command, args array, { dir }) → { ok, text }. text is English, at most 3 lines, read directly by the AI.
// Functions executed in the page must be self-contained (sent via toString()); the 3rd argument brief is injected by page().
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ev, evAttached, KEY } from './pageFns.mjs';
import { saveSnapshot, compareSnapshot } from '../describe-snapshot.mjs';
import { hintFor } from 'threedog/error-hints';
import { errorsCommand } from './errorlog.mjs';
const num = (s, name) => {
  const n = parseFloat(s);
  if (!(n > 0)) throw new Error(`${name} must be a positive number, e.g. threedog ${name === 'seconds' ? 'step 2' : '…'}`);
  return n;
};
const lines = (s, n = 3) => String(s).split('\n').slice(0, n).join('\n');
const MAX = 500;   // default output cap (characters); add --max N for more

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
    else if (args[i] === '--since') opt.since = args[++i];
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
  errors: 'page errors with id, time, tick, source and count: errors = new since the last read; errors latest [N] = the last N, repeatable; errors --since E5 = after id 5 (known classes come with the cause and the doc page)',
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
  const c = v.counts, head = v.done
    ? `${v.ok ? '✓' : '✗'} Loading finished${ready ? '' : ' (start() not finished)'}, ${c.done}/${c.total} ok${c.failed ? `, ${c.failed} failed` : ''}`
    : `… ${v.blocked ? 'BLOCKED, ' : ''}waiting: ${v.waiting} (${c.pending} pending, ${c.done}/${c.total} done)`;
  const fail = v.failed.map(f => `${f.critical ? '✗ critical' : '! fell back'} ${f.kind} "${f.name}" ${f.error.url ?? ''} ${f.error.message}`
    + (f.fallback ? ` -> ${f.fallback}` : ''));
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
      if (stray && /^-?[\d.]+$/.test(stray)) throw new Error(`"${stray}" is a stray number: in PowerShell a comma splits the argument, `
        + 'so quote coordinates, e.g. "pos=1,-8"');
      const params = Object.fromEntries(rest.map(kv => {
        const i = kv.indexOf('=');
        if (i < 1) throw new Error(`arguments must be key=value, e.g. time=18:30 (got "${kv}")`);
        return [kv.slice(0, i), kv.slice(i + 1)];
      }));
      if (params.pos !== undefined && !/^-?[\d.]+,-?[\d.]+$/.test(params.pos)) throw new Error(`pos must be two numbers x,z (got "${params.pos}"). `
        + 'In PowerShell quote the comma: threedog state "pos=1,-8"');
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
      const brief = lines(await ev(driver, 'brief', {}), 2);
      return { ok: true, text: `✓ Screenshot .threedog/shots/${name}.png (${(png.length / 1024).toFixed(0)} KB)\n` + brief };
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
    case 'errors': return errorsCommand(dir, rest, opt);
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
      if (!task) throw new Error(`No loading task named "${rest[0]}"; `
        + 'threedog loading lists pending and failed ones (manifest asset names, module names, track() names)');
      return { ok: task.phase !== 'failed', text: JSON.stringify(task, null, 1).slice(0, max) };
    }
    default:
      throw new Error(`No command "${cmd}". Available: ${Object.keys(COMMANDS).join(', ')}`);
  }
}
