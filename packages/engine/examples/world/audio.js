// This game's sounds (createEngine({ audio })): sounds are the game's, not the style pack's. 'synth' plays the engine's synthesized
// sound; a file path (or an array of variants, picked at random) plays the file; anything omitted is silent.
const rain = e => e.weather?.current.rain ?? 0;
const daylight = e => e.sky?.daylight ?? 1;
const step = surface => ({ synth: 'footstep', params: { surface } });

export default {
  sounds: {
    // footsteps per surface (built-in footstep synth); a file version: 'step.grass': ['/sounds/grass-1.ogg', '/sounds/grass-2.ogg']
    'step.grass': step('grass'), 'step.sand': step('sand'), 'step.rock': step('rock'), 'step.snow': step('snow'), 'step.water': step('water'),
    shutter: 'synth', thunder: 'synth',
    wind: 'synth', rain: 'synth', water: 'synth', birds: 'synth', crickets: 'synth',   // ambience synths (ambience() module)
  },
  // Ambience rule table: while `when` holds the sound plays at `volume`; `every` makes it a one-shot at random gaps
  ambience: [
    { sound: 'wind', volume: (e, a) => Math.min(0.5, 0.05 + (e.weather?.current.wind ?? 0.8) * 0.08 + Math.max(0, e.surface(a.position.x, a.position.z)) / 40 * 0.15), fade: 0.8 },
    { sound: 'rain', volume: e => rain(e) * 0.22 },   // volume 0 = off: the loop fades out and stops
    { sound: 'water', volume: (e, a) => a.nearWater(12) * 0.12 },
    { sound: 'birds', when: e => daylight(e) > 0.15 && rain(e) < 0.2, every: [1.5, 6.5] },
    { sound: 'crickets', when: e => daylight(e) < 0.05 && rain(e) < 0.2 && (e.weather?.current.snow ?? 0) < 0.2, every: [0.4, 1.6] },
  ],
  // Ground type (terrainPreset biome names) -> footstep sound; water while swimming; default for anything else
  footsteps: { beach: 'step.sand', rock: 'step.rock', snow: 'step.snow', water: 'step.water', default: 'step.grass' },
  // Background music (only with files): music: { tracks: { day: '/sounds/day.ogg', night: '/sounds/night.ogg' }, rules: [{ track: 'night', when: { time: 'night' } }, { track: 'day' }] }
};
