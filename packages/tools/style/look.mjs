// The look check printed after every `threedog shot` and `threedog snap` (pageLook), and on a saved picture by `threedog shot --image` (imageLook,
// pixel facts only): numbers from the pixels plus hints of three kinds only.
//   contradiction: a setting says X, the pixels show not-X (shadows on but none measurable, a light that changes no pixel). Style-independent.
//   fact:          something measured that may or may not be wanted, with its cost: glare, large clipped or near-black areas, a night that is not
//                  dark from lighting (time-flat), the key / fill balance. A game may want blinding light, deep black or a bright night, so each is
//                  a contradiction only where DESIGN.md declares the opposite (readIntent: no-glare, no-pitch-black, dark-nights, strong-light).
//   intent:        the numbers clearly disagree with what the game itself declared (DESIGN.md "Look intent" line, or --ref).
//                  No declaration and no reference -> numbers only, no judgement.
// Every hint states the fact and the likely cause as a parameter name with its current value, never a target value: the thresholds below only
// decide whether a fact is worth a line, they are not printed as goals. Nothing here fails a check or changes the game.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { luma } from './pixels.mjs';

/** the probe picture's width (probeLook's default size): a saved picture is read at this width too, so its spots and shares compare with a shot's */
const PROBE_W = 240;

/**
 * What counts as clipped: one channel at the top AND bright overall. Why not "all channels >= 250": warm blow-outs (255, 240, 200: a lamp head,
 * the wall beside it) never have blue at the top, so a rainy night full of glaring lamps measured 0% overexposed. Why the luma floor: a saturated
 * pure red sign (255, 0, 0) has a channel at the top but is not blown out. Used by lookNumbers (node) and passed to probeLook (page) so both agree.
 */
const CLIP = { channel: 250, luma: 0.75 };
/**
 * Near white, for glare spots: a light's hotspot measured on the small probe picture (240 wide) averages with its surroundings, so a lamp head
 * that is 252 on the full shot reads ~245 there. The whole-picture share keeps CLIP (a bright overcast sky is near white without being a fault);
 * HOT is only used for spots and for what one light or glowing material blows out (probeLook glare).
 */
export const HOT = { channel: 240, luma: 0.7 };

/**
 * Whole-picture numbers of RGBA bytes: lookStats' four plus contrast (std of luma) and range (luma p95 - p5), and, with the width, hotspots:
 * the near-white (HOT) pixels grouped into spots (4-connected, 3+ pixels). Why spots: a few glaring lamps are a small share of the picture, so
 * the share alone stays near 0 while each spot is plainly blown out.
 * @param {Uint8Array | Buffer} rgba @param {number} [width] image width in pixels (no hotspots without it)
 */
export function lookNumbers(rgba, width) {
  const n = rgba.length / 4, L = new Float32Array(n), hot = new Uint8Array(n);
  let lum = 0, sat = 0, over = 0, dark = 0;
  for (let i = 0, k = 0; i < rgba.length; i += 4, k++) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    lum += L[k] = luma([r, g, b]); if (mx) sat += (mx - mn) / mx;
    if (mx >= CLIP.channel && L[k] >= CLIP.luma) over++;
    if (mx >= HOT.channel && L[k] >= HOT.luma) hot[k] = 1;
    if (mx <= 20) dark++;
  }
  if (!n) return { luminance: 0, saturation: 0, contrast: 0, range: 0, overexposed: 0, dark: 0, hotspots: 0 };
  const m = lum / n;
  let v = 0; for (const x of L) v += (x - m) ** 2;
  const s = L.slice().sort(), p = q => s[Math.min(n - 1, Math.floor(q * n))];
  const r3 = x => +x.toFixed(3);
  return { luminance: r3(m), saturation: r3(sat / n), contrast: r3(Math.sqrt(v / n)), range: r3(p(0.95) - p(0.05)), overexposed: r3(over / n), dark: r3(dark / n),
    hotspots: width ? spots(hot, width).length : 0 };
}

/** Sizes of the 4-connected groups of set pixels with 3 or more pixels (a flood fill; the probe picture is small) */
function spots(mask, w) {
  const seen = new Uint8Array(mask.length), out = [], stack = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let size = 0; seen[i] = 1; stack.push(i);
    while (stack.length) {
      const j = stack.pop(); size++;
      const x = j % w;
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) if (k >= 0 && k < mask.length && mask[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
    }
    if (size >= 3) out.push(size);
  }
  return out;
}

// ── intent: the optional "Look intent:" line of DESIGN.md, the one place a game declares what its look wants ──
// Why a line of listed words and nothing else: free text read by keywords missed a rephrased wish ("lamps must not blind") silently, and two
// ways to declare could disagree. A word the list does not know is reported, never guessed.
export const INTENT_WORDS = {
  'bright': { want: 'bright' }, 'dark': { want: 'dark' }, 'high-contrast': { want: 'highContrast' }, 'low-contrast': { want: 'lowContrast' },
  'saturated': { want: 'saturated' }, 'muted': { want: 'muted' }, 'strong-light': { want: 'strongLight' },
  'dark-nights': { want: 'dark', when: 'night' }, 'bright-nights': { want: 'bright', when: 'night' },
  'no-glare': { want: 'noGlare' }, 'no-pitch-black': { want: 'noBlack' },
};
const INTENT_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?look intent(?:\*\*)?\s*(?:\([^)]*\))?\s*(?:\*\*)?\s*[:：]\s*(.*)$/im;
const OPPOSITE = { bright: 'dark', dark: 'bright', highContrast: 'lowContrast', lowContrast: 'highContrast', saturated: 'muted', muted: 'saturated' };

/**
 * Declared look words of a DESIGN.md text, from its "Look intent:" line: [{ want, word, row: 'Look intent', clause, when: 'night' | null }].
 * No line, or only "(none)": [] (numbers only, no judgement). An unlisted word comes back as want 'unknown'. Opposite words in one time
 * context are dropped (no clear intent).
 */
export function readIntent(text) {
  const line = String(text ?? '').match(INTENT_LINE)?.[1].trim() ?? '';
  const words = line.toLowerCase().split(/[\s,;，；、]+/).filter(w => w && !/^\(.*\)$/.test(w));
  return dropOpposites(words.map(w => INTENT_WORDS[w]
    ? { want: INTENT_WORDS[w].want, word: w, row: 'Look intent', clause: w, when: INTENT_WORDS[w].when ?? null }
    : { want: 'unknown', word: w, row: 'Look intent', clause: w, when: null }));
}
const dropOpposites = out => out.filter(a => !out.some(b => b.want === OPPOSITE[a.want] && (b.when === a.when || !b.when || !a.when)));
/** "differs from DESIGN.md: you wrote ..." for a declared wish, '' without one */
const wrote = a => a ? `differs from DESIGN.md: you wrote '${a.clause}' (${a.row}); ` : '';

