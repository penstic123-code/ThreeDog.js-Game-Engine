// The atmosphere contract's input side: what a function-valued look value is called with every frame, and the one entry a game feeds its own state.
//   engine.look.state({ boss: true })        merge into the game state (null drops a key); returns the state now. engine.look.state() only reads it
//   look.fog.set({ color: ({ state }) => state.boss ? '#400' : 'horizon' })   any key marked fn in the catalog takes such a function
// Why one context object and not (sky) => ...: the keyframes are only the default implementation. A style that wants its look to follow
// gameplay (a boss room, a dream, a cutscene) needs the same inputs the keyframes use (time, weather, season) plus the game's own state, in one
// shape whatever module evaluates it, so fog, sky colors, lights and exposure read alike. The time-of-day module (sky) fills it once per frame.
import { codedError } from '../errorHints.js';
import { isPlainObject } from '../util.js';

/**
 * The per-frame context of one engine (created once, refilled by the sky each frame): a plain object, the same one every frame.
 * @param {any} e @returns {{ time: number, weather: string | null, season: string | null, day: number, state: Record<string, any>, sky: any }}
 */
function lookContext(e) {
  if (e._lookCtx) return e._lookCtx;
  e._lookCtx = { time: 0, weather: null, season: null, day: 1, state: e._lookState ??= {}, sky: null };
  return e._lookCtx;
}

/** Refill the context (the time-of-day module, modules/sky/frame.js, once per frame before anything function-valued is evaluated; core names no module) */
export function fillContext(e, sky, weather, cal) {
  const c = lookContext(e);
  // day / season come from the calendar the sky draws (passed in by the sky: core names no module); without one a fixed time: day 1, no season
  c.time = sky.drawnTime; c.season = cal?.season ?? null; c.day = cal?.day ?? 1; c.sky = sky; c.weather = weather ?? null;
  return c;
}

/** A value or a function of the context: the one rule every fn-marked key follows */
export const live = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

/** engine.look.state(patch?): non-enumerable on engine.look so describe / catalog / debug loops over parts never see it */
export function defineState(look, e) {
  if (Object.hasOwn(look, 'state')) return;
  Object.defineProperty(look, 'state', {
    enumerable: false, configurable: true,
    /** @param {Record<string, any> | null} [patch] */
    value(patch) {
      const s = e._lookState ??= {};
      if (patch === undefined) return s;
      if (!isPlainObject(patch)) throw codedError('look-param', `engine.look.state(patch): patch is an object of your own fields, e.g. engine.look.state({ boss: true }); got ${JSON.stringify(patch)}`);
      for (const [k, v] of Object.entries(patch)) v === null ? delete s[k] : (s[k] = v);
      return s;
    },
  });
}
