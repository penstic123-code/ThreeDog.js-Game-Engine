// The asset packs this game registers (main.js: engine.assets.manifest(packs)). Kept in their own file so `npm run check` imports the same
// objects and checks the model / sound names content uses against them (one source, no scanning of main.js).
import { models } from './models.js';

// blip: a tiny synth content/audio.js names; a sound made in code is registered like a file, by name
const blip = (a, p, out) => { a.tone({ freq: (p.freq ?? 440) * p.pitch, dur: 0.12, out }); return 0.12; };

export default [{ name: 'action', models, sounds: { blip } }];