// ── hints ──
/** noon and midnight closer than this share of the brighter one: "time barely changes the picture" (a hint threshold, never printed as a goal) */
export const TIME_FLAT = 0.15;
// small shares keep two decimals: a glare spot is often under 0.1% of the picture and "0.0%" read as nothing
const pc = x => `${(x * 100).toFixed(x > 0 && x < 0.001 ? 3 : x > 0 && x < 0.01 ? 2 : 1)}%`;
// two decimals, but small values (a bias of -0.00005) keep two significant digits instead of printing 0
const r2 = x => (typeof x !== 'number' ? x : x !== 0 && Math.abs(x) < 0.01 ? +x.toPrecision(2) : +x.toFixed(2));
/** "look.lights sun.intensity 3.2 (style)" from a probe param { name, value, writer } */
const said = p => (p ? `${p.name} ${typeof p.value === 'object' ? JSON.stringify(p.value) : r2(p.value)}${p.writer ? ` (${p.writer})` : ''}` : null);
const list = ps => ps.map(said).filter(Boolean).join(', ');
const LEVERS = {
  luminance: ['exposure', 'sun', 'hemi', 'env'],
  contrast: ['sun', 'hemi', 'env', 'shadowIntensity', 'fog'],
  saturation: ['fog', 'post'],
};
const levers = (P, k) => list(LEVERS[k].map(n => P[n])) + (k === 'saturation' ? (P.post || P.fog ? ', ' : '') + 'the material / palette colors in style/' : '');

/**
 * Hints from the screenshot numbers, the page probe (probeLook) and the declared intent.
 * @param {{ numbers: any, probe?: any, intent?: any[], isDay?: boolean | null, ref?: any }} o ref: a compareImages result
 * @returns {{ kind: 'contradiction' | 'fact' | 'intent', id: string, text: string }[]}
 */
