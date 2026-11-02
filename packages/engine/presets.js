// Opt-in gameplay presets: named, plain option objects a game picks on purpose, like a style for feel.
// The engine never applies one by itself (weather() alone has only 'clear', sky() has no seasons and no day cycle, music() does not duck for dialogue, no module binds a gameplay key, createPlayer() and interactions() refuse to guess a feel
// or a key); a preset only bundles options the game could write itself, so spreading it and overriding a field is always the same as writing it out:
//   engine.use(weather({ ...presets.weather.temperate, autoPool: ['clear', 'rain'] }));
//   engine.characters.createPlayer({ ...presets.player.lockOn, faceTarget: boss });
//   engine.use(interactions({ ...presets.interactions.nearest, keys: ['KeyF'] }));
// No imports and no engine state: plain data plus small control functions that call public API only.

/** @import { WeatherOptions, SkyOptions } from './types/world' */

/** A side-scroller moves only along world X (left / right keys); W / S do nothing. Reads input by action like the 'camera' control */
function sideScroll(p, input) { return { x: (input.autopilot || input.axis).x, z: 0, run: input.actions.has('run') && input.down('run') }; }

// The keys the walking presets bind (the engine binds none by itself): Shift / gamepad LB runs, Space / gamepad A jumps
const RUN = Object.freeze(['ShiftLeft', 'ShiftRight', 'PadLB']), JUMP = Object.freeze(['Space', 'PadA']);
const walk = (control, faceMode) => Object.freeze({ control, faceMode, runKeys: RUN, jumpKeys: JUMP, cameraFollow: true });
const use = pick => Object.freeze({ pick, keys: Object.freeze(['KeyE', 'PadX']) });

/**
 * Opt-in presets, grouped by the option they fill. Each value is an options object for the function named in its group.
 * @example engine.use(openWorld({ weather: presets.weather.temperate, calendar: presets.calendar.fourSeasons }))
 * @example engine.use(followCamera(presets.camera.overShoulder)); engine.characters.createPlayer({ ...presets.player.aim, spawn })
 * @example engine.use(interactions({ ...presets.interactions.nearest }))
 */
