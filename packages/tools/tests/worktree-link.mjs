// worktree-link.mjs on a fake main repo and worktree. Why a test: the danger is silent, a link to the main checkout runs the wrong code and a careless
// remove deletes the main repo's packages, and a leftover link of a removed package once stopped the old helper script.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check as resolved, link, unlink } from '../worktree-link.mjs';

export const name = 'worktree-link: own packages stay local, a dead link is skipped, unlink leaves every target in place';

const pkg = (dir, name) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'package.json'), JSON.stringify({ name })); };

export async function run({ check }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wt-link-')));
  const main = join(root, 'main'), wt = join(root, 'wt');
  try {
    pkg(join(main, 'packages', 'gone'), '@x/gone');
    pkg(join(main, 'node_modules', 'lib'), 'lib');
    pkg(join(main, 'node_modules', '@s', 'scoped'), '@s/scoped');
    pkg(join(main, 'packages', 'eng'), 'eng');
    mkdirSync(join(main, 'node_modules', '@x'));
    mkdirSync(join(main, 'node_modules', '.vite'));
    symlinkSync(join(main, 'packages', 'eng'), join(main, 'node_modules', 'eng'), 'junction');
    symlinkSync(join(main, 'packages', 'gone'), join(main, 'node_modules', '@x', 'gone'), 'junction');
    rmSync(join(main, 'packages', 'gone'), { recursive: true });   // the removed package: its link in the main repo now points nowhere
    pkg(join(wt, 'packages', 'eng'), 'eng');
    writeFileSync(join(wt, 'package.json'), '{}');

    link(wt, main);
    check('[guard] a workspace package resolves into the worktree', resolved(wt).every(r => r.ok) && resolved(wt).length === 1, JSON.stringify(resolved(wt)));
    check('other packages and scoped ones link to the main repo', realpathSync(join(wt, 'node_modules', 'lib')) === join(main, 'node_modules', 'lib') && existsSync(join(wt, 'node_modules', '@s', 'scoped', 'package.json')));
    check("a dead link of a removed package is skipped; caches are not shared", !existsSync(join(wt, 'node_modules', '@x', 'gone')) && !existsSync(join(wt, 'node_modules', '.vite')));
    check('linking twice changes nothing', link(wt, main) === 0);

    mkdirSync(join(wt, 'node_modules', 'real'));
    const kept = unlink(wt);
    check('[guard] unlink keeps every target', existsSync(join(main, 'node_modules', 'lib', 'package.json')) && existsSync(join(wt, 'packages', 'eng', 'package.json')));
    check('unlink removes the links and reports what is not a link', !lstatSync(join(wt, 'node_modules', 'lib'), { throwIfNoEntry: false }) && kept.length === 1 && kept[0].endsWith('real'), JSON.stringify(kept));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