export function lookHints({ numbers: N, probe, intent = [], isDay = null, ref = null }) {
  const out = [], P = probe?.params ?? {}, add = (kind, id, text, size = 0, brief) => out.push({ kind, id, text, size, ...(brief && { brief }) });
  // size: the measured share of the picture (or of its brightness) the hint is about; formatLook ranks by it and prints `brief` (one sentence:
  // measured -> source -> value), --json keeps the full `text`
  const sh = probe?.shadows;
  // shadows on, something casts, the sun is up and lit, yet no pixel gets darker from the shadow
  if (sh && sh.casters > 0 && sh.sunLit && sh.area < 0.003) {
    // name the body actually lighting: at night the sky moves engine.lights.sun to the moon (modules/sky/frame.js), "sun up" at 21:40 read as a bug
    const body = sh.body === 'moon' ? 'the moon up: engine.lights.sun carries the moonlight at night' : 'sun up';
    const fact = `shadows are on (${sh.casters} casting meshes, ${body}) but none is measurable in this view: turning shadow intensity to 0 changes ${pc(sh.area)} of the picture`;
    let cause;
    if (sh.intensity === 0) cause = `the shadow intensity is 0 (${said(P.shadowIntensity)})`;
    else if (sh.mask && sh.mask.area >= 0.003) cause = `the shadow map has them (with direct light only they cover ${pc(sh.mask.area)}), the light in shadow washes them out: fill ${list([P.hemi, P.env, P.ambient])} against ${said(P.sun)}`;
    else {
      const c = [];
      if (sh.biasMeters >= 0.5) c.push(`${said(P.bias)} = ${r2(sh.biasMeters)} m of the ${r2(sh.depthRange)} m shadow depth range, which moves the shadow test past the casters`);
      if (sh.normalBias >= 0.5) c.push(`${said(P.normalBias)} m`);
      if (sh.outside) c.push(`the camera looks at a point ${r2(sh.viewDist)} m from the shadow box center and the box is ±${r2(sh.extent)} m (${said(P.extent)}, follow ${P.follow ? said(P.follow) : 'n/a'})`);
      if (sh.texel >= 0.3) c.push(`one shadow texel covers ${r2(sh.texel)} m (${list([P.extent, P.mapSize])}), small casters vanish`);
      // no setting stands out and the sun is behind the camera: the shadows fall behind the casters, out of sight; that is no contradiction
      if (!c.length && sh.sunBehind) cause = null;
      else cause = c.length ? c.join('; ') : `no shadow setting stands out (${list([P.bias, P.normalBias, P.extent, P.mapSize])}); check castShadow / receiveShadow on the meshes in view (${sh.casters} cast, ${sh.receivers} receive)`;
    }
    if (cause) add('contradiction', 'shadow-invisible', `${fact}. Likely cause: ${cause}.`, sh.mask?.area ?? 0.05,
      `shadows on (${sh.casters} casters) but none measurable (${pc(sh.area)} of the picture changes without them); likely: ${cause}.`);
  }
  const t = probe?.time;
  // judged on the part the time should drive (sun / moon, sky fill, environment): lights and glowing materials the game itself switches with the
  // time (street lamps, lit windows) are taken out at both times, else a town whose lamps light the night "does not follow the time" (t.driven)
  const tn = t?.base ?? t;
  // two ways the night fails to be night: (1) noon and midnight look alike; (2) noon is brighter, but the midnight picture is still at least half
  // the noon brightness with every light off: a gray background / fog that never darkens is what lights the night (the round-1 demo's rainy night)
  // both times fully black: nothing here says what the time does, only that the frame is black ('crushed' below reports that once)
  const bothBlack = t && Math.max(tn.noon, tn.midnight) < 0.01;
  const flatTime = t && !bothBlack && Math.abs(tn.noon - tn.midnight) / Math.max(tn.noon, tn.midnight, 0.01) < TIME_FLAT;
  const unlitNight = t && !bothBlack && t.unlit !== undefined && t.unlit >= 0.6 * tn.midnight;
  if (flatTime || (unlitNight && t.unlit >= 0.5 * tn.noon)) {
    const at = w => list([w.sun, w.hemi, w.env, w.exposure]);
    const drv = t.driven?.length ? `, without the ${t.driven.length} light(s) the game switches with the time (${t.driven.slice(0, 4).join(', ')}): ${r2(tn.noon)} / ${r2(tn.midnight)}` : '';
    const fact = `${flatTime ? 'time of day barely changes the picture' : 'the night is not dark from lighting'}: mean luminance ${r2(t.noon)} at 12:00, ${r2(t.midnight)} at 00:00 (same view, same weather)${drv}`;
    let cause;
    if (unlitNight) {
      const fogPart = t.noFog !== undefined && tn.midnight - t.noFog >= 0.3 * tn.midnight;
      cause = `the 00:00 brightness is not lighting: with every light and the environment at 0 it is still ${r2(t.unlit)}. ` +
        (fogPart ? `Most of it is the fog: ${said(t.at.midnight.fog)} at 00:00 (fog color black gives ${r2(t.noFog)}; look.fog)` :
          `What stays lit without light: emissive or unlit materials${t.glow ? ` (switched on by the game at night: ${list(t.glow)})` : ''}, the sky / background${t.at.midnight.background ? ` (${said(t.at.midnight.background)})` : ''}${t.at.midnight.fog ? `, ${said(t.at.midnight.fog)}` : ''}, post effects${P.post ? ` (${said(P.post)})` : ''}`);
    } else cause = `what lights the scene does not follow the time. At 12:00 ${at(t.at.noon)}; at 00:00 ${at(t.at.midnight)}${t.envSource ? `; ${said(t.envSource)}` : ''}`;
    // brief: the one cause that measured, without the long lists (every post pass, every glowing material) the full text keeps
    const glowShort = t.glow?.length ? `glow ${t.glow.slice(0, 2).map(said).join(', ')}${t.glow.length > 2 ? ` +${t.glow.length - 2}` : ''}` : null;
    const brief = unlitNight
      ? (t.noFog !== undefined && tn.midnight - t.noFog >= 0.3 * tn.midnight ? `the fog: ${said(t.at.midnight.fog)}`
        : `not light: ${r2(t.unlit)} with every light off (${[glowShort, t.at.midnight.background && said(t.at.midnight.background), P.post && 'look.post'].filter(Boolean).join(', ') || 'emissive / unlit materials, the sky'})`)
      : `the lights do not follow the time (12:00 ${at(t.at.noon)}; 00:00 ${at(t.at.midnight)})`;
    // a fact unless DESIGN.md wants dark nights: a game may want a bright, readable night (fog color or an unlit sky on purpose)
    const darkNight = intent.find(a => a.want === 'dark' && a.when === 'night');
    add(darkNight ? 'contradiction' : 'fact', 'time-flat', `${wrote(darkNight)}${fact}. What makes it: ${cause}.`, 1 - Math.abs(tn.noon - tn.midnight) / Math.max(tn.noon, tn.midnight, 0.01),
      `${wrote(darkNight)}${flatTime ? 'time barely changes the picture' : 'the night is not dark from lighting'}: luminance ${r2(t.noon)} at 12:00, ${r2(t.midnight)} at 00:00; from: ${brief}.`);
  }
  // outshone: it does change pixels once the sun / sky fill / environment are dimmed (a lamp at dusk under a strong sun): no contradiction
  for (const l of probe?.lights ?? []) if (!l.changed && !l.outshone)
    add('contradiction', 'light-no-effect', `light ${l.name} (${l.type}) changes no pixel in this view although its range reaches the camera's view, even with the sun, sky fill and environment dimmed: intensity ${r2(l.intensity)}` +
      `${l.distance !== undefined ? `, distance ${r2(l.distance)}, decay ${r2(l.decay)}` : ''}, ${r2(l.toCamera)} m from the camera. Likely cause: intensity too low for its units / decay, ` +
      `a range that ends before the lit surfaces, unlit materials in view, or the light on another layer (layers ${l.layers}, camera ${l.cameraLayers}).`, 0.01,
      `light ${l.name} (${l.type}) changes no pixel though its range reaches the view: intensity ${r2(l.intensity)}${l.distance !== undefined ? `, distance ${r2(l.distance)}, decay ${r2(l.decay)}` : ''}.`);
  // large clipped areas: a fact (a game may want a blown-out sky or a blinding scene), a contradiction only under a DESIGN.md no-glare, as glare
  const noGlareWish = intent.find(a => a.want === 'noGlare');
  if (N.overexposed >= 0.1)
    add(noGlareWish ? 'contradiction' : 'fact', 'clipped', `${wrote(noGlareWish)}${pc(N.overexposed)} of the picture is clipped (a channel >= ${CLIP.channel} and luma >= ${CLIP.luma}): no detail is left there. Set by: ${list([P.exposure, P.toneMapping, P.sun, P.env]) || 'exposure / light intensities'}${P.post ? `, ${said(P.post)}` : ''}.`, N.overexposed,
      `${wrote(noGlareWish)}${pc(N.overexposed)} of the picture is clipped; set by: ${list([P.exposure, P.toneMapping, P.sun, P.env]) || 'exposure / light intensities'}${P.post ? ', look.post' : ''}.`);
  // glare: near-white spots a light or a glowing material causes (turning that one source off brings those pixels back below near-white), however
  // small the share: the whole-picture share above never sees a few blown-out lamps. Sun / sky brightness is not attributed to a source here,
  // so a bright day stays quiet
  // A fact, not a contradiction: a game may want blinding light. It turns into a contradiction only when DESIGN.md says no glare (readIntent
  // 'noGlare'), the same rule as every intent hint; what the glare costs (detail lost under it) is stated so the game can weigh it
  const gl = probe?.glare, noGlare = intent.find(a => a.want === 'noGlare');
  const glareKind = noGlare ? 'contradiction' : 'fact', glareWhy = noGlare ? `differs from DESIGN.md: you wrote '${noGlare.clause}' (${noGlare.row}); ` : '';
  // the cost: mean luma edge under what this source blows out, on vs off (probeLook glareOf). Below 0.01 with it off there was no detail to lose
  const cost = d => !d ? '' : d.off < 0.01 ? ', a flat area underneath (no detail lost)'
    : `, the detail under it (luma edge ${r2(d.on)} on, ${r2(d.off)} off) ${d.on < d.off ? `${Math.round((1 - d.on / d.off) * 100)}% lost` : 'kept'}`;
  if (gl?.sources?.length) {
    const what = s => `blows out ${pc(s.clipped)}${cost(s.detail)}${s.halo ? ` and lifts ${pc(s.halo)} more to near white` : ''}`;
    const src = gl.sources.map(s => s.kind === 'light'
      ? `light ${s.name} (${s.type}) ${what(s)}: intensity ${r2(s.intensity)}${s.distance !== undefined ? `, distance ${r2(s.distance)}, decay ${r2(s.decay)}` : ''}, ${r2(s.toCamera)} m from the camera`
      : `material '${s.name}' (${s.meshes} mesh${s.meshes > 1 ? 'es' : ''} in view) ${what(s)}: emissive ${s.emissive} x emissiveIntensity ${r2(s.emissiveIntensity)}${s.toneMapped === false ? ', toneMapped false' : ''}`);
    const ctx = [said(P.exposure), said(P.toneMapping), gl.bloom && `bloom ${gl.bloom.enabled ? `strength ${r2(gl.bloom.strength)}, threshold ${r2(gl.bloom.threshold)}, radius ${r2(gl.bloom.radius)}` : 'off'}`].filter(Boolean).join(', ');
    add(glareKind, 'glare', `${glareWhy}glare: ${pc(gl.clipped)} of the picture is near white (a channel >= ${HOT.channel}, luma >= ${HOT.luma}) in ${N.hotspots || 'some'} spot(s); ` +
      `turning one source off at a time, these bring part of it back: ${src.join('; ')}. Also in play: ${ctx || 'exposure / tone mapping'}.`,
      gl.sources.reduce((a, s) => a + s.clipped + (s.halo || 0), 0),
      `${glareWhy}glare: ${pc(gl.clipped)} near white; ${src[0]}${src.length > 1 ? ` (+${src.length - 1} more source${src.length > 2 ? 's' : ''})` : ''}.`);
  } else if (!probe && N.hotspots) {
    // a saved picture (shot --image): the spots are counted, but which light / material makes them and what they cover needs the live page
    add(glareKind, 'hotspots', `${glareWhy}${N.hotspots} near-white spot(s) (a channel >= ${HOT.channel}, luma >= ${HOT.luma}). From a picture alone the source is unknown: `
      + 'threedog shot or threedog snap on the running page turns each light and glowing material off once and names the one that makes them.', 0.001);
  }
  // key against fill (probeLook out.key): what the sun / key light and the fill each add to the mean brightness (each turned off once) and how
  // much darker the shadowed areas are. Why a fact on every lit shot: whether a picture reads as lit is mostly this ratio (and warm / cool
  // between lit and shaded sides), and a flat day had no line pointing at it. A contradiction only when DESIGN.md asks for strong light
  const k = probe?.key;
  if (k) {
    const dk = Math.max(0, k.base - k.noKey), df = Math.max(0, k.base - k.noFill);
    if (dk + df >= 0.01) {
      const ks = dk / (dk + df), lit = sh && sh.sunLit && sh.area >= 0.003 ? sh.depth : null;
      const fillP = list([P.hemi, P.env, P.ambient]);
      const strong = intent.find(a => a.want === 'strongLight' && (!a.when || isDay == null || (a.when === 'day') === isDay));
      const weak = strong && (ks < 0.5 || (lit !== null && lit < 0.2));
      const body = k.body === 'moon' ? 'moon (engine.lights.sun)' : 'sun / key';
      const text = `light: the ${body} gives ${Math.round(ks * 100)}% of the lit brightness, the fill ${Math.round((1 - ks) * 100)}%` +
        (lit !== null ? `; shadowed areas are ${pc(lit)} darker than lit` : '') + ` (${said(P.sun) ?? 'sun'}${fillP ? `; fill ${fillP}` : ''})`;
      // size: the share of the brightness that is not the key (a flat picture ranks high)
      // printed: the values without their writers ("look.lights sun.intensity 2.19 (style)" -> "sun.intensity 2.19"), so the line stays one sentence
      const bare = p => p && `${p.name.replace(/^look\.\w+ /, '')} ${r2(p.value)}`;
      const brief = `light: ${body} ${Math.round(ks * 100)}%, fill ${Math.round((1 - ks) * 100)}% of the lit brightness${lit !== null ? `; shadows ${pc(lit)} darker` : ''}` +
        ` (${[P.sun, P.hemi, P.env, P.ambient].map(bare).filter(Boolean).join(', ')})`;
      const why = weak ? `differs from DESIGN.md: you wrote '${strong.clause}' (${strong.row}); ` : '';
      add(weak ? 'contradiction' : 'fact', 'light-balance', `${why}${text}.`, 1 - ks, `${why}${brief}.`);
    }
  }
  if (probe?.cameraInside) {
    const c = probe.cameraInside;
    add('fact', 'camera-inside', `the camera at (${c.camera.map(v => r2(v)).join(', ')}) is inside mesh '${c.name}' (its back faces on all six axes): the picture shows its inside; move the camera (--view / --pos) or the mesh.`, 1);
  }
  // large near-black areas: a fact (a horror night or a silhouette look may want them), a contradiction only under a DESIGN.md no-pitch-black
  const noBlack = intent.find(a => a.want === 'noBlack');
  if (N.dark >= 0.4)
    add(noBlack ? 'contradiction' : 'fact', 'crushed', `${wrote(noBlack)}${pc(N.dark)} of the picture is near black (all channels <= 20): no detail is left there${isDay === false ? ' (a night shot)' : ''}. ` +
      `Set by: ${list([P.exposure, P.sun, P.hemi, P.env]) || 'exposure / light intensities'}.`, N.dark);
  for (const a of intent) if (a.want === 'unknown')
    add('fact', 'intent-word', `DESIGN.md "Look intent" has '${a.word}', which the look check does not read; the words it reads: ${Object.keys(INTENT_WORDS).join(', ')}.`, 0.01);

  // ── intent: declared words, checked only where the numbers clearly disagree ──
  const CHECK = {
    bright: [N.luminance < 0.3, 'luminance', 'mean luminance', N.luminance], dark: [N.luminance > 0.5, 'luminance', 'mean luminance', N.luminance],
    highContrast: [N.contrast < 0.12, 'contrast', 'contrast (std of luminance)', N.contrast], lowContrast: [N.contrast > 0.24, 'contrast', 'contrast (std of luminance)', N.contrast],
    saturated: [N.saturation < 0.2, 'saturation', 'mean saturation', N.saturation], muted: [N.saturation > 0.45, 'saturation', 'mean saturation', N.saturation],
  };
  const seen = new Set();
  for (const a of intent) {
    if (a.when && (isDay == null || (a.when === 'day') !== isDay)) continue;   // "dark nights" says nothing about a noon shot, nor about a game with no sky (day or night unknown)
    if (!CHECK[a.want]) continue;   // noGlare is judged with the glare above
    const [off, k, what, v] = CHECK[a.want];
    if (!off || seen.has(a.want)) continue;
    seen.add(a.want);
    add('intent', `design-${a.want}`, `differs from DESIGN.md: you wrote '${a.clause}' (${a.row}), measured ${what} ${v}; levers: ${levers(P, k)}.`, 0.5);
  }
  if (ref?.diff) {
    const d = ref.diff, R = ref.reference, S = ref.screenshot;
    const dims = [['brightness', 'luminance', 0.25], ['contrast', 'contrast', 0.3], ['saturation', 'saturation', 0.3]];
    for (const [k, lk, lim] of dims) if (Math.abs(d[k].relative) >= lim)
      add('intent', `ref-${k}`, `differs from the reference ${R.file}: ${k} ${R[k]} there, ${S[k]} here (${d[k].relative > 0 ? '+' : ''}${Math.round(d[k].relative * 100)}%); levers: ${levers(P, lk)}.`, Math.abs(d[k].relative));
  }
  return out;
}

