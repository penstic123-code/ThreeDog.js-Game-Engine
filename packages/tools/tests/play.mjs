// threedog play / status / play --stop against a server that play starts itself: npm test -- "play and status"
// Skipped when someone is running dev on the engine right now (the dev.json would be shared).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { TOOLS, ROOT, ENGINE } from '../paths.mjs';

export const name = 'play and status: start the dev server, wait for the bridge, stop it';

const CLI = join(TOOLS, 'threedog/cli.mjs');
const threedog = (...args) => new Promise(res => execFile(process.execPath, [CLI, ...args, '-w', 'engine'], { cwd: ROOT, encoding: 'utf8' },
  (err, out) => res({ out: out.trim(), code: err ? err.code : 0 })));

export async function run({ check }) {
  if (existsSync(join(ENGINE, '.threedog/dev.json'))) return;
  const st0 = await threedog('status');
  check('status without a server names the cause and play as the next step', st0.code === 1 && /No dev server|has no \.threedog\/dev\.json/.test(st0.out) && st0.out.includes('threedog play'), st0.out);
  const pl = await threedog('play');
  try {
    const st1 = await threedog('status');
    check('play: prints the address and the state line; status: Ready, no page errors',
      pl.code === 0 && /Game at http:\/\/localhost:\d+\//.test(pl.out) && /Headless page paused/.test(pl.out) && st1.code === 0 && st1.out.startsWith('✓ Ready'), pl.out + ' | ' + st1.out);
  } finally {
    const sp = await threedog('play', '--stop');
    check('play --stop: the server stops and dev.json is gone', sp.code === 0 && !existsSync(join(ENGINE, '.threedog/dev.json')), sp.out);
  }
}
