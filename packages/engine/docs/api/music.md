# engine.music — music(opts?: MusicOptions)

Background music (music() module)

- Options `MusicOptions`:
  - `tracks?: Record<string, MusicTrack>` Tracks: name -> path or { url, volume, loop }
  - `fade?: number` Default crossfade seconds, default 2
  - `duckDialogue?: number | false` How far music is ducked during dialogue (0–1), false turns it off, default 0.35
  - `duckFade?: number` Fade seconds for the ducking
  - `hold?: number` Rule debounce seconds, default 2
  - `interval?: number` Rule check interval (seconds), default 1

## Methods and properties
- `music.addTracks(map: Record<string, MusicTrack>)` — Register tracks: { name: url / { url, volume, loop } }
- `music.play(name: string | null, opts?: { fade?: number; force?: boolean })` — Play a track (cross-fade over fade seconds). Does nothing if it is already playing; force replays it
- `music.stop(fade?: number)` — Fade out and stop (fade over fade seconds)
- `music.duck(amount?: number, seconds?: number, fade?: number)` — Duck the music to amount (0-1), restore automatically after `seconds` (0 = stay ducked), fade is the fade seconds
- `music.stinger(name: string, opts?: { duck?: number; volume?: number })` — Layer a one-shot piece (victory, discovered place...), ducking the background music slightly while it plays
- `music.rules(list: MusicRule[] | null, opts?: { hold?, fade?, interval? })` — Set the auto track rules (null turns them off). opts: hold how many seconds a new result must be stable before switching, fade switch fade seconds, interval check interval
- `music.override(name: string | null, opts?: { fade?: number; force?: boolean })` — Pick a track by hand, pausing the rules; override(null) hands control back
- `music.pick() → string | null | undefined` — Which track the current rules would pick (without switching)
- Properties:
  - `tracks: Map<string, { url: string; volume?: number; loop?: boolean …` Registered tracks
  - `current: string | null` Name of the track playing (or wanted)
  - `duckLevel: number` Current duck multiplier
  - `regions: Map<string, number>` Trigger-zone tag the player is in -> count
  - `when: { weather, time, night, day, inRegion, dialogue, … }` Common conditions (for the `when` of rules; all return a MusicCondition; without the matching module they simply never match) (weather() time() night() day() inRegion() dialogue() all() any() not())
  - `ready: boolean` Whether audio is usable
  - `ruled: boolean` Auto track rules are in use
  - `state: { current, playing, pending, duck, regions, override, … }` State (for debugging)

## Data structures
- **MusicRule** Auto-selection rule: when the condition holds play track (null = silence), higher priority wins
  - `track: string | null`
  - `when: MusicCondition`
  - `priority?: number`
