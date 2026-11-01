// Asset swap check (assets check --against): a new export that lost colliders / template nodes / spawn points, moved points or changed size is flagged.
import { compareModels } from '../assets-check/against.mjs';

export const name = 'assets check --against: missing col_ / template / spawn, moved points, size change';

export async function run({ check }) {
  const model = (o = {}) => ({
    level: { spawns: [{ name: 'spawn', position: [0, 0, 0] }], triggers: [{ name: 'trigger_gate', position: [5, 0, 0] }], npcs: [], markers: [], records: [{ node: 'door', position: [1, 0, 1] }], ...o.level },
    report: { colliders: ['col_wall', 'col_box'], clips: [{ name: 'Idle' }], materials: [{ name: 'wood' }], bounds: [[0, 0, 0], [10, 3, 10]], ...o.report },
  });
  const same = compareModels(model(), model());
  check(same.length === 0, 'identical files have no differences: ' + JSON.stringify(same));
  const codes = compareModels(model({ level: { spawns: [], triggers: [{ name: 'trigger_gate', position: [9, 0, 0] }], records: [] }, report: { colliders: ['col_wall'], clips: [], bounds: [[0, 0, 0], [20, 3, 10]] } }), model()).map(i => i.code);
  for (const c of ['missing-col--collider', 'missing-template-id-node', 'missing-spawn-point', 'missing-animation-clip', 'moved-point', 'size-changed']) check(codes.includes(c), 'flags ' + c + ' (got ' + codes.join(',') + ')');
}
