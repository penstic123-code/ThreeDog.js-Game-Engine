// describe().render: what the renderer, lights and post effects are set to now, and who set each value.
// Tags: 'engine' = engine default, 'style' = the style pack (or sky) set it, 'game' = the value differs from what engine/style set (the game changed it).
// This is information only: the engine never warns when a game changes the renderer or lights; the tags just tell an AI where a look came from.
import { TONE } from './sceneMethods.js';
import { SHADOW_TYPES } from './shadowTypes.js';
import { r1 } from './math.js';

const toneName = v => Object.keys(TONE).find(k => TONE[k] === v) ?? String(v);
const shadowName = v => Object.keys(SHADOW_TYPES).find(k => SHADOW_TYPES[k].three === v) ?? String(v);

/**
 * Record what engine and style set at construction; describeRender compares the live values against it.
 * @param {any} e
 * @param {{ owned: boolean }} o owned: false when the game passed its own renderer (then the style's tone mapping / exposure were not applied by the engine)
 */
export function recordRender(e, { owned }) {
  const r = e.renderer, st = e.style;
  e._renderBase = {
    owned,
    toneMapping: r.toneMapping, exposure: r.toneMappingExposure, shadowType: r.shadowMap.type,
    from: { tone: owned && st.toneMapping != null, exposure: owned && st.exposure != null },
    lights: Object.fromEntries(Object.entries(e.lights).map(([k, l]) => [k, l.intensity])),
  };
}

/** One tagged value: 'game' when it moved off the recorded value, else 'style' or 'engine' */
const by = (base, now, styled) => (now !== base ? 'game' : styled ? 'style' : 'engine');

/** The render section: structured data plus one compact text block (`text`) @param {any} e */
export function describeRender(e) {
  const r = e.renderer, b = e._renderBase;
  if (!b) return undefined;
  const sky = e.modules.has('sky');   // sky drives the default lights and exposure each frame, so those count as style, not a game change
  const tone = { value: toneName(r.toneMapping), by: by(b.toneMapping, r.toneMapping, b.from.tone) };
  const exposure = { value: r1(r.toneMappingExposure), by: e.exposureDriver ? 'style' : by(b.exposure, r.toneMappingExposure, b.from.exposure) };
  const shadows = { enabled: r.shadowMap.enabled, type: shadowName(r.shadowMap.type), by: by(b.shadowType, r.shadowMap.type, false) };
  const styleFx = new Set((e.style.post || []).map(x => x?.name));
  const post = (e.post?._list || []).map(h => ({ name: h.name, on: h.enabled, params: { ...h.params }, by: styleFx.has(h.name) ? 'style' : 'game' }));
  const lights = Object.entries(e.lights || {}).map(([name, l]) => ({ name, type: l.type, intensity: r1(l.intensity), by: sky ? 'style' : by(b.lights[name], l.intensity, false) }));
  const kv = x => Object.entries(x).map(([k, v]) => `${k}=${typeof v === 'number' ? r1(v) : v}`).join(' ');
  const text = [
    `renderer: ${tone.value} (${tone.by}) exposure ${exposure.value} (${exposure.by}) shadows ${shadows.enabled ? shadows.type : 'off'} (${shadows.by})${b.owned ? '' : ' [game-supplied renderer]'}`,
    `post: ${post.map(x => `${x.name}${x.on ? '' : ' off'}${Object.keys(x.params).length ? `{${kv(x.params)}}` : ''} (${x.by})`).join(', ') || 'none'}${e.post?.antialias ? ' + MSAA' : ''}`,
    `lights: ${lights.map(l => `${l.name} ${l.type} ${l.intensity} (${l.by})`).join(', ')}`,
  ].join('\n');
  return { toneMapping: tone, exposure, shadows, post, lights, text };
}
