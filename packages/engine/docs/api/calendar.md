# engine.calendar — calendar(opts?: CalendarOptions)

Time of day, day, seasons and clock-time timers (calendar() module); NPC schedules, content clock conditions and audio time rules read it

- Options `CalendarOptions`:
  - `time?: string | number` Time of day at start: 'HH:MM' or fraction of a day 0–1 (0.5 noon), default 0.33 (afterwards read / write engine.calendar.timeOfDay)
  - `dayLength?: number` Calendar seconds per day, default Infinity: the time of day never moves until the game sets a length (presets.calendar.cycle has 360) (one hour = dayLength / hoursPerDay calendar seconds; with clock.rate 1 calendar seconds are real seconds)
  - `hoursPerDay?: number` Hours per day of the displayed clock and of clock notation ('18:30'), default 24
  - `day?: number` Which day to start from, default 1
  - `daysPerSeason?: number` Days of each season given by name only, default 7
  - `seasons?: (string | { name: string, days: number })[]` Seasons, default none ([]): names (each daysPerSeason days) or { name, days } for seasons of their own length, e.g. ['spring', 'summer', 'autumn', 'winter'], [{ name: 'wet', days: 10 }, { name: 'dry', days: 20 }], or ['q1', 'q2', 'q3', 'q4'] for a business year

## Methods and properties
- `calendar.at(clock: string | number, fn: (day: number) => void, opts?: CalendarAtOptions) → Handle` — Call fn every day at a clock time: at('18:00', fn) or at(0.75, fn). Fires only when time moves forward across the clock time: natural flow, engine.skip and setting timeOfDay later all count; crossing several triggers at once is replayed per catchUp; rewinding time and loading a save do not fire, they only reset the baseline. To hold a state during a time range (lights, shop door) use between
- `calendar.between(from: string | number, to: string | number, opts: CalendarBetweenOptions) → Handle` — Time-range switch: on() while clock time is in [from, to), otherwise off() (from > to wraps midnight). Aligns once immediately on registration, new game, load, applying a scenario and time rewind; afterwards it calls on/off when crossing a boundary. Example: `engine.calendar.between('09:00', '17:00', { on: () => shop.open(), off: () => shop.close() })`
- `calendar.daily(fn: (day: number) => void, opts?: CalendarAtOptions) → Handle` — Call fn(day) at the start of each day (00:00)
- `calendar.onSeason(name: string, fn: (season: string) => void) → Handle` — Call fn(seasonName) on entering season name
- `calendar.untilMark() → number` — (experimental) Calendar seconds until the next clock mark (midnight, at times, between edges); engine.skip ends a segment there; Infinity when the time of day never moves
- Properties:
  - `hoursPerDay: number` (experimental) Hours per day (clock notation 'HH:MM', schedules, at / between)
  - `seasons: string[]` (experimental) Season names, [] when the game has no seasons (the default)
  - `timeOfDay: number` Time of day: 0-1 (0 midnight, 0.25 6am, 0.5 noon, 0.75 6pm); one day = dayLength calendar seconds (the unit of engine.clock.now). Writing it later in the day counts as time passing (at timers crossed fire); writing it earlier only resets the timers' baseline
  - `day: number` Day number (1-based); writing it fires no day:start
  - `dayLength: number` Calendar seconds per day (1 hour = dayLength / hoursPerDay calendar seconds; at clock.rate 1 calendar seconds equal real seconds); Infinity = the time of day never moves. Changing it keeps the current time of day
  - `clock: string` Clock text, e.g. "18:00"
  - `daylight: number` Daylight from the clock 0-1 (0 from 18:00 to 06:00, 1 at noon; a sine over the day). Audio rules { daylight }, ambience and the sky's default sun read it
  - `isDay: boolean` Whether it is daytime by the clock (06:00-18:00 of the day's hours)
  - `seasonIndex: number` (experimental) Current season index, -1 without seasons
  - `season: string | null` Current season name, e.g. 'spring'; null without seasons
  - `dayOfSeason: number` (experimental) Day within the season (1-based); 0 without seasons
  - `seasonProgress: number` (experimental) Fraction of the season elapsed, 0-1 (includes time of day); 0 without seasons
  - `totalDays: number` (experimental) Total game time in days (fractional), for growth, cooldowns and the like

## Data structures
- **CalendarAtOptions** Parameters of calendar.at() / daily()
  - `days?: number[] | ((day: number) => boolean)` Only fire on these days: a list of days, or (day) => whether to fire
  - `catchUp?: 'all' | 'once' | 'skip'` When one advance crosses several trigger points: 'all' fire them all / 'once' fire once (default) / 'skip' do not make up
- **CalendarBetweenOptions** Callback of calendar.between: on is called when entering the period, off when leaving it
  - `on?: () => void` Entering the period (or found inside it when aligned)
  - `off?: () => void` Leaving the period (or found outside it when aligned)
