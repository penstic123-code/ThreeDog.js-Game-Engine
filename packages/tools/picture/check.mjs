// The picture check printed after every `threedog shot` and `threedog snap` (pagePicture), and on a saved picture by `threedog shot --image` (imagePicture,
// pixel facts only): numbers from the pixels plus hints of three kinds only.
//   contradiction: a setting says X, the pixels show not-X (shadows on but none measurable, a light that changes no pixel). Style-independent.
//   fact:          something measured that may or may not be wanted, with its cost: glare, large clipped or near-black areas, a night that is not
//                  dark from lighting (time-flat), the key / fill balance. A game may want blinding light, deep black or a bright night, so each is
//                  a contradiction only where DESIGN.md declares the opposite (readIntent: no-glare, no-pitch-black, dark-nights, strong-light).
//   intent:        the numbers clearly disagree with what the game itself declared (DESIGN.md "Picture intent" line, or --ref).
//                  No declaration and no reference -> numbers only, no judgement.
// Every hint states the fact and the likely cause as a parameter name with its current value, never a target value: the thresholds below only
// decide whether a fact is worth a line, they are not printed as goals. Nothing here fails a check or changes the game.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { luma } from './pixels.mjs';

/** the probe picture's width (probePicture's default size): a saved picture is read at this width too, so its spots and shares compare with a shot's */
const PROBE_W = 240;

/**
 * What counts as clipped: one channel at the top AND bright overall. Why not "all channels >= 250": warm blow-outs (255, 240, 200: a lamp head,
 * the wall beside it) never have blue at the top, so a rainy night full of glaring lamps measured 0% overexposed. Why the luma floor: a saturated
 * pure red sign (255, 0, 0) has a channel at the top but is not blown out. Used by pictureNumbers (node) and passed to probePicture (page) so both agree.
 */
const CLIP = { channel: 250, luma: 0.75 };
/**
 * Near white, for glare spots: a light's hotspot measured on the small probe picture (240 wide) averages with its surroundings, so a lamp head
 * that is 252 on the full shot reads ~245 there. The whole-picture share keeps CLIP (a bright overcast sky is near white without being a fault);
 * HOT is only used for spots and for what one light or glowing material blows out (probePicture glare).
 */
export const HOT = { channel: 240, luma: 0.7 };

/**
 * Whole-picture numbers of RGBA bytes: lookStats' four plus contrast (std of luma) and range (luma p95 - p5), and, with the width, hotspots:
 * the near-white (HOT) pixels grouped into spots (4-connected, 3+ pixels). Why spots: a few glaring lamps are a small share of the picture, so
 * the share alone stays near 0 while each spot is plainly blown out.
 * @param {Uint8Array | Buffer} rgba @param {number} [width] image width in pixels (no hotspots without it)
 */
export function pictureNumbers(rgba, width) {
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

/** The 4-connected groups of set pixels with 3 or more pixels, as { size, at: their first pixel } (a flood fill) */
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
    if (size >= 3) out.push({ size, at: i });
  }
  return out;
}

/**
 * Shadow stripes and stepped edges from the mask of shadowed pixels at canvas pixels (1 = the shadow darkens this pixel). Why on the mask and not
 * on the picture: textures and geometry are full of edges, the mask holds only what the shadow map adds. Why at canvas pixels: the probe's small
 * copy averages stripes a few pixels wide away. Read in 16-pixel cells.
 *   stripes: most rows or columns of a cell cross several lit / shadowed bands (a surface shadowing itself). A solid shadow's edge crosses once.
 *   jag:     outer and inner corners side by side in a 128-pixel window (2 x 2 blocks of 64, so a block border cannot split a stair). Why: a majority filter leaves a straight edge alone at any slope and rounds off
 *            every corner, so what it changes are the corners; a stair of shadow map pixels alternates outer and inner ones, while a real shadow
 *            has a few, far apart and mostly outer.
 * Shares are of the cells or blocks read; the numbers decide whether a fact is worth a line, they are no goal.
 * @param {Uint8Array} m one value per pixel, 0 or 1 @param {number} w @param {number} h
 * @returns {{ stripes: number, jag: number }}
 */
export function shadowEdges(m, w, h) {
  const S = 16, B = 64, R = 4, STAIR = 3, cw = Math.floor(w / S), ch = Math.floor(h / S);
  if (!cw || !ch) return { stripes: 0, jag: 0 };
  let striped = 0;
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    let on = 0, tx = 0, ty = 0;
    for (let y = cy * S; y < cy * S + S; y++) for (let x = cx * S; x < cx * S + S; x++) {
      const v = m[y * w + x]; on += v;
      if (x > cx * S && v !== m[y * w + x - 1]) tx++;
      if (y > cy * S && v !== m[(y - 1) * w + x]) ty++;
    }
    if (on >= 0.1 * S * S && on <= 0.9 * S * S && Math.max(tx, ty) >= 2 * S) striped++;
  }
  const sum = new Int32Array((w + 1) * (h + 1));   // summed-area table: any window's count in four reads
  for (let y = 0; y < h; y++) for (let x = 0, row = 0; x < w; x++) { row += m[y * w + x]; sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row; }
  const outer = new Uint8Array(w * h), inner = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = Math.max(0, x - R), b = Math.max(0, y - R), c = Math.min(w, x + R + 1), d = Math.min(h, y + R + 1);
    const n = sum[d * (w + 1) + c] - sum[b * (w + 1) + c] - sum[d * (w + 1) + a] + sum[b * (w + 1) + a], most = 2 * n > (c - a) * (d - b) ? 1 : 0, v = m[y * w + x];
    if (v && !most) outer[y * w + x] = 1; else if (!v && most) inner[y * w + x] = 1;
  }
  const bw = Math.ceil(w / B), bh = Math.ceil(h / B), blocks = bw * bh, perBlock = mask => {
    const c = new Uint16Array(blocks);
    for (const { at } of spots(mask, w)) c[Math.floor(at / w / B) * bw + Math.floor(at % w / B)]++;
    return c;
  };
  const o = perBlock(outer), n = perBlock(inner);
  const stepped = new Uint8Array(blocks);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const win = [by * bw + bx, by * bw + bx + 1, (by + 1) * bw + bx, (by + 1) * bw + bx + 1].filter((_, k) => bx + (k & 1) < bw && by + (k >> 1) < bh);
    if (Math.min(...[o, n].map(c => win.reduce((a, i) => a + c[i], 0))) >= STAIR) for (const i of win) if (o[i] + n[i]) stepped[i] = 1;
  }
  return { stripes: striped / (cw * ch), jag: stepped.reduce((a, b) => a + b, 0) / blocks };
}

// ── intent: the optional "Picture intent:" line of DESIGN.md, the one place a game declares what its picture wants ──
// Why a line of listed words and nothing else: free text read by keywords missed a rephrased wish ("lamps must not blind") silently, and two
// ways to declare could disagree. A word the list does not know is reported, never guessed.
export const INTENT_WORDS = {
  'bright': { want: 'bright' }, 'dark': { want: 'dark' }, 'high-contrast': { want: 'highContrast' }, 'low-contrast': { want: 'lowContrast' },
  'saturated': { want: 'saturated' }, 'muted': { want: 'muted' }, 'strong-light': { want: 'strongLight' },
  'dark-nights': { want: 'dark', when: 'night' }, 'bright-nights': { want: 'bright', when: 'night' },
  'no-glare': { want: 'noGlare' }, 'no-pitch-black': { want: 'noBlack' },
};
const INTENT_LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?picture intent(?:\*\*)?\s*(?:\([^)]*\))?\s*(?:\*\*)?\s*[:：]\s*(.*)$/im;
const OPPOSITE = { bright: 'dark', dark: 'bright', highContrast: 'lowContrast', lowContrast: 'highContrast', saturated: 'muted', muted: 'saturated' };

