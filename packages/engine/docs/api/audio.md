# engine.audio (Audio) — engine.audio: sound

- `audio.setVolume(channel: AudioChannel | "volume", v: number)` — Set volume: 'volume' (master) / 'ambience' / 'sfx' / 'music', 0-1. Example: `engine.audio.setVolume('music', 0.3);`
- `audio.register(name: string, synthFn: SynthFn)` — Register a synthesized fallback sfx. Example: `engine.audio.register('ding', a => a.tone({ freq: 880, dur: 0.2 }));`
- `audio.sfx(name: string, variant?: any, opts?: { volume?: number })` — Play an sfx by name (uses the style.sounds file if the style pack has one, else synthesizes). Example: `engine.audio.sfx('ding');`
- `audio.noiseBurst(opts?: { dur?, type?, freq?, vol?, bus?, rate?, … })` — Synth: a burst of filtered noise (footsteps, shutter, rain, thunder all use it). dur in seconds, freq in Hz, vol 0-1
- `audio.tone(opts?: { freq?, to?, dur?, vol?, type?, bus?, … })` — Synth: a short tone (bird call, notification). freq/to in Hz, dur in seconds, pan -1..1. Example: `engine.audio.tone({ freq: 660, to: 880, dur: 0.15 });`
- `audio.load(url: string) → Promise<any>` — Download and decode an audio file
- `audio.play(url: string, opts?: { channel?, volume?, loop?, fadeIn? }) → Promise<SoundHandle>` — Play an audio file; returns { stop(fadeSeconds), gain, source }. Example: `const h = await engine.audio.play('/sfx/door.ogg', { channel: 'sfx' });`
- Properties:
  - `ctx: any` The browser AudioContext (exists only after the first click)
  - `levels: { volume, ambience, sfx, music }` Volume per channel, 0-1
  - `running: boolean` Is audio usable (the player has clicked/pressed a key)?
