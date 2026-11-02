// Dev bridge command line: the BRIDGE commands of bin/threedog.mjs (forwarded from there; the list lives in COMMANDS of commands.mjs and EXTRA of dispatch.mjs).
// Finds the running dev server (vite-threedog-bridge.js) through <workspace>/.threedog/dev.json and forwards the primitives to it; the commands themselves are in
// commands.mjs, the entry shared with the MCP server (result shape, state line, play / status / verify) in dispatch.mjs.
//   threedog describe                   on the engine package example
//   threedog describe -w my-farm        pick a workspace (or just run it inside the game directory)
//   --page /tests/city/index.html              pick the page path (default: the real page that last got focus, otherwise a headless /)
import { pickWorkspace } from '../paths.mjs';
import { pagePath as pageArg } from '../lib/cli-args.mjs';

const [cmd, ...argv] = process.argv.slice(2);
const fail = text => { console.log(text); process.exit(1); };

let dir, args;
// live: at the repo root (no workspace around the current folder) talk to the one running dev server instead of falling back to the engine example
try { ({ dir, args } = pickWorkspace(argv, { live: true })); } catch (e) { fail('✗ ' + e.message); }
let pagePath;
try { const pi = args.indexOf('--page'); pagePath = pi >= 0 ? pageArg(args.splice(pi, 2)[1]) : undefined; } catch (e) { fail('✗ ' + e.message); }
// --json: the unified result (the same object the MCP server returns as structuredContent) instead of the text
const ji = args.indexOf('--json'), asJson = ji >= 0 && !!args.splice(ji, 1);

// Heavy modules (commands, dispatch, playwright-facing code) load only when a command really runs here: `session` and a command answered by a running
// session (session.mjs, which only needs node:http) never pay for them. `session` is the only command with no bridge behind it.
let r;
if (cmd === 'session') { const { sessionCommand } = await import('./session.mjs'); r = await sessionCommand(dir, args); }
else {
  if (cmd !== 'play') { const { viaSession } = await import('./session.mjs'); r = await viaSession(dir, cmd, args, pagePath); }
  if (!r) {
    const { execute } = await import('./dispatch.mjs');
    // execute() does not throw: a failure comes back as ok false with its explanation in text (the matching one of four causes when the bridge is unreachable; an unknown command name is answered there too)
    r = await execute(dir, cmd, args, { page: pagePath });
  }
}
const { ok, text } = r;
console.log(asJson ? JSON.stringify({ ok, code: r.code, summary: r.summary, runtime: r.runtime, data: r.data, text }, null, 2) : text);
process.exit(ok ? 0 : 1);