/**
 * Declared picture words of a DESIGN.md text, from its "Picture intent:" line: [{ want, word, row: 'Picture intent', clause, when: 'night' | null }].
 * No line, or only "(none)": [] (numbers only, no judgement). An unlisted word comes back as want 'unknown'. Opposite words in one time
 * context are dropped (no clear intent).
 */
export function readIntent(text) {
  const line = String(text ?? '').match(INTENT_LINE)?.[1].trim() ?? '';
  const words = line.toLowerCase().split(/[\s,;，；、]+/).filter(w => w && !/^\(.*\)$/.test(w));
  return dropOpposites(words.map(w => INTENT_WORDS[w]
    ? { want: INTENT_WORDS[w].want, word: w, row: 'Picture intent', clause: w, when: INTENT_WORDS[w].when ?? null }
    : { want: 'unknown', word: w, row: 'Picture intent', clause: w, when: null }));
}
const dropOpposites = out => out.filter(a => !out.some(b => b.want === OPPOSITE[a.want] && (b.when === a.when || !b.when || !a.when)));
/** "differs from DESIGN.md: you wrote ..." for a declared wish, '' without one */
const wrote = a => a ? `differs from DESIGN.md: you wrote '${a.clause}' (${a.row}); ` : '';

// ── hints ──
/** noon and midnight closer than this share of the brighter one: "time barely changes the picture" (a hint threshold, never printed as a goal) */
export const TIME_FLAT = 0.15;
/** Fog over this share of the picture: 'fog-cover' reports it, and it is printed before a time-flat line (a hint threshold, never printed as a goal) */
const FOG_MUCH = 0.25;
/** Shadowed pixels this much darker than lit, with the fill adding under this share of the lit brightness there: 'shadow-black' (hint thresholds, no goals) */
const SHADOW_BLACK = { depth: 0.85, fill: 0.05 };
/** Shares of the picture from which shadow stripes / stepped edges are worth a line, the screen pixels a shadow map pixel must span to show as a step, the share that may change by itself before edges are not read (hint thresholds, no goals) */
const SHADOW_EDGE = { stripes: 0.01, jag: 0.005, texelPx: 3, noise: 0.02 };
/** What each budget category counts and the next step when it is over. Usage lines quote the real API: lightPool (recipe 09 1b), a light's own shadow fields */
const BUDGET_WORDS = {
  lights: 'real point / spot lights lit', shadowLights: 'shadow-casting point / spot lights lit',
  shadowMaps: 'shadow maps drawn each frame (a point light is six)', shadowMapSize: 'pixels on the side of the largest shadow map',
};
/** Why each default limit is there: "lights 10 over 8" read as a rule with no reason. A limit is a guide for what to measure, nothing is cut at it */
const BUDGET_WHY = {
  lights: 'each adds work per lit pixel', shadowLights: 'each draws the scene again', shadowMaps: 'each is one more pass over the scene', shadowMapSize: 'memory grows with its square',
};
const budgetNext = (cat, b) => {
  if (cat === 'lights') return b.pool ? 'lightPool is installed: lightPool({ point }) sets how many real lights it keeps, its other sources wait'
    : 'many lights: light pool, engine.use(lightPool({ point: 8 })) then engine.lightPool.add(torch, { intensity: 4, distance: 8 }) (recipe 09 1b)';
  const who = b.casters?.length ? `: ${b.casters.map(c => `${c.name} (${c.type}, ${c.size})`).join(', ')}` : '';
  return cat === 'shadowMapSize' ? `pick light.shadow.mapSize from engine.tier in the picture code${who}` : `set castShadow = false on the lights that can go without${who}`;
};
// small shares keep two decimals: a glare spot is often under 0.1% of the picture and "0.0%" read as nothing
const pc = x => `${(x * 100).toFixed(x > 0 && x < 0.001 ? 3 : x > 0 && x < 0.01 ? 2 : 1)}%`;
// two decimals, but small values (a bias of -0.00005) keep two significant digits instead of printing 0
const r2 = x => (typeof x !== 'number' ? x : x !== 0 && Math.abs(x) < 0.01 ? +x.toPrecision(2) : +x.toFixed(2));
/** "engine.lights.sun intensity 3.2" from a probe param { name, value, writer? } */
const said = p => (p ? `${p.name} ${typeof p.value === 'object' ? JSON.stringify(p.value) : r2(p.value)}${p.writer ? ` (${p.writer})` : ''}` : null);
const list = ps => ps.map(said).filter(Boolean).join(', ');
const LEVERS = {
  luminance: ['exposure', 'sun', 'hemi', 'env'],
  contrast: ['sun', 'hemi', 'env', 'shadowIntensity', 'fog'],
  saturation: ['fog', 'post'],
};
const levers = (P, k) => list(LEVERS[k].map(n => P[n])) + (k === 'saturation' ? (P.post || P.fog ? ', ' : '') + 'the material / palette colors in picture/ (style/ in an older game)' : '');

/**
 * Hints from the screenshot numbers, the page probe (probePicture) and the declared intent.
 * @param {{ numbers: any, probe?: any, intent?: any[], isDay?: boolean | null, ref?: any }} o ref: a compareImages result
 * @returns {{ kind: 'contradiction' | 'fact' | 'intent', id: string, text: string }[]}
 */
