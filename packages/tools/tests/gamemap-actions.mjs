// GAMEMAP "Key actions": an action counts as used when input reads it or when an interaction names it (interactions.add(obj, { action })).
// Why: a farm demo's 'stow' action, used only as an interaction's second key, was listed "(not used)" and read as dead content. Offline.
import { actionUsed } from '../gamemap/codeScan.mjs';
import { npcWhere } from '../gamemap/extra.mjs';

export const name = 'gamemap actions: input reads and interaction action keys both count as using an action';

export async function run({ check }) {
  const pos = p => `(${p.x},${p.z})`;
  check('[guard] an NPC with only start stands somewhere in the map, it does not read "undefined"', npcWhere({ start: { x: 1, z: 2 } }, pos) === 'stands at (1,2)', npcWhere({ start: { x: 1, z: 2 } }, pos));
  check('a schedule and a behavior read as before', npcWhere({ schedule: [{ at: '07:00', x: 0, z: 0 }] }, pos) === '07:00 (0,0)' && npcWhere({ behavior: 'wander' }, pos) === 'wander');
  check('input.pressed / down / released count', actionUsed("if (engine.input.pressed('jump')) go();", 'jump') && actionUsed('input.down("run")', 'run') && actionUsed("released( 'aim' )", 'aim'));
  check('[guard] interactions.add(obj, { action: \'stow\' }) counts', actionUsed("engine.interactions.add(o, { id: 'stow-1', action: 'stow', label: 'Stow' })", 'stow'));
  check('another name, a label or a comment-free mention do not count', !actionUsed("engine.input.pressed('stowAll'); const label = 'stow';", 'stow'));
}
