// assets.lease (core/assets/assetEntry.js takeLease): the original is freed only after the last lease, a model copy is one, and the counts come back. Why a test: a freed original
// shows as a black or missing model in a part of the game far from the code that released it.
// 不许绕开: the real Assets class with its real free path; a second count beside takeLease would disagree with describe().assets here.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';

export const name = 'assets.lease: originals wait for the last lease, a copy is one lease, counts return to baseline';

export async function run({ check }) {
  const { THREE } = await import('threedog');
  const { Assets } = await import(pathToFileURL(join(ENGINE, 'core', 'assets', 'Assets.js')).href);
  const added = {};
  const assets = new Assets({ describe: { add: (k, fn) => { added[k] = fn; } }, rays: {}, loading: {} });
  const geo = new THREE.BoxGeometry(), scene = new THREE.Group().add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()));
  let freed = 0; geo.addEventListener('dispose', () => freed++);
  const e = { type: 'model', name: 'rock', url: 'rock', opts: {}, named: true };
  e.load = { owner: e, type: 'model', value: { scene, animations: [] }, users: 0, settled: true };
  e.value = e.load.value; e.promise = Promise.resolve(e.load.value);
  assets.entries.set('rock', e);

  const a = await assets.lease('rock'), b = await assets.lease('rock'), copy = assets._copy(e, {});
  check('counts: two leases and a copy on one name', added.assets().leases.rock === 3, JSON.stringify(added.assets()));
  assets.release('rock');
  check('release waits and says so', freed === 0 && added.assets().waiting.join() === 'rock', JSON.stringify(added.assets()));
  check('trim leaves it alone', assets.trim().length === 0 && freed === 0);
  a.remove(); a.remove();
  check('a second remove() does not count twice', added.assets().leases.rock === 2, JSON.stringify(added.assets()));
  assets.forget(copy);
  check('a copy going is a lease ending: still held by the last one', freed === 0 && added.assets().leases.rock === 1);
  b.remove();
  check('the last lease frees the original', freed === 1);
  check('counts are back to baseline', JSON.stringify(added.assets()) === '{"leases":{},"waiting":[]}', JSON.stringify(added.assets()));

  let code = null;
  await assets.lease('nothing').catch(err => { code = err.code; });
  check('an unknown name is a coded error', code === 'unknown-name', String(code));
}