export function pictureHints({ numbers: N, probe, intent = [], isDay = null, ref = null }) {
  const out = [], P = probe?.params ?? {}, add = (kind, id, text, size = 0, brief) => out.push({ kind, id, text, size, ...(brief && { brief }) });
  // size: the measured share of the picture (or of its brightness) the hint is about; formatPicture ranks by it and prints `brief` (one sentence:
  // measured -> source -> value), --json keeps the full `text`
  const sh = probe?.shadows;
  // the shadow mask travels from the page once and is read here (one path for pagePicture and for a test page); the bytes do not stay in --json
  if (sh?.edgeMask) {
    const { w, h, b64 } = sh.edgeMask, bits = Buffer.from(b64, 'base64'), m = new Uint8Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = (bits[i >> 3] >> (i & 7)) & 1;
    sh.edges = shadowEdges(m, w, h); delete sh.edgeMask;
  }
  // cascades as the game can reach them, by the light they go on (recipe 45)
  const cascadeWay = sh?.split === 'engine' ? 'large scene: engine.shadows.cascades(engine.lights.sun, { count: 3 })'
    : sh?.split === 'own' ? 'large scene: engine.shadows.cascades(light, { count: 3 }) (recipe 45)' : null;
  // shadows on, something casts, the sun is up and lit, yet no pixel gets darker from the shadow
  if (sh && sh.casters > 0 && sh.sunLit && sh.area < 0.003) {
    const fact = `shadows are on (${sh.casters} casting meshes, key light lit) but none is measurable in this view: turning shadow intensity to 0 changes ${pc(sh.area)} of the picture`;
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
    if (cause) add('contradiction', 'shadow-invisible', `${fact}. Likely cause: ${cause}.`, sh.mask?.area ?? 0.05,
      `shadows on (${sh.casters} casters) but none measurable (${pc(sh.area)} of the picture changes without them); likely: ${short ?? cause}.`);
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
        (fogPart ? `Most of it is the fog: ${said(t.at.midnight.fog)} at 00:00 (fog color black gives ${r2(t.noFog)}; scene.fog)` :
          `What stays lit without light: emissive or unlit materials${t.glow ? ` (switched on by the game at night: ${list(t.glow)})` : ''}, the sky / background${t.at.midnight.background ? ` (${said(t.at.midnight.background)})` : ''}${t.at.midnight.fog ? `, ${said(t.at.midnight.fog)}` : ''}, post effects${P.post ? ` (${said(P.post)})` : ''}`);
    } else cause = `what lights the scene does not follow the time (the sky moves no light: your picture/ code reads engine.uniforms.uDaylight and writes it, recipe 62). At 12:00 ${at(t.at.noon)}; at 00:00 ${at(t.at.midnight)}${t.envSource ? `; ${said(t.envSource)}` : ''}`;
    // much fog in this very picture: the time line says so itself, the fog comes first (formatPicture prints fog-cover before this line)
    const fogLead = probe?.fog?.share >= FOG_MUCH ? `the fog first (it covers ${pc(probe.fog.share)}), then: ` : '';
    // brief: the one cause that measured, without the long lists (every post pass, every glowing material) the full text keeps
    const glowShort = t.glow?.length ? `glow ${t.glow.slice(0, 2).map(said).join(', ')}${t.glow.length > 2 ? ` +${t.glow.length - 2}` : ''}` : null;
    const brief = unlitNight
      ? (t.noFog !== undefined && tn.midnight - t.noFog >= 0.3 * tn.midnight ? `the fog: ${said(t.at.midnight.fog)}`
        : `not light: ${r2(t.unlit)} with every light off (${[glowShort, t.at.midnight.background && said(t.at.midnight.background), P.post && 'engine.post'].filter(Boolean).join(', ') || 'emissive / unlit materials, the sky'})`)
      : `the lights do not follow the time (12:00 ${at(t.at.noon)}; 00:00 ${at(t.at.midnight)})`;
    // a fact unless DESIGN.md wants dark nights: a game may want a bright, readable night (fog color or an unlit sky on purpose)
    const darkNight = intent.find(a => a.want === 'dark' && a.when === 'night');
    add(darkNight ? 'contradiction' : 'fact', 'time-flat', `${wrote(darkNight)}${fact}. What makes it: ${fogLead}${cause}.`, 1 - Math.abs(tn.noon - tn.midnight) / Math.max(tn.noon, tn.midnight, 0.01),
      `${wrote(darkNight)}${flatTime ? 'time barely changes the picture' : 'the night is not dark from lighting'}: luminance ${r2(t.noon)} at 12:00, ${r2(t.midnight)} at 00:00; from: ${fogLead}${brief}.`);
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
      `${wrote(noGlareWish)}${pc(N.overexposed)} of the picture is clipped; set by: ${list([P.exposure, P.toneMapping, P.sun, P.env]) || 'exposure / light intensities'}${P.post ? ', engine.post' : ''}.`);
  // glare: near-white spots a light or a glowing material causes (turning that one source off brings those pixels back below near-white), however
  // small the share: the whole-picture share above never sees a few blown-out lamps. Sun / sky brightness is not attributed to a source here,
  // so a bright day stays quiet
  // A fact, not a contradiction: a game may want blinding light. It turns into a contradiction only when DESIGN.md says no glare (readIntent
  // 'noGlare'), the same rule as every intent hint; what the glare costs (detail lost under it) is stated so the game can weigh it
  const gl = probe?.glare, noGlare = intent.find(a => a.want === 'noGlare');
  const glareKind = noGlare ? 'contradiction' : 'fact', glareWhy = noGlare ? `differs from DESIGN.md: you wrote '${noGlare.clause}' (${noGlare.row}); ` : '';
  // the cost: mean luma edge under what this source blows out, on vs off (probePicture glareOf). Below 0.01 with it off there was no detail to lose
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
  // shadowed pixels near black with almost no fill there: a fact (a hard-noon or horror look may want it), with the two ways to bring light into them
  const dk0 = sh?.dark;
  if (dk0 && sh.depth >= SHADOW_BLACK.depth && dk0.fill < SHADOW_BLACK.fill) {
    const fillNow = list([P.hemi, P.env, P.ambient]) || 'no hemisphere, ambient or environment light in the scene';
    const ways = 'light probes, await engine.bakeProbes({ bounds, spacing: 4 }), or a fill light, scene.add(new THREE.HemisphereLight(sky, ground, intensity))';
    add('fact', 'shadow-black', `the shadowed ${pc(sh.area)} of the picture is nearly black (mean luma ${r2(dk0.luma)}, ${pc(sh.depth)} darker than lit) and the fill adds ${pc(dk0.fill)} of the lit brightness there (${fillNow}). ` +
      `For detail in the shadows: ${ways} (recipe 34).`, sh.area, `shadows ${pc(sh.depth)} darker than lit, fill ${pc(dk0.fill)} there; for detail: ${ways}.`);
  }
  // stripes and stepped edges of the shadow map (shadowEdges), measured on the shadow alone. Facts: a pixel-art or hard-edged look may want the blocks
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
  // over a budget (probePicture out.budget, the same values and limits as engine.budget): a limit the game wrote is its own declaration (intent); the
  // engine's default line for lights is a fact. Tier is printed because a game picks its limits from it: engine.budget.enable(engine.tier === 'low' ? {...} : {...})
  const bg = probe?.budget;
  for (const o of bg?.over ?? []) {
    const whose = o.own ? `your engine.budget limit ${o.limit}` : `the engine's default guide ${o.limit} (${BUDGET_WHY[o.category]}; nothing is cut at it, measure with threedog perf; engine.budget.enable({ ${o.category}: n }) sets yours)`;
    // brief: value, limit and the way out; the full sentence runs past LINE_MAX and clipLine would cut the usage first
    add(o.own ? 'intent' : 'fact', 'over-budget', `${o.value} ${BUDGET_WORDS[o.category]}, over ${whose}; tier ${bg.tier}. ${budgetNext(o.category, bg)}.`, Math.min(1, o.value / o.limit - 1),
      `${o.category} ${o.value} over ${o.own ? `${o.limit} (tier ${bg.tier})` : `default ${o.limit} (a guide: ${BUDGET_WHY[o.category]}; tier ${bg.tier})`}: ${budgetNext(o.category, bg)}.`);
  }
  // key against fill (probePicture out.key): what the sun / key light and the fill each add to the mean brightness (each turned off once) and how
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
      const text = `light: the sun / key gives ${Math.round(ks * 100)}% of the lit brightness, the fill ${Math.round((1 - ks) * 100)}%` +
        (lit !== null ? `; shadowed areas are ${pc(lit)} darker than lit` : '') + ` (${said(P.sun) ?? 'sun'}${fillP ? `; fill ${fillP}` : ''})`;
      // size: the share of the brightness that is not the key (a flat picture ranks high)
      // printed short ("engine.lights.sun intensity 2.19" -> "sun intensity 2.19"), so the line stays one sentence
      const bare = p => p && `${p.name.replace(/^engine\.lights\./, '')} ${r2(p.value)}`;
      const brief = `light: sun / key ${Math.round(ks * 100)}%, fill ${Math.round((1 - ks) * 100)}% of the lit brightness${lit !== null ? `; shadows ${pc(lit)} darker` : ''}` +
        ` (${[P.sun, P.hemi, P.env, P.ambient].map(bare).filter(Boolean).join(', ')})`;
      const why = weak ? `differs from DESIGN.md: you wrote '${strong.clause}' (${strong.row}); ` : '';
      add(weak ? 'contradiction' : 'fact', 'light-balance', `${why}${text}.`, 1 - ks, `${why}${brief}.`);
    }
  }
  if (probe?.cameraInside) {
    const c = probe.cameraInside;
    add('fact', 'camera-inside', `the camera at (${c.camera.map(v => r2(v)).join(', ')}) is inside mesh '${c.name}' (its back faces on all six axes): the picture shows its inside; move the camera (--view / --pos) or the mesh.`, 1);
  }
  // the whole frame black: a contradiction when hiding one material brings the picture back (no look wants one material to black out everything)
  const bk = probe?.black;
  if (bk) {
    const failed = bk.broken?.length ? ` ${bk.broken.length} shader program(s) failed to compile: ${bk.broken.slice(0, 3).join(', ')} (.threedog/errors.log has the line).` : '';
    const c = bk.culprit, nan = c && /Shader/.test(c.type) ? ': a NaN or infinite value from its shader is the usual cause (a division by 0, normalize of a zero vector, pow / sqrt / log of a negative)'
      + (bk.post ? ', and the post chain (bloom) spreads it over the whole frame' : '') : '';
    if (c) add('contradiction', 'black-frame', `the frame is black, and hiding the meshes of material '${c.name}' (${c.type}, ${c.meshes} mesh${c.meshes > 1 ? 'es' : ''}) alone brings the picture back (luminance ${r2(c.luminance)})${nan}.${failed}`, 1,
      `the frame is black; hiding material '${c.name}' (${c.type}) alone brings it back${nan ? ': likely NaN / Inf from its shader' + (bk.post ? ', spread by the post chain' : '') : ''}.${failed}`);
    else add('fact', 'black-frame', `the frame is black, and hiding no single one of the ${bk.tried} newest materials (of ${bk.materials}) brings it back: look at the lights and exposure (${list([P.exposure, P.sun, P.hemi, P.env]) || 'none set'})${bk.post ? `, the post chain (${said(P.post) ?? 'engine.post'})` : ''}, and the camera (inside or behind something).${failed}`, 1);
  }
  // fog that makes up most of the picture: a fact (a foggy look may want it), with the setting that makes it
  const fg = probe?.fog;
  if (fg && fg.share >= FOG_MUCH)
    add('fact', 'fog-cover', `the fog is most of the color in ${pc(fg.share)} of the picture (fog color black vs white changes those pixels by over half the full fog amount): scene.fog ${fg.setting}, color ${fg.color}. Colors and lights there barely show; move near / far (or density) or the fog color.`, fg.share,
      `fog covers ${pc(fg.share)} of the picture (scene.fog ${fg.setting}, color ${fg.color}): colors and lights there barely show.`);
  // hand-written materials: what was measured, and where the pixels gave no clear answer it says so
  const sd = probe?.shaders;
  for (const r of sd?.rows ?? []) {
    const left = sd.left ? ` (${sd.left} more shader materials not measured)` : '';
    if (r.fog?.answer === 'ignores') add('fact', 'shader-no-fog', `ShaderMaterial '${r.name}' ignores the fog: with scene.fog made total, black against white moved ${r.fog.moved} of its ${r.fog.pixels} pixels. In three.js it needs fog: true, the fog uniforms and #include <fog_fragment>; a picture may want it outside the fog${left}.`, 0.03,
      `ShaderMaterial '${r.name}' ignores the fog (${r.fog.moved} of ${r.fog.pixels} pixels moved with the fog color).`);
    else if (r.fog?.answer === 'not sure') add('fact', 'shader-fog-unsure', `not sure whether ShaderMaterial '${r.name}' takes the fog: ${r.fog.why ?? `${r.fog.moved} of its ${r.fog.pixels} pixels moved with the fog color`}.`, 0.005);
    if (r.tone?.answer === 'ignores') add('fact', 'shader-no-tone', `ShaderMaterial '${r.name}' ignores the tone curve (${P.toneMapping?.value ?? 'on'}): exposure /4 against x4 moved ${r.tone.moved} of its ${r.tone.pixels} pixels${r.toneMapped === false ? '; it has toneMapped: false' : '; it needs #include <tonemapping_fragment>'}; a picture may want it outside the curve${left}.`, 0.03,
      `ShaderMaterial '${r.name}' ignores the tone curve (${r.tone.moved} of ${r.tone.pixels} pixels moved with exposure).`);
    else if (r.tone?.answer === 'not sure') add('fact', 'shader-tone-unsure', `not sure whether ShaderMaterial '${r.name}' takes the tone curve: ${r.tone.moved} of its ${r.tone.pixels} pixels moved with exposure.`, 0.005);
  }
  // light layout: seen by the dev light watch while the game ran. A compile and a layout change seen together are not proven to be one frame
  const ll = probe?.lightLayout;
  if (ll?.changes.length) {
    const c = ll.changes[ll.changes.length - 1], n = ll.changes.reduce((s, x) => s + x.programs, 0);
    add('fact', 'light-layout', `the light layout changed during play (${ll.changes.length} time${ll.changes.length > 1 ? 's' : ''}, last ${c.from} -> ${c.to}) and ${n} shader programs were compiled around those changes (seen together, not proven to be the same frame): a compile is a frozen frame. Fading a fixed set of lights with intensity compiles nothing.`, 0.04,
      `light layout changed during play (${c.from} -> ${c.to}), ${n} shader programs compiled around it.`);
  } else if (ll && ll.now !== ll.last)
    add('fact', 'light-layout-unsure', `the light layout now (${ll.now}) differs from the last one seen (${ll.last}) with no compile seen yet: not sure it will cost one.`, 0.005);
  // transparent neighbors: only pixels that moved with the swap count; pairs not drawn stay "not sure"
  const tp = probe?.transparent;
  if (tp) {
    const untried = tp.pairs - tp.tried, cut = tp.looked < tp.meshes ? `; only the nearest ${tp.looked} of ${tp.meshes} transparent meshes were looked at` : '', rest = untried ? `; not sure about the ${untried} other overlapping pairs${cut}` : cut;
    const s = [...tp.swapped].sort((a, b) => b.pixels - a.pixels)[0];
    if (s) add('fact', 'transparent-order', `transparent meshes '${s.a}' and '${s.b}' have one renderOrder, and swapping their draw order moved ${s.pixels} pixels (${pc(s.share)} of the picture): three sorts them by object center, so the picture can pop as the camera moves. renderOrder fixes the order${rest}.`, Math.max(s.share, 0.01),
      `transparent '${s.a}' / '${s.b}': swapping draw order moves ${pc(s.share)} of the picture.`);
    else if (untried) add('fact', 'transparent-unsure', `no pixel moved in the ${tp.tried} overlapping transparent pairs drawn${rest}.`, 0.005);
  }
  // large near-black areas: a fact (a horror night or a silhouette look may want them), a contradiction only under a DESIGN.md no-pitch-black
  const noBlack = intent.find(a => a.want === 'noBlack');
  if (N.dark >= 0.4 && !bk)
    add(noBlack ? 'contradiction' : 'fact', 'crushed', `${wrote(noBlack)}${pc(N.dark)} of the picture is near black (all channels <= 20): little detail shows there${isDay === false ? ' (a night shot)' : ''}. ` +
      `Set by: ${list([P.exposure, P.sun, P.hemi, P.env]) || 'exposure / light intensities'}.`, N.dark);
  for (const a of intent) if (a.want === 'unknown')
    add('fact', 'intent-word', `DESIGN.md "Picture intent" has '${a.word}', which the picture check does not read; the words it reads: ${Object.keys(INTENT_WORDS).join(', ')}.`, 0.01);

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

