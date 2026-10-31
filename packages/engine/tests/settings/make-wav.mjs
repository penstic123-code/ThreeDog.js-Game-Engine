// Generate a sine-wave WAV for tests (16-bit mono PCM)：node packages/engine/tests/settings/make-wav.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
const dir = new URL('./audio/', import.meta.url);
mkdirSync(dir, { recursive: true });
function wav(name, freq, seconds, vol = 0.3, rate = 22050) {
  const n = Math.floor(rate * seconds), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 200, (n - i) / 200);
    b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / rate) * vol * env * 32767), 44 + i * 2);
  }
  writeFileSync(new URL(name, dir), b);
}
wav('a.wav', 440, 2); wav('b.wav', 330, 2); wav('sting.wav', 880, 1);
