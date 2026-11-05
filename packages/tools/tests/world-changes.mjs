// describe().world and the one-line answer of a command: walkers must not push out what the command did. No browser: worldChanges reads plain records.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';
import { changeLine } from '../describe-snapshot.mjs';

const { worldChanges } = await import(pathToFileURL(join(ENGINE, 'modules/world/persist.js')).href);

export const name = 'world changes: a record that walks on its own is no row of its own; the Changed line keeps what a command did';

const walker = (id, x) => ({ id, kind: 'npc', position: { x, y: 0, z: 0 }, motion: { facing: 0 } });
const base = id => ({ id, kind: 'npc', position: { x: 0, y: 0, z: 0 } });

/** A world of five walkers at step x, plus a prop that a press moved or not */
function world(x, chest) {
  const ids = ['a', 'b', 'c', 'd', 'e'], records = new Map(ids.map(id => [id, walker(id, x)]));
  records.set('zchest', { id: 'zchest', kind: 'prop', position: { x: chest, y: 0, z: 0 } });
  records.set('stray', { id: 'stray', kind: 'prop', position: { x: 2, y: 0, z: 0 } });
  const w = { records, _unsaved: new Set(), _removed: new Set(), _base: new Map([...ids.map(id => [id, base(id)]), ['zchest', { id: 'zchest', kind: 'prop', position: { x: 0, y: 0, z: 0 } }]]) };
  return w;
}

export async function run({ check }) {
  const before = worldChanges(world(1, 0)), after = worldChanges(world(2, 5));
  check('[guard] walkers are not rows of their own', !after.changed.some(r => 'abcde'.includes(r.id)), JSON.stringify(after));
  const line = changeLine({ world: before }, { world: after });
  check('[guard] the Changed line names what the press moved', /zchest/.test(line), line);
  const w = world(1, 0), rows = worldChanges(w).changed, stray = rows.find(r => r.id === 'stray');
  w.records.get('stray').position.x = 9;
  check('a runtime row is a copy: a kept describe result does not move', stray.position.x === 2, JSON.stringify(stray));
  const named = world(1, 0);
  named.records.get('a').state = 'angry';
  check('another field of a walker still shows', worldChanges(named).changed.some(r => r.id === 'a' && r.state === 'angry'), JSON.stringify(worldChanges(named)));
}