/** "noon 0.64 / midnight 0.22", with each time's exposure when the two differ (exposure that changes over the day): an AI then sees
 *  that its own curve lifts the night. Only the numbers, no hint */
function timeLums(t) {
  const en = t.at?.noon?.exposure?.value, em = t.at?.midnight?.exposure?.value;
  const ex = typeof en === 'number' && typeof em === 'number' && Math.abs(en - em) > 0.005;
  return `noon ${r2(t.noon)}${ex ? ` (exposure ${r2(en)})` : ''} / midnight ${r2(t.midnight)}${ex ? ` (exposure ${r2(em)})` : ''}`;
}

/** The printed picture block: at most this many hint lines (the last one says how many more) and this many characters per line */
export const HINT_LINES = 4, LINE_MAX = 220;
/** One printed line within LINE_MAX: cut at the last clause break ('; ' or ', ') that fits, the full text stays in --json */
function clipLine(l) {
  if (l.length <= LINE_MAX) return l;
  const head = l.slice(0, LINE_MAX - 12), cut = Math.max(head.lastIndexOf('; '), head.lastIndexOf(', '));
  return (cut > 60 ? head.slice(0, cut) : head) + ' … (--json)';
}

/** Text lines of numbers + probe facts + hints */
export function formatPicture(N, probe, hints, ms = probe?.ms) {
  const sh = probe?.shadows;
  const shadow = !probe ? null : !sh ? 'shadows off' : !sh.sunLit ? 'shadows: sun down or dark' : `shadow area ${pc(sh.area)} (darkened by ${pc(sh.depth)} on average)`;
  const lines = [`Picture: luminance ${N.luminance.toFixed(2)} · contrast ${N.contrast.toFixed(2)} (range p5-p95 ${N.range.toFixed(2)}) · saturation ${N.saturation.toFixed(2)} · overexposed ${pc(N.overexposed)}${N.hotspots ? ` · ${N.hotspots} near-white spot(s)` : ''} · dark ${pc(N.dark)}${shadow ? ` · ${shadow}` : ''}` +
    (probe?.time ? ` · ${timeLums(probe.time)}` : '') + (ms != null ? ` (picture check ${ms} ms)` : '')];
  if (probe?.error) lines.push(`  picture probe skipped: ${probe.error}`);
  // Short by default, detail on demand: a rainy-night shot printed 4 lines of 400-600 characters (one listed ~17 post names) and the AI had to dig.
  // Contradictions first, then intent, then facts, each by measured size; at most HINT_LINES lines of one sentence, the rest counted
  const rank = { contradiction: 0, intent: 1, fact: 2 };
  const sorted = [...hints].sort((a, b) => (rank[a.kind] - rank[b.kind]) || ((b.size ?? 0) - (a.size ?? 0)));
  // the fog before the time line, whatever their kinds: a picture mostly fog gets its picture from that fog, and "brightness stays with the lights off"
  // alone sent the AI after the lights (a dark fog at night ate three rounds of color changes)
  const fi = sorted.findIndex(h => h.id === 'fog-cover'), ti = sorted.findIndex(h => h.id === 'time-flat');
  if (fi > ti && ti >= 0) sorted.splice(ti, 0, sorted.splice(fi, 1)[0]);
  const shown = sorted.length > HINT_LINES ? sorted.slice(0, HINT_LINES - 1) : sorted;
  for (const h of shown) lines.push(clipLine(`  ${h.kind}: ${h.brief ?? h.text}`));
  if (shown.length < sorted.length) lines.push(`  ${sorted.length - shown.length} more: threedog shot --json (picture.hints)`);
  if (hints.length) lines.push('  (facts and likely causes, not targets: change what the game wants, or nothing)');
  return lines;
}

