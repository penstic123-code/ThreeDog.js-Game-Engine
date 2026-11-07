import { reportError } from '../../core/base/errors.js';
import { codedError } from '../../core/base/errorHints.js';
// Apply one setting to the engine (helper of Settings.js): the built-in keys (pixel ratio, shadows, post effects, quality tier, audio buses) and the rows of modules and of
// the game (define). `s` is the Settings instance.

/** The shared values each built-in row limits. A game's own row names its values with define(key, def, { limits }); both go through limit() */
const BUILTIN_LIMITS = { shadows: ['shadows.enabled'], bloom: ['post.bloom.enabled'], ao: ['post.ao.enabled'] };

/**
 * The settings layer only restricts (core/ops/sharedPoint.js). A row's value on one shared point: true (or 1) drops the settings entry, so the scene's
 * own choice shows again; false switches it off (set false on a switch, mul 0 on a number); a number from 0 to 1 is a factor (mul) on a number.
 * Why never "force on": a cutscene or a dark cave that switched shadows off must not be switched back on by the menu; describe().shared then
 * says the settings allow it and which owner below turned it off.
 * @param {any} e @param {string} name the shared point ('shadows.enabled') @param {boolean | number} val
 */
function limit(e, name, val) {
  const allow = val === true || val === 1;
  // an effect not added yet (settings install before the game's boot code) has no point: the limit waits on one made now, and add() starts under it. Allowing has nothing to lift
  if (!e.stacks.has(name) && (allow || !name.startsWith('post.'))) return;
  const p = e.stacks.has(name) ? e.stacks.get(name) : e.post.switchPoint(name);
  if (allow) p.release('settings');
  else p.take({ owner: 'settings', layer: 'settings', ...(p.kind === 'number' ? { mul: val === false ? 0 : val } : { set: val }) });
}
/** @internal a row leaves: no control is left to lift its limits, so it gives its shared values back @param {any} e @param {string[]} names */
export function releaseRow(e, names) { for (const n of names) if (e.stacks.has(n)) e.stacks.get(n).release('settings'); }
/** @internal the module leaves: so does every row */
export function releaseLimits(s) {
  for (const names of [...Object.values(BUILTIN_LIMITS), ['tier'], ...[...s.custom.values()].map(c => c.limits ?? [])]) releaseRow(s.engine, names);
}
/** @internal the row's value fits the points it limits: a switch row (boolean) limits switches or numbers, a number row (a factor) only numbers */
export function checkLimits(s, key, def, names) {
  const e = s.engine;
  const known = () => e.stacks.list().filter(n => n.endsWith('.enabled')).join(', ');
  for (const n of names) {
    if (typeof n !== 'string' || !e.stacks.has(n)) throw codedError('unknown-name', `settings.define('${key}', ${JSON.stringify(def)}, { limits }): no shared value ${JSON.stringify(n)}. Define the row after the effect exists (engine.post.add, engine.stacks.define). Switches now: ${known()}; every name: engine.stacks.list()`);
    const kind = e.stacks.get(n).kind;
    const ok = typeof def === 'boolean' ? kind === 'number' || kind === 'value' : typeof def === 'number' && kind === 'number';
    if (!ok) throw codedError('shared-settings', `settings.define('${key}', ${JSON.stringify(def)}, { limits: '${n}' }): '${n}' holds ${kind === 'number' ? 'a number' : 'a value'}; a row limits it with ${kind === 'number' ? 'a switch (false = 0) or a factor from 0 to 1' : 'a switch: true allows what the scene chose, false turns it off'}`);
    for (const [other, c] of [...Object.entries(BUILTIN_LIMITS).map(([k, l]) => [k, { limits: l }]), ...s.custom])
      if (other !== key && c.limits?.includes(n)) throw codedError('shared-settings', `settings.define('${key}', { limits: '${n}' }): the row '${other}' already limits it; one row per value (the player would not know which one wins)`);
  }
}
/** What the menu shows for a picture switch: the player's permission (true unless the settings layer holds it off), not what the scene did with it */
export const allowed = (e, name) => !(e.stacks.has(name) && e.stacks.get(name).has('settings'));

export function applySetting(s, key, val) {
  const e = s.engine;
  try {
    // shadows, bloom, ao and a game row's { limits }: off restricts, on allows what the game chose
    const limits = BUILTIN_LIMITS[key] ?? s.custom.get(key)?.limits;
    if (limits) for (const n of limits) limit(e, n, typeof val === 'number' ? val : !!val);
    switch (key) {
      case 'pixelRatio': e.setPixelRatio(val); break;
      case 'antialias': e.post.nextAntialias(val); break;
      case 'tier': if (val) e.mod('tier', { owner: 'settings', layer: 'settings', set: val }); else e.stacks.get('tier').release('settings'); break;
      case 'adaptive': if (e.adaptive) { e.adaptive.on = val; if (!val && e.adaptive.max) e.setPixelRatio(e.adaptive.max); } break;
      default:
        // a saved slider for a bus this build no longer has is skipped, not an error
        if (key.startsWith('vol.')) { if (key.slice(4) in e.audio.levels) e.audio.setVolume(key.slice(4), val); }
        else s.custom.get(key)?.apply?.(val, e);
    }
  } catch (err) { reportError(e, err, `settings '${key}' apply`, { soft: true }); }
}
