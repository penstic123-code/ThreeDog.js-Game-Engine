// Day and night as a signal. engine.uniforms.uNight is 0 by day and 1 at night; lightPool sources with `dusk` fade on this same curve, so a game's
// emissive windows that read uNight switch on together with the lamps instead of two curves drifting apart.

// default dusk: lights fade in as daylight drops below 0.3 (calendar daylight: about 16:50 -> fully lit at 18:00). It is only a starting value:
// each lightPool source may pass its own `dusk`, and a game's own fade reads uDaylight with its own edge
export const DUSK = 0.3;

/** Daylight 0..1 from the 'daylight' measure (engine.audio.measure): the calendar registers it (gameplay day / night), the sky only when no
 * calendar did (the drawn sun). Read through the measure, not e.calendar / e.sky, so render/ names no module and a game's own clock module counts
 * the same by registering the measure. null when nothing tells day from night */
export const daylightOf = e => { const d = e.audio?.measures.get('daylight')?.(e); return typeof d === 'number' ? d : null; };
/**
 * 0 by day, 1 at night for one dusk (daylight below which it fades in); null daylight -> 0 (the day value is kept). dusk 0 has no fade:
 * on only while daylight is 0 (a cave mushroom that glows only in full dark); the d / dusk curve would divide by zero there
 */
export function nightOf(d, dusk) {
  if (d === null) return 0;
  if (dusk === 0) return d > 0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, d / dusk));
  return 1 - t * t * (3 - 2 * t);   // smoothstep: no visible kink when the fade starts or ends
}

/**
 * Once per frame, before the modules' frame hooks. uDaylight is written from the measure so a calendar with no sky still tells a shader the time of
 * day; the sky's own frame then writes its drawn sun over it, as it always has.
 * @internal core/loop.js
 * @param {any} e
 */
export function writeDaylight(e) {
  const d = daylightOf(e);
  e.uniforms.uNight.value = nightOf(d, DUSK);
  if (d !== null) e.uniforms.uDaylight.value = d;
}
