// threedog build | dev | preview -w <game>: -w picks the workspace, as it does for every other command.
// Why: the vite branch only read a game name from the first argument and passed `-w my-game` straight to vite, where -w is --watch: vite build
// sat in watch mode on the wrong root and never exited, which looked like a hang.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, TOOLS } from '../paths.mjs';

export const name = 'cli: build/dev/preview -w <workspace> picks the workspace and is never handed to vite as --watch';

const cli = (...args) => spawnSync(process.execPath, [join(TOOLS, 'bin', 'threedog.mjs'), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });

export async function run({ check }) {
  const miss = cli('build', '-w', 'zz-no-such-game');
  check('build -w <unknown>: fails at once naming the workspace (no vite run, no watch)', miss.status === 1 && /zz-no-such-game.*not found/.test(miss.stderr), `exit ${miss.status} ${miss.signal ?? ''} ${(miss.stderr + miss.stdout).slice(-300)}`);
  const help = cli('build', '-w', 'engine', '--help');
  check('build -w engine --help: acts on the engine workspace and exits', help.status === 0 && /^build: packages\/engine/m.test(help.stdout), `exit ${help.status} ${help.signal ?? ''} ${help.stdout.slice(0, 200)}`);
  check('the -w and its value never reach vite', !/watch/i.test(help.stderr), help.stderr.slice(-200));
  const both = cli('preview', 'engine', '--help');
  check('the positional game name still works', both.status === 0 && /^preview: packages\/engine/m.test(both.stdout), `exit ${both.status} ${both.stdout.slice(0, 200)}`);
}
