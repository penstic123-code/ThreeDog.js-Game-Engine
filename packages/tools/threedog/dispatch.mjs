// One entry for every bridge command, used by both the command line (cli.mjs) and the MCP server (mcp.mjs), so they cannot drift apart.
//   execute(dir, cmd, args, { page, onShot }) → { ok, summary, runtime, data, text }
//     ok       the command's own verdict (also the CLI exit code)
//     code     stable: ok | blocked | not-ready | no-server | starting | page-error | no-bridge | command-error (see the comment where it is set)
//     summary  one sentence: the first line of text without its ✓ / ✗
//     runtime  { ready, mode: 'running' | 'paused' | 'frozen' | null, tick, headless, blockedBy[] } read right after the command (runtime.mjs)
//     data     structured payload where there is one (errors, status, verify, a described path); otherwise null
//     text     what the CLI prints and the MCP text content carries: the command's lines, then one line saying the state and the way back to normal.
//              Plain-data outputs (eval / js, describe with a path or --full / --all) get no state line, so their text stays parseable; runtime still has it.
import { run, COMMANDS } from './commands.mjs';
import { bridgeDriver, devServer, errorText } from './connect.mjs';
import { diagnose } from './diagnose.mjs';
import { readRuntime, trailer, NONE } from './runtime.mjs';
import { play, status } from './play.mjs';
import { verify, scenarioReport } from './verify.mjs';
import { pictureCommand } from './picture-cmd.mjs';

/** Commands outside commands.mjs: they work (or explain why not) without a running page */
export const EXTRA = {
  play: 'start the game for the AI: starts the dev server if none runs, waits for the bridge and the engine, prints the page address (play --stop stops it)',
  status: 'is it ready: engine ready / loading / page errors / paused or frozen, or which of four causes keeps the bridge from answering',
  'picture-palette': 'measure a reference picture, no game needed: picture-palette art/reference/ref.png [--n 8] [--average] [--ignore-ui] [--region x,y,w,h] (same as threedog picture palette)',
  'picture-compare': 'numbers for two pictures, no game needed: picture-compare ref.png .threedog/shots/snap.png [--region x,y,w,h] [--out side.png] (same as threedog picture compare)',
  verify: 'run a scenario (tests/scenarios/<name>.json) and report what it tested and what it never touched: verify barter',
};
export const ALL = { ...COMMANDS, ...EXTRA };

/** Failures of the bridge itself (not of the command): these get the four-cause diagnosis */
const BRIDGE_ERR = /no dev server is running|cannot reach the dev server|timed out waiting for the engine|no ready engine|no engine in the page|did not respond for 2 minutes/;

/** Output that a caller parses (JSON, a bare value): no state line appended */
const plain = (cmd, args) => cmd === 'eval' || cmd === 'js' || (cmd === 'describe' && args.some((a, i) => a === '--full' || a === '--all'
  || (!a.startsWith('--') && args[i - 1] !== '--max')));

export async function execute(dir, cmd, args = [], { page, onShot } = {}) {
  // a mistyped command name is answered as that, not as "no dev server" (which is what the bridge check below would say first)
  if (!ALL[cmd]) {
    const text = `✗ no command "${cmd}"\nAvailable: ${Object.keys(ALL).join(', ')}, session`;
    return { ok: false, code: 'command-error', summary: `no command "${cmd}"`, runtime: { ...NONE, blockedBy: [] }, data: null, text };
  }
  let r, driver, runtime = null, thrown = false, code = null;
  try {
    if (cmd === 'play') r = await play(dir, { page, stop: args.includes('--stop') });
    else if (cmd === 'status') r = await status(dir, { page });
    else if (cmd.startsWith('picture-')) r = await pictureCommand(dir, cmd, args);
    else {
      devServer(dir);
      const base = bridgeDriver(dir, { page });
      driver = base;
      r = cmd === 'verify' ? await verify(driver, dir, args[0]) : cmd === 'scenario' ? await scenarioReport(driver, dir, args[0]) : await run(driver, cmd, args, { dir });
    }
    runtime = r.runtime ?? null;
    if (r.image) onShot?.(r.image);   // snap: the picture the caller should see (it may be smaller than the saved file)
  } catch (e) {
    const dx = BRIDGE_ERR.test(String(e.message)) ? await diagnose(dir, e).catch(() => null) : null;
    thrown = true;
    code = dx ? dx.kind : 'command-error';
    r = { ok: false, text: dx?.text ?? '✗ ' + errorText(e), data: dx ? { cause: dx.kind } : null };
    if (dx) driver = null;
  }
  if (driver) runtime = (await readRuntime(driver)).runtime;
  const rt = runtime ?? { ...NONE, blockedBy: [] };
  // code tells the three kinds of "not ok" apart without reading prose: blocked (the command ran and was refused / found a problem), not-ready (the page is not
  // ready), a connection cause (no-server | starting | page-error | no-bridge), command-error (bad arguments or an exception in the page)
  code ??= r.ok ? 'ok' : r.kind ?? (rt.ready ? 'blocked' : 'not-ready');
  const body = r.text, state = runtime && !thrown && !plain(cmd, args);
  const summary = body.split('\n')[0].replace(/^[✓✗…]\s*/, '');
  let data = r.data ?? null;
  if (!data && plain(cmd, args)) try { data = JSON.parse(body.replace(/^✓ /, '')); } catch { data = null; }
  return { ok: r.ok, code, summary, runtime: rt, data,
    text: state ? `${body}\n${trailer(runtime)}` : body };
}