/** The declared intent of the game at dir (its DESIGN.md), [] without one */
export function designIntent(dir) {
  const f = join(dir, 'DESIGN.md');
  return existsSync(f) ? readIntent(readFileSync(f, 'utf8')) : [];
}

/**
 * The picture check on a live page, for every way a picture of the running game is taken: `threedog shot` (its own headless page) and `threedog snap`
 * (the dev bridge's page). Why one function: the demos bypassed the check by screenshotting another way; the check must be the same wherever it runs.
 * evaluate(src, arg) runs function source in the page (Playwright page.evaluate and the dev bridge driver both take a function string).
 * → { numbers, probe, intent, hints } or { error } when the canvas could not be read (the picture still stands)
 */
export async function pagePicture(evaluate, { dir, time = 'auto', ref = null } = {}) {
  const probe = await evaluate(`([src, o]) => (0, eval)('(' + src + ')')(window.engine, o)`, [probePicture.toString(), { time, flat: TIME_FLAT, hot: HOT }]);
  if (!probe?.pixels) return { error: probe?.error ?? 'no pixels read' };
  const numbers = pictureNumbers(Buffer.from(probe.pixels.b64, 'base64'), probe.pixels.w);
  delete probe.pixels;
  const intent = dir ? designIntent(dir) : [];
  return { numbers, probe, intent, hints: pictureHints({ numbers, probe, intent, isDay: probe.isDay, ref }) };
}

/** What the live-page probes add, said under a check that had no page (a saved picture) */
export const NO_PAGE = '  (a saved picture: only pixel facts. Which light / material blows out, shadows, noon / midnight need the running page: threedog shot or threedog snap)';

/**
 * The pixel-only part of the picture check on a saved picture (any screenshot, however it was taken): luminance, contrast, saturation, clipped /
 * near-black share, near-white spots, and the intent words of DESIGN.md. Read at the probe's width so spots and shares match a shot's numbers.
 */
export async function imagePicture(file, { dir, ref = null } = {}) {
  const { openImage } = await import('./pixels.mjs'), img = await openImage(file);
  const w = Math.min(PROBE_W, img.width), size = [w, Math.max(1, Math.round(w * img.height / img.width))];
  let px; try { px = await img.read(undefined, { size }); } finally { await img.close(); }
  const numbers = pictureNumbers(px.data, px.w), intent = dir ? designIntent(dir) : [];
  return { numbers, size: [img.width, img.height], intent, hints: pictureHints({ numbers, intent, ref }) };
}

/**
 * Runs inside the game page (page.evaluate(`(${probePicture})(engine, opts)`) or a test page with any engine): renders the current view a few extra
 * times at the canvas size, reads a small copy of each, and restores every value it touched. Self-contained on purpose (serialized into the page).
 * Uses only intensity / time writes (uniforms) and the debug 'shadow' view, so nothing but the view's one override material recompiles.
 * @param {any} e @param {{ time?: boolean | 'auto', flat?: number, size?: [number, number] }} [opts] time: also render 12:00
 *   and 00:00 (needs sky; the calendar's time if any; 'auto' = only when calendar and sky both run); flat: TIME_FLAT, passed in because this function is
 *   serialized alone. Returns { pixels: the shot's view as RGBA (base64, size) for pictureNumbers, isDay, params, shadows, lights, time, ms }
 */