/** "noon 0.64 / midnight 0.22", with each time's exposure when the two differ (a style's look.tone exposure curve over the day): an AI then sees
 *  that its own curve lifts the night. Only the numbers, no hint */
function timeLums(t) {
  const en = t.at?.noon?.exposure?.value, em = t.at?.midnight?.exposure?.value;
  const ex = typeof en === 'number' && typeof em === 'number' && Math.abs(en - em) > 0.005;
  return `noon ${r2(t.noon)}${ex ? ` (exposure ${r2(en)})` : ''} / midnight ${r2(t.midnight)}${ex ? ` (exposure ${r2(em)})` : ''}`;
}

/** The printed look block: at most this many hint lines (the last one says how many more) and this many characters per line */
export const HINT_LINES = 4, LINE_MAX = 220;
/** One printed line within LINE_MAX: cut at the last clause break ('; ' or ', ') that fits, the full text stays in --json */
function clipLine(l) {
  if (l.length <= LINE_MAX) return l;
  const head = l.slice(0, LINE_MAX - 12), cut = Math.max(head.lastIndexOf('; '), head.lastIndexOf(', '));
  return (cut > 60 ? head.slice(0, cut) : head) + ' … (--json)';
}

/** Text lines of numbers + probe facts + hints */
export function formatLook(N, probe, hints, ms = probe?.ms) {
  const sh = probe?.shadows;
  const shadow = !probe ? null : !sh ? 'shadows off' : !sh.sunLit ? 'shadows: sun down or dark' : `shadow area ${pc(sh.area)} (darkened by ${pc(sh.depth)} on average)`;
  const lines = [`Look: luminance ${N.luminance.toFixed(2)} · contrast ${N.contrast.toFixed(2)} (range p5-p95 ${N.range.toFixed(2)}) · saturation ${N.saturation.toFixed(2)} · overexposed ${pc(N.overexposed)}${N.hotspots ? ` · ${N.hotspots} near-white spot(s)` : ''} · dark ${pc(N.dark)}${shadow ? ` · ${shadow}` : ''}` +
    (probe?.time ? ` · ${timeLums(probe.time)}` : '') + (ms != null ? ` (look check ${ms} ms)` : '')];
  if (probe?.error) lines.push(`  look probe skipped: ${probe.error}`);
  // Short by default, detail on demand: a rainy-night shot printed 4 lines of 400-600 characters (one listed ~17 post names) and the AI had to dig.
  // Contradictions first, then intent, then facts, each by measured size; at most HINT_LINES lines of one sentence, the rest counted
  const rank = { contradiction: 0, intent: 1, fact: 2 };
  const sorted = [...hints].sort((a, b) => (rank[a.kind] - rank[b.kind]) || ((b.size ?? 0) - (a.size ?? 0)));
  const shown = sorted.length > HINT_LINES ? sorted.slice(0, HINT_LINES - 1) : sorted;
  for (const h of shown) lines.push(clipLine(`  ${h.kind}: ${h.brief ?? h.text}`));
  if (shown.length < sorted.length) lines.push(`  ${sorted.length - shown.length} more: threedog shot --json (look.hints)`);
  if (hints.length) lines.push('  (facts and likely causes, not targets: change what the game wants, or nothing)');
  return lines;
}

