import { reportError } from '../../core/errors.js';
import { codedError } from '../../core/errorHints.js';
// Apply one setting to the engine (helper of Settings.js): the built-in keys (pixel ratio, shadows, post effects, view distance, density, audio buses) and
// the game's own settings (define). `s` is the Settings instance.

/** The shared values each built-in row limits. A game's own row names its values with define(key, def, { limits }); both go through limit() */
const BUILTIN_LIMITS = { shadows: ['look.shadow.enabled'], bloom: ['look.post.bloom.enabled'], ao: ['look.post.ao.enabled'] };

/**
 * The settings layer only restricts (core/sharedPoint.js). A row's value on one shared point: true (or 1) drops the settings entry, so the scene's
 * own choice shows again; false switches it off (set false on a switch, mul 0 on a number); a number from 0 to 1 is a factor (mul) on a number.
 * Why never "force on": a cutscene or a dark cave that switched shadows off must not be switched back on by the menu; describe().shared then
 * says the settings allow it and which owner below turned it off.
 * @param {any} e @param {string} name the shared point ('look.shadow.enabled') @param {boolean | number} val
 */
function limit(e, name, val) {
  if (!e.stacks.has(name)) return;   // a style without this effect has nothing to switch
  const p = e.stacks.get(name);
  if (val === true || val === 1) p.release('settings');
  else p.take({ owner: 'settings', layer: 'settings', ...(p.kind === 'number' ? { mul: val === false ? 0 : val } : { set: val }) });
}
/** @internal the row's value fits the points it limits: a switch row (boolean) limits switches or numbers, a number row (a factor) only numbers */
export function checkLimits(s, key, def, names) {
  const e = s.engine;
  const known = () => e.stacks.list().filter(n => n.endsWith('.enabled')).join(', ');
  for (const n of names) {
    if (typeof n !== 'string' || !e.stacks.has(n)) throw codedError('unknown-name', `settings.define('${key}', ${JSON.stringify(def)}, { limits }): no shared value ${JSON.stringify(n)}. Define the row after the effect exists (look.post.add, a style effect, engine.stacks.define). Switches now: ${known()}; every name: engine.stacks.list()`);
    const kind = e.stacks.get(n).kind;
    const ok = typeof def === 'boolean' ? kind === 'number' || kind === 'value' : typeof def === 'number' && kind === 'number';
    if (!ok) throw codedError('shared-settings', `settings.define('${key}', ${JSON.stringify(def)}, { limits: '${n}' }): '${n}' holds ${kind === 'number' ? 'a number' : 'a value'}; a row limits it with ${kind === 'number' ? 'a switch (false = 0) or a factor from 0 to 1' : 'a switch: true allows what the scene chose, false turns it off'}`);
    for (const [other, c] of [...Object.entries(BUILTIN_LIMITS).map(([k, l]) => [k, { limits: l }]), ...s.custom])
      if (other !== key && c.limits?.includes(n)) throw codedError('shared-settings', `settings.define('${key}', { limits: '${n}' }): the row '${other}' already limits it; one row per value (the player would not know which one wins)`);
  }
}
/** What the menu shows for a look switch: the player's permission (true unless the settings layer holds it off), not what the scene did with it */
export const allowed = (e, name) => !(e.stacks.has(name) && e.stacks.get(name).has('settings'));

export function applySetting(s, key, val) {
  const e = s.engine;
  try {
    // shadows, bloom, ao and a game row's { limits }: off restricts, on allows what the style / game / device chose (a low-tier device's bloom stays off)
    const limits = BUILTIN_LIMITS[key] ?? s.custom.get(key)?.limits;
    if (limits) for (const n of limits) limit(e, n, typeof val === 'number' ? val : !!val);
    switch (key) {
      case 'pixelRatio': if (e.adaptive) e.adaptive.max = val; if (Math.abs(e.renderer.getPixelRatio() - val) > 0.001) e.setPixelRatio(val); break;
      case 'antialias': e.post.setAntialias(val); break;
      case 'adaptive': if (e.adaptive) { e.adaptive.on = val; if (!val && e.adaptive.max) e.setPixelRatio(e.adaptive.max); } break;
      case 'viewChunks': { const H = s.chunkHost(); if (H?.setViewChunks && H.viewChunks !== val) H.setViewChunks(val); break; }
      case 'density': { const H = s.chunkHost(); if (H?.setDensity && H.density !== val) H.setDensity(val); break; }
      default:
        // a saved slider for a bus this build no longer has is skipped, not an error
        if (key.startsWith('vol.')) { if (key.slice(4) in e.audio.levels) e.audio.setVolume(key.slice(4), val); }
        else s.custom.get(key)?.apply?.(val, e);
    }
  } catch (err) { reportError(e, err, `settings '${key}' apply`, { soft: true }); }
}