export async function probePicture(e, { time = 'auto', flat = 0.15, size = [240, 135], hot = { channel: 240, luma: 0.7 } } = {}) {
  const t0 = performance.now(), [W, H] = size, R = e.renderer, scene = e.scene, cam = e.camera;
  // what the check changes and puts back is not the game's: the "who wrote it" record and the light watch skip it (core/pictureWriters.js, core/lightWatch.js)
  e._probing = true;
  const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
  const g = c2.getContext('2d', { willReadFrequently: true });
  // drawImage of the WebGL canvas in the same task as the render: the drawing buffer is still there without preserveDrawingBuffer
  let raw;
  // hooks false (every probe render but one): the game's onRender hooks do not run, else picture code that writes three.js values each frame
  // put back the light a probe had just turned off and every light read "changes no pixel". true only right after the probe moved the time,
  // so the picture code maps the new time to its lights once (then the renders after it keep what the probe writes)
  const grab = (hooks = false) => {
    e._render(0, hooks); g.drawImage(R.domElement, 0, 0, W, H);
    const d = raw = g.getImageData(0, 0, W, H).data, L = new Float32Array(W * H);
    for (let i = 0; i < L.length; i++) L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    return L;
  };
  // near-white pixels of the last grab (HOT in this file, passed in: this function is serialized alone)
  const clipped = L => { const m = new Uint8Array(L.length); for (let i = 0; i < L.length; i++) m[i] = Math.max(raw[i * 4], raw[i * 4 + 1], raw[i * 4 + 2]) >= hot.channel && L[i] >= hot.luma ? 1 : 0; return m; };
  const mean = L => { let s = 0; for (const v of L) s += v; return s / L.length; };
  // describe().picture is what three.js holds now, whoever wrote it: every value below goes by its three.js name
  const desc = e.describe?.({ only: ['picture', 'render', 'owned', 'time'] }), pic = desc?.picture ?? {}, fo = desc?.owned?.['shadow.follow'];
  // the key and fill lights: the engine's sun / hemisphere when they are in the scene, else the game's own strongest DirectionalLight /
  // HemisphereLight. Why: with createEngine({ lights: false }) the engine lights still exist outside the scene, and the hints named their
  // values for a picture the game lights itself
  const inScene = o => { for (let p = o; p; p = p.parent) if (p === scene) return true; return false; };
  const pickLight = (eng, is) => {
    if (eng && eng.visible && inScene(eng)) return { light: eng, engine: true };
    let best = null; scene.traverse(o => { if (is(o) && o.visible && (!best || o.intensity > best.intensity)) best = o; });
    return best && { light: best, engine: false };
  };
  const key = pickLight(e.lights?.sun, o => o.isDirectionalLight), fill = pickLight(e.lights?.hemi ?? e.lights?.hemisphere, o => o.isHemisphereLight);
  const sun = key?.light, hemi = fill?.light;
  const lightName = k => (k.engine ? `engine.lights.${k.light === e.lights?.sun ? 'sun' : 'hemi'}` : `${k.light.type} '${k.light.name || k.light.uuid.slice(0, 8)}'`);
  const lightParam = k => ({ name: `${lightName(k)} intensity`, value: k.light.intensity });
  let ambient = 0; scene.traverse(o => { if (o.isAmbientLight && o.visible) ambient += o.intensity; });
  const shadowParam = (what, value) => (sun ? { name: `${lightName(key)} shadow.${what}`, value } : null);
  const params = {
    exposure: { name: 'renderer.toneMappingExposure', value: pic.exposure ?? R.toneMappingExposure }, toneMapping: pic.toneMapping ? { name: 'renderer.toneMapping', value: pic.toneMapping } : null,
    sun: key ? lightParam(key) : null, hemi: fill ? lightParam(fill) : null,
    env: pic.environment?.present ? { name: 'scene.environmentIntensity', value: pic.environment.intensity } : null,
    ambient: ambient ? { name: 'AmbientLight intensity (sum)', value: ambient } : null,
    bias: shadowParam('bias', sun?.shadow.bias), normalBias: shadowParam('normalBias', sun?.shadow.normalBias),
    extent: sun?.shadow.camera.isOrthographicCamera ? { name: `${lightName(key)} shadow camera half width`, value: (sun.shadow.camera.right - sun.shadow.camera.left) / 2 } : null,
    mapSize: shadowParam('mapSize', sun?.shadow.mapSize.x),
    follow: fo ? { name: 'shadow box follow', value: fo.writer === 'engine' ? 'on' : 'off' } : null,
    shadowIntensity: shadowParam('intensity', sun?.shadow.intensity),
    fog: pic.fog ? { name: 'scene.fog', value: pic.fog.type === 'FogExp2' ? `density ${pic.fog.density}` : `near ${pic.fog.near} far ${pic.fog.far}` } : null,
    post: desc?.render?.post?.length ? { name: 'engine.post', value: desc.render.post.filter(x => x.on).map(x => x.name).join(' ') } : null,
  };
  for (const k in params) if (!params[k]) delete params[k];
  const out = { params, isDay: desc?.time?.isDay ?? null, shadows: null, time: null, lights: [] };
  // Facts about what hand-written materials do to the picture, each from renders of those objects alone (the rest hidden), values put back after:
  // - a ShaderMaterial in view, fog on: the fog made total (uniforms only, no recompile), its color black then white. Pixels that do not move ignore fog.
  // - the same with exposure far down and far up, when a tone curve is on and no post chain applies it for everyone.
  // - transparent neighbors: two transparent meshes with one renderOrder whose boxes overlap, drawn in both orders. Pixels that move depend on an order
  //   three picks from object centers, so it can flip as the camera moves. Why not judge by boxes alone: additive pairs and pairs not on top of each other
  //   overlap harmlessly; only the pixels say. Every answer below a clear share is 'not sure'.
  const probeOwnDraws = () => {
    const T = e.THREE, res = {}, MOVED = 6 / 255, FEW = 12, drawable = o => o.isMesh || o.isPoints || o.isLine || o.isSprite;
    const only = (keep, fn) => {
      const k = new Set(keep), hid = [];
      scene.traverse(o => { if (drawable(o) && o.visible && !k.has(o)) { o.visible = false; hid.push(o); } });
      try { return fn(); } finally { hid.forEach(o => { o.visible = true; }); }
    };
    // of the pixels this object covers, the share that followed the change; follows and ignores are clear answers, the middle is not. Covered is judged
    // against the empty picture under the same setting (ea for a, eb for b): the background moves with exposure, and it is not the object's doing
    const verdict = (ea, eb, a, b) => {
      let n = 0, moved = 0;
      for (let i = 0; i < a.length; i++) {
        if (Math.abs(a[i] - ea[i]) <= MOVED && Math.abs(b[i] - eb[i]) <= MOVED) continue;
        n++; if (Math.abs(a[i] - b[i]) > MOVED) moved++;
      }
      const share = n ? moved / n : 0;
      return { pixels: n, moved, answer: n < FEW ? 'not sure' : share >= 0.8 ? 'follows' : share <= 0.05 ? 'ignores' : 'not sure' };
    };
    const shaders = new Map(), box = new T.Box3(), sphere = new T.Sphere();
    const world = new T.Vector3();
    cam.getWorldPosition(world);
    scene.traverseVisible(o => {
      if (!drawable(o) || !o.material) return;
      for (const m of [].concat(o.material)) {
        if (!m?.isShaderMaterial) continue;
        if (o.geometry) {   // a mesh around the camera is a sky: fog and exposure do not apply to it in any picture
          if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
          sphere.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
          if (sphere.containsPoint(world)) continue;
        }
        (shaders.get(m) ?? shaders.set(m, []).get(m)).push(o);
      }
    });
    const fog = scene.fog, curve = R.toneMapping !== T.NoToneMapping && !e.post?.active;
    if (shaders.size && (fog?.color || curve)) {
      const x = R.toneMappingExposure, low = x / 4, high = x * 4, rows = [];
      const emptyAt = v => { R.toneMappingExposure = v; try { return only([], grab).slice(); } finally { R.toneMappingExposure = x; } };
      const empty = emptyAt(x), emptyLow = curve ? emptyAt(low) : null, emptyHigh = curve ? emptyAt(high) : null;
      // shortcut: the 6 newest shader materials (5 renders each); says how many it left out
      for (const [m, objs] of [...shaders].sort((a, b) => b[0].id - a[0].id).slice(0, 6)) {
        const row = { name: m.name || `${m.type} ${m.uuid.slice(0, 8)}`, toneMapped: m.toneMapped };
        only(objs, () => {
          if (fog?.color) {
            const c = fog.color.clone(), n = fog.near, f = fog.far, d = fog.density;
            if (fog.isFogExp2) fog.density = 1e3; else { fog.near = 0; fog.far = 1e-3; }
            try {
              fog.color.setRGB(0, 0, 0); const black = grab().slice();
              fog.color.setRGB(1, 1, 1); const white = grab();
              row.fog = verdict(empty, empty, black, white);
              // its own fog from uniforms the game feeds in onRender cannot move here: hooks do not run in the probe
              if (row.fog.answer === 'ignores' && /fog/i.test(`${m.vertexShader}${m.fragmentShader}`)) { row.fog.answer = 'not sure'; row.fog.why = 'its shader text says fog, maybe through its own uniforms, which this render does not feed'; }
            } finally { fog.color.copy(c); if (fog.isFogExp2) fog.density = d; else { fog.near = n; fog.far = f; } }
          }
          if (curve) {
            try { R.toneMappingExposure = low; const dim = grab().slice(); R.toneMappingExposure = high; row.tone = verdict(emptyLow, emptyHigh, dim, grab()); } finally { R.toneMappingExposure = x; }
          }
        });
        rows.push(row);
      }
      res.shaders = { rows, left: Math.max(0, shaders.size - rows.length) };
    }
    const see = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const clear = [];
    scene.traverseVisible(o => { if (o.isMesh && !o.isInstancedMesh && [].concat(o.material).some(m => m?.transparent) && see.intersectsObject(o)) clear.push(o); });
    if (clear.length > 1) {
      // shortcut: the 48 nearest transparent meshes, and 4 pairs drawn; both limits are reported, so "none found" is never read as "none exist"
      const near = clear.map(o => [o, o.getWorldPosition(new T.Vector3()).distanceToSquared(world)]).sort((a, b) => a[1] - b[1]).slice(0, 48).map(x => x[0]);
      const boxes = near.map(o => box.clone().setFromObject(o)), pairs = [];
      for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++)
        if (near[i].renderOrder === near[j].renderOrder && boxes[i].intersectsBox(boxes[j])) pairs.push([near[i], near[j]]);
      const swapped = [];
      for (const [a, b] of pairs.slice(0, 4)) {
        const ro = a.renderOrder;
        only([a, b], () => {
          try {
            a.renderOrder = ro + 1; const ab = grab().slice();
            a.renderOrder = ro; b.renderOrder = ro + 1; const ba = grab();
            let px = 0; for (let i = 0; i < ab.length; i++) if (Math.abs(ab[i] - ba[i]) > MOVED) px++;
            if (px >= FEW) swapped.push({ a: a.name || a.uuid.slice(0, 8), b: b.name || b.uuid.slice(0, 8), pixels: px, share: px / ab.length });
          } finally { a.renderOrder = ro; b.renderOrder = ro; }
        });
      }
      res.transparent = { meshes: clear.length, looked: near.length, pairs: pairs.length, tried: Math.min(4, pairs.length), swapped };
    }
    return res;
  };
  // the light watch runs in dev and test builds; without it nothing is claimed either way
  const lw = e._lightWatch;
  if (lw) out.lightLayout = { changes: [...lw.changes], last: lw.lights, now: lw.setup() };
  try {
    const base = grab(), baseClip = clipped(base);
    // the numbers come from this canvas-only copy (no HTML UI on top), so they measure the 3D look, at one fixed size whatever the shot size
    let bin = ''; for (let i = 0; i < raw.length; i += 8192) bin += String.fromCharCode.apply(null, raw.subarray(i, i + 8192));
    out.pixels = { w: W, h: H, b64: btoa(bin) };
    const darkShare = () => { let n = 0; for (let i = 0; i < raw.length; i += 4) if (Math.max(raw[i], raw[i + 1], raw[i + 2]) <= 20) n++; return n / (raw.length / 4); };
    // ── budget: real lights and shadow maps against engine.budget, the same values and limits budget.report() reads, so a game's own lights count too ──
    if (e.budget?.values) {
      const B = e.budget, v = B.values(), over = [];
      for (const category of ['lights', 'shadowLights', 'shadowMaps', 'shadowMapSize']) {
        const limit = B.limitOf(category);
        if (limit != null && v[category] > limit) over.push({ category, value: v[category], limit, own: B.limits[category] != null });
      }
      if (over.length) {
        const cast = [];
        scene.traverse(o => { if (o.isLight && o.castShadow && o.visible && o.shadow) cast.push({ name: o.name || o.uuid.slice(0, 8), type: o.type, size: o.shadow.mapSize.x }); });
        out.budget = { tier: e.tier, pool: !!e.lightPool, over, casters: cast.sort((a, b) => b.size - a.size).slice(0, 3) };
      }
    }
    // ── a black frame: which material, hidden alone, brings the picture back. Why: a game's ShaderMaterial that outputs NaN / Inf turned the whole
    // frame black through the post chain (bloom spreads it) with no error anywhere. Newest materials first (material.id grows), visibility only
    if (mean(base) < 0.02 && darkShare() >= 0.95) {
      const byMat = new Map();
      scene.traverse(o => { if (o.isMesh && o.visible) for (const m of [].concat(o.material)) if (m) (byMat.get(m) ?? byMat.set(m, []).get(m)).push(o); });
      // the shader compile state: a program that failed to link draws nothing and logs once, long before anyone looks at a black picture
      const broken = (R.info?.programs ?? []).filter(p => p.diagnostics && p.diagnostics.runnable === false).map(p => p.name || p.cacheKey?.slice(0, 40));
      const black = { post: !!e.post?.active, tried: 0, culprit: null, broken };
      // shortcut: the 12 newest materials only (one render each); a scene with more names none and says how many it tried
      for (const [m, meshes] of [...byMat].sort((a, b) => b[0].id - a[0].id).slice(0, 12)) {
        black.tried++;
        meshes.forEach(o => { o.visible = false; });
        let L; try { L = grab(); } finally { meshes.forEach(o => { o.visible = true; }); }
        if (mean(L) >= 0.05 && darkShare() < 0.9) { black.culprit = { name: m.name || `${m.type} ${m.uuid.slice(0, 8)}`, type: m.type, meshes: meshes.length, luminance: mean(L) }; break; }
      }
      black.materials = byMat.size;
      out.black = black;
      grab();   // raw back to the shot's own frame for the probes below
    }
    Object.assign(out, probeOwnDraws());
    // ── fog: how much of the picture the fog color makes up. Two renders with the fog color black and white (a uniform, no recompile): where they
    // differ by more than half of the most-fogged pixel's difference, the fog is most of that pixel. Why: a dark fog from 14 m swallowed most of a
    // night street and three rounds of color changes went nowhere; the other facts never named it
    if (scene.fog?.color) {
      const fc = scene.fog.color.clone();
      let Lb, Lw;
      try { scene.fog.color.setRGB(0, 0, 0); Lb = grab(); scene.fog.color.setRGB(1, 1, 1); Lw = grab(); } finally { scene.fog.color.copy(fc); }
      let top = 0; for (let i = 0; i < Lb.length; i++) top = Math.max(top, Lw[i] - Lb[i]);
      let n = 0; if (top > 0.05) for (let i = 0; i < Lb.length; i++) if (Lw[i] - Lb[i] >= 0.5 * top) n++;
      const f = scene.fog;
      out.fog = { share: n / Lb.length, color: '#' + fc.getHexString(), setting: f.isFogExp2 ? `density ${f.density}` : `near ${f.near} far ${f.far}` };
      grab();
    }
    // ── shadows: every visible light that casts; their shadow intensity to 0 shows exactly which pixels the shadows darken ──
    const casters = [], lit = [];
    let nCast = 0, nRecv = 0;
    scene.traverse(o => {
      if (o.isLight && o.castShadow && o.visible && o.intensity > 0 && o.shadow) casters.push(o);
      if (o.isMesh && o.visible) { if (o.castShadow) nCast++; if (o.receiveShadow) nRecv++; }
    });
    const isShadowed = (on, off) => off - on > 0.015 && (off - on) / Math.max(off, 1e-3) > 0.06;
    const darkened = (on, off) => {
      let n = 0, depth = 0;
      for (let i = 0; i < on.length; i++) if (isShadowed(on[i], off[i])) { n++; depth += (off[i] - on[i]) / off[i]; }
      return { area: n / on.length, depth: n ? depth / n : 0 };
    };
    if (R.shadowMap.enabled && casters.length) {
      const was = casters.map(l => l.shadow.intensity);
      const noShadow = () => { casters.forEach(l => { l.shadow.intensity = 0; }); try { return grab(); } finally { casters.forEach((l, i) => { l.shadow.intensity = was[i]; }); } };
      const unshadowed = noShadow(), s = darkened(base, unshadowed);
      const key = sun && casters.includes(sun) ? sun : casters[0], sc = key.shadow.camera;
      const up = key.position.y - (key.target?.position.y ?? 0) > 0;
      const center = key.target?.position ?? { x: 0, y: 0, z: 0 };
      // what the camera looks at: engine.focus, else a point 20 m ahead
      const f = e.focus?.isVector3 ? e.focus : cam.getWorldDirection(cam.position.clone()).multiplyScalar(20).add(cam.position);
      const viewDist = Math.hypot(f.x - center.x, f.z - center.z), extent = sc.isOrthographicCamera ? (sc.right - sc.left) / 2 : NaN;
      Object.assign(s, {
        casters: nCast, receivers: nRecv, intensity: key.shadow.intensity, sunLit: up && key.intensity > 0.05,
        biasMeters: Math.abs(key.shadow.bias) * (sc.far - sc.near), depthRange: sc.far - sc.near, normalBias: key.shadow.normalBias,
        // camera forward against the light's direction (light -> target): above 0.6 the sun shines from behind the camera
        sunBehind: cam.getWorldDirection(cam.position.clone()).dot(center.clone ? center.clone().sub(key.position).normalize() : key.position.clone().negate().normalize()) > 0.6,
        extent, viewDist, outside: viewDist > extent * 1.05, texel: (2 * extent) / key.shadow.mapSize.x, mask: null,
      });
      if (s.area < 0.003 && s.sunLit && e.debug?.view) {
        // none visible: is it the shadow map (nothing in it) or the fill light (in it, washed out)? The debug 'shadow' view lights with direct light only
        e.debug.view('shadow', { owner: 'shot-picture', force: true });
        try { const on = grab(); s.mask = darkened(on, noShadow()); } finally { e.debug.view('off', { owner: 'shot-picture', force: true }); }
      }
      // how the view can get cascades: none when they are on, else on the engine sun or the game's own light
      s.split = e.shadows?.csm ? null : e.sky && key === e.lights?.sun ? 'engine' : 'own';
      // one shadow texel on screen, at the point the camera looks at
      const cv0 = R.domElement, far = cam.position.distanceTo(f);
      s.texelPx = s.texel * cv0.height / (cam.isPerspectiveCamera ? 2 * Math.tan(cam.fov * Math.PI / 360) * far : (cam.top - cam.bottom) / cam.zoom);
      s.settings = key === sun ? [params.bias, params.normalBias, params.mapSize, params.extent].filter(Boolean)
        : [['bias', key.shadow.bias], ['normalBias', key.shadow.normalBias], ['mapSize', key.shadow.mapSize.x]].map(([k, value]) => ({ name: `${key.type} shadow.${k}`, value }));
      // very dark shadows: how much the fill adds right there (fill off once, on the shadowed pixels only). A cost gate, not a verdict: one render only
      // when shadows are deep. Why not the frame's key / fill: lit ground dominates that mean, and a game whose key is a SpotLight has no 'key' at all
      if (s.area >= 0.003 && s.depth >= 0.7) {
        const fills = []; scene.traverse(o => { if (o.isAmbientLight || o.isHemisphereLight || o.isLightProbe) fills.push([o, o.intensity]); });
        const envWas = scene.environmentIntensity;
        fills.forEach(([o]) => { o.intensity = 0; }); scene.environmentIntensity = 0;
        let noFill; try { noFill = grab(); } finally { fills.forEach(([o, v]) => { o.intensity = v; }); scene.environmentIntensity = envWas; }
        let lit = 0, dark = 0, gone = 0, n = 0;
        for (let i = 0; i < base.length; i++) if (isShadowed(base[i], unshadowed[i])) { n++; lit += unshadowed[i]; dark += base[i]; gone += base[i] - noFill[i]; }
        s.dark = { luma: dark / n, fill: Math.max(0, gone) / Math.max(lit, 1e-3) };
      }
      // the shadow alone at canvas pixels (centered, 1:1): the small copy above averages stripes away. The mask goes to node (shadowEdges), as the pixels do
      {
        const cv = R.domElement, mw = Math.min(cv.width, 960), mh = Math.min(cv.height, 540), c3 = document.createElement('canvas'); c3.width = mw; c3.height = mh;
        const g3 = c3.getContext('2d', { willReadFrequently: true }), sx = (cv.width - mw) >> 1, sy = (cv.height - mh) >> 1;
        const full = () => { e._render(0, false); g3.drawImage(cv, sx, sy, mw, mh, 0, 0, mw, mh); const d = g3.getImageData(0, 0, mw, mh).data, L = new Float32Array(mw * mh); for (let i = 0; i < L.length; i++) L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255; return L; };
        const on = full(), again = full();
        casters.forEach(l => { l.shadow.intensity = 0; });
        let off; try { off = full(); } finally { casters.forEach((l, i) => { l.shadow.intensity = was[i]; }); }
        // two identical renders that differ: moving film grain or any animated post. On / off then differs by itself in a speckle the stripe test
        // reads as bands (82-97% on a picture with none), so what changes by itself is taken out of the mask, and a picture mostly that gets no verdict
        const bits = new Uint8Array(Math.ceil(mw * mh / 8));
        let moving = 0;
        for (let i = 0; i < on.length; i++) {
          if (Math.abs(on[i] - again[i]) > 0.015) moving++;
          else if (isShadowed(on[i], off[i])) bits[i >> 3] |= 1 << (i & 7);
        }
        s.edgeNoise = moving / on.length;
        let b64 = ''; for (let i = 0; i < bits.length; i += 8192) b64 += String.fromCharCode.apply(null, bits.subarray(i, i + 8192));
        s.edgeMask = { w: mw, h: mh, b64: btoa(b64) };
        grab();   // raw back to the shot's own frame for the probes below
      }
      out.shadows = s;
    }
    // ── key against fill: the sun / key light off once, then the fill (hemisphere, ambient, environment) off once. Why: a flat daytime picture
    // with "no sense of light" had no hint at all; how much of the brightness comes from the direct light and how much from the fill is the
    // fact behind it (pictureHints 'light-balance'). Two renders, intensities only
    if (sun && sun.visible && sun.intensity > 0) {
      const B = mean(base), kw = sun.intensity;
      sun.intensity = 0;
      let noKey; try { noKey = mean(grab()); } finally { sun.intensity = kw; }
      const fill = []; scene.traverse(o => { if (o.isLight && o !== sun && (o === hemi || o.isAmbientLight || o.isHemisphereLight)) fill.push([o, o.intensity]); });
      const envWas = scene.environmentIntensity;
      fill.forEach(([o]) => { o.intensity = 0; }); scene.environmentIntensity = 0;
      let noFill; try { noFill = mean(grab()); } finally { fill.forEach(([o, v]) => { o.intensity = v; }); scene.environmentIntensity = envWas; }
      out.key = { base: B, noKey, noFill };
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
    // shortcut: the nearest 4 lights only (each costs one render, the picture check stays near 300 ms); a scene with more checks those near the camera
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
          lum[k] = mean(grab(true));
          own.forEach(s => { s[k] = s.o[s.key]; });
          at[k] = { sun: sun && { name: 'sun.intensity', value: sun.intensity }, hemi: hemi && { name: 'hemi.intensity', value: hemi.intensity },
            env: scene.environment && { name: 'scene.environmentIntensity', value: scene.environmentIntensity }, exposure: { name: 'exposure', value: R.toneMappingExposure } };
        }
        const driven = own.filter(s => s.key === 'intensity' && s.noon !== s.midnight);
        const glow = own.filter(s => s.key === 'emissiveIntensity' && s.noon !== s.midnight);
        if (glow.length) lum.glow = glow.slice(0, 4).map(s => ({ name: `${s.name} emissiveIntensity`, value: s.midnight }));
        if (driven.length) {   // two more renders, only for a game that switches its own lights with the time (we are at 00:00 now)
          base2.midnight = zeroDriven(() => mean(grab()));
          write(0.5); e._frameHooks(0, true); R.shadowMap.needsUpdate = true; grab(true);
          base2.noon = zeroDriven(() => mean(grab()));
          write(0); e._frameHooks(0, true); R.shadowMap.needsUpdate = true; grab(true);
          lum.base = base2; lum.driven = [...new Set(driven.map(s => s.name))];
        }
        // still at 00:00: how much of that brightness is not light at all? Every light and the environment at 0,
        // then the fog color black (uniforms only). Always measured (two renders): with the game's lamps taken out, a night lit by a gray
        // background and fog that never darken is the contradiction even when noon is clearly brighter (pictureHints 'time-flat')
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
      out.time = { ...lum, at, envSource: pic.environment?.present ? { name: 'scene.environment', value: scene.environment.name || scene.environment.type || 'a map' } : null };
    }
  } catch (err) { out.error = String(err?.message ?? err); } finally { e._probing = false; }
  out.ms = Math.round(performance.now() - t0);
  return out;
}