/** The declared intent of the game at dir (its DESIGN.md), [] without one */
export function designIntent(dir) {
  const f = join(dir, 'DESIGN.md');
  return existsSync(f) ? readIntent(readFileSync(f, 'utf8')) : [];
}

/**
 * The look check on a live page, for every way a picture of the running game is taken: `threedog shot` (its own headless page) and `threedog snap`
 * (the dev bridge's page). Why one function: the demos bypassed the check by screenshotting another way; the check must be the same wherever it runs.
 * evaluate(src, arg) runs function source in the page (Playwright page.evaluate and the dev bridge driver both take a function string).
 * → { numbers, probe, intent, hints } or { error } when the canvas could not be read (the picture still stands)
 */
export async function pageLook(evaluate, { dir, time = 'auto', ref = null } = {}) {
  const probe = await evaluate(`([src, o]) => (0, eval)('(' + src + ')')(window.engine, o)`, [probeLook.toString(), { time, flat: TIME_FLAT, hot: HOT }]);
  if (!probe?.pixels) return { error: probe?.error ?? 'no pixels read' };
  const numbers = lookNumbers(Buffer.from(probe.pixels.b64, 'base64'), probe.pixels.w);
  delete probe.pixels;
  const intent = dir ? designIntent(dir) : [];
  return { numbers, probe, intent, hints: lookHints({ numbers, probe, intent, isDay: probe.isDay, ref }) };
}

/** What the live-page probes add, said under a check that had no page (a saved picture) */
export const NO_PAGE = '  (a saved picture: only pixel facts. Which light / material blows out, shadows, noon / midnight need the running page: threedog shot or threedog snap)';

/**
 * The pixel-only part of the look check on a saved picture (any screenshot, however it was taken): luminance, contrast, saturation, clipped /
 * near-black share, near-white spots, and the intent words of DESIGN.md. Read at the probe's width so spots and shares match a shot's numbers.
 */
export async function imageLook(file, { dir, ref = null } = {}) {
  const { openImage } = await import('./pixels.mjs'), img = await openImage(file);
  const w = Math.min(PROBE_W, img.width), size = [w, Math.max(1, Math.round(w * img.height / img.width))];
  let px; try { px = await img.read(undefined, { size }); } finally { await img.close(); }
  const numbers = lookNumbers(px.data, px.w), intent = dir ? designIntent(dir) : [];
  return { numbers, size: [img.width, img.height], intent, hints: lookHints({ numbers, intent, ref }) };
}

/**
 * Runs inside the game page (page.evaluate(`(${probeLook})(engine, opts)`) or a test page with any engine): renders the current view a few extra
 * times at the canvas size, reads a small copy of each, and restores every value it touched. Self-contained on purpose (serialized into the page).
 * Uses only intensity / time writes (uniforms) and the debug 'shadow' view, so nothing but the view's one override material recompiles.
 * @param {any} e @param {{ time?: boolean | 'auto', flat?: number, size?: [number, number] }} [opts] time: also render 12:00
 *   and 00:00 (needs sky; the calendar's time if any; 'auto' = only when calendar and sky both run); flat: TIME_FLAT, passed in because this function is
 *   serialized alone. Returns { pixels: the shot's view as RGBA (base64, size) for lookNumbers, isDay, params, shadows, lights, time, ms }
 */
