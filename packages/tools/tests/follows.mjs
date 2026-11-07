// [guard] A copy counts as current only once it was built: a rebuild that throws leaves it stale, so the next read tries again.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';

const { follows } = await import(pathToFileURL(join(ENGINE, 'core/base/follows.js')).href);

export const name = 'follows: a failed rebuild is not confirmed';

export async function run({ check }) {
  const owner = { version: 1 }, f = follows(() => owner, o => o.version), seen = [];
  const build = change => { seen.push(change); };
  f.sync(build);
  check('the first read builds', seen.join() === 'source', seen.join());
  f.sync(build);
  check('a current copy is not built again', seen.length === 1, seen.join());
  owner.version = 2;
  let threw = false;
  try { f.sync(() => { throw new Error('half built'); }); } catch { threw = true; }
  check('the failure reaches the reader', threw);
  f.sync(build);
  check('the next read tries again', seen.join() === 'source,version', seen.join());
  f.sync(build);
  check('after success it stays current', seen.length === 2, seen.join());
}
