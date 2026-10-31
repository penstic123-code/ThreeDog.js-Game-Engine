// Test scene for the audio system (tests/specs/audio.mjs): buses, sounds by name (variants, cooldown, voice limit, 3D), the ambience
// rule table, music rules and stems, ducking, the settings sliders. No real listening: the spec reads gains and counters.
import { createEngine, world, sky, weather, triggers, ambience, music, settings, followCamera, content, THREE } from '../../index.js';

// sound files made in the page (a built test page has no static files to fetch): a 1 s mono 16-bit sine WAV as a blob: URL
function wav(freq) {
  const rate = 8000, n = rate, buf = new DataView(new ArrayBuffer(44 + n * 2)), str = (o, t) => [...t].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); buf.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true); str(36, 'data'); buf.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) buf.setInt16(44 + i * 2, Math.sin(i / rate * freq * 2 * Math.PI) * 8000, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
const [a, b, c] = [wav(220), wav(330), wav(440)];
// a tiny synth the spec can count: a 0.2 s tone, or a loop object when asked to loop
const ping = (a, p, out) => {
  if (p.loop) { const o = a.ctx.createOscillator(); o.frequency.value = 220; o.connect(out); o.start(); return { stop: t => o.stop(t) }; }
  a.tone({ freq: 660 * p.pitch, dur: 0.2, out }); return 0.2;
};
const engine = createEngine({ canvas: document.getElementById('view'), saveKey: 'threedog-audio-test', audio: {
  levels: { voice: 0.9 },   // a game bus of its own
  sounds: {
    hit: [a, b, c],
    ping: { synth: 'ping' },
    slow: { synth: 'ping', cooldown: 0.5 },
    buzz: { synth: 'ping', voices: 2 },
    hum: { synth: 'ping', loop: true },
  },
  ambience: [{ sound: 'hum', when: { state: 'combat' }, volume: 0.5, fade: 0.1 }],
  music: { tracks: { calm: a, fight: { url: a, stems: [{ url: b, at: [0.5, 1] }] } },
    rules: [{ track: 'fight', when: { state: 'combat' }, priority: 5 }, { track: 'calm' }], hold: 0, interval: 0.1 },
} });
engine.audio.register('ping', ping);
engine.use(world(), sky({ time: 0.5 }), weather({ start: 'clear' }), triggers(), followCamera(), ambience({ interval: 0.1 }), music(), settings(), content());
const ground = new THREE.Mesh(new THREE.PlaneGeometry(50, 50).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8a9a7a }));
engine.add(ground);
window.engine = engine; window.THREE = THREE;   // the spec makes an Object3D for a positional sound to follow
window.toneUrl = a;   // the content-audio spec registers it as an asset pack sound
engine.start();
