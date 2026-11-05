// What every hint file shares: the wording of a measured value, and the thresholds that decide whether a fact is worth a line.
/** noon and midnight closer than this share of the brighter one: "time barely changes the picture" (a hint threshold, never printed as a goal) */
export const TIME_FLAT = 0.15;
/** Fog over this share of the picture: 'fog-cover' reports it, and it is printed before a time-flat line (a hint threshold, never printed as a goal) */
export const FOG_MUCH = 0.25;
/** Shadowed pixels this much darker than lit, with the fill adding under this share of the lit brightness there: 'shadow-black' (hint thresholds, no goals) */
export const SHADOW_BLACK = { depth: 0.85, fill: 0.05 };
/** Shares of the picture from which shadow stripes / stepped edges are worth a line, the screen pixels a shadow map pixel must span to show as a step, the share that may change by itself before edges are not read (hint thresholds, no goals) */
export const SHADOW_EDGE = { stripes: 0.01, jag: 0.005, texelPx: 3, noise: 0.02 };
// small shares keep two decimals: a glare spot is often under 0.1% of the picture and "0.0%" read as nothing
export const pc = x => `${(x * 100).toFixed(x > 0 && x < 0.001 ? 3 : x > 0 && x < 0.01 ? 2 : 1)}%`;
// two decimals, but small values (a bias of -0.00005) keep two significant digits instead of printing 0
export const r2 = x => (typeof x !== 'number' ? x : x !== 0 && Math.abs(x) < 0.01 ? +x.toPrecision(2) : +x.toFixed(2));
/** "engine.lights.sun intensity 3.2" from a probe param { name, value, writer? } */
export const said = p => (p ? `${p.name} ${typeof p.value === 'object' ? JSON.stringify(p.value) : r2(p.value)}${p.writer ? ` (${p.writer})` : ''}` : null);
export const list = ps => ps.map(said).filter(Boolean).join(', ');
