// The engine uniforms renamed for 0.8 (MIGRATING-0.8.md). These names live inside a game's shader text, where a stale one is a bare `uniform float uCloud;`
// reading 0 forever, with no error anywhere. So in development the old name says so once: on engine.uniforms and engine.sky.uniforms, on the TSL nodes, and in
// any shader text the engine is handed. It only speaks: the name stays gone (reads give undefined), so a game cannot work in dev and break in the build.
// This help ends at 1.0: delete this file and its call sites then.
import { DEV, warnOnce } from '../core/validate.js';

/** Old name -> new name on engine.uniforms, in patches and in c.fx.uniform() */
const RENAMED_UNIFORMS = {
  uCloudScale: 'uCloudShadowScale', uCloudSpeed: 'uCloudShadowSpeed', uCloud: 'uWeatherCloud', uCurve: 'uSkyCurve', uCover: 'uGroundCover',
  uSunPower: 'uSunBrightness', uMoonPower: 'uMoonBrightness',
};
/** In the dome's own scope (engine.sky.uniforms, engine.sky.clouds(), dome layers) the old uCloudScale was the dome clouds', not the shadows' */
export const RENAMED_DOME_UNIFORMS = { ...RENAMED_UNIFORMS, uCloudScale: 'uSkyCloudScale', uCloudSpeed: 'uSkyCloudSpeed' };

const say = (old, now, where) => warnOnce(`${where}: the uniform ${old} is now ${now} (0.8); the old name reads nothing. See MIGRATING-0.8.md.`, `uniform-renamed:${where}:${old}`);

/** Non-enumerable, so nothing that walks the uniforms (declarations, TSL nodes, three) ever sees the old names. @template T @param {T} target @param {string} where @returns {T} */
export function watchRenamed(target, where, table = RENAMED_UNIFORMS) {
  if (!DEV) return target;
  for (const [old, now] of Object.entries(table)) Object.defineProperty(target, old, { enumerable: false, configurable: true, get() { say(old, now, where); return undefined; } });
  return target;
}
/** One name asked for by string. @param {string} name @param {string} where */
export function noteRenamed(name, where, table = RENAMED_UNIFORMS) {
  if (DEV && Object.hasOwn(table, name)) say(name, table[name], where);
}
/** A word of shader text with an old name, unless the code brings its own uniform by that name. @param {unknown[]} texts @param {string} where @param {object} [own] */
export function scanRenamed(texts, where, own, table = RENAMED_UNIFORMS) {
  if (!DEV) return;
  const text = texts.filter(t => typeof t === 'string').join('\n');
  for (const [old, now] of Object.entries(table)) if (!own?.[old] && new RegExp(`\\b${old}\\b`).test(text)) say(old, now, where);
}
