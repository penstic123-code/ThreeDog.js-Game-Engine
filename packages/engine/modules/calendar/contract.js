// What any calendar must provide so NPC schedules, content `clock` conditions, audio rules, engine.skip({ to }), saves, describe and the sky keep
// working when a game replaces the engine's calendar (a turn counter, a lunar calendar, a shop sim's opening days). Same shape as the other
// contracts (gameplay/inventory.contract.js has the field meanings), checked by @threedog/tools/contract.
//   fields: plain properties the readers use (npcSim reads timeOfDay / dayLength, content and NPC schedules hoursPerDay, the sky timeOfDay /
//   season / seasons / seasonIndex / seasonProgress / day, skip untilMark()); probe.state may read one of them instead of calling a method
export default {
  name: 'calendar',
  api: ['at', 'between', 'daily', 'onSeason', 'untilMark'],
  fields: ['timeOfDay', 'day', 'dayLength', 'hoursPerDay', 'clock', 'seasons', 'season', 'seasonIndex', 'seasonProgress', 'totalDays', 'isDay', 'daylight'],
  ops: [],
  events: ['day:start', 'season:change'],
  saves: { calendar: 1 },
  describe: true,
  options: { time: '06:00', dayLength: 240, seasons: ['wet', 'dry'], daysPerSeason: 2 },
  probe: {
    setup: [['at', '12:00', () => {}]],
    // a whole day of fixed steps: crosses midnight (day:start) and, with 2-day seasons, the season boundary on day 3 (season:change)
    emits: [['day:start', ['__step', 240]], ['season:change', ['__step', 240]]],
    state: { read: 'day', expect: 3 },
  },
};
