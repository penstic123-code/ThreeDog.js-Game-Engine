# engine.clock (Clock) — engine.clock: game seconds and "after how long / every how long"

- `clock.after(seconds: number, fnOrEvent: (() => void) | string, data?: any) → Handle` — Call fn after seconds game seconds; if an event name is passed, the event is emitted when due (with data, can be saved)
- `clock.every(seconds: number, fn: () => void) → Handle` — Call once every seconds game seconds
- Properties:
  - `now: number` Game seconds = fixed-step seconds x clock.timeScale (the time scale is 1 without sky), does not advance while paused / frozen, saved with the game; one sky day = sky.dayLength game seconds
  - `timeScale: number` Game-time speed: game seconds per fixed-step second (default 1; the sky's time of day follows it). `engine.clock.timeScale = 60` makes a minute pass per second
