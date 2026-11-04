// Keeps GAMEMAP.md current while `npm run dev` runs (dev server only; not in tests, which must not write into the tree).
// Why here and not in `npm run check`: check is the gate that says the committed GAMEMAP.md matches the game. If check regenerated it, it would
// pass on a stale commit (the file is rewritten before it is compared). So the file is refreshed while you edit, and check stays a pure comparison.
// When: once at server start, then (debounced) after a game source file is added, changed or removed. It runs `gamemap.mjs -w <root>` in a child
// process, the same generator `threedog map` uses, so the result is byte-identical to a hand-run map.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GAMEMAP = fileURLToPath(new URL('../gamemap.mjs', import.meta.url));
const slash = p => p.replace(/\\/g, '/');
// The map reads the game's own files. Its output, caches, build output and dependencies are not inputs: counting them would loop on its own write.
const IGNORED = /(^|\/)(node_modules|\.threedog|dist|\.git)\/|(^|\/)GAMEMAP\.md$/;

/** Does a change to this file (absolute path) possibly change the game's GAMEMAP.md? */
export const affectsMap = (file, root) => {
  const f = slash(file), r = slash(root).replace(/\/$/, '') + '/';
  return f.startsWith(r) && !IGNORED.test(f.slice(r.length)) && /\.(m?js|json|html)$/.test(f);
};

const spawnMap = root => new Promise(res => {
  const c = spawn(process.execPath, [GAMEMAP, '-w', root], { cwd: root, stdio: 'ignore' });
  c.on('close', res); c.on('error', res);
});

/** @param {{ run?: (root: string) => Promise<unknown>, delay?: number, force?: boolean }} [opts] for the guard test */
export default function threedogMap({ run = spawnMap, delay = 400, force = false } = {}) {
  let root = process.cwd();
  return {
    name: 'threedog-map',
    apply: 'serve',
    configResolved(c) { root = c.root; },
    configureServer(server) {
      if (process.env.THREEDOG_TEST && !force) return;
      let timer = null, running = Promise.resolve();
      // Runs never overlap: a change during a run schedules one more run after it, so the last edit is always in the file
      const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { running = running.then(() => run(root)); }, delay); };
      const changed = file => { if (affectsMap(file, root)) schedule(); };
      for (const ev of ['add', 'change', 'unlink']) server.watcher.on(ev, changed);
      server.httpServer?.once('close', () => clearTimeout(timer));
      schedule();
    },
  };
}
