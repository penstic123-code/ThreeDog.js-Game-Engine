// Modifier stacks (core/stacks.js), the one way several systems change a shared quantity: combine rules per op x layer, only the owner ends its
// entry, a stale handle ends nothing, two owners setting one layer warn (release; dev throws), save / load round trip, holders(); pause / freeze / camera ride on it.
// The "no way around it" check: claims.js and the engine's private holder fields are gone, so nothing can hold the engine still beside the stacks.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  const hi = e.mod('q', { owner: 'hi', set: 0, layer: 'effect' });
  check('a higher layer set hides everything below', v() === 0);
  const top = e.mod('q', { owner: 'top', add: 1, layer: 'system' });
  check('a higher layer still adds on top of it', v() === 1);
  hi.remove(); top.remove();
  check('ending recomputes from what is left (no old value comes back)', v() === 18);
  // only the owner ends its entry; a stale handle ends nothing
  s.remove(); check('remove drops only its own entry', v() === 25 && q.has('a') && q.has('m'));
  const old = m; m.remove(); e.mod('q', { owner: 'm', mul: 3 });
  old.remove(); check('a stale handle (the owner modded again) ends nothing', q.has('m') && v() === 25);
  check('a handle is { owner, remove, change }: remove is the one way to end it, change rewrites it in place', Object.keys(old).sort().join() === 'change,owner,remove', Object.keys(old).join());
  check('... a stale handle changes nothing (false)', old.change(9) === false && v() === 25);
  check('release by another owner name drops nothing', q.release('nobody') === false && q.size() === 3);
  // the same owner again replaces its entry with a new latest one (still one per owner)
  e.mod('q', { owner: 'a', add: 1 }); check('the same owner modding again replaces its entry, now the latest (one per owner)', q.size() === 3 && q.names().at(-1) === 'a', q.names().join());
  // holders
  const h = q.holders();
  check('holders lists owner / op / value / layer', h.length === 3 && h.at(-1).owner === 'a' && h.at(-1).op === 'add' && h.at(-1).value === 1 && h.at(-1).layer === 'game', JSON.stringify(h));
  // two owners set in one layer: development builds throw (browser spec shared-points); this node run is a release build: later wins, warned once
  const warns = []; const w0 = console.warn; console.warn = (...x) => warns.push(x.join(' '));
  try { e.mod('q', { owner: 's1', set: 1 }); e.mod('q', { owner: 's2', set: 2 }); void v(); void v(); } finally { console.warn = w0; }
  check('release: two owners set in one layer, the later wins ((2 + 1) x 3)', v() === 9, String(v()));
  check('... and warn once naming both owners (shared-conflict)', warns.filter(x => x.includes("'s1'") && x.includes("'s2'")).length === 1, JSON.stringify(warns));
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
  e.mod('q', { owner: 'menu', mul: 0.5, layer: 'system' });
  const saved = JSON.parse(JSON.stringify(e.parts.stacks.save()));
  check('system entries are not saved', !saved.q.some(x => x.owner === 'menu') && saved.q.length === 5);
  const before = v();
  e.mod('q', { owner: 'later', add: 100 }); q.release('a');
  e.parts.stacks.load(saved);
  check('load replaces the saved entries and keeps system ones', v() === before && q.has('menu') && !q.has('later') && q.has('a'), `${v()} vs ${before}`);
  // handles survive a load: inside a slow zone (time.world-like mul 0.5) save, load, leave the zone: the zone's handle still ends its entry
  const tw = S.define('tw', { base: 1 });
  const zone = e.mod('tw', { owner: 'slow-zone', mul: 0.5 });
  const inZone = JSON.parse(JSON.stringify(e.parts.stacks.save()));
  e.parts.stacks.load(inZone);
  check('load in the zone: the value is still 0.5', tw.value() === 0.5, String(tw.value()));
  check('... the old handle still changes it (true)', zone.change(0.25) === true && tw.value() === 0.25, String(tw.value()));
  zone.remove();
  check('... and leaving the zone ends it (back to 1, no entry left)', tw.value() === 1 && tw.size() === 0, `${tw.value()} ${tw.names().join()}`);
  const zone2 = e.mod('tw', { owner: 'slow-zone', mul: 0.5 });
  e.parts.stacks.load({ ...inZone, tw: [] });   // a save made outside the zone
  check('a load whose save has no entry for the owner drops it; the old handle then ends nothing', tw.size() === 0 && zone2.change(0.1) === false && tw.value() === 1);
  // settings only restrict; the player's restriction holds over the system layer; only debug overrides it
  const sc = f => { try { f(); return 'no throw'; } catch (x) { return x.code; } };
  const vol = S.define('vol', { base: 0.6 });
  check('settings mul above 1 throws shared-settings', sc(() => e.mod('vol', { owner: 'settings', mul: 3, layer: 'settings' })) === 'shared-settings' && vol.value() === 0.6);
  check('settings clamp with a min throws shared-settings', sc(() => e.mod('vol', { owner: 'settings', clamp: { min: 5 }, layer: 'settings' })) === 'shared-settings' && vol.value() === 0.6);
  const cap = e.mod('vol', { owner: 'settings', clamp: { max: 0.4 }, layer: 'settings' });
  check('settings clamp max / mul 0..1 are accepted', vol.value() === 0.4 && sc(() => e.mod('vol', { owner: 'settings2', mul: 0.5, layer: 'settings' })) === 'no throw');
  check('handle.change on a settings entry cannot raise it either', sc(() => cap.change({ min: 1 })) === 'shared-settings');
  vol.release('settings2');
  e.mod('vol', { owner: 'cutscene', set: 1, layer: 'system' });
  check('a system set does not lift the player cap (settings is above system)', vol.value() === 0.4, String(vol.value()));
  const dbg = e.mod('vol', { owner: 'debug', set: 1, layer: 'debug' });
  check('only debug overrides it', vol.value() === 1); dbg.remove();
  const shake = S.define('shake', { kind: 'value', base: true });
  e.mod('shake', { owner: 'settings', set: false, layer: 'settings' });
  e.mod('shake', { owner: 'cutscene', set: true, layer: 'system' });
  check('the player turned shake off: a cutscene set true on the system layer keeps it off', shake.value() === false);
  const e2 = fake(); e2.parts.stacks.load(saved); const q2 = e2.stacks.define('q', { base: 10 }); e2.mod('q', { owner: 'menu', mul: 0.5, layer: 'system' });
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
  // one layer table: engine.mod takes layer names from core/sharedPoint.js; the 0.4 numeric priority option is gone everywhere in the engine
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(x => x.isDirectory() ? walk(join(d, x.name)) : x.name.endsWith('.js') ? [join(d, x.name)] : []);
  const oldPriority = ['core', 'modules', 'ui'].flatMap(d => walk(join(ENGINE, d))).filter(f => /\.mod\([^)]*\bpriority:/.test(readFileSync(f, 'utf8')));
  check('no engine.mod call passes priority (layer replaced it)', !oldPriority.length, oldPriority.join(', '));
  check('the layer table lives only in sharedPoint.js', !/\bPRIORITY\s*=\s*\{/.test(readFileSync(join(ENGINE, 'core/stacks.js'), 'utf8')) && /export const LAYERS/.test(readFileSync(join(ENGINE, 'core/sharedPoint.js'), 'utf8')));
}
