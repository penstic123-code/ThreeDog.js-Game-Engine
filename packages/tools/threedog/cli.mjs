// Dev bridge command line: the BRIDGE commands of bin/threedog.mjs (forwarded from there; the list lives in COMMANDS of commands.mjs).
// Finds the running dev server (vite-threedog-bridge.js) through <workspace>/.threedog/dev.json and forwards the primitives to it; the commands themselves are in commands.mjs.
//   threedog describe                   on the engine package example
//   threedog describe -w my-farm        pick a workspace (or just run it inside the game directory)
//   --page /tests/city/index.html              pick the page path (default: the real page that last got focus, otherwise a headless /)
import { pickWorkspace } from '../paths.mjs';
import { run, COMMANDS } from './commands.mjs';
import { devServer, bridgeDriver, errorText, scenario } from './connect.mjs';

const [cmd, ...argv] = process.argv.slice(2);
const fail = text => { console.log(text); process.exit(1); };

let dir, args;
try { ({ dir, args } = pickWorkspace(argv)); } catch (e) { fail('✗ ' + e.message); }
const pi = args.indexOf('--page'), pagePath = pi >= 0 ? args.splice(pi, 2)[1] : undefined;

try { devServer(dir); } catch (e) { fail('✗ ' + e.message); }
const driver = bridgeDriver(dir, { page: pagePath });

if (!COMMANDS[cmd]) fail(`✗ no command "${cmd}"\nAvailable: ${Object.keys(COMMANDS).join(', ')}`);
try {
  const { ok, text } = cmd === 'scenario' ? await scenario(driver, dir, args[0]) : await run(driver, cmd, args, { dir });
  console.log(text);
  process.exit(ok ? 0 : 1);
} catch (e) {
  // The bridge's own multi-line explanations (engine wait timeout etc.) are shown whole; Playwright errors carry a stack, so only the first line
  console.log('✗ ' + errorText(e));
  process.exit(1);
}
