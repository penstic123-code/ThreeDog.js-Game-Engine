// describe().render: renderer, post, lights and probes. Facts read from three.js and the post chain.
// Who set a value lives in one place, describe().look: each `look` here is the path of that record ('look.tone.exposure'), and `writer` is copied
// from that record, not a second answer worked out again (review r2 #11); 'engine' when no look part covers it. `writer` is the one "who set it"
// field name across describe() (look, owned, render), so a tool never has to know which section says `by` and which says `writer`.
// This is information only: the engine never warns when a game changes the renderer or lights.
import { SHADOW_TYPES } from './shadowTypes.js';
import { describeLook } from './look/report.js';
import { rv } from './math.js';
import { toneName } from './look/coreParts.js';
import { defineOwned } from './owned.js';

const shadowName = v => Object.keys(SHADOW_TYPES).find(k => SHADOW_TYPES[k].three === v) ?? String(v);

/**
 * Record how the renderer was made.
 * @param {any} e
 * @param {{ owned: boolean }} o owned: false when the game passed its own renderer (then the style's tone mapping / exposure were not applied by the engine)
 */
export function recordRender(e, { owned }) {
  // tone mapping is written once at creation (coreParts.js). Who writes it now is one owned record like every other look value (core/owned.js),
  // not a comparison against a remembered creation value here: a direct renderer.toneMapping write yields it ('three (engine yielded)'), quietly (once),
  // because that write is the documented way to change the curve. A game-supplied renderer (owned false) starts manual: the engine never wrote it
  e._oTone = defineOwned(e, { id: 'toneMapping', part: 'tone', key: 'toneMapping', read: () => e.renderer.toneMapping, objects: [e.renderer], once: true,
    write: v => { e.renderer.toneMapping = v; }, levels: { manual: "engine.look.tone.manual('toneMapping')" } });
  if (owned) e._oTone.mark(); else e._oTone.manual(true, 'game renderer');
  // style vs engine only says which default the creation write used (the pack named a curve, or the baseline AgX)
  e._renderBase = { owned, toneBy: e.style?.toneMapping != null ? 'style' : 'engine' };
}

/** The render section: structured data plus one compact text block (`text`) @param {any} e */
export function describeRender(e) {
  const r = e.renderer, b = e._renderBase;
  if (!b) return undefined;
  const look = describeLook(e) ?? {};
  // { look, writer }: the record to read in describe().look and its writer; 'engine' (no look record) when no part covers it
  const who = (part, key) => { const row = look[part]?.[key]; return row ? { look: `look.${part}.${key}`, writer: row.writer } : { look: null, writer: 'engine' }; };
  e._oTone.check();   // a direct write since the last look turns the record to 'yielded' (quiet: no warning)
  // a post effect in the 'tone' slot replaces the tone-mapping stage (render/PostFX.js): then it, not renderer.toneMapping, makes the picture
  const toneFx = e.post?._list?.find(h => h.slot === 'tone' && h.enabled);
  const tone = toneFx ? { value: `post effect '${toneFx.name}' (tone slot)`, ...who('post', `${toneFx.name}.enabled`) }
    : { value: toneName(r.toneMapping), writer: e._oTone.on ? b.toneBy : 'game' };
  const exposure = { value: rv(r.toneMappingExposure), ...who('tone', 'exposure') };   // keyframes / a function: the value used this frame
  const shadows = { enabled: r.shadowMap.enabled, type: shadowName(r.shadowMap.type), ...who('shadow', 'type') };
  const post = (e.post?._list || []).map(h => ({ name: h.name, on: h.enabled, params: { ...h.params }, ...who('post', `${h.name}.enabled`),
    ...(e.post._offWhy?.[h.name] && !h.enabled ? { why: e.post._offWhy[h.name] } : {}) }));
  const lights = Object.entries(e.lights || {}).filter(([, l]) => l.parent)
    .map(([name, l]) => ({ name, type: l.type, intensity: rv(l.intensity), source: 'engine-default', ...who('lights', `${name}.intensity`) }));
  // the game's own point / spot lights (core/gameLights.js): adopted like a lightPool light, listed with the line that added them
  for (const l of e._gameLights?.list() ?? []) lights.push({ name: l.name || l.type, type: l.type, intensity: rv(l.intensity), castShadow: l.castShadow,
    source: 'game', writer: 'game', at: e._things?.entryOf(l)?.[0]?.at ?? null, ...(e._gameLights.idled(l) ? { shadowIdled: true } : {}) });
  const kv = x => Object.entries(x).map(([k, v]) => `${k}=${typeof v === 'number' ? rv(v) : v}`).join(' ');
  const srgb = r.outputColorSpace === 'srgb' ? '' : ' (WRONG: colors are encoded for srgb; color textures must be srgb, data maps linear, see assets.report)';
  let text = [
    `renderer: ${tone.value} (${tone.writer}) exposure ${exposure.value} (${exposure.writer}) shadows ${shadows.enabled ? shadows.type : 'off'} (${shadows.writer})${b.owned ? '' : ' [game-supplied renderer]'} output ${r.outputColorSpace}${srgb}`,
    `post: ${post.map(x => `${x.name}${x.on ? '' : x.why ? ' off (low-tier default)' : ' off'}${Object.keys(x.params).length ? `{${kv(x.params)}}` : ''} (${x.writer})`).join(', ') || 'none'}${e.post?.antialias ? ' + MSAA' : ''}`,
    `lights: ${lights.map(l => `${l.name} ${l.type} ${l.intensity} (${l.writer}${l.at ? ' ' + l.at : ''})`).join(', ')}`,
  ].join('\n');
  // probe sets (render/probes.js): how many, how dense, who made them and who writes the scene probe now
  const probes = [...(e._probeSets ?? [])].map(s => s.info());
  if (probes.length) text += `\nprobes: ${probes.map(p => `${p.count} (${p.counts.join('x')}, step ${p.step.join('/')}) from ${p.source} by ${p.owner}, follow ${p.follow}${p.writer ? ` (${p.writer})` : ''}`).join('; ')}`;
  const dv0 = e.debug?.viewState?.(), dv = dv0 && dv0.mode !== 'off' ? dv0 : null;
  if (dv) text = `DEBUG VIEW "${dv.mode}" (by ${dv.owner}) is ON: ${dv.what}. This is NOT the real look; the debug view 'off' restores it.
` + text;
  // render scale: the canvas resolution against the display. auto: the adaptive resolution lowered it at some point (it raises it back when frames are fast)
  const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1, cur = r.getPixelRatio(), ad = e.adaptive;
  const scale = { current: Math.round(cur * 100) / 100, devicePixelRatio: dpr, upscaled: cur < dpr - 0.01, autoLowered: !!ad?.lowered && cur < (ad.max ?? cur) - 0.01,
    adaptive: !!ad?.on, floor: ad?.min ?? null, max: ad?.max ?? null };
  text += `
render scale: ${scale.current} of device pixel ratio ${dpr}${scale.upscaled ? ' (picture is upscaled, softer than the screen)' : ''}${scale.autoLowered ? ` (auto-lowered by adaptive resolution, floor ${scale.floor}; adaptiveResolution: false turns it off)` : ''}`;
  return { debugView: dv, scale, toneMapping: tone, exposure, shadows, post, lights, probes, text };
}