export async function probeLook(e, { time = 'auto', flat = 0.15, size = [240, 135], hot = { channel: 240, luma: 0.7 } } = {}) {
  const t0 = performance.now(), [W, H] = size, R = e.renderer, scene = e.scene, cam = e.camera;
  const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
  const g = c2.getContext('2d', { willReadFrequently: true });
  // drawImage of the WebGL canvas in the same task as the render: the drawing buffer is still there without preserveDrawingBuffer
  let raw;
  const grab = () => {
    e._render(0); g.drawImage(R.domElement, 0, 0, W, H);
    const d = raw = g.getImageData(0, 0, W, H).data, L = new Float32Array(W * H);
    for (let i = 0; i < L.length; i++) L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    return L;
  };
  // near-white pixels of the last grab (HOT in this file, passed in: this function is serialized alone)
  const clipped = L => { const m = new Uint8Array(L.length); for (let i = 0; i < L.length; i++) m[i] = Math.max(raw[i * 4], raw[i * 4 + 1], raw[i * 4 + 2]) >= hot.channel && L[i] >= hot.luma ? 1 : 0; return m; };
  const mean = L => { let s = 0; for (const v of L) s += v; return s / L.length; };
  const desc = e.describe?.(), look = desc?.look ?? {};
  // live values where three holds them: describe().look rounds for reading (a bias of -0.05 shows as 0)
  const pr = (_, part, key, value) => ({ name: `look.${part} ${key}`, value: value ?? look[part]?.[key]?.value, writer: look[part]?.[key]?.writer });
  const sun = e.lights?.sun, hemi = e.lights?.hemi ?? e.lights?.hemisphere;
  let ambient = 0; scene.traverse(o => { if (o.isAmbientLight && o.visible) ambient += o.intensity; });
  const params = {
    exposure: pr(0, 'tone', 'exposure', R.toneMappingExposure), toneMapping: look.tone?.toneMapping ? pr(0, 'tone', 'toneMapping') : null,
    sun: sun ? pr(0, 'lights', 'sun.intensity', sun.intensity) : null, hemi: hemi ? pr(0, 'lights', 'hemi.intensity', hemi.intensity) : null,
    env: scene.environment ? { name: 'scene.environmentIntensity', value: scene.environmentIntensity, writer: look.env?.intensity?.writer ?? look.lights?.['env.intensity']?.writer } : null,
    ambient: ambient ? { name: 'AmbientLight intensity (sum)', value: ambient } : null,
    bias: look.shadow ? pr(0, 'shadow', 'bias', sun?.shadow.bias) : sun ? { name: 'sun.shadow.bias', value: sun.shadow.bias } : null,
    normalBias: look.shadow ? pr(0, 'shadow', 'normalBias', sun?.shadow.normalBias) : sun ? { name: 'sun.shadow.normalBias', value: sun.shadow.normalBias } : null,
    extent: look.shadow?.extent ? pr(0, 'shadow', 'extent') : null, mapSize: sun ? pr(0, 'shadow', 'mapSize', sun.shadow.mapSize.x) : null,
    follow: look.shadow?.follow ? pr(0, 'shadow', 'follow') : null,
    shadowIntensity: sun ? { name: 'engine.lights.sun.shadow.intensity', value: sun.shadow.intensity } : null,
    fog: scene.fog ? { name: 'scene.fog', value: scene.fog.isFogExp2 ? `density ${scene.fog.density}` : `near ${scene.fog.near} far ${scene.fog.far}`, writer: look.fog ? 'look.fog' : null } : null,
    post: look.post && Object.keys(look.post).length ? { name: 'look.post', value: Object.keys(look.post).filter(k => k !== 'text').join(' ') } : null,
  };
  for (const k in params) if (!params[k]) delete params[k];
  const out = { params, isDay: desc?.time?.isDay ?? null, shadows: null, time: null, lights: [] };
  try {
    const base = grab(), baseClip = clipped(base);
    // the numbers come from this canvas-only copy (no HTML UI on top), so they measure the 3D look, at one fixed size whatever the shot size
    let bin = ''; for (let i = 0; i < raw.length; i += 8192) bin += String.fromCharCode.apply(null, raw.subarray(i, i + 8192));
    out.pixels = { w: W, h: H, b64: btoa(bin) };
    // ── shadows: every visible light that casts; their shadow intensity to 0 shows exactly which pixels the shadows darken ──
    const casters = [], lit = [];
    let nCast = 0, nRecv = 0;
    scene.traverse(o => {
      if (o.isLight && o.castShadow && o.visible && o.intensity > 0 && o.shadow) casters.push(o);
      if (o.isMesh && o.visible) { if (o.castShadow) nCast++; if (o.receiveShadow) nRecv++; }
    });
    const darkened = (on, off) => {
      let n = 0, depth = 0;
      for (let i = 0; i < on.length; i++) { const d = off[i] - on[i]; if (d > 0.015 && d / Math.max(off[i], 1e-3) > 0.06) { n++; depth += d / off[i]; } }
      return { area: n / on.length, depth: n ? depth / n : 0 };
    };
    if (R.shadowMap.enabled && casters.length) {
      const was = casters.map(l => l.shadow.intensity);
      const noShadow = () => { casters.forEach(l => { l.shadow.intensity = 0; }); try { return grab(); } finally { casters.forEach((l, i) => { l.shadow.intensity = was[i]; }); } };
      const s = darkened(base, noShadow());
      const key = sun && casters.includes(sun) ? sun : casters[0], sc = key.shadow.camera;
      const up = key.position.y - (key.target?.position.y ?? 0) > 0;
      const center = key.target?.position ?? { x: 0, y: 0, z: 0 };
      // what the camera looks at: engine.focus, else a point 20 m ahead
      const f = e.focus?.isVector3 ? e.focus : cam.getWorldDirection(cam.position.clone()).multiplyScalar(20).add(cam.position);
      const viewDist = Math.hypot(f.x - center.x, f.z - center.z), extent = sc.isOrthographicCamera ? (sc.right - sc.left) / 2 : NaN;
      Object.assign(s, {
        casters: nCast, receivers: nRecv, intensity: key.shadow.intensity, sunLit: up && key.intensity > 0.05,
        // the sky drives engine.lights.sun from the moon while the drawn sun is below the horizon
        body: key === sun && e.sky?.sunDir && e.sky.sunDir.y < 0 ? 'moon' : 'sun',
        biasMeters: Math.abs(key.shadow.bias) * (sc.far - sc.near), depthRange: sc.far - sc.near, normalBias: key.shadow.normalBias,
        // camera forward against the light's direction (light -> target): above 0.6 the sun shines from behind the camera
        sunBehind: cam.getWorldDirection(cam.position.clone()).dot(center.clone ? center.clone().sub(key.position).normalize() : key.position.clone().negate().normalize()) > 0.6,
        extent, viewDist, outside: viewDist > extent * 1.05, texel: (2 * extent) / key.shadow.mapSize.x, mask: null,
      });
      if (s.area < 0.003 && s.sunLit && e.debug?.view) {
        // none visible: is it the shadow map (nothing in it) or the fill light (in it, washed out)? The debug 'shadow' view lights with direct light only
        e.debug.view('shadow', { owner: 'shot-look', force: true });
        try { const on = grab(); s.mask = darkened(on, noShadow()); } finally { e.debug.view('off', { owner: 'shot-look', force: true }); }
      }
      out.shadows = s;
    }
    // ── key against fill: the sun / key light off once, then the fill (hemisphere, ambient, environment) off once. Why: a flat daytime picture
    // with "no sense of light" had no hint at all; how much of the brightness comes from the direct light and how much from the fill is the
    // fact behind it (lookHints 'light-balance'). Two renders, intensities only
    if (sun && sun.visible && sun.intensity > 0) {
      const B = mean(base), kw = sun.intensity;
      sun.intensity = 0;
      let noKey; try { noKey = mean(grab()); } finally { sun.intensity = kw; }
      const fill = []; scene.traverse(o => { if (o.isLight && o !== sun && (o === hemi || o.isAmbientLight || o.isHemisphereLight)) fill.push([o, o.intensity]); });
      const envWas = scene.environmentIntensity;
      fill.forEach(([o]) => { o.intensity = 0; }); scene.environmentIntensity = 0;
      let noFill; try { noFill = mean(grab()); } finally { fill.forEach(([o, v]) => { o.intensity = v; }); scene.environmentIntensity = envWas; }
      out.key = { base: B, noKey, noFill, body: e.sky?.sunDir && e.sky.sunDir.y < 0 ? 'moon' : 'sun' };
    }
    // ── camera inside a mesh: the first shot of a demo stood inside a building and the output only gave the camera position. A mesh counts
    // when the camera is inside its world box AND rays along the six axes all leave it through a back face (closed around the camera).
    // BackSide materials are skipped: a sky dome is meant to be seen from inside. No render; material.side is put back right after the ray
    {
      const T = e.THREE, cp = cam.getWorldPosition(new T.Vector3()), box = new T.Box3(), rc = new T.Raycaster(), n = new T.Vector3();
      const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(d => new T.Vector3(...d));
      const cands = [];
      scene.traverse(o => {
        if (!o.isMesh || !o.visible || !o.geometry || o.isInstancedMesh || o.isSkinnedMesh) return;
        const mats = [].concat(o.material);
        if (mats.some(m => m?.side === T.BackSide)) return;
        if (box.setFromObject(o).containsPoint(cp)) cands.push(o);
      });
      for (const o of cands.slice(0, 20)) {
        const mats = [].concat(o.material), sides = mats.map(m => m.side);
        let back = 0;
        mats.forEach(m => { m.side = T.DoubleSide; });
        try {
          for (const d of dirs) {
            rc.set(cp, d);
            const h = rc.intersectObject(o, false)[0];
            if (h?.face && n.copy(h.face.normal).transformDirection(o.matrixWorld).dot(d) > 0) back++;
          }
        } finally { mats.forEach((m, i) => { m.side = sides[i]; }); }
        if (back === 6) { out.cameraInside = { name: o.name || `${o.type} ${o.uuid.slice(0, 8)}`, camera: [cp.x, cp.y, cp.z] }; break; }
      }
    }
    // ── lights the game added (not the engine's sun / hemisphere) whose range reaches the view: turn each off and see if any pixel changes ──
    // casting a shadow does not exempt a light: a game's shadowed street lamp or torch that lights nothing or glares is measured like any other
    const V = cam.position.clone(), mine = new Set([sun, hemi].filter(Boolean)), cand = [];
    scene.traverse(o => { if (o.isLight && !o.isAmbientLight && !o.isHemisphereLight && o.visible && o.intensity > 0 && !mine.has(o)) cand.push(o); });
    const wp = o => o.getWorldPosition(V.clone());
    // a light "should show" when its range holds the camera or the point it looks at: a far lamp behind a wall or in fog changing nothing is no contradiction
    const focus = e.focus?.isVector3 ? e.focus : null;
    const reaches = o => o.isDirectionalLight || !o.distance || wp(o).distanceTo(cam.position) <= o.distance || (focus && wp(o).distanceTo(focus) <= o.distance * 0.7);
    // glare of one source: pixels clipped with it and not without it, and pixels it alone makes near-white (base >= 0.75, off at least 0.25 lower)
    const nClip = baseClip.reduce((a, b) => a + b, 0), N = base.length;
    // What the glare costs: the mean luma edge (|right| + |below| neighbor difference) over the pixels this source blows out, with the source on
    // and off. Why: "near white" alone reads as a verdict on every glow; whether the sign's letters, the wall's texture or the face under the lamp
    // are gone is the fact a game can weigh against the glow it wants
    const edge = (L, m) => { let s = 0, n = 0; for (let i = 0; i < N; i++) if (m[i]) { const x = i % W; s += (x < W - 1 ? Math.abs(L[i] - L[i + 1]) : 0) + (i + W < N ? Math.abs(L[i] - L[i + W]) : 0); n++; } return n ? s / n : 0; };
    const glareOf = off => {
      const c = clipped(off), gm = new Uint8Array(N); let gone = 0, halo = 0;
      for (let i = 0; i < N; i++) if (baseClip[i] && !c[i]) { gone++; gm[i] = 1; } else if (!baseClip[i] && base[i] >= 0.75 && base[i] - off[i] >= 0.25) halo++;
      return { clipped: gone / N, halo: halo / N, px: gone, ...(gone >= 3 && { detail: { on: edge(base, gm), off: edge(off, gm) } }) };
    };
    const maxDiff = (a, b) => { let mx = 0; for (let i = 0; i < a.length; i++) mx = Math.max(mx, Math.abs(a[i] - b[i])); return mx; };
    // the sun / moon, sky fill, ambient and environment at 0 for one render (a light that changes nothing may only be outshone by them)
    const dimmed = fn => {
      const fill = []; scene.traverse(o => { if (o.isLight && (mine.has(o) || o.isAmbientLight || o.isHemisphereLight)) fill.push([o, o.intensity]); });
      const envWas = scene.environmentIntensity; fill.forEach(([o]) => { o.intensity = 0; }); scene.environmentIntensity = 0;
      try { return fn(); } finally { fill.forEach(([o, v]) => { o.intensity = v; }); scene.environmentIntensity = envWas; }
    };
    const glare = [];
    // shortcut: the nearest 4 lights only (each costs one render, the look check stays near 300 ms); a scene with more checks those near the camera
    for (const o of cand.filter(reaches).sort((a, b) => wp(a).distanceTo(cam.position) - wp(b).distanceTo(cam.position)).slice(0, 4)) {
      const was = o.intensity; o.intensity = 0;
      let L; try { L = grab(); } finally { o.intensity = was; }
      const gq = nClip ? glareOf(L) : null;   // now: glareOf reads the last grab's bytes
      const fact = { name: o.name || o.uuid.slice(0, 8), type: o.type, intensity: o.intensity, ...(o.distance !== undefined ? { distance: o.distance, decay: o.decay } : {}),
        toCamera: wp(o).distanceTo(cam.position), changed: maxDiff(L, base) > 2 / 255, layers: o.layers.mask, cameraLayers: cam.layers.mask };
      // no pixel changed: try once more with the sun / fill / environment dimmed. Changes then = outshone (a lamp at dusk), not a light that lights nothing
      if (!fact.changed) fact.outshone = dimmed(() => { const on = grab(); o.intensity = 0; try { return maxDiff(grab(), on) > 2 / 255; } finally { o.intensity = was; } });
      out.lights.push(fact);
      if (gq && (gq.px >= 3 || gq.halo >= 0.002)) glare.push({ kind: 'light', ...fact, clipped: gq.clipped, halo: gq.halo, detail: gq.detail });
    }
    // ── glare from glowing materials: the brightest emissive materials on meshes in view, each turned off once (a uniform: no recompile) ──
    if (nClip) {
      const T = e.THREE, fr = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)), mats = new Map();
      scene.traverse(o => {
        if (!o.isMesh || !o.visible || !o.geometry || !fr.intersectsObject(o)) return;
        for (const m of [].concat(o.material)) if (m?.emissive && m.emissiveIntensity > 0 && Math.max(m.emissive.r, m.emissive.g, m.emissive.b) > 0) {
          const k = mats.get(m) ?? { m, meshes: 0 }; k.meshes++; mats.set(m, k);
        }
      });
      const strength = m => Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * m.emissiveIntensity;
      for (const { m, meshes } of [...mats.values()].sort((a, b) => strength(b.m) - strength(a.m)).slice(0, 3)) {
        const was = m.emissiveIntensity; m.emissiveIntensity = 0;
        let L; try { L = grab(); } finally { m.emissiveIntensity = was; }
        const gq = glareOf(L);
        if (gq.px >= 3 || gq.halo >= 0.002) glare.push({ kind: 'material', name: m.name || `${m.type} ${m.uuid.slice(0, 8)}`, meshes, emissive: '#' + m.emissive.getHexString(),
          emissiveIntensity: was, toneMapped: m.toneMapped, clipped: gq.clipped, halo: gq.halo, detail: gq.detail });
      }
      const b = e.post?.get?.('bloom');
      out.glare = { clipped: nClip / N, sources: glare.sort((x, y) => y.clipped + y.halo - x.clipped - x.halo),
        bloom: b ? { enabled: !!b.enabled, strength: b.params?.strength, threshold: b.params?.threshold, radius: b.params?.radius } : null };
    }
    // ── time: the same view at 12:00 and 00:00, then back ──
    const cal = e.calendar, sky = e.sky;
    if (time === 'auto' ? cal && sky : time && sky) {
      const read = () => cal ? cal.timeOfDay : sky.fixedTime, write = v => { if (cal) cal.timeOfDay = v; else sky.fixedTime = v; };
      const was = read(), at = {}, lum = {};
      // the game's own sources with their value at each time: local lights (not the sky's sun / fill / ambient) and glowing materials.
      // A local LIGHT whose intensity differs between 12:00 and 00:00 is switched by the game with the time (street lamps): it is the game's
      // night lighting, not "lighting that does not follow the time", so the time tests run with those at 0 at both times.
      // Time-switched GLOW (emissive windows, signs) stays in: it lights nothing, and a night made bright by it is what the
      // "not lighting" cause names (listed by name and value in t.glow)
      const own = [];
      scene.traverse(o => {
        if (o.isLight && !mine.has(o) && !o.isAmbientLight && !o.isHemisphereLight && !o.isDirectionalLight) own.push({ o, key: 'intensity', name: o.name || o.type });
        if (o.isMesh) for (const m of [].concat(o.material)) if (m?.emissive && !own.some(s => s.o === m)) own.push({ o: m, key: 'emissiveIntensity', name: `material '${m.name || m.type}'` });
      });
      const zeroDriven = fn => { const d = own.filter(s => s.key === 'intensity' && s.noon !== s.midnight), w = d.map(s => s.o[s.key]); d.forEach(s => { s.o[s.key] = 0; }); try { return fn(); } finally { d.forEach((s, i) => { s.o[s.key] = w[i]; }); } };
      const base2 = {};
      try {
        for (const [k, v] of [['noon', 0.5], ['midnight', 0]]) {
          write(v); e._frameHooks(0, true); R.shadowMap.needsUpdate = true;   // the sun moved: redraw its shadow map (only here; the other renders reuse it)
          lum[k] = mean(grab());
          own.forEach(s => { s[k] = s.o[s.key]; });
          at[k] = { sun: sun && { name: 'sun.intensity', value: sun.intensity }, hemi: hemi && { name: 'hemi.intensity', value: hemi.intensity },
            env: scene.environment && { name: 'scene.environmentIntensity', value: scene.environmentIntensity }, exposure: { name: 'exposure', value: R.toneMappingExposure } };
        }
        const driven = own.filter(s => s.key === 'intensity' && s.noon !== s.midnight);
        const glow = own.filter(s => s.key === 'emissiveIntensity' && s.noon !== s.midnight);
        if (glow.length) lum.glow = glow.slice(0, 4).map(s => ({ name: `${s.name} emissiveIntensity`, value: s.midnight }));
        if (driven.length) {   // two more renders, only for a game that switches its own lights with the time (we are at 00:00 now)
          base2.midnight = zeroDriven(() => mean(grab()));
          write(0.5); e._frameHooks(0, true); R.shadowMap.needsUpdate = true;
          base2.noon = zeroDriven(() => mean(grab()));
          write(0); e._frameHooks(0, true); R.shadowMap.needsUpdate = true;
          lum.base = base2; lum.driven = [...new Set(driven.map(s => s.name))];
        }
        // still at 00:00: how much of that brightness is not light at all? Every light and the environment at 0,
        // then the fog color black (uniforms only). Always measured (two renders): with the game's lamps taken out, a night lit by a gray
        // background and fog that never darken is the contradiction even when noon is clearly brighter (lookHints 'time-flat')
        {
        const lights = []; scene.traverse(o => { if (o.isLight) lights.push([o, o.intensity]); });
        const envWas = scene.environmentIntensity;
        lights.forEach(([o]) => { o.intensity = 0; }); scene.environmentIntensity = 0;
        try { lum.unlit = mean(grab()); } finally { lights.forEach(([o, v]) => { o.intensity = v; }); scene.environmentIntensity = envWas; }
        if (scene.fog?.color) {
          const fc = scene.fog.color.clone(); at.midnight.fog = { name: 'fog color', value: '#' + fc.getHexString() };
          scene.fog.color.setRGB(0, 0, 0);
          try { lum.noFog = zeroDriven(() => mean(grab())); } finally { scene.fog.color.copy(fc); }
        }
        // scene.background is named only where it shows: a sky dome (or any mesh) drawn over it hides the engine's baseline gray, and naming that
        // gray as "what stays lit" sent the AI after a color nobody sees. One render with the background color inverted: no pixel moves = covered
        if (scene.background?.isColor) {
          const bg = scene.background, was = bg.clone(), before = grab().slice();
          bg.setRGB(1 - was.r, 1 - was.g, 1 - was.b);
          let shows = 0;
          try { const after = grab(); for (let i = 0; i < after.length; i++) if (Math.abs(after[i] - before[i]) > 2 / 255) shows++; } finally { bg.copy(was); }
          if (shows) at.midnight.background = { name: 'scene.background', value: '#' + was.getHexString(), shows: shows / before.length };
        }
        }
      } finally { write(was); e._frameHooks(0, true); R.shadowMap.needsUpdate = true; }   // lights back at the shot's time, and the sun's shadow map redrawn for it (the probes left the midnight one); the next real frame draws it
      const src = look.env?.source;
      out.time = { ...lum, at, envSource: src ? { name: 'look.env source', value: typeof src.value === 'object' ? src.value : `${src.value}${src.followsTime === false ? ', does not follow the time' : ''}`, writer: src.writer } : null };
    }
  } catch (err) { out.error = String(err?.message ?? err); }
  out.ms = Math.round(performance.now() - t0);
  return out;
}