export const presets = Object.freeze({
  /** weather({ ... }) options */
  weather: Object.freeze({
    /** Seven temperate weathers (clear cloudy overcast rain storm snow fog) and an automatic-weather pool weighted toward clear */
    temperate: Object.freeze({
      types: Object.freeze({
        clear:  { cloud: 0.15, sun: 1.0, fog: 1.0, wind: 0.8, rain: 0, snow: 0, grey: 0.0, lightning: 0 },
        cloudy: { cloud: 0.45, sun: 0.85, fog: 0.9, wind: 1.1, rain: 0, snow: 0, grey: 0.15, lightning: 0 },
        overcast: { cloud: 0.85, sun: 0.45, fog: 0.75, wind: 1.3, rain: 0, snow: 0, grey: 0.45, lightning: 0 },
        rain:   { cloud: 0.9, sun: 0.35, fog: 0.6, wind: 1.6, rain: 0.6, snow: 0, grey: 0.55, lightning: 0 },
        storm:  { cloud: 1.0, sun: 0.2, fog: 0.45, wind: 2.6, rain: 1.0, snow: 0, grey: 0.7, lightning: 1 },
        snow:   { cloud: 0.85, sun: 0.5, fog: 0.55, wind: 0.9, rain: 0, snow: 1.0, grey: 0.5, lightning: 0 },
        fog:    { cloud: 0.6, sun: 0.55, fog: 0.25, wind: 0.4, rain: 0, snow: 0, grey: 0.5, lightning: 0 },
      }),
      autoPool: Object.freeze(['clear', 'clear', 'clear', 'cloudy', 'cloudy', 'overcast', 'rain', 'storm', 'fog']),
    }),
  }),
  /** calendar({ ... }) options */
  calendar: Object.freeze({
    /** Spring, summer, autumn, winter, 7 days each, with the 360 s day cycle of `cycle` (a cozy life sim; set daysPerSeason: 28 for longer seasons) */
    fourSeasons: Object.freeze({ seasons: Object.freeze(['spring', 'summer', 'autumn', 'winter']), daysPerSeason: 7, dayLength: 360 }),
    /** A day-night cycle, one day = 360 game seconds (6 minutes at clock.rate 1); calendar() alone keeps a fixed time of day */
    cycle: Object.freeze({ dayLength: 360 }),
    /** One time of day that never moves (dungeon, arena, space station), what calendar() does without a dayLength; pick the hour with time */
    fixedTime: Object.freeze({ dayLength: Infinity }),
  }),
  /** characters.createPlayer({ ... }) movement, facing, run / jump keys and camera follow (createPlayer has no default: pick one of these or write the options) */
  player: Object.freeze({
    /** The engine does nothing: no key reads, no turning, no camera follow; the game calls player.move() and player.face() itself (add cameraFollow: true to keep the camera on it) */
    none: Object.freeze({ control: 'none', faceMode: 'manual', cameraFollow: false }),
    /** Keys relative to the camera, Shift runs, Space jumps, turn toward the move direction, camera follows (adventure, life sim) */
    thirdPerson: walk('camera', 'move'),
    /** Keys relative to the camera while facing faceTarget: strafe around a locked-on enemy (soulslike); set faceTarget */
    lockOn: walk('camera', 'target'),
    /** Keys relative to the camera while facing where the camera looks (over-the-shoulder shooter) */
    aim: walk('camera', 'camera'),
    /** Left / right only along world X, turn toward the move direction (2.5D side-scroller; pair with a side-on camera) */
    sideScroller: walk(sideScroll, 'move'),
  }),
  /** interactions({ ... }) selection and key (interactions has no default pick or key: pick one of these or write { pick, keys }) */
  interactions: Object.freeze({
    /** E / gamepad X uses the nearest one in reach (top-down, third person, life sim) */
    nearest: use('nearest'),
    /** E uses only what the actor faces, within 60° (soulslike: the door behind you stays dark) */
    facing: use('facing'),
    /** E uses the one closest to the screen-center ray (first person, shooters) */
    aim: use('aim'),
  }),
  /**
   * Keys for modules that open or do one thing (no module binds a key by itself): spread one into that module's options,
   * e.g. inventory({ ...presets.keys.inventory, capacity: 20 }), characters({ ...presets.keys.brake })
   */
  keys: Object.freeze({
    /** inventory(): I / gamepad Y opens the bag */
    inventory: Object.freeze({ keys: Object.freeze(['KeyI']), pad: Object.freeze(['PadY']) }),
    /** quests(): J / gamepad Select opens the quest log */
    quests: Object.freeze({ keys: Object.freeze(['KeyJ']), pad: Object.freeze(['PadSelect']) }),
    /** photo(): P / gamepad RB takes a photo */
    photo: Object.freeze({ keys: Object.freeze(['KeyP']), pad: Object.freeze(['PadRB']) }),
    /** grids.preview(): R turns the placement preview (spread into the preview options; rotate names the action) */
    gridRotate: Object.freeze({ rotateKeys: Object.freeze(['KeyR']) }),
    /** characters(): B / gamepad LT brakes while driving */
    brake: Object.freeze({ brakeKeys: Object.freeze(['KeyB']), brakePad: Object.freeze(['PadLT']) }),
  }),
  /** followCamera({ ... }) options */
  camera: Object.freeze({
    /** Far, slow orbit for open landscapes (the follow camera's own defaults) */
    follow: Object.freeze({}),
    /** Close over-the-shoulder view with a locked mouse (third-person shooter, soulslike) */
    overShoulder: Object.freeze({ distance: 3, shoulder: 0.7, pitch: 0.15, pointerLock: true }),
    /** Third-person action: locked mouse, look up to about +60° and down, the ground shortens the arm (look direction kept), walls pull it in, the player hides when the camera is inside it */
    thirdPersonAction: Object.freeze({ distance: 4.5, minDistance: 1.5, maxDistance: 9, height: 1.6, shoulder: 0.5, pitch: 0.25, minPitch: -1.05, maxPitch: 1.2,
      ground: 'shorten', groundClearance: 0.3, hideTargetNear: 0.9, pointerLock: true }),
  }),
});
