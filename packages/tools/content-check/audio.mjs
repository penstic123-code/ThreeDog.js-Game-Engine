// Part of content validation (called by content-check.mjs): the audio table of content (content/audio.js -> { sounds, ambience, music, footsteps }).
// Content is data, so a function anywhere in it is an error (at run time the rule is dropped with a warning: core/audioRules.js), and a sound
// written as a file path is an error like a model path: the file belongs in an asset pack, content names it.
const PATH = /[/\\]|\.(mp3|ogg|wav|m4a|aac|flac|webm|opus)$/i;
const COMPARE = ['gt', 'gte', 'lt', 'lte'];
const VOLUME = ['base', 'add', 'min', 'max'];
const RULE = ['sound', 'when', 'volume', 'fade', 'every', 'bus'];

/** Path of the first function inside v ('' = v itself), or null */
function fnAt(v, at = '') {
  if (typeof v === 'function') return at || '(itself)';
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { const r = fnAt(x, at ? `${at}.${k}` : k); if (r) return r; }
  return null;
}

/** ctx: { c, err, warn, isObj, known, code } (code = the game's own .js source, where code-defined sounds may live) */
export function checkAudio({ c, err, warn, isObj, known, code }) {
  const a = c.audio;
  if (a === undefined) return;
  if (!isObj(a)) return err('audio', 'audio must be an object { sounds, ambience, music, footsteps }');
  for (const k of Object.keys(a)) if (!['sounds', 'ambience', 'music', 'footsteps'].includes(k)) err('audio', `unknown audio key "${k}" (known: sounds, ambience, music, footsteps; levels stay in createEngine({ audio }))`);
  const f = fnAt(a);
  if (f) err('audio', `audio.${f} is a function; content is data: compare a measure ({ daylight: { gt: 0.15 } }), write volume as { base, add: { rain: 0.22 }, min, max }, or register a value with engine.audio.measure(name, fn) in code`);
  const sounds = a.sounds || {}, music = a.music || {}, tracks = music.tracks || {};
  const named = n => n in sounds || new RegExp(`['"]?${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*:`).test(code);
  const srcs = v => typeof v === 'string' ? (v === 'synth' ? [] : [v]) : Array.isArray(v) ? v : isObj(v) ? [v.src].flat().filter(Boolean) : [];
  for (const [n, v] of Object.entries(sounds)) for (const s of srcs(v)) if (typeof s === 'string' && PATH.test(s)) err('audio',
    `audio.sounds.${n} names the file "${s}"; content names sounds only: register it in an asset pack (engine.assets.manifest({ sounds: { ${n}: '${s}' } })) and write '${n}'`);
  for (const [n, t] of Object.entries(tracks)) for (const s of [typeof t === 'string' ? t : t?.url, ...(t?.stems || []).map(x => x?.url)]) if (typeof s === 'string' && PATH.test(s)) err('audio',
    `audio.music.tracks.${n} names the file "${s}"; register it in an asset pack's sounds and write its name`);

  const checkWhen = (where, w) => {
    if (w === undefined || typeof w === 'function') return;
    if (!isObj(w)) return err('audio', `when of ${where} must be an object of condition keys / measures, got ${JSON.stringify(w)}`);
    for (const [k, v] of Object.entries(w)) if (isObj(v) && !Object.keys(v).every(x => COMPARE.includes(x))) err('audio',
      `when.${k} of ${where}: a measure is compared with { ${COMPARE.join(', ')} }, got ${JSON.stringify(v)}`);
  };
  (Array.isArray(a.ambience) ? a.ambience : a.ambience === undefined ? [] : (err('audio', 'audio.ambience must be a list of rules'), [])).forEach((r, i) => {
    const where = `ambience rule #${i + 1}`;
    if (!isObj(r)) return err('audio', `${where} must be an object { sound, when, volume, ... }`);
    for (const k of Object.keys(r)) if (!RULE.includes(k)) err('audio', `${where} has an unknown key "${k}" (known: ${RULE.join(', ')})`);
    if (typeof r.sound !== 'string') err('audio', `${where} needs sound: a name from audio.sounds`);
    else if (!named(r.sound)) warn('audio', `${where} plays "${r.sound}", which audio.sounds does not define (sounds: ${known(sounds)}); it stays silent unless code defines it`);
    checkWhen(where, r.when);
    if (isObj(r.volume)) for (const k of Object.keys(r.volume)) if (!VOLUME.includes(k)) err('audio', `volume of ${where} has an unknown key "${k}" (known: ${VOLUME.join(', ')})`);
  });
  (music.rules || []).forEach((r, i) => {
    const where = `music rule #${i + 1}`;
    if (r?.track != null && !(r.track in tracks) && !named(r.track)) warn('audio', `${where} picks track "${r.track}", which audio.music.tracks does not define (tracks: ${known(tracks)})`);
    checkWhen(where, r?.when);
  });
  for (const [type, n] of Object.entries(a.footsteps || {})) if (typeof n !== 'string' || !named(n)) warn('audio',
    `footsteps.${type} plays "${n}", which audio.sounds does not define (sounds: ${known(sounds)})`);
}
