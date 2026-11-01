// Dev bridge command line: the BRIDGE commands of bin/threedog.mjs (forwarded from there; the list lives in COMMANDS of commands.mjs and EXTRA of dispatch.mjs).
// Finds the running dev server (vite-threedog-bridge.js) through <workspace>/.threedog/dev.json and forwards the primitives to it; the commands themselves are in
// commands.mjs, the entry shared with the MCP server (result shape, state line, play / status / verify) in dispatch.mjs.
//   threedog describe                   on the engine package example
//   threedog describe -w my-farm        pick a workspace (or just run it inside the game directory)
//   --page /tests/city/index.html              pick the page path (default: the real page that last got focus, otherwise a headless /)
import { pickWorkspace } from '../paths.mjs';
import { execute, ALL } from './dispatch.mjs';

const [cmd, ...argv] = process.argv.slice(2);
const fail = text => { console.log(text); process.exit(1); };

let dir, args;
try { ({ dir, args } = pickWorkspace(argv)); } catch (e) { fail('✗ ' + e.message); }
const pi = args.indexOf('--page'), pagePath = pi >= 0 ? args.splice(pi, 2)[1] : undefined;

if (!ALL[cmd]) fail(`✗ no command "${cmd}"\nAvailable: ${Object.keys(ALL).join(', ')}`);
// execute() does not throw: a failure comes back as ok false with its explanation in text (the matching one of four causes when the bridge is unreachable)
// --json: the unified result (the same object the MCP server returns as structuredContent) instead of the text
const ji = args.indexOf('--json'), asJson = ji >= 0 && !!args.splice(ji, 1);
const r = await execute(dir, cmd, args, { page: pagePath }), { ok, text } = r;
console.log(asJson ? JSON.stringify({ ok, code: r.code, summary: r.summary, runtime: r.runtime, data: r.data, text }, null, 2) : text);
process.exit(ok ? 0 : 1);
