// Hints about shadows: shadows on but none measurable, shadowed pixels near black, stripes and stepped edges of the shadow map.
// Each hint takes the h of pictureHints (hints.mjs).
import { shadowEdges } from './numbers.mjs';
import { pc, r2, said, list, SHADOW_BLACK, SHADOW_EDGE } from './hint-text.mjs';

/** The shadow mask travels from the page once and is read here (one path for pagePicture and for a test page); the bytes do not stay in --json */
export function readEdgeMask(sh) {
  if (!sh?.edgeMask) return;
  const { w, h, b64 } = sh.edgeMask, bits = Buffer.from(b64, 'base64'), m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = (bits[i >> 3] >> (i & 7)) & 1;
  sh.edges = shadowEdges(m, w, h); delete sh.edgeMask;
}

/** Cascades as the game can reach them, by the light they go on (recipe 45) */
export const cascadeWayOf = sh => (sh?.split === 'engine' ? 'large scene: engine.shadows.cascades(engine.lights.sun, { count: 3 })'
  : sh?.split === 'own' ? 'large scene: engine.shadows.cascades(light, { count: 3 }) (recipe 45)' : null);

/** Why shadows cannot be measured: { cause, short }; cause null when nothing is wrong */
function invisibleCause({ sh, P, cascadeWay }) {
  let cause, short = null;
  if (sh.intensity === 0) cause = `the shadow intensity is 0 (${said(P.shadowIntensity)})`;
  else if (sh.mask && sh.mask.area >= 0.003) cause = `the shadow map has them (with direct light only they cover ${pc(sh.mask.area)}), the light in shadow washes them out: fill ${list([P.hemi, P.env, P.ambient])} against ${said(P.sun)}`;
  else {
    const c = [];
    if (sh.biasMeters >= 0.5) c.push(`${said(P.bias)} = ${r2(sh.biasMeters)} m of the ${r2(sh.depthRange)} m shadow depth range, which moves the shadow test past the casters`);
    if (sh.normalBias >= 0.5) c.push(`${said(P.normalBias)} m`);
    if (sh.outside) c.push(`the camera looks at a point ${r2(sh.viewDist)} m from the shadow box center and the box is ±${r2(sh.extent)} m (${said(P.extent)}, follow ${P.follow ? said(P.follow) : 'n/a'})`);
    if (sh.texel >= 0.3) {
      c.push(`one shadow texel covers ${r2(sh.texel)} m (${list([P.extent, P.mapSize])}), small casters vanish${cascadeWay ? `; ${cascadeWay}` : ''}`);
      // the printed line keeps the way out: the whole cause runs past LINE_MAX and clipLine would cut the usage first
      if (cascadeWay) short = `one shadow texel covers ${r2(sh.texel)} m; ${cascadeWay}`;
    }
    // no setting stands out and the sun is behind the camera: the shadows fall behind the casters, out of sight; that is no contradiction
    if (!c.length && sh.sunBehind) cause = null;
    else cause = c.length ? c.join('; ') : `no shadow setting stands out (${list([P.bias, P.normalBias, P.extent, P.mapSize])}); check castShadow / receiveShadow on the meshes in view (${sh.casters} cast, ${sh.receivers} receive)`;
  }
  return { cause, short };
}

/** Shadows on, something casts, the sun is up and lit, yet no pixel gets darker from the shadow */
export function shadowInvisible(h) {
  const { sh, add } = h;
  if (!(sh && sh.casters > 0 && sh.sunLit && sh.area < 0.003)) return;
  const fact = `shadows are on (${sh.casters} casting meshes, key light lit) but none is measurable in this view: turning shadow intensity to 0 changes ${pc(sh.area)} of the picture`;
  const { cause, short } = invisibleCause(h);
  if (cause) add('contradiction', 'shadow-invisible', `${fact}. Likely cause: ${cause}.`, sh.mask?.area ?? 0.05,
    `shadows on (${sh.casters} casters) but none measurable (${pc(sh.area)} of the picture changes without them); likely: ${short ?? cause}.`);
}

/** Shadowed pixels near black with almost no fill there: a fact (a hard-noon or horror look may want it), with the two ways to bring light into them */
export function shadowBlack({ sh, P, add }) {
  const dk0 = sh?.dark;
  if (dk0 && sh.depth >= SHADOW_BLACK.depth && dk0.fill < SHADOW_BLACK.fill) {
    const fillNow = list([P.hemi, P.env, P.ambient]) || 'no hemisphere, ambient or environment light in the scene';
    const ways = 'light probes, await engine.bakeProbes({ bounds, spacing: 4 }), or a fill light, scene.add(new THREE.HemisphereLight(sky, ground, intensity))';
    add('fact', 'shadow-black', `the shadowed ${pc(sh.area)} of the picture is nearly black (mean luma ${r2(dk0.luma)}, ${pc(sh.depth)} darker than lit) and the fill adds ${pc(dk0.fill)} of the lit brightness there (${fillNow}). ` +
      `For detail in the shadows: ${ways} (recipe 34).`, sh.area, `shadows ${pc(sh.depth)} darker than lit, fill ${pc(dk0.fill)} there; for detail: ${ways}.`);
  }
}

/** Stripes and stepped edges of the shadow map (shadowEdges), measured on the shadow alone. Facts: a pixel-art or hard-edged look may want the blocks */
export function shadowEdgeHints({ sh, cascadeWay, add }) {
  const ed = sh?.edges;
  if (sh?.edgeNoise >= SHADOW_EDGE.noise) add('fact', 'shadow-edges-unread', `shadow stripes and stepped edges not measured: ${pc(sh.edgeNoise)} of the picture changes between two identical renders (film grain or animated post), which reads as stripes that are not there.`, 0,
    `shadow edges not measured: ${pc(sh.edgeNoise)} of the picture changes by itself (grain or animated post).`);
  else if (ed) {
    const values = `${list(sh.settings ?? [])}, shadow depth range ${r2(sh.depthRange)} m`;
    if (ed.stripes >= SHADOW_EDGE.stripes)
      add('fact', 'shadow-stripes', `shadow stripes on ${pc(ed.stripes)} of the picture (thin lit / shadowed bands on surfaces, read at canvas pixels): a surface shadowing itself, or many thin casters such as leaves or a fence. In play: ${values}.`, ed.stripes,
        `shadow stripes on ${pc(ed.stripes)} of the picture (self-shadowing or thin casters); in play: ${values}.`);
    // Why the texel gate: leaf and fence shadows have corners too, and a map whose pixels are smaller than a step cannot be what made it
    if (ed.jag >= SHADOW_EDGE.jag && !(sh.texelPx < SHADOW_EDGE.texelPx))
      add('fact', 'shadow-jag', `stepped shadow edges on ${pc(ed.jag)} of the picture (read at canvas pixels): shadow map pixels seen as blocks, or many small casters. In play: ${values}${sh.texelPx ? `, one shadow texel is about ${r2(sh.texelPx)} screen pixels at the view's focus` : ''}${cascadeWay ? `; ${cascadeWay}` : ''}.`, ed.jag,
        `stepped shadow edges on ${pc(ed.jag)} of the picture; in play: ${values}${cascadeWay ? `; ${cascadeWay}` : ''}.`);
  }
}
