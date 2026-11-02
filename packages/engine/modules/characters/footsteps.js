// Built-in footstep synth and the ground-type -> sound-name lookup (split out of index.js)
// Built-in footstep synth (sound asset 'footstep'), silent until the game names it: sounds: { 'step.grass': { src: 'footstep', params: { surface: 'grass' } } }.
// params: surface (a key of STEP_SYNTH or params.surfaces), volume, surfaces ({ mud: [filter, Hz, volume, seconds] } to add or retune one)
const STEP_SYNTH = { grass: ['bandpass', 900, 0.08, 0.12], sand: ['lowpass', 1400, 0.1, 0.14], rock: ['bandpass', 2400, 0.05, 0.1], snow: ['lowpass', 900, 0.12, 0.16], water: ['bandpass', 600, 0.15, 0.18] };
export function footstepSynth(audio, params, out) {
  const table = { ...STEP_SYNTH, ...(params.surfaces || {}) };
  const p = table[params.surface] || table.grass;
  // presentation: random footstep pitch
  audio.noiseBurst({ type: p[0], freq: p[1] * params.pitch * (0.9 + Math.random() * 0.2), vol: p[2] * (params.volume ?? 1), dur: p[3], out });
  return p[3] + 0.05;
}
/** Sound name for a ground type: the game's createEngine({ audio: { footsteps } }) map, then its default, then 'footstep' */
export const stepSound = (e, type) => { const m = e.audio.config.footsteps; return m[type] ?? m.default ?? 'footstep'; };
