// describe().render: what the renderer, lights and post effects are set to now (facts read from three.js and the post chain).
// Who set a value lives in one place, describe().look: each `by` here is the path of that record ('look.tone.exposure'), not a second
// answer worked out again (review r2 #11); 'engine' when no look part covers it. The text line shows the look record's tag for reading.
// This is information only: the engine never warns when a game changes the renderer or lights.
import { SHADOW_TYPES } from './shadowTypes.js';
import { describeLook } from './look/report.js';
import { r1 } from './math.js';

const shadowName = v => Object.keys(SHADOW_TYPES).find(k => SHADOW_TYPES[k].three === v) ?? String(v);

/**
 * Record how the renderer was made.
 * @param {any} e
 * @param {{ owned: boolean }} o owned: false when the game passed its own renderer (then the style's tone mapping / exposure were not applied by the engine)
 */
export function recordRender(e, { owned }) {
  e._renderBase = { owned };
}

/** The render section: structured data plus one compact text block (`text`) @param {any} e */
export function describeRender(e) {
  const r = e.renderer, b = e._renderBase;
  if (!b) return undefined;
  const look = describeLook(e) ?? {};
  const who = (part, key) => (look[part]?.[key] ? `look.${part}.${key}` : 'engine');   // the record to read in describe().look
  const tag = path => { const [, part, ...k] = path.split('.'); return look[part]?.[k.join('.')]?.by ?? 'engine'; };   // for the text line only
  const tone = { value: look.tone?.mapping?.value, by: who('tone', 'mapping') };
  const exposure = { value: r1(r.toneMappingExposure), by: who('tone', 'exposure') };   // keyframes / a function: the value used this frame
  const shadows = { enabled: r.shadowMap.enabled, type: shadowName(r.shadowMap.type), by: who('shadow', 'type') };
  const post = (e.post?._list || []).map(h => ({ name: h.name, on: h.enabled, params: { ...h.params }, by: who('post', `${h.name}.enabled`),
    ...(e.post._offWhy?.[h.name] && !h.enabled ? { why: e.post._offWhy[h.name] } : {}) }));
  const lights = Object.entries(e.lights || {}).filter(([, l]) => l.parent)
    .map(([name, l]) => ({ name, type: l.type, intensity: r1(l.intensity), source: 'engine-default', by: who('lights', `${name}.intensity`) }));
  const kv = x => Object.entries(x).map(([k, v]) => `${k}=${typeof v === 'number' ? r1(v) : v}`).join(' ');
  const srgb = r.outputColorSpace === 'srgb' ? '' : ' (WRONG: colors are encoded for srgb; color textures must be srgb, data maps linear, see assets.report)';
  let text = [
    `renderer: ${tone.value} (${tag(tone.by)}) exposure ${exposure.value} (${tag(exposure.by)}) shadows ${shadows.enabled ? shadows.type : 'off'} (${tag(shadows.by)})${b.owned ? '' : ' [game-supplied renderer]'} output ${r.outputColorSpace}${srgb}`,
    `post: ${post.map(x => `${x.name}${x.on ? '' : x.why ? ' off (low-tier default)' : ' off'}${Object.keys(x.params).length ? `{${kv(x.params)}}` : ''} (${tag(x.by)})`).join(', ') || 'none'}${e.post?.antialias ? ' + MSAA' : ''}`,
    `lights (engine-added defaults; extra scene lights are not listed): ${lights.map(l => `${l.name} ${l.type} ${l.intensity} (${tag(l.by)})`).join(', ')}`,
  ].join('\n');
  const dv0 = e.debug?.viewState?.(), dv = dv0 && dv0.mode !== 'off' ? dv0 : null;
  if (dv) text = `DEBUG VIEW "${dv.mode}" (by ${dv.owner}) is ON: ${dv.what}. This is NOT the real look; the debug view 'off' restores it.
` + text;
  // render scale: the canvas resolution against the display. auto: the adaptive resolution lowered it at some point (it raises it back when frames are fast)
  const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1, cur = r.getPixelRatio(), ad = e.adaptive;
  const scale = { current: Math.round(cur * 100) / 100, devicePixelRatio: dpr, upscaled: cur < dpr - 0.01, autoLowered: !!ad?.lowered && cur < (ad.max ?? cur) - 0.01,
    adaptive: !!ad?.on, floor: ad?.min ?? null, max: ad?.max ?? null };
  text += `
render scale: ${scale.current} of device pixel ratio ${dpr}${scale.upscaled ? ' (picture is upscaled, softer than the screen)' : ''}${scale.autoLowered ? ` (auto-lowered by adaptive resolution, floor ${scale.floor}; adaptiveResolution: false turns it off)` : ''}`;
  return { debugView: dv, scale, toneMapping: tone, exposure, shadows, post, lights, text };
}
