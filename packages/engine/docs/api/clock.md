# engine.clock (Clock) — engine.clock: calendar seconds and "after how long / every how long"

- `clock.after(seconds: number, fnOrEvent: (() => void) | string, opts?: { data?: any; channel?: string }) → Handle` — Call fn after seconds calendar seconds; if an event name is passed, the event is emitted when due (with data, can be saved). { channel } counts that time channel's seconds instead (a poison tick that slows down in bullet time)
- `clock.every(seconds: number, fn: () => void, opts?: { channel?: string }) → Handle` — Call once every seconds calendar seconds ({ channel }: 'real' or a time channel's seconds instead)
- Properties:
  - `now: number` Calendar seconds = world-channel seconds x clock.rate, does not advance while paused / frozen, saved with the game; one calendar day = calendar.dayLength calendar seconds
  - `rate: number` Calendar seconds per world-channel second (default 1; 0 stops the calendar, sky included). Read-only: change it with `engine.mod('clock.rate', { owner: 'game', set: 60 })` (a minute per second); the handle's remove() undoes it
  - `speed: number` Calendar seconds per real second right now (rate x the world channel's speed)
