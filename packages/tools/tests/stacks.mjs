// Modifier stacks (core/stacks.js), the one way several systems change a shared quantity: combine rules per op x priority, only the owner ends its
// entry, a stale handle ends nothing, two sets in one layer warn, save / load round trip, holders(); pause / freeze / camera ride on it.
// The "no way around it" check: claims.js and the engine's private holder fields are gone, so nothing can hold the engine still beside the stacks.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';

const { Stacks } = await import(pathToFileURL(join(ENGINE, 'core/stacks.js')).href);
const { holdMethods, defineHoldStacks } = await import(pathToFileURL(join(ENGINE, 'core/holds.js')).href);

export const name = 'modifier stacks: engine.mod combine rules, owners, save, holds';

/** A minimal engine: saves, events and the stacks; the holds from holds.js on top */
function fake() {
  const parts = {}, events = [], on = {};
  const e = Object.defineProperties({ elapsed: 0, saves: { register: (k, p) => { parts[k] = p; } }, _loop() {}, disposed: false,
    events: { emit: (n, d) => events.push([n, d]), on: (n, f) => { (on[n] ??= []).push(f); return { remove() {} }; } } }, Object.getOwnPropertyDescriptors(holdMethods));
  e.stacks = new Stacks(e); e.mod = (n, o) => e.stacks.mod(n, o);
  defineHoldStacks(e);   // the engine's own hold stacks (pause does the loop side effect itself)
  return Object.assign(e, { parts, events, fire: (n, d) => (on[n] ?? []).forEach(f => f(d)) });
}

export async function run({ check }) {
  const e = fake(), S = e.stacks;
  const q = S.define('q', { base: 10 });
  const v = () => q.value();
  // one op per layer, then the layer order
  const a = e.mod('q', { owner: 'a', add: 5 });
  check('add', v() === 15);
  const m = e.mod('q', { owner: 'm', mul: 2 });
  check('same layer: add then mul ((10 + 5) x 2)', v() === 30, String(v()));
  const c = e.mod('q', { owner: 'c', clamp: { max: 25 } });
  check('clamp last in its layer', v() === 25);
  const s = e.mod('q', { owner: 's', set: 4 });
  check('set replaces the value before the layer\'s add / mul / clamp ((4 + 5) x 2 -> 18, under 25)', v() === 18, String(v()));
  const hi = e.mod('q', { owner: 'hi', set: 0, priority: 'effect' });
  check('a higher layer set hides everything below', v() === 0);
  const top = e.mod('q', { owner: 'top', add: 1, priority: 'system' });
  check('a higher layer still adds on top of it', v() === 1);
  hi.remove(); top.remove();
  check('ending recomputes from what is left (no old value comes back)', v() === 18);
  // only the owner ends its entry; a stale handle ends nothing
  s.remove(); check('remove drops only its own entry', v() === 25 && q.has('a') && q.has('m'));
  const old = m; m.remove(); e.mod('q', { owner: 'm', mul: 3 });
  old.remove(); check('a stale handle (the owner modded again) ends nothing', q.has('m') && v() === 25);
  check('a handle is { owner, remove } only: one way to end it', Object.keys(old).sort().join() === 'owner,remove', Object.keys(old).join());
  check('release by another owner name drops nothing', q.release('nobody') === false && q.size() === 3);
  // the same owner again replaces its entry with a new latest one (still one per owner)
  e.mod('q', { owner: 'a', add: 1 }); check('the same owner modding again replaces its entry, now the latest (one per owner)', q.size() === 3 && q.names().at(-1) === 'a', q.names().join());
  // holders
  const h = q.holders();
  check('holders lists owner / op / value / priority', h.length === 3 && h.at(-1).owner === 'a' && h.at(-1).op === 'add' && h.at(-1).value === 1 && h.at(-1).priority === 100);
  // two sets in one layer warn once and the latest wins
  const warns = []; const w0 = console.warn; console.warn = (...x) => warns.push(x.join(' '));
  try { e.mod('q', { owner: 's1', set: 1 }); e.mod('q', { owner: 's2', set: 2 }); void v(); void v(); } finally { console.warn = w0; }
  check('two different sets in one layer: latest wins ((2 + 1) x 3)', v() === 9, String(v()));
  check('... and warn once naming both owners', warns.filter(x => x.includes("'s1'") && x.includes("'s2'")).length === 1, JSON.stringify(warns));
  // bad input says how to call it
  const code = f => { try { f(); return 'no throw'; } catch (x) { return x.code; } };
  check('no owner throws mod-owner', code(() => e.mod('q', { mul: 2 })) === 'mod-owner');
  check('two ops throw mod-owner', code(() => e.mod('q', { owner: 'x', mul: 2, add: 1 })) === 'mod-owner');
  check('unknown quantity throws unknown-name', code(() => e.mod('nope', { owner: 'x', mul: 2 })) === 'unknown-name');
  // per-record stacks and world.remove
  const dmg = S.define('damageTaken', { per: true, min: 0 });
  e.mod('damageTaken', { owner: 'shield', id: 'p', mul: 0.5 }); e.mod('damageTaken', { owner: 'weak', id: 'e3', mul: 2 });
  check('per-record values are separate', dmg.value('p') === 0.5 && dmg.value('e3') === 2 && dmg.value('x') === 1);
  e.fire('world:remove', { id: 'e3' });
  check('world.remove drops every entry of that record', dmg.value('e3') === 1 && dmg.size('e3') === 0 && dmg.value('p') === 0.5);
  // save / load: below-system entries saved, system ones stay with the screen
  e.mod('q', { owner: 'menu', mul: 0.5, priority: 'system' });
  const saved = JSON.parse(JSON.stringify(e.parts.stacks.save()));
  check('system entries are not saved', !saved.q.some(x => x.owner === 'menu') && saved.q.length === 5);
  const before = v();
  e.mod('q', { owner: 'later', add: 100 }); q.release('a');
  e.parts.stacks.load(saved);
  check('load replaces the saved entries and keeps system ones', v() === before && q.has('menu') && !q.has('later') && q.has('a'), `${v()} vs ${before}`);
  const e2 = fake(); e2.parts.stacks.load(saved); const q2 = e2.stacks.define('q', { base: 10 }); e2.mod('q', { owner: 'menu', mul: 0.5, priority: 'system' });
  check('a save loaded before the game defines the quantity applies when it does', q2.value() === before);
  // holds: pause / freeze / camera are stacks
  const f1 = e.freeze('menu'); e.freeze({ owner: 'title', kind: 'title' });
  check('freeze is the freeze stack', e.frozen === true && S.get('freeze').names().join() === 'menu,title');
  e.stacks.get('freeze').release('someone-else'); check('unfreeze by a non-owner leaves it', e.frozen);
  f1.remove(); e.stacks.get('freeze').release('title'); check('frozen ends when every owner released', e.frozen === false);
  const hm = e.mod('freeze', { owner: 'pause-menu' }); check('engine.mod(\'freeze\', { owner }) is the same freeze', e.frozen === true);
  hm.remove(); check('... and its remove() unfreezes', e.frozen === false);
  check('one end per hold: no engine.resume / engine.unfreeze beside the handle', !('resume' in e) && !('unfreeze' in e));
  const cam = e.takeCamera('cut', { focus: null }); e.takeCamera('photo');
  check('camera: latest holder in charge', e.cameraOverride.owner === 'photo');
  e.stacks.get('camera').release('photo'); check('releasing hands back to the previous holder', e.cameraOverride.owner === 'cut');
  cam.remove(); check('none left: null', e.cameraOverride === null);
  const p = e.pause('t');
  check('the pause handle does not chain (pause / step are engine calls)', Object.keys(p).sort().join() === 'owner,remove', Object.keys(p).join());
  p.remove();
  // nothing beside the stacks
  check('core/claims.js is deleted', !existsSync(join(ENGINE, 'core/claims.js')));
  const src = ['holds.js', 'services.js', 'loop.js', 'Describe.js', 'checks.js', 'Ops.js', 'opsRun.js', 'debugView.js'].map(f => readFileSync(join(ENGINE, 'core', f), 'utf8')).join('\n');
  check('no private holder fields left (_pausers / _freezers / _cameraClaims / claims())', !/_pausers|_freezers|_cameraClaims|\bclaims\(/.test(src));
}
