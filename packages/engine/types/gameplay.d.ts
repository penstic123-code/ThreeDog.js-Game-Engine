// Gameplay modules: timeline, level, triggers, entities, world changes, particles, settings, music, characters/NPCs, interactions, dialogue, inventory,
// quests, photo mode, ambience, debug.
import type { Object3D, Vector3, Vector2, Quaternion, Texture, ColorLike, Vec3Like, Ease, Handle, Range, XZ, Loose, PositionLike } from './common';
import type { Engine } from './core';
import type { Input } from './generated/core/Input';
import type { Animator, AnimatorOptions, Vehicle } from './physics';
import type { WorldRecord } from './generated/modules/world/World';

// ======================================================================
// Timeline timeline()
// ======================================================================

/** Promise of a tween: await it to wait for the end; finish() jumps to the end now, cancel() stops at the current position */
export interface TweenPromise extends Promise<boolean> {
  finish(): void;
  cancel(): void;
  task: any;
}
/** Tween target: 'dotted.path' -> target value. E.g. { 'position.y': 3, 'material.color': 0xffffff, scale: [2, 2, 2] }; a value can also be () => value */
export type TweenTo = Record<string, number | string | number[] | object | (() => any)>;

/** One end point of a camera move */
export interface CameraPose {
  /** Camera position */
  position?: Vec3Like;
  /** The point to look at, or a moving object */
  lookAt?: Vec3Like | Object3D;
  /** Field of view (degrees) */
  fov?: number;
}
/** Timeline steps (run in order) */
export type TimelineStep =
  | TimelineStep[]
  | ((engine: Engine, run: any) => any)
  | { parallel: TimelineStep[] }
  | { sequence: TimelineStep[] }
  /** Wait some seconds */
  | { wait: number }
  /** Wait for an event; timeout is the maximum seconds to wait */
  | { waitFor: string; timeout?: number }
  /** Run a piece of code (may be async) */
  | { do: (engine: Engine, run: any) => any }
  /** Tween: target is the object, to the target values, duration in seconds */
  | { tween: { target: any; to: TweenTo; duration?: number; ease?: Ease } }
  /** Camera: from/to end points, duration in seconds, fov target field of view; or { release: true } to hand the camera back */
  | { camera: { from?: CameraPose; to?: CameraPose; duration?: number; ease?: Ease; fov?: number; release?: false } | { release: true } }
  /**
   * Move an object (or character, or camera) along a path: points are the path points, duration in seconds, lookAhead how far ahead to look (0–1),
   * ground snaps to the ground (a number = height above ground)
   */
  | { path: { object: any; points: Vec3Like[]; duration?: number; ease?: Ease; lookAhead?: number; ground?: boolean | number; closed?: boolean; curve?: 'catmullrom' | 'centripetal' | 'chordal'; tension?: number; upright?: boolean } }
  /** Full-screen fade: fade is the seconds, to is the target cover (0 transparent ... 1 full black, default 1) */
  | { fade: number; to?: number }
  /** Say a line of dialogue (needs the dialogue module) and wait for the dialogue to end */
  | { say: { speaker?: string; text?: string; nodes?: DialogueScript; node?: string } }
  | null | undefined | false;

export interface TimelinePlayOptions {
  /** Can be skipped, default true */
  skippable?: boolean;
  /** Letterbox bars, default false */
  letterbox?: boolean;
  /** Lock player input while playing, default true */
  lockInput?: boolean;
}

// Timeline (engine.timeline) is generated from the JSDoc in modules/timeline/Timeline.js (npm run map); only the type is re-exported here
import type { Timeline } from './generated/modules/timeline/Timeline';
export type { Timeline };
export interface TimelineOptions {
  /**
   * Keys that skip a cutscene, default ['Escape', 'Backspace'] (Esc is the back key, which the UI focus stack hands to the topmost cutscene; cutscenes
   * do not advance while frozen)
   */
  skipKeys?: string[];
}

// ======================================================================
// Level level()
// ======================================================================

export interface LevelOptions {
  /** glTF path (or asset name); pick one of this and scene */
  url?: string | null;
  /** THREE.Object3D built in code; pick one of this and url */
  scene?: Object3D | null;
  /** Decide yourself which meshes are walkable */
  walkable?: ((mesh: Object3D) => boolean) | null;
  /** 'named' only col_ meshes block the player | 'auto' every tall mesh that is not walkable blocks | false */
  colliders?: 'named' | 'auto' | false;
  /** Heightfield cell size (meters), default 0.5 */
  cellSize?: number;
  /** Ground height outside the level (meters), default 0 */
  outside?: number;
  /** Water surface height (meters), default no water */
  waterLevel?: number;
  /** Expand the collision box outward by this much (meters) */
  colliderPad?: number;
  /** Minimum height of the collision box (meters) */
  colliderHeight?: number;
  /** Treat it as a step edge when the height difference between adjacent grid points exceeds this (meters), default 0.6 */
  sharpEdge?: number;
  /** Hide the marker placeholder meshes, default true */
  hideMarkers?: boolean;
  /** Add the scene to engine.scene, default true */
  addToScene?: boolean;
}
/** Markers in the level (spawn, npc_*, trigger_*, marker_*), in world coordinates */
export interface LevelMarker { name: string; position: Vector3; quaternion: Quaternion; scale: Vector3; userData: Record<string, any>; object: Object3D }
export interface LevelLoadedEvent { root: Object3D; markers: Record<string, LevelMarker>; spawn: Vector3 }

/** engine.level */
export interface Level {
  /** Scene root node */
  root: Object3D | null;
  /** Same as root (the name consistent with player.object and ent.object) */
  readonly object: Object3D | null;
  /** All markers: name -> marker */
  markers: Record<string, LevelMarker>;
  /** Spawn point position */
  spawn: Vector3;
  /** Heightfield (for debugging) */
  heightfield: any;
  /** Milliseconds spent building the heightfield */
  buildMs?: number;
  /** Whether loading is finished */
  readonly ready: boolean;
  /** Get a marker, null if none */
  marker(name: string): LevelMarker | null;
  /** Get all markers whose names start with prefix, e.g. markersWith('npc_') */
  markersWith(prefix: string): LevelMarker[];
  /** Unload the level (the scene is fully deleted with engine.remove; collision, ray registrations and things registered with track are removed together) */
  unload(): void;
  /**
   * Change level: unload the current one, load the new one (glTF path/asset name, or a THREE object), and emit level:loaded when done. When a load
   * changes level, the save system waits for it
   */
  load(urlOrScene: string | Object3D): Promise<void>;
  /**
   * Register things that belong to the current level and need not be kept (the { remove() } handles of triggers...); they are deleted automatically on
   * level change / unload; returns the same handle. world data that keeps state (NPCs, pickups, props) needs no registration: with a zone, a level
   * change only tears down the model
   */
  track<T extends { remove(): void }>(handle: T): T;
}

// ======================================================================
// Trigger zones triggers()
// ======================================================================

/** Trigger zone parameters */
export interface TriggerOptions {
  /** Shape: 'cylinder' upright cylinder (default) | 'sphere' | 'box' cuboid */
  shape?: 'cylinder' | 'sphere' | 'box';
  /** Center { x, y, z } / [x, y, z] / Vector3 / object (meters); for box and cylinder y is the bottom height; without y the ground height is used */
  position?: PositionLike;
  /** Sphere/cylinder radius (meters), default 1.5 */
  radius?: number;
  /** Box size [width, height, depth] (meters), default [2, 2, 2] */
  size?: number[];
  /** Cylinder height (meters), default 3 */
  height?: number;
  /** Box rotation around the Y axis (radians) */
  rotation?: number;
  /** Called on entering; who is the position that entered */
  onEnter?: ((t: Trigger, who: Vector3) => void) | null;
  /** Called on leaving */
  onExit?: ((t: Trigger, who: Vector3 | null) => void) | null;
  /** Called every fixed step while inside (dt in seconds) */
  onStay?: ((dt: number, t: Trigger, who: Vector3) => void) | null;
  /** Fire on the first enter only (exit follows at once); the zone stays with used = true, and a new playthrough (engine.session) re-arms it */
  once?: boolean;
  /** false pauses detection */
  enabled?: boolean;
  /** Name (carried in events) */
  tag?: string;
  /** Who can trigger it: the player by default; or a position, an object (its position is used), or a function returning an array of positions */
  who?: Vector3 | Object3D | { x: number; y: number; z: number } | (() => Array<{ x: number; y: number; z: number }>) | null;
  /** Seconds after leaving during which entering does not fire again, default 0 */
  cooldown?: number;
  /** Custom data */
  userData?: Record<string, any>;
}
/** A trigger zone (the return value of add()) */
export interface Trigger {
  shape: 'cylinder' | 'sphere' | 'box';
  /** Position (meters) */
  x: number; y: number; z: number;
  radius: number; height: number; rotation: number;
  tag: string;
  /** Whether the player is inside now */
  inside: boolean;
  /** Can be changed at any time: false pauses detection */
  enabled: boolean;
  once: boolean;
  /** A once zone that already fired this playthrough */
  used: boolean;
  cooldown: number;
  userData: Record<string, any>;
  onEnter: TriggerOptions['onEnter'];
  onExit: TriggerOptions['onExit'];
  onStay: TriggerOptions['onStay'];
  /** Delete this trigger zone */
  remove(): void;
  /** Whether a point is inside */
  contains(p: { x: number; y: number; z: number }): boolean;
}
export interface TriggerEvent { tag: string; trigger: Trigger; who: Vector3 | null }
export interface TriggersOptions {
  /** Show the wireframes from the start */
  debug?: boolean;
  /** Action name that toggles the wireframes, default 'triggersDebug' */
  action?: string;
  /** Key that toggles the wireframes: default ['F4'] in dev builds, none in release builds */
  keys?: string[];
}

/** engine.triggers */
export interface Triggers {
  /** All trigger zones (a new array) */
  list(): Trigger[];
  /** Whether wireframes are shown */
  debug: boolean;
  action: string;
  /** Add a trigger zone */
  add(opts?: TriggerOptions): Trigger;
  /** Delete all (delete a single one with trigger.remove()) */
  clear(): void;
  /** Find by tag */
  byTag(tag: string): Trigger[];
  /** Every trigger_xxx marker in the level becomes a trigger zone with tag xxx; opts is shared by all of them */
  fromMarkers(opts?: TriggerOptions): Trigger[];
  /** Show / hide the wireframes */
  setDebug(on: boolean): void;
}

// ======================================================================
// Entities entities()
// ======================================================================

/** Growth stage */
export interface EntityStage {
  /** Stage name, e.g. 'seed' */
  name: string;
  /** How many game seconds to stay in this stage (leave out on the last one = stay here forever) */
  duration?: number;
  /** Model size multiplier */
  scale?: number;
  /** Swap the model */
  model?: (engine: Engine, ent: Entity) => Object3D;
}
/** Entity interaction settings (needs the interactions module) */
export interface EntityInteract {
  /** Prompt text: an i18n key, plain text, or a function ent => text */
  label?: string | ((ent: Entity, engine: Engine) => string);
  /** Interaction action name, default 'interact' */
  action?: string;
  /** How close you must be to interact (meters), default 2.5 */
  radius?: number;
  /** How high the prompt floats (meters) */
  height?: number;
  /** Whether it can be interacted with */
  enabled?: (ent: Entity, engine: Engine) => boolean;
  /** When the interact key is pressed */
  onUse?: (ent: Entity, engine: Engine) => void;
}
/** Entity type definition: engine.entities.define('sapling', {...}) */
export interface EntityDef<S = Record<string, any>> {
  /** Create the model (required), returns a THREE.Object3D */
  create: (engine: Engine, ent: Entity<S>) => Object3D;
  /** Default state (merged with the state given at spawn) */
  state?: S;
  /** Growth stages */
  stages?: EntityStage[];
  /** Growth stops when this returns false */
  canGrow?: (ent: Entity<S>, engine: Engine) => boolean;
  /** Called every fixed step (dt in seconds); runs only near the player, far away only growth is caught up */
  update?: (dt: number, ent: Entity<S>, engine: Engine) => void;
  /** Interaction */
  interact?: EntityInteract;
  /** Circular collision radius (meters, needs the collision module; follows the model, exists only near the player) */
  collider?: number;
  /** Collision height (meters), default 3 */
  colliderHeight?: number;
  /** Cleanup when the model is torn down (called both when walking away and on deletion; don't clear data while the data still exists) */
  dispose?: (ent: Entity<S>, engine: Engine) => void;
  /** false = not saved (temporary things, cleared on load), default true */
  save?: boolean;
}
/** Parameters of spawn() */
export interface EntitySpawnData {
  /** Specify the id (generated automatically if omitted) */
  id?: string;
  /** Position: Vector3 / object / [x, y, z] / { x, z } ({ x, z } without y snaps to the ground), default origin */
  position?: PositionLike;
  /** Heading (radians) */
  rotation?: number;
  /** Initial state (merged onto the default state) */
  state?: Record<string, any>;
  /** Extra data (ent.data, saved) */
  extra?: Record<string, any>;
}
/** An entity: x / y / z / rotation / state / data read engine.world data directly (kind is 'entity:<type>'); object / visual exist only near the player */
export interface Entity<S = Record<string, any>> {
  id: string;
  type: string;
  def: EntityDef<S>;
  /** Position (meters) */
  readonly x: number; readonly z: number; readonly y: number;
  readonly rotation: number;
  /** State (stage is the current stage index, stageAt the time it was entered); change values with ent.set() so that events fire */
  state: S & { stage?: number; stageAt?: number };
  /** Root node (heading and interactions hang on it); null when there is no model far away, built the frame after spawn */
  readonly object: Object3D | null;
  /** Model (a child of the root node) */
  readonly visual: Object3D | null;
  /** Extra data */
  readonly data: Record<string, any>;
  /** Change one state value (emits the entity:state event) */
  set(key: string, value: any): void;
  /** Delete this entity */
  remove(): boolean;
  /** Current stage name */
  readonly stageName: string | null;
}
export interface EntityStateEvent { ent: Entity; key: string; value: any; prev: any }
export interface EntityStageEvent { ent: Entity; stage: number; name: string }

/** engine.entities */
export interface Entities {
  /** Type definitions */
  types: Map<string, EntityDef>;
  /** Game seconds (= engine.clock.now) */
  readonly now: number;
  /** Define an entity type */
  define<S = Record<string, any>>(type: string, def: EntityDef<S>): this;
  /** Spawn an entity (returns null if the type is not defined) */
  spawn(type: string, data?: EntitySpawnData): Entity | null;
  get(id: string): Entity | null;
  byType(type: string): Entity[];
  list(): Entity[];
  /** The entity nearest to position within radius meters (default 3) (type restricts to one type) */
  nearest(position: PositionLike, opts?: { radius?: number; type?: string | null }): Entity | null;
  remove(id: string): boolean;
  /** Delete all entities */
  clear(): void;
  /** Jump straight to a growth stage */
  setStage(ent: Entity, i: number): void;
}

// ======================================================================
// Particles particles()
// ======================================================================

/** Particle effect parameters (style.particles[name] of the style pack uses the same format too). All optional */
export interface ParticleOptions {
  /** Maximum alive at once, default 120 (halved on low-end devices) */
  max?: number;
  /** Seconds each particle lives [min, max] */
  lifetime?: Range;
  /** Default particles per second for attach */
  rate?: number;
  /** Initial speed (m/s) [min, max] */
  speed?: Range;
  /** Emission direction [x, y, z] */
  direction?: number[];
  /** Maximum angle away from the direction (radians, π = all directions) */
  spread?: number;
  /** Radius of random spread around the spawn point (meters), or a box [x, y, z] */
  area?: number | number[];
  /** Vertical acceleration (m/s², negative falls) */
  gravity?: number;
  /** Air drag (fraction of speed lost per second) */
  drag?: number;
  /** How much wind affects it */
  wind?: number;
  /** Wind direction [x, y, z] */
  windDir?: number[];
  /** Size at birth / at death (meters) */
  size?: Range;
  /** Color at birth / at death (one color, or [birth, death]; an array, not a tuple, so a plain JS literal [0xffffff, 0xdddddd] type-checks) */
  color?: ColorLike | ColorLike[];
  /** Opacity at birth / at death, 0–1 */
  opacity?: Range;
  /** Texture (asset name, path or THREE.Texture); a soft round dot if omitted */
  texture?: string | Texture | null;
  /** 'normal' | 'additive' (glowing blend, for sparks) */
  blending?: Loose<'normal' | 'additive'>;
  /** Texture rotation speed (radians/second) */
  spin?: number;
  /** With attach, whether particles stay in the world (true) or the emission direction rotates with the object (false) */
  worldSpace?: boolean;
  /** Affected by fog, default true */
  fog?: boolean;
  /** Largest on-screen size of one particle in pixels (smoke drifting past the camera stays bounded), default 512 */
  maxPixels?: number;
}
/** Continuous emitter returned by attach() (a handle) */
export interface ParticleEmitter extends Handle {
  /** Particles per second (can be changed at any time) */
  rate: number;
  /** false pauses */
  active: boolean;
  /** Stop and remove (also removed automatically when the object leaves the scene) */
  remove(): void;
  [key: string]: any;
}
/** A particle effect */
export interface ParticleEffect { name: string; o: ParticleOptions; max: number; alive: number; points: Object3D; [key: string]: any }

// Particles (engine.particles) is generated from the JSDoc in modules/particles/Particles.js (npm run map); only the type is re-exported here
import type { Particles } from './generated/modules/particles/Particles';
export type { Particles };

// ======================================================================
// Settings menu settings()
// ======================================================================

/** Contents of a graphics quality preset */
export interface QualityPreset { pixelRatio?: number; shadows?: boolean; antialias?: boolean; bloom?: boolean; ao?: boolean; viewChunks?: number; density?: number; [key: string]: any }
/**
 * The tools a settings tab's render(tools, e, s) receives: escaping, translation and the control helpers (each returns HTML)
 * @example render: (tools, e, s) => tools.row(tools.t('my.subtitles'), tools.toggle('subtitles', s.get('subtitles')))
 */
export interface SettingsTools {
  /** Escape text for HTML */
  esc: (s: any) => string;
  /** Translate a string key */
  t: (key: string, params?: Record<string, any>) => string;
  /** One row: text on the left, control on the right */
  row(label: string, ctl: string): string;
  /** Toggle button for a setting */
  toggle(key: string, on: boolean): string;
  /** Slider for a setting */
  range(key: string, v: number, min: number, max: number, step: number): string;
  /** A group of mutually exclusive buttons: options = [[value, text], ...]; a disabled value is display-only */
  segmented(key: string, cur: any, options: [any, string][], disabled?: any[]): string;
}
/** One settings tab */
export interface SettingsSection {
  /** Title: text or engine => text */
  title: string | ((e: Engine) => string);
  /** Generate the content HTML */
  render: (tools: SettingsTools, e: Engine, s: Settings) => string;
  /** Called after every redraw, to bind events to custom controls */
  bind?: (el: HTMLElement, e: Engine, s: Settings) => void;
  /** When this returns false the tab is not shown */
  when?: (e: Engine) => boolean;
  /** Sort order, smaller first, default 100 */
  order?: number;
}
export interface SettingsOptions {
  /** Action name that opens the menu, default 'menu' */
  action?: string;
  /** Key that opens the menu, default ['Escape'] */
  keys?: string[];
  /** Browser storage key */
  storageKey?: string;
  /** Override the graphics presets: { low: {...}, medium: {...}, high: {...} } */
  presets?: Record<string, QualityPreset>;
  /**
   * Tabs: true (default) graphics, audio, controls, language, saves; false none; or a list by name, which may include the optional
   * 'game' (resume, load a save, back to title) and 'camera' (mouse sensitivity, invert Y, field of view; saved as camera.sensitivity / camera.invertY
   * / camera.fov)
   * @example settings({ sections: ['game', 'graphics', 'audio', 'controls', 'camera'] })
   */
  sections?: boolean | string[];
  /**
   * Pause gameplay while the menu is open (with flow installed it switches to flow's 'paused' and returns to the previous state on close; without flow
   * it uses engine.freeze); the picture keeps running, default false
   */
  freezeWorld?: boolean;
}

/** engine.settings */
export interface Settings {
  action: string;
  /** All current setting values */
  values: Record<string, any>;
  /** Graphics presets */
  presets: Record<string, QualityPreset>;
  /** Tabs */
  sections: Map<string, any>;
  /** Whether the menu is open */
  readonly isOpen: boolean;
  /** Read a setting, e.g. get('vol.music') */
  get(key: string): any;
  /** Change a setting (takes effect immediately + saved) */
  set(key: string, value: any, opts?: { save?: boolean }): void;
  /** Graphics preset: 'low' | 'medium' | 'high' */
  preset(name: 'low' | 'medium' | 'high' | (string & {})): void;
  /** Game-defined setting: default value + apply function (saved automatically) */
  define<T = any>(key: string, def: T, apply?: (value: T, e: Engine) => void): this;
  /** Add a tab of your own, or a built-in / optional one by name: addSection('camera') */
  addSection(id: string, section?: SettingsSection): this;
  removeSection(id: string): void;
  open(): void;
  close(): void;
  toggle(on?: boolean): void;
  /** Restore all keys to defaults */
  resetBindings(): void;
  /** Change the first key of an action to code */
  rebind(action: string, code: string): void;
  /** Key list (for the UI) */
  actionList(): any[];
  /** Save to the browser */
  save(): void;
}

// ======================================================================
// Music music()
// ======================================================================

/** Track: a path, or { url, volume 0-1, loop, stems }. Stems are extra layers started in sync; each fades in as music.intensity rises through its `at` range */
export type MusicTrack = string | { url?: string; volume?: number; loop?: boolean; stems?: MusicStem[] };
/** A layer of a track: silent below at[0], full at at[1] and above (intensity 0-1) */
export interface MusicStem { url: string; at?: number[]; volume?: number }
/** Auto-selection condition: an object of condition keys ({ state: 'combat', time: 'night', zone: 'cave' }) or (e, music) => boolean */
export type MusicCondition = import('./core').AudioCondition;
/** Auto-selection rule: when the condition holds play track (null = silence), higher priority wins; no `when` = always (a fallback) */
export interface MusicRule { track: string | null; when?: MusicCondition; priority?: number }
export interface MusicChangeEvent { from: string | null; to: string | null }
export interface MusicOptions {
  /** Tracks: name -> path or { url, volume, loop, stems } */
  tracks?: Record<string, MusicTrack>;
  /** Auto track rules (same as engine.music.rules(list)) */
  rules?: MusicRule[];
  /** Default crossfade seconds, default 2 */
  fade?: number;
  /** Duck the music bus during dialogue to this (0-1, e.g. 0.35); default false = no duck (the game opts in) */
  duckDialogue?: number | false;
  /** Fade seconds for the ducking */
  duckFade?: number;
  /** Rule debounce seconds, default 2 */
  hold?: number;
  /** Rule check interval (seconds), default 1 */
  interval?: number;
}

// Music (engine.music) is generated from the JSDoc in modules/music/Music.js (npm run map); only the type is re-exported here
import type { Music } from './generated/modules/music/Music';
export type { Music };

// ======================================================================
// Characters characters() -> engine.characters, engine.npcs
// ======================================================================

/** Skeleton of a style pack's custom character: root is the root node, body/head optional, limbs are the swinging limbs */
export interface CharacterRig {
  root: Object3D;
  body?: Object3D;
  head?: Object3D;
  /** Named joints, exposed on the character as properties (lowpoly humanoid: armL armR legL legR) */
  joints?: Record<string, Object3D>;
  limbs?: { joint: Object3D; offset: number; amp: number; kind: 'arm' | 'leg'; side?: number }[];
}
/** Character parameters (shared by the player and NPCs) */
export interface CharacterOptions {
  /** Colors (default from the style pack's style.character.colors) */
  colors?: { body?: ColorLike; skin?: ColorLike; legs?: ColorLike; hair?: ColorLike };
  /** Walking speed (m/s), default 4.5 */
  speed?: number;
  /** Running speed (m/s), default 7 */
  runSpeed?: number;
  /** Collision radius (meters), default 0.4 */
  radius?: number;
  /** Whether it can swim, default true */
  canSwim?: boolean;
  /** Water depth (meters) at which swimming starts, default 1 */
  swimDepth?: number;
  /** Swimming speed multiplier, default 0.45 */
  swimSpeed?: number;
  /** How fast it turns, default 10 */
  turnSpeed?: number;
  /** How fast it starts / stops, default 12 */
  acceleration?: number;
  /** Gravity (m/s², negative), default -24 */
  gravity?: number;
  /** Jump speed (m/s), default 8 */
  jumpSpeed?: number;
  /** Step height it can climb directly (meters), default 0.45 */
  stepHeight?: number;
  /** Air control, 0–1 */
  airControl?: number;
  /** How long after walking off an edge a jump is still allowed (seconds) */
  coyoteTime?: number;
  /** Whether it can jump, default true */
  canJump?: boolean;
  /**
   * glTF model: what engine.assets.model() returned, or the name of a registered model asset (default style.character.model).
   * A name builds the character at once with the placeholder body and swaps in a copy of the asset when it loads (see Character.ready / whenReady,
   * event 'character:model')
   * @example engine.characters.createPlayer({ model: 'hero' })   // after engine.assets.manifest({ models: { hero: '/models/hero.glb' } })
   */
  model?: Object3D | string | null;
  /** Action name mapping { idle, walk, run, swim, jump, fall } (shorthand for animation) */
  clips?: { idle?: string; walk?: string; run?: string; swim?: string; jump?: string; fall?: string; drive?: string } | null;
  /** Skeletal animation state machine config (states, blend trees, one-shot actions), see AnimatorOptions */
  animation?: AnimatorOptions | null;
  /** Movement method: 'simple' built into the engine (default) | 'rapier' Rapier character controller (needs the rigid module) */
  mover?: 'simple' | 'rapier';
  /**
   * Which way it turns each move: 'move' (default, toward its velocity) | 'camera' (along cameraRig.forward()) | 'target' (toward faceTarget) | 'manual'
   * (only face() turns it)
   */
  faceMode?: FaceMode;
  /** What faceMode 'target' faces (lock-on) */
  faceTarget?: PositionLike | null;
}
/** Character facing mode, see CharacterOptions.faceMode */
export type FaceMode = 'move' | 'camera' | 'target' | 'manual';
/** What a player control function returns: world direction (length 0–1), run, speed override (m/s); null = stand still */
export type MoveRequest = { x: number; z: number; run?: boolean; speed?: number } | null | undefined;
/**
 * Who moves the player each fixed step: 'camera' movement keys relative to the camera | 'none' the game calls player.move() itself | function returns
 * the move request
 */
export type PlayerControl = 'camera' | 'none' | ((player: Character, input: Input, dt: number) => MoveRequest);
/** Parameters of createPlayer() */
export interface PlayerOptions extends CharacterOptions {
  /** Spawn point (meters, { x, z } / Vector3 / object); flat ground is found automatically if omitted */
  spawn?: PositionLike;
  /** Keys of the 'jump' action; none bound when omitted (player.jump() still works). presets.player.* use ['Space', 'PadA'] */
  jumpKeys?: string[];
  /** Keys of the 'run' action read by control 'camera' / moveInput(); none bound when omitted. presets.player.* use Shift / gamepad LB */
  runKeys?: string[];
  /**
   * Required, no default: 'camera' (keys relative to the camera) | 'none' (call player.move() yourself in onFixed) | (player, input, dt) => ({ x, z,
   * run?, speed? }). Also the runtime property player.control. presets.player.* fill it
   */
  control: PlayerControl;
  /** true: the camera module follows the player (and back after a vehicle, and on a new session). Omitted with a camera installed warns in dev */
  cameraFollow?: boolean;
}
/** Character state */
export type CharacterState = 'idle' | 'walk' | 'run' | 'swim' | 'jump' | 'fall' | 'drive';

/** Character (player and NPCs) */
export declare class Character {
  constructor(engine: Engine, opts?: CharacterOptions);
  engine: Engine;
  /** Root node (this is what gets added to the scene) */
  root: Object3D;
  /** Same as root: add children, change visible and scale on it */
  readonly object: Object3D;
  /** Position (= root.position) */
  readonly position: Vector3;
  /** Horizontal velocity (x, y map to world x, z) */
  velocity: Vector2;
  /**
   * Heading (radians): 0 faces +Z, forward = (sin facing, cos facing); increasing turns toward +X (rotation about the Y axis, consistent with
   * root.rotation.y)
   */
  facing: number;
  /** Vertical velocity (m/s) */
  vy: number;
  /** Whether standing on the ground */
  grounded: boolean;
  /** Whether swimming */
  swimming: boolean;
  /** Current action state */
  state: CharacterState;
  /** Current movement speed (m/s) */
  moveAmount: number;
  /** Facing mode, change at any time; see CharacterOptions.faceMode */
  faceMode: FaceMode;
  /** What faceMode 'target' faces */
  faceTarget: PositionLike | null;
  /** Player only: who moves it each fixed step (see PlayerOptions.control) */
  control?: PlayerControl;
  /** Player only: whether the camera module follows it (see PlayerOptions.cameraFollow) */
  cameraFollow?: boolean;
  /** Move at a fixed velocity (m/s) for seconds, ignoring move()'s direction and without turning (knockback, dodge roll); gravity and collision still apply */
  push(vx: number, vz: number, seconds: number): void;
  speed: number; runSpeed: number; radius: number; canSwim: boolean; swimDepth: number; swimSpeedFactor: number;
  turnSpeed: number; acceleration: number; gravity: number; jumpSpeed: number; stepHeight: number; airControl: number; coyoteTime: number; canJump: boolean;
  /** Called when a foot lands (the argument is the ground type underfoot) */
  onStep: ((groundType: string) => void) | null;
  /** Called on landing (the argument is the landing speed) */
  onLand: ((impact: number) => void) | null;
  /** Movement method; name is 'simple' | 'rapier', controller is the native Rapier character controller (when rapier) */
  mover: { name: 'simple' | 'rapier'; controller?: any; body?: any; collider?: any; move(dirX: number, dirZ: number, run: boolean, dt: number, speedOverride?: number): void; dispose?(): void };
  /** Skeletal animation state machine (when there is a glTF model; null while a model named by asset is still loading) */
  anim: Animator | null;
  /** false while a model named by asset is loading (the placeholder body shows); true otherwise, also after a failed load (placeholder kept) */
  ready: boolean;
  /**
   * Settles (never rejects) when a model named by asset is swapped in or has failed; already settled otherwise
   * @example const npc = new Character(engine, { model: 'villager' }).addTo();   // import { Character } from 'threedog' await npc.whenReady;
   * npc.playAction('Wave');
   */
  readonly whenReady: Promise<void>;
  /** The vehicle being driven (null when not driving) */
  vehicle: Vehicle | null;
  /** Board a vehicle (the vehicle returned by rigid.addVehicle) */
  enter(vehicle: Vehicle): void;
  /** Exit the vehicle */
  exit(): void;
  /** Play a one-shot action (e.g. 'wave'); skipped if the model has no such clip */
  playAction(name: string): void;
  /**
   * Fully delete this character: exits the vehicle first, releases animation and movement, removes it from the scene and releases geometry and materials
   * (used by npcs.remove / removePlayer)
   */
  dispose(): void;
  /** Request a jump */
  jump(): void;
  /** Add to the scene */
  addTo(scene?: any): this;
  /** Put it on the ground at position (Vector3 / object / [x, y, z] / { x, z }) */
  placeAt(position: PositionLike): this;
  /**
   * After moving root yourself (a cutscene path, a scripted pose): write position and motion back to its world record (the player's), so a save right
   * after has it
   */
  syncRecord(): this;
  /** Move in a direction (called once per fixed step): dirX/dirZ is the world direction (length 0–1), run to run, dt in seconds */
  move(dirX: number, dirZ: number, run: boolean, dt: number, speedOverride?: number): void;
  /** Ground type underfoot ('water' while swimming) */
  groundType(): string;
  /** Turn at once to a position, or to an angle in radians (0 = +Z) */
  face(target: PositionLike | number): void;
  /**
   * Copy the motion state into a plain object (velocity, vertical velocity, heading, movement amount, grounded, swimming) to store in world data; after
   * the model is rebuilt or a save is loaded, loadMotion continues from it with identical results
   */
  saveMotion(out?: CharacterMotion): CharacterMotion;
  /** Restore the motion state from the plain object of saveMotion */
  loadMotion(m: CharacterMotion | null | undefined): this;
}
/** Result of Character.saveMotion (plain values, can be saved) */
/** facing is the same as Character.facing: 0 = +Z, forward (sin f, cos f) */
export interface CharacterMotion { vx?: number; vz?: number; vy?: number; facing?: number; amount?: number; grounded?: boolean; swimming?: boolean; coyote?: number }

/** One schedule stop (the npcs.add form): at is when to set off, position the destination */
export interface ScheduleStop {
  /** When to set off: clock time 'HH:MM' (e.g. '18:30'), or a time of day 0–1 (0.25 = 6 am) */
  at: number | string;
  /** Destination (Vector3 / object / [x, y, z] / { x, z }) */
  position: PositionLike;
}
/** One schedule stop (as stored in npc.schedule after install): at has been converted to 0–1, x/z is the destination (meters) */
export interface ScheduleEntry { at: number; x: number; z: number }
/** Parameters of engine.npcs.add({...}) */
export interface NPCOptions extends CharacterOptions {
  /**
   * Stable id (used by saves, quest targets { npc } and npcs.get); falls back to name if omitted (two NPCs with the same name and no id throw an error).
   * Calling add again with the same id updates the definition and keeps position and state
   */
  id?: string;
  /**
   * NPC authored in content (everything added by content): the initial record of world; saves only record changes such as position and state, the
   * schedule follows the content; deleted ones do not reappear after loading
   */
  initial?: boolean;
  /** Name */
  name?: string;
  /**
   * Which zone it belongs to (a level name, see world.zone): when not in this zone only the model is torn down and the data stays; null (default) means
   * it is present everywhere
   */
  zone?: string | null;
  /** Schedule (needs the sky module; without it the first entry is always used) */
  schedule?: ScheduleStop[];
  /** Behavior name: 'schedule' (default, follows the schedule), 'wander' (roams around home) or a name registered with npcs.behavior() */
  behavior?: string;
  /**
   * Behavior parameters and memory (plain values, saved). wander: { radius in meters (8), pause [min, max] seconds ([2, 6]), home { x, z } (defaults to
   * the position when wandering started) }
   */
  mind?: Record<string, any>;
  /** Dialogue script name (needs the dialogue and interactions modules), triggered by pressing the interact key when close */
  talk?: string | null;
  /** Prompt text (text is stored in the data; a function stays in memory only) */
  talkLabel?: string | (() => string);
  /** Dialogue distance (meters), default 3.2 */
  talkRadius?: number;
  /** Pathfinding grid size (meters), default 2 */
  pathStep?: number;
  /** Seconds before re-pathfinding after getting stuck, default 2 */
  repath?: number;
  /**
   * Arrival distance (meters), default 1.2: within 1.2 m of the schedule stop / target counts as arrived and stops, it does not step exactly on the
   * point (call placeAt yourself for an exact spot)
   */
  arriveDistance?: number;
  /** Initial position (Vector3 / object / [x, y, z] / { x, z }); the current schedule stop is used if omitted */
  position?: PositionLike;
}
/**
 * NPC handle (returned by npcs.add): the truth of an NPC is one record of kind 'npc' in engine.world; the model (Character) exists only when nearby.
 * The handle finds the record and the current model by id, so it keeps working after the model is torn down or a load replaces the data.
 */
export declare class NPC {
  /** Stable id */
  readonly id: string;
  /** The record in world (a plain object; undefined after deletion). Change fields with engine.world.set(npc.id, {...}) */
  readonly data: WorldRecord | undefined;
  readonly name: string | undefined;
  /** Schedule (at converted to 0–1, sorted by time) */
  readonly schedule: ScheduleEntry[];
  /** Current behavior name */
  readonly behavior: string;
  /** Dialogue id */
  readonly talk: string | null;
  /** Animation state ('idle' / 'walk'...) */
  readonly state: string;
  /** In dialogue (stopped, not walking) */
  readonly busy: boolean;
  /** The current character model: exists only when nearby; null when far away, in another level, or not yet built */
  readonly character: Character | null;
  /** Root object of the current model (= character.root), null when there is no model */
  readonly root: Object3D | null;
  /** Same as root */
  readonly object: Object3D | null;
  /** Position: the model's position when there is a model (use it read-only, move with placeAt), a copy of the record's position when there is none */
  readonly position: Vector3;
  /**
   * Change behavior (stored in the data, restored by saves). mind is the new behavior's parameters / memory (plain values), cleared if omitted. E.g.
   * npc.setBehavior('wander', { radius: 12 })
   */
  setBehavior(name: string, mind?: Record<string, any>): this;
  /** The stop it should be heading to now */
  currentStop(): ScheduleEntry | null;
  /** Teleport to the ground at a position (handed to the mover when there is a model, otherwise the data is changed) and re-pathfind */
  placeAt(position: PositionLike): this;
  /** Face a position (when there is a model) */
  face(position: PositionLike): this;
  /** Delete this NPC (data and model together) */
  remove(): boolean;
}
/** engine.npcs (NPC data lives in engine.world, kind 'npc'; needs the world module) */
export interface NPCManager {
  /** All NPCs (including far ones and ones in other levels) */
  list(): NPC[];
  /** Add an NPC, returns a handle */
  add(opts: NPCOptions): NPC;
  /**
   * Delete an NPC (pass a handle, id or name): the data is deleted, and the model and dialogue interaction are torn down together. Returns false if not
   * found
   */
  remove(npc: NPC | string): boolean;
  /**
   * Register an NPC behavior: near(rec, dt, npc) once per fixed step when nearby, far(rec, dt) simulated from the data when far (dt is accumulated
   * seconds); selected through behavior in the data
   */
  behavior(name: string, impl: { near?: (rec: WorldRecord, dt: number, npc: NPC) => void; far?: (rec: WorldRecord, dt: number) => void }): this;
  /**
   * Nearby NPCs avoid each other (on by default): pushed apart to no less than the sum of their radii, the player counts as an obstacle (NPCs yield to
   * the player), then constrained back to walkable places by engine.collision; deterministic and cheap, with identical results after loading.
   * With nav({ crowd: true }) crowd takes over. Far NPCs (no model) do not avoid one by one. on / radius / strength are the current values.
   * @example engine.npcs.avoid.set({ radius: 0.6, strength: 2 });   // set(false) turns it off
   */
  readonly avoid: {
    on: boolean;
    /** Avoidance radius of each NPC (meters), null = engine.movement.radius */
    radius: number | null;
    /** Maximum push-apart speed (m/s), default 3 */
    strength: number;
    set(opts: boolean | { on?: boolean; radius?: number | null; strength?: number }): NPCManager['avoid'];
    /**
     * For custom behaviors: call once after character.move and before writing back to the data, to push this NPC away from neighbors and the player
     * (built-in behaviors already call it)
     */
    push(rec: WorldRecord, character: Character, dt: number): void;
  };
  /** Find by id or name (id first) */
  get(idOrName: string): NPC | undefined;
  /** The current character model of an NPC, null if none */
  character(id: string): Character | null;
}
/** engine.characters */
export interface CharactersApi {
  /**
   * Find a spawn point: searches outward from position (default origin) for walkable (not steep, no obstacle), non-water ground, without assuming
   * terrain height; e.g. findSpawn(v, { minH: 3, maxH: 20 }). Returns a Vector3 (y is the ground height)
   */
  findSpawn(position?: PositionLike, opts?: FindSpawnOptions): Vector3;
  /**
   * Create the player and set engine.player; control is required (no default feel), e.g. createPlayer({ ...presets.player.thirdPerson, spawn }). An
   * existing player is deleted first
   */
  createPlayer(opts: PlayerOptions): Character;
  /**
   * The 'camera' player control as a value: keys / stick relative to the camera, the 'run' action if bound, input.autopilot. Reused object; call it
   * inside your own control function to wrap it
   */
  moveInput(): { x: number; z: number; run: boolean; speed?: number };
  /**
   * Delete the current player (exits the vehicle first, stops responding to keys, fully deletes the model). The player save (key player) carries the
   * position and the vehicle; loading an on-foot save exits the vehicle first
   */
  removePlayer(): void;
  /**
   * Pathfinding (the single entry point): uses the navmesh when nav is installed and ready, otherwise the A* fallback. Returns a path [{ x, z }...], or
   * null if unreachable
   */
  findPath(from: PositionLike, to: PositionLike, opts?: FindPathOptions & { detailed?: false }): XZ[] | null;
  /**
   * Pass detailed: true: returns { status, path }, distinguishing 'ok' found | 'noPath' unreachable | 'notReady' nav is installed but the mesh is not
   * built yet (path is the A* fallback result and may be inaccurate)
   */
  findPath(from: PositionLike, to: PositionLike, opts: FindPathOptions & { detailed: true }): PathResult;
  /**
   * findPath for many callers (NPC crowds, AI squads): solved in engine.threads workers; done(path, status) runs on a fixed step a few steps later (same
   * paths with threads on or off). Recipe 12 section 4
   */
  findPathAsync(
    from: PositionLike, to: PositionLike, done: (path: XZ[] | null, status: 'ok' | 'noPath' | 'notReady') => void,
    opts?: { radius?: number; step?: number; maxNodes?: number }
  ): { remove(): void };
  /** How many findPathAsync requests leave per fixed step (default 32); the rest wait for the next steps */
  pathsPerStep: number;
}
/** Return value of findPath(..., { detailed: true }) */
export interface PathResult { status: 'ok' | 'noPath' | 'notReady'; path: XZ[] | null }
/**
 * Parameters of findSpawn(): minH/maxH height range (meters, default unlimited), maxSlope maximum slope (default 0.3), waterMargin minimum meters above
 * the water (default 0.5)
 */
export interface FindSpawnOptions { minH?: number; maxH?: number; maxSlope?: number; waterMargin?: number }
export interface CharactersOptions {
  /** Whether to enable NPCs (engine.npcs), default true */
  npcs?: boolean;
  /** Brake key when driving (action brake, registered when rigid is installed), none by default (no brake while driving; one warning names the fix); presets.keys.brake has ['KeyB'] (so it doesn't fight with Space for jump) */
  brakeKeys?: string[];
  /** Gamepad button for braking, none by default; presets.keys.brake has ['PadLT'] */
  brakePad?: string[];
}
/** Pathfinding options: step is the grid size (meters, A*), maxNodes the maximum cells searched (A*), radius the character radius (meters) */
/** radius defaults to engine.movement.radius; for detailed see findPath */
export interface FindPathOptions { step?: number; maxNodes?: number; radius?: number; detailed?: boolean }

// ======================================================================
// Interactions interactions()
// ======================================================================

export interface InteractionOptions {
  /** Stable id for the op interaction.use { id } (default: the world record id it was built for, else a running number) */
  id?: string;
  /** Prompt text, or a function returning text */
  label?: string | (() => string);
  /** How close the actor must be (meters), default interactions({ radius }) = 2.5 */
  radius?: number;
  /** Key action name, default 'interact' (E key). Give one object a second verb by adding another interaction with another action */
  action?: string;
  /** Called when pressed */
  onUse?: (object: Object3D) => void;
  /**
   * When this returns false the whole prompt disappears (to show a state such as "growing", don't use enabled: have the label function return different
   * text by state and decide in onUse whether it can be used)
   */
  enabled?: () => boolean;
  /** How high the prompt floats above the object (meters) */
  height?: number;
}
/** engine.interactions */
export interface Interactions {
  action: string;
  /** How high the prompt floats (meters) */
  promptHeight: number;
  /** All interactions */
  items: any[];
  /** Default reach of add() in meters (2.5) */
  radius: number;
  /** How the one in front of the actor is chosen; can be changed at runtime */
  pickMode: InteractionPick;
  /** The interaction the prompt shows right now (null if none) */
  current: any;
  /** One best interaction per key action this frame, for a prompt that lists several keys */
  options: { action: string; id: string; label: string }[];
  /**
   * Add an interaction: passing an object makes it follow the object, passing a position (Vector3 / [x, y, z] / { x, y, z }) makes a fixed point.
   * Returns a handle { remove() }
   */
  add(target: Object3D | PositionLike, opts?: InteractionOptions): Handle;
  /** The interaction with this id, or null. Using one is the op: engine.ops.run('interaction.use', { id }) (no id = the one the actor would pick) */
  get(id: string): any;
}
/**
 * What the 'prompt' UI part receives in update(view) every frame while an interaction is in reach (hide() when none). Call use() on click: it runs the
 * op interaction.use.
 * @example engine.ui.set('prompt', (engine) => ({ update: (v) => myLabel.set(v.x, v.y, v.label, v.key), hide: () => myLabel.hide() }))
 */
export interface PromptView {
  /** Interaction id */
  id: string;
  /** Action that uses it ('interact') and its key label ('E') */
  action: string;
  key: string;
  /** The interaction's label, and the default text 'E · label' */
  label: string;
  text: string;
  /** Screen pixels above the target */
  x: number;
  y: number;
  onScreen: boolean;
  /** Use it (the op interaction.use) */
  use(): void;
  /** One best interaction per action this frame, for a prompt that lists several keys ("E · 浇水  F · 收获") */
  options: { action: string; id: string; label: string }[];
}
/** A candidate handed to a pick function: an enabled interaction within its radius of the actor */
export interface InteractionCandidate { id: string; object: Object3D; action: string; label: string | (() => string); distance: number }
/**
 * 'nearest' | 'facing' (within 60° of where the actor faces) | 'aim' (closest to the screen-center ray) | a function choosing one candidate (nearest
 * first) or null
 */
export type InteractionPick = 'nearest' | 'facing' | 'aim' | ((candidates: InteractionCandidate[], ctx: { engine: Engine; actor: string; position: Vector3; action?: string }) => InteractionCandidate | null | undefined);
export interface InteractionsOptions {
  /** Default action name, default 'interact' */
  action?: string;
  /** How high the prompt floats (meters) */
  promptHeight?: number;
  /** Default reach of add() in meters, default 2.5 */
  radius?: number;
  /**
   * Required, no default: how the interaction in front of the actor is chosen. presets.interactions.* fill it. @example interactions({ pick: 'aim',
   * keys: ['KeyE'], radius: 2 }) // first person
   */
  pick: InteractionPick;
  /** Keys of the action; required unless the game bound the action already (createEngine({ bindings: { interact: [...] } }) or input.define) */
  keys?: string[];
}

// ======================================================================
// Dialogue dialogue()
// ======================================================================

/** Story state: flags are story flags (this is engine.vars.flags, autosaved) */
export interface DialogueState { flags: Record<string, any>; [key: string]: any }
/** Dialogue choice */
export interface DialogueChoice {
  /** Choice text */
  text: string | ((state: DialogueState, engine: Engine) => string);
  /** Which node to go to after choosing (omit = end) */
  next?: string;
  /** Condition: when it returns false this choice is not shown */
  if?: (state: DialogueState, engine: Engine) => boolean;
  /** Run after choosing */
  do?: (state: DialogueState, engine: Engine) => void;
  /** The game's own fields (icon, tone...): handed to the UI part as choices[i].data. Other unknown keys are reported as typos */
  data?: Record<string, any>;
}
/** Dialogue node */
export interface DialogueNode {
  /** Line of dialogue, or a function returning one */
  text: string | ((state: DialogueState, engine: Engine) => string);
  /** Change the speaker (the script name by default) */
  speaker?: string;
  /** Next node (omit = end; 'end' also means end) */
  next?: string;
  /** Choices (next has no effect when there are choices) */
  choices?: DialogueChoice[];
  /** Run when this line is shown (change story flags, give items...) */
  do?: (state: DialogueState, engine: Engine) => void;
  /**
   * The game's own fields (portrait, mood, voice clip, camera shot...): handed to the 'dialogue' UI part and the 'dialogue:line' event.
   * Other unknown keys are reported as typos, so a misspelled next does not silently end the dialogue.
   * @example { text: 'Hm.', data: { portrait: 'fisher', mood: 'tired', voice: 'fisher_03.mp3' } }
   */
  data?: Record<string, any>;
}
/** Dialogue script: node name -> node, starting from 'start' */
export type DialogueScript = Record<string, DialogueNode>;
/** Promise returned by say() (id is a temporary dialogue name) */
export interface SayPromise extends Promise<void> { id: string }

/** engine.dialogue */
export interface Dialogue {
  /** Story state: state.flags is engine.vars.flags (autosaved) */
  readonly state: DialogueState;
  /** All scripts */
  scripts: Map<string, DialogueScript>;
  /** The dialogue in progress (null when none) */
  active: { speaker: string; nodes: DialogueScript; node?: DialogueNode; onEnd: (() => void) | null; lock: boolean } | null;
  /** The script currently speaking */
  readonly speaking: string | null;
  /** Typing speed (characters/second) */
  cps: number;
  /** Define a dialogue (the name is usually the speaker) */
  define(speaker: string, nodes: DialogueScript): void;
  /**
   * Start a dialogue: from node nodeId (default 'start'), onEnd is called when it ends.
   * lock (default true) locks game input and takes Esc; lock: false lets the player keep playing (lines move on by themselves) and never cuts into a
   * locking dialogue.
   * onCancel: what the back key (Esc) does while this locking dialogue is on top of the UI focus stack (default: nothing).
   * Ending the playthrough (engine.session newGame / load / quit) closes the dialogue without calling onEnd.
   * @example engine.dialogue.start('guard', 'start', null, { lock: false })
   */
  start(speaker: string, nodeId?: string, onEnd?: (() => void) | null, opts?: { lock?: boolean; onCancel?: (() => void) | null }): void;
  /**
   * Say a one-off line (no need to define first); the Promise resolves when it is done. lock: false = said while the player keeps playing (barks, radio
   * chatter).
   * When the playthrough ends (engine.session) the line is dropped and the Promise never resolves, so code awaiting it does not run in the next playthrough.
   * @example await engine.dialogue.say('Reloading!', { speaker: 'Mira', lock: false })
   */
  say(text: string | DialogueScript, opts?: { speaker?: string; node?: string; lock?: boolean; onCancel?: (() => void) | null }): SayPromise;
  /** End the current dialogue */
  end(): void;
  // Advancing and choosing are ops: engine.ops.run('dialogue.advance') / engine.ops.run('dialogue.choose', { index })
  // (0-based; while typing it completes the line first)
}
export interface DialogueOptions {
  /** Typing speed (characters/second, game time: advanced by engine.step), default 40 */
  charsPerSecond?: number;
  /** Actions that advance the dialogue, default ['confirm', 'interact'] (interact only when the game bound it) */
  advanceActions?: string[];
  /** Number keys 1-9 pick choices (read only while a locking dialogue runs; rebind them as actions choice1...choice9), false = click / op only. Default true */
  choiceKeys?: boolean;
  /** A non-locking line (lock: false) moves on this many seconds after it is fully typed, default 2 */
  holdSeconds?: number;
}
/**
 * What the 'dialogue' UI part receives in update(view) (show() comes first, hide() when the dialogue ends). Call advance() / choose(i) from your UI:
 * they run the ops dialogue.advance / dialogue.choose, so keys, clicks and tests stay one path.
 * @example
 * engine.ui.set('dialogue', (engine) => {
 *   const el = document.createElement('div'); engine.uiRoot.appendChild(el); el.hidden = true;
 *   el.onclick = () => view?.advance();
 *   let view = null;
 *   return {
 *     show: () => { el.hidden = false; },
 *     update: (v) => { view = v; el.textContent = `${v.speaker}: ${v.text}`; },   // v.data.portrait, v.choices[i].text ...
 *     hide: () => { el.hidden = true; },
 *     dispose: () => el.remove(),
 *   };
 * });
 */
export interface DialogueView {
  /** Script name (dialogue.define name) */
  script: string;
  /** Node id */
  node: string;
  /** Who speaks this line */
  speaker: string;
  /** The part typed so far (the whole line once typing ends) */
  text: string;
  /** The whole line */
  full: string;
  /** Still typing (charsPerSecond) */
  typing: boolean;
  /** Visible choices once typing ends (empty while typing or without choices); key is the key label ('1') or null */
  choices: { text: string; key: string | null; data: Record<string, any> }[];
  /** "E to continue" text when the line waits for the player, else '' */
  hint: string;
  /** The node's data (the game's own fields), {} when none */
  data: Record<string, any>;
  /** false for a line said while the player keeps playing */
  lock: boolean;
  /** Run the op dialogue.advance (finish typing / next line) */
  advance(): any;
  /** Run the op dialogue.choose { index } (0-based among choices) */
  choose(index: number): any;
}

// ======================================================================
// Inventory inventory()
// ======================================================================

/** Item definition */
export interface ItemDef {
  /** Display name */
  name?: string;
  /** Icon (text or emoji) */
  icon?: string;
  /** Icon image path */
  iconUrl?: string;
  /** Description */
  desc?: string;
  /** Pieces per slot, default 99 (an entry of 150 uses 2 slots); 1 = every piece with data is its own entry */
  stack?: number;
  /** Weight of one piece, counted against a container's maxWeight (default 0) */
  weight?: number;
  /** Makes the item usable with the inventory.use op */
  use?: (e: any, info: ItemUseEvent) => void;
  /** Whether it can be used now: true or a reason string (checked by the op's can) */
  canUse?: (e: any, info: ItemUseEvent) => true | string;
  /** inventory.use removes one piece before calling use */
  consume?: boolean;
  /** Color of the pickup on the ground */
  color?: ColorLike;
  [key: string]: any;
}
/** id = item id, key = entry key ('arrow', or 'sword#3' for a piece with data), count = change, total = how many of the item now */
export interface ItemEvent { id: string; key: string; count: number; total: number }
/** inventory.use: who used which entry (data = that piece's data) */
export interface ItemUseEvent { actor: string; item: string; key: string; data?: Record<string, any> }
/** One entry of a container: plain items share one entry per kind (key = item id); items with data have their own key ('sword#3') */
export interface ItemEntry { key: string; id: string; count: number; data?: Readonly<Record<string, any>>; def: ItemDef }
/** Change in a non-player container (the player inventory emits item:add / item:remove): container is the container id */
export interface ContainerEvent extends ItemEvent { container: string }
export interface PickupEvent { id: string; x: number; z: number }
/**
 * Handle returned by spawnPickup(): id is the item, worldId is the id of this record in engine.world, object is the current model (null when far away);
 * remove() deletes the pickup (data and model; a model passed in through opts.mesh is only taken off)
 */
export interface PickupHandle extends Handle { id: string; worldId: string; readonly object: Object3D | null }
/** Parameters of spawnPickup() */
export interface PickupOptions {
  /**
   * Stable id of this record in world (saves recognize it by this); numbered automatically pickup#1... if omitted, and an existing record with the same
   * id is reused
   */
  id?: string;
  /** How many you get when picking up, default 1 */
  count?: number;
  /** The piece's own data (a dropped sword keeps its durability) */
  data?: Record<string, any>;
  /** Reach in meters, default inventory pickupRadius (2) */
  radius?: number;
  /** Taken by walking into it (no key press, no prompt) */
  auto?: boolean;
  /** Custom model (the style pack's style.pickup is used if omitted) */
  mesh?: Object3D | null;
  /** Game seconds until it reappears, 0 = never reappears */
  respawnSeconds?: number;
  /** Bob up and down and rotate, default true */
  bob?: boolean;
  /**
   * Pickup authored in content (needs an id): the initial record of world; saves record only being picked up / waiting to respawn, with identical
   * results whether the load comes before or after this spawn
   */
  initial?: boolean;
  /** Which zone it belongs to (a level name, see world.zone): the data stays across level changes (a picked-up one stays picked up) */
  zone?: string | null;
}

/**
 * Container (inventory, chest, corpse, shelf): inventory.container(id, opts) gets or creates one; the player inventory is the one with id 'player'.
 * Every x is an item id or an entry key
 */
export interface Container {
  readonly id: string;
  /** Slot limit, default Infinity */
  capacity: number;
  /** Weight limit (item weight × count), default Infinity */
  maxWeight: number;
  /** How many of an item, or of one entry key */
  count(x: string): number;
  /** Whether there are at least n (default 1) */
  has(x: string, n?: number): boolean;
  /** One entry by key, or null */
  get(key: string): ItemEntry | null;
  /** Slots used */
  readonly slotsUsed: number;
  /** Total weight */
  readonly weight: number;
  /** Every entry (for custom UI) */
  list(): ItemEntry[];
  /** How many more fit (Infinity = no limit), for an item without data, with this data, or like an existing entry key */
  room(x: string, data?: Record<string, any>): number;
  /** Add n (default 1), optionally with data; returns the entry key, false if none fit; silent suppresses the toast (only the player inventory shows one) */
  add(id: string, n?: number, opts?: { data?: Record<string, any>; silent?: boolean }): string | false;
  /** Remove n (default 1) of an item or entry key, returns false if there are not enough */
  remove(x: string, n?: number): boolean;
  /**
   * Atomic trade: take A (id or entry key) and give B in one all-or-nothing step; reason 'notEnough' | 'full'. Ops: inventory.trade, engine.ops.undo
   * reverses it
   */
  trade(
    take: string, give: string, opts?: { takeN?: number; giveN?: number; data?: Record<string, any>; silent?: boolean }
  ): { ok: boolean; reason?: string; took?: { id: string; count: number; data?: any }[]; gave?: string; giveId?: string; giveN?: number };
  /** Replace an entry's data (null = none) for n pieces (default all); returns the key now holding them */
  setData(key: string, data: Record<string, any> | null, n?: number): string;
  /** Listen for changes of this container, returns a handle */
  on(type: 'add' | 'remove', fn: (e: ItemEvent) => void): Handle;
}

/** engine.inventory */
export interface Inventory {
  /** true: gameplay freezes while the inventory window is open (set from inventory({ pauseGame }) or at runtime) */
  pauseGame: boolean;
  /** Item definitions */
  defs: Map<string, ItemDef>;
  /** Slot limit of the player inventory */
  capacity: number;
  /** Player inventory (= container('player')) */
  readonly bag: Container;
  defaultStack: number;
  /** Reach of pickups that do not set their own (meters) */
  pickupRadius: number;
  action: string;
  /** Define an item (chainable) */
  define(id: string, def: ItemDef): this;
  /** Get an item definition */
  item(id: string): ItemDef;
  /** How many of an item, or of one entry key */
  count(x: string): number;
  /** Whether there are at least n (default 1) */
  has(x: string, n?: number): boolean;
  /** Slots used */
  readonly slotsUsed: number;
  /** Player inventory entries (for custom UI) */
  list(): ItemEntry[];
  /** One player inventory entry by key, or null */
  get(key: string): ItemEntry | null;
  /** Add n to the player inventory (default 1), opts { data, silent }; returns the entry key, false if it does not fit */
  add(id: string, n?: number, opts?: { data?: Record<string, any>; silent?: boolean }): string | false;
  /** Remove n (default 1) of an item or entry key, returns false if there are not enough */
  remove(x: string, n?: number): boolean;
  /**
   * Atomic trade: take A (id or entry key) and give B in one all-or-nothing step; reason 'notEnough' | 'full'. Ops: inventory.trade, engine.ops.undo
   * reverses it
   */
  trade(
    take: string, give: string, opts?: { takeN?: number; giveN?: number; data?: Record<string, any>; silent?: boolean }
  ): { ok: boolean; reason?: string; took?: { id: string; count: number; data?: any }[]; gave?: string; giveId?: string; giveN?: number };
  /** Replace a player inventory entry's data for n pieces (default all); returns the key now holding them */
  setData(key: string, data: Record<string, any> | null, n?: number): string;
  /**
   * Get or create a container (chest, corpse, shelf...); the id can be the id of a world record, and the contents are saved. A second call returns the
   * same one; deleting the world record does not delete the container automatically
   */
  container(id: string, opts?: { capacity?: number; maxWeight?: number; items?: Record<string, number> }): Container;
  /**
   * Move n (default 1) of an item or one entry key between containers (pieces keep data and key); moves fewer if the target cannot hold them all,
   * returns how many were actually moved
   */
  transfer(from: Container | string, to: Container | string, item: string, n?: number): number;
  /** Delete a container together with its contents ('player' cannot be deleted), returns whether one was deleted */
  removeContainer(id: string): boolean;
  /**
   * Place a pickup on the ground at position; its y, if any, is the reference height on multi-layer ground (needs the interactions module unless auto):
   * spawnPickup('berry', v, { count: 2 }). Returns a handle, remove() deletes it
   */
  spawnPickup(id: string, position: PositionLike, opts?: PickupOptions): PickupHandle;
  /** The data of the nearest pickup of an item still on the ground to from (default the player) (a world record of kind 'pickup'), null if none */
  nearestPickup(id: string, from?: PositionLike): WorldRecord | null;
}
export interface InventoryOptions {
  /** Action name that opens the inventory, default 'inventory' */
  action?: string;
  /** Keys that open the bag: required unless createEngine({ bindings }) binds the action ([] = no key); presets.keys.inventory has ['KeyI'] */
  keys?: string[];
  /** Gamepad button, none by default; presets.keys.inventory has ['PadY'] */
  pad?: string[];
  /** true: gameplay freezes (engine.freeze) while the inventory window is open, default false. Also settable at runtime: engine.inventory.pauseGame */
  pauseGame?: boolean;
  /** Pickups float and spin only within this distance (meters) of the focus, default 60 */
  bobDistance?: number;
  /** Slot limit of the player inventory, default Infinity (no limit) */
  capacity?: number;
  /** Weight limit of the player inventory, default Infinity */
  maxWeight?: number;
  /** Reach of pickups that do not set their own radius (meters), default 2 */
  pickupRadius?: number;
  /** Default stack limit, default 99 */
  defaultStack?: number;
}

// ======================================================================
// Quests quests()
// ======================================================================

/**
 * One quest step: text is the displayed text, done the completion condition (checked every half second), target the objective (a marker is shown when
 * hud is installed)
 */
export interface QuestStep {
  /** Stable id: saves store progress by it, so steps can be inserted or reordered later (default: the step's position) */
  id?: string;
  text: string;
  done: (e: Engine) => boolean;
  /**
   * Objective: a place name (content.place), object, character, { x, z }, { nearest: itemId } or a function returning an objective; with the hud module
   * the current step shows a marker automatically
   */
  target?: HudTarget;
}
/** One goal of a parallel step; optional goals do not hold the step back */
export interface QuestPart { /** Stable id within the step (default: its position) */ id?: string; text: string; done: (e: Engine) => boolean; target?: HudTarget; optional?: boolean }
/** Parallel goals: done when every non-optional part is done, in any order; text defaults to the required parts joined */
export interface QuestParallelStep { /** Stable id (default: the step's position) */ id?: string; text?: string; all: QuestPart[] }
/** Quest definition */
export interface QuestDef {
  /** Title */
  title: string;
  /** Description */
  desc?: string;
  /** Steps (completed in order); a step may be parallel goals { all: [...] } */
  steps: (QuestStep | QuestParallelStep)[];
  /** Called on completion (give rewards) */
  reward?: (e: Engine) => void;
  /** Checked while active; true fails the quest (quest:fail; start(id) can begin it again). @example fail: e => e.vars.flag('caravanLost') */
  fail?: (e: Engine) => boolean;
  /** Called when the quest fails */
  onFail?: (e: Engine) => void;
}
/** engine.quests */
export interface Quests {
  defs: Map<string, QuestDef>;
  /** Quests in progress / completed / failed: id -> { step (current step), done, failed?, parts? } */
  state: Record<string, { step: number; done: boolean; failed?: boolean; parts?: boolean[] }>;
  /** The quest log (UI part 'questLog'): open, toggle(on?), refresh() */
  win: { readonly open: boolean; toggle(on?: boolean): void; refresh(): void };
  /** Define a quest (chainable) */
  define(id: string, def: QuestDef): this;
  /** Start a quest */
  start(id: string): void;
  isDone(id: string): boolean;
  /** Started, not done and not failed */
  isActive(id: string): boolean;
  /** Its fail condition held (start(id) begins it again) */
  isFailed(id: string): boolean;
  /** Check completion conditions once immediately */
  check(): void;
  /** Quest list (for custom UI) */
  list(): { id: string; title: string; desc?: string; done: boolean; failed: boolean;
    steps: { text: string; target?: HudTarget; done: boolean; current: boolean; parts?: { text: string; target?: HudTarget; optional: boolean; done: boolean }[] }[] }[];
}
/**
 * What the 'questLog' UI part receives in show(view) / update(view) (hide() when it closes). The engine opens it on the quest key, pushes the UI focus stack
 * (Esc calls close), locks gameplay input and calls update again when quests change while it is open.
 * @example
 * engine.ui.set('questLog', (engine) => {
 *   const el = document.createElement('div'); engine.uiRoot.appendChild(el); el.hidden = true;
 * const draw = (v) => { el.hidden = false; el.innerHTML = v.quests.map(q => `<p>${q.title}: ${q.steps.find(s => s.current)?.text ??
 * 'done'}</p>`).join(''); el.onclick = v.close; };
 *   return { show: draw, update: draw, hide: () => { el.hidden = true; }, dispose: () => el.remove() };
 * });
 */
export interface QuestLogView {
  /** Window title (localized) */
  title: string;
  /** Label of the key that toggles the log, e.g. 'J' */
  key: string;
  /** Same as engine.quests.list(): unfinished first */
  quests: ReturnType<Quests['list']>;
  /** Close the log (same as Esc or the quest key) */
  close(): void;
}
export interface QuestsOptions {
  /** Action name that opens the quest log, default 'quests' */
  action?: string;
  /** Keys that open the quest log: required unless createEngine({ bindings }) binds the action ([] = no key); presets.keys.quests has ['KeyJ'] */
  keys?: string[];
  /** Gamepad button, none by default; presets.keys.quests has ['PadSelect'] */
  pad?: string[];
  /** Check interval (game seconds, checked in the fixed step; not checked while frozen / paused), default 0.5 */
  checkInterval?: number;
  /**
   * Messages on quest start / step / done: true a toast with kind 'quest' (default) · false none · a function to show them your way.
   * @example quests({ notify: false })   quests({ notify: ({ type, text }) => type === 'done' && myBanner(text) })
   */
  notify?: boolean | ((msg: { type: 'start' | 'step' | 'done'; id: string; text: string }) => void);
}

// ======================================================================
// Photo mode photo()
// ======================================================================

/** A photo: url is the image data, time the clock time it was taken (e.g. "18:00"), position where it was taken */
export interface PhotoShot {
  /**
   * Id of the photo in storage (available right after taking it; photos are stored separately as Blobs in IndexedDB and the album is read back on the
   * next start, url is a blob: address)
   */
  id?: string;
  url: string; time: string; position: XZ | null;
  /** What was in the middle of the frame: name is the name, kind the kind (npc, entity, vegetation...), distance in meters */
  subject?: { name: string; kind: string; distance: number } | null;
}
export interface PhotoTakeOptions {
  /** Resolution multiplier, default 1.6 */
  scale?: number;
  /** Shadow resolution (pixels), default 4096 */
  shadowMapSize?: number;
  /** Turn bloom on when taking a photo */
  bloom?: boolean;
  /** Image quality 0–1 */
  quality?: number;
  /** Image format, e.g. 'image/jpeg' */
  format?: string;
}
export interface PhotoOptions extends PhotoTakeOptions {
  /** Photo key: required unless createEngine({ bindings }) binds 'photo' ([] = no key); presets.keys.photo has ['KeyP'] */
  keys?: string[];
  /** Gamepad button for taking a photo, none by default; presets.keys.photo has ['PadRB'] */
  pad?: string[];
  /** How many photos the album keeps at most, default 50 */
  maxAlbum?: number;
}
/** engine.photo */
export interface Photo {
  /** Album (newest first) */
  album: PhotoShot[];
  /** The op photo.take's can: return true, or false / a reason string to refuse (e.g. () => engine.inventory.has('film') || 'noFilm') */
  canTake: () => boolean | string;
  scale: number; shadowMapSize: number; bloom: boolean; quality: number; format: string; maxAlbum: number;
  /** Capture a photo now without checks. Gameplay takes photos through the op: engine.ops.run('photo.take') (checks canTake, logged) */
  take(opts?: PhotoTakeOptions): PhotoShot;
  /** What is in the middle of the frame (NPC, entity, named object, vegetation), null if nothing; this is the subject of take() */
  subject(): { name: string; kind: string; distance: number } | null;
}

// ======================================================================
// Ambience ambience(), debug debug()
// ======================================================================

// Ambience (engine.ambience) is generated from the JSDoc in modules/ambience/Ambience.js (npm run map); only the type is re-exported here
import type { Ambience } from './generated/modules/ambience/Ambience';
export type { Ambience };
/** ambience() options: rules (the rule table; added after createEngine({ audio: { ambience } })), interval seconds between rule checks (0.25) */
export interface AmbienceOptions { rules?: import('./core').AmbienceRule[]; interval?: number }
// DebugPanel (engine.debug) is generated from the JSDoc in modules/debug/DebugPanel.js (npm run map); only the type is re-exported here
import type { DebugPanel } from './generated/modules/debug/DebugPanel';
export type { DebugPanel };

// ======================================================================
// UI
// ======================================================================

/** Window returned by makeWindow() */
export interface UIWindow {
  el: HTMLElement;
  /** Whether it is open */
  readonly open: boolean;
  /** Redraw the content */
  refresh(): void;
  /** Open / close (toggle if no argument is passed) */
  toggle(on?: boolean): void;
}
/** Parameters of makeWindow() */
export interface WindowOptions {
  /** Window name (also the style pack's template name) */
  id: string;
  /** Title */
  title: () => string;
  /** Action name that toggles it (shows the key hint) */
  hintAction?: string;
  /** Default content: (data, tools) => HTML */
  render: (data: any, tools: { esc: (s: any) => string; t: (key: string, params?: Record<string, any>) => string; icon: (def: any) => string }) => string;
  /** Template data */
  data?: () => any;
  /** What to do on the back key (Esc), default closes the window (an open window is on the UI focus stack, and Esc goes only to the topmost) */
  onCancel?: () => void;
}
/** An entry of the UI focus stack (returned by uiFocus(engine).push) */
export interface FocusHandle extends Handle {
  id: string;
  /** Called on the back key; null = swallow the back key */
  cancel: (() => void) | null;
  /** Just pushed this frame (the key press that opened it must not count as its own action) */
  readonly fresh: boolean;
}
/**
 * UI focus stack: windows, dialogue, cutscenes and the settings menu are pushed in the order they open, and the back key (action cancel) goes only to
 * the top; when the stack is empty it goes to the one registered by setRoot (the settings menu)
 */
export interface UIFocus {
  /** Name of the top, null for an empty stack */
  readonly top: string | null;
  /** Names from bottom to top */
  list(): string[];
  /** Push; without cancel = swallow the back key */
  push(id: string, opts?: { cancel?: (() => void) | null }): FocusHandle;
  /** What to do on the back key when the stack is empty (only one, a later registration replaces it) */
  setRoot(fn: () => void): Handle;
}


// ======================================================================
// Game clock engine.clock, story variables engine.vars (core)
// ======================================================================

/**
 * engine.clock: game seconds and "after how long / every how long". Clock-time / season timers are on engine.sky (at / between / daily / onSeason). All
 * timers return a handle { remove() }
 */
export interface Clock {
  /**
   * Game seconds = fixed-step seconds x clock.timeScale (the time scale is 1 without sky), does not advance while paused / frozen, saved with the game;
   * one sky day = sky.dayLength game seconds
   */
  now: number;
  /**
   * Game-time speed: game seconds per fixed-step second (default 1; the sky's time of day follows it). `engine.clock.timeScale = 60` makes a minute pass
   * per second
   */
  timeScale: number;
  /** Call fn after seconds game seconds; if an event name is passed, the event is emitted when due (with data, can be saved) */
  after(seconds: number, fnOrEvent: (() => void) | string, data?: any): Handle;
  /** Call once every seconds game seconds */
  every(seconds: number, fn: () => void): Handle;
}
/** engine.vars: story flags and counters (autosaved) */
export interface Vars {
  /** All flags */
  flags: Record<string, any>;
  /** All counters */
  counters: Record<string, number>;
  /** Read a flag */
  flag(key: string): any;
  /** Set a flag (default true) */
  setFlag(key: string, value?: any): void;
  /** Read a counter (0 if none) */
  counter(key: string): number;
  /** Counter +n (default 1), returns the new value */
  bump(key: string, n?: number): number;
}

// ======================================================================
// Content content()
// ======================================================================

/** How a vocabulary value is written (the validator checks by it, the loader converts by it): clock receives a 0–1 ratio, position receives { x, z } */
export type ContentRef = 'flag' | 'counter' | 'itemCounts' | 'counterCounts' | 'quest' | 'text' | 'particles' | 'clock' | 'position' | 'any' | (string & {});
/** Custom condition: test(e, value) says whether it holds; ref/desc/describe are for the validator and the game map */
export interface ContentConditionDef {
  /** How the value is written, e.g. 'clock' */
  ref?: ContentRef;
  /** One-line description */
  desc?: string;
  /** Whether it holds: value is the value converted by ref, raw is the form written in the content */
  test(e: Engine, value: any, raw?: any): boolean;
  /** Write the value as human-readable text (for the game map) */
  describe?(value: any): string;
}
/** Parameters of content.load(): places is place name -> position. Models are asset names (engine.assets.manifest / an asset pack), not an option */
export interface ContentLoadOptions { places?: Record<string, PositionLike> }
/** A content pack: the object of content/index.js, or a folder / npm package exporting the same tables. Data only: it names assets, never paths or code */
export type ContentPack = Record<string, any> & { name?: string; audio?: import('./core').ContentAudio };
/**
 * Prop (each item of content/props.js): model name (an asset name from engine.assets.manifest / an asset pack, never a path; write an array to pass
 * parameters), position, heading (radians), collision
 */
export interface PropDef {
  /**
   * Stable id (saves recognize it by this); if omitted it is `prop:<model name>:<index in the props array>`. Inserting in the middle of the array shifts
   * the later indices, so write an id for content that will change
   */
  id?: string;
  model: string | any[];
  place?: string; x?: number; z?: number;
  /** Height above the ground (meters) */
  y?: number;
  /** Rotation about the Y axis (radians) */
  rot?: number;
  scale?: number;
  /** Collision: 'box' cuboid, 'circle' cylinder, false none (default) */
  collide?: 'box' | 'circle' | false;
  /** Register for ray acceleration (engine.raycast can hit it), default true */
  static?: boolean;
  /** false: never drawn through engine.batching (default: repeated props batch automatically) */
  batch?: boolean;
}
/** engine.content: loads the plain data of the game's content/*.js into the engine */
export interface Content {
  /** All vegetation models are fetched and the models of world data such as nearby props are built (world.ready) */
  readonly ready: boolean;
  /** Markers added by the marker effect: id -> marker */
  markers: Map<string, HudMarker | undefined>;
  /**
   * Load content (items, pickups, vegetation, NPCs, dialogue, quests, keys, trigger zones, props, the game vocabulary rules): one pack, or a list of packs
   * loaded together in order; an id defined by two packs of one call is an error naming both (a later separate load overrides by name instead)
   * @example engine.content.load([baseContent, forestDlc], { places: { home } })
   */
  load(data: ContentPack | ContentPack[], opts?: ContentLoadOptions): this;
  /** Register a custom condition, e.g. condition('timeAfter', { ref: 'clock', test: (e, t) => e.sky.timeOfDay >= t }) */
  condition(name: string, def: ContentConditionDef): this;
  /** Whether a condition holds (object, array or function) */
  test(cond: any): boolean;
  /** Run an effect (object, array or function) */
  run(effect: any): any;
  /** Place name -> position (load's places first, then level markers), null if none */
  place(name: string): XZ | null;
  /** Position form in content { place?, x?, z? } -> world coordinates */
  where(p: { place?: string; x?: number; z?: number }): XZ;
  /**
   * The shared, frozen definition of a content template (content/templates.js); instance state lives on the world record. e.g.
   * template('chest').container.capacity
   */
  template(name: string): Readonly<ContentTemplate>;
  /**
   * New runtime instance of a template (inside an op or fixed step), saved whole; returns the world record (kind = template name). e.g. spawn('chest', {
   * x: 10, z: 4 }, { opened: true })
   */
  spawn(name: string, at: any, fields?: { id?: string; rot?: number; scale?: number; y?: number; items?: Record<string, number>; [stateField: string]: any }): WorldRecord;
}
/** A content template: shared definition of a reusable object (recipes/30-templates.md) */
export interface ContentTemplate {
  /** Model name (style pack generator or assets name); every instance clones one shared prototype */
  model: string | any[];
  /** Collision box or circle from the model's bounds; omitted = does not block */
  collide?: 'box' | 'circle';
  /** false = not registered for rays */
  static?: boolean;
  /** Interaction: using an instance runs op with { id } */
  interact?: { op: string; label?: string | ((rec: WorldRecord, e: Engine) => string); radius?: number; height?: number; action?: string; enabled?: (rec: WorldRecord, e: Engine) => boolean };
  /** Each instance gets a container with its record id; items = starting goods (placed once) */
  container?: { capacity?: number; maxWeight?: number; items?: Record<string, number> };
  /** sfx played after a successful use */
  sound?: { use?: string };
  /** Per-frame look from the record (lid angle, glow); runs only while the model exists */
  animate?: (rec: WorldRecord, obj: Object3D, dt: number) => void;
  /** Instance state fields and their defaults, copied onto each record (saved) */
  state?: Record<string, any>;
}

// ======================================================================
// Game flow flow()
// ======================================================================

/** Parameters of flow() */
export interface FlowOptions {
  /** Starting state, default 'playing'; other states are entered on engine:ready (so you can define after use()) */
  start?: string;
}
/** A flow state (title, playing, paused, game over...) */
export interface FlowStateDef {
  /** Called on entering */
  enter?: (e: Engine, from: string) => void;
  /** Called on leaving */
  exit?: (e: Engine, to: string) => void;
  /** Freeze gameplay (engine.freeze, the picture keeps running), default false */
  freeze?: boolean;
  /** Lock game input, default false */
  lockInput?: boolean;
  /** Music played on entering (track name, null for silence) */
  music?: string | null;
}
/** Parameters of flow.transition() */
export interface FlowTransitionOptions {
  /** Fade-to-black / fade-in seconds, default 0.5 */
  fade?: number;
  /** Lock input during the switch, default true */
  lockInput?: boolean;
  /** Music: 'fade' fades out (default) | 'keep' leaves it alone */
  music?: 'fade' | 'keep';
  /** Save to slot 'auto' before the switch: 'auto' | false (default: a game with its own save points keeps its slots) */
  autosave?: 'auto' | false;
}
/** engine.flow: game state and scene transitions */
export interface Flow {
  /** Current state name */
  state: string;
  /** A scene transition is in progress */
  readonly transitioning: boolean;
  /** Define a state (built-in 'playing', 'paused') */
  define(name: string, def: FlowStateDef): this;
  /** Switch state */
  go(name: string): void;
  /**
   * Scene transition: lock input -> fade to black -> fade out music -> autosave -> fn() -> wait for modules to be ready -> fade in -> unlock; multiple
   * calls queue up
   */
  transition(fn: () => any, opts?: FlowTransitionOptions): Promise<void>;
}

// ======================================================================
// Objective markers hud()
// ======================================================================

/** Parameters of hud() */
export interface HudOptions {
  /** Show a marker automatically when the current quest step has a target, default true */
  questMarkers?: boolean;
}
/** Objective marker parameters */
export interface HudMarkerOptions {
  /** Text */
  label?: string | (() => string);
  /** Icon (text or image URL) */
  icon?: string;
  /** When the target is off screen: 'arrow' an arrow at the screen edge (default) | 'hide' not shown */
  offscreen?: 'arrow' | 'hide';
  /** Show the distance, default true */
  distance?: boolean;
  /** How high the marker floats above the target (meters) */
  height?: number;
}
/**
 * Marker target: an object, a character (with root), { x, z } (snapped to the ground), { x, y, z }, a place name;
 * { nearest: itemId } the nearest not-yet-picked-up pickup of that kind to the player (hidden when all are picked up); a function: called every frame
 * to get the target, hidden when it returns null
 */
export type HudTarget = Object3D | { root: Object3D } | PositionLike | string | { nearest: string } | (() => Object3D | { root: Object3D } | PositionLike | string | null);
/** Marker returned by hud.marker() */
export interface HudMarker {
  target: HudTarget;
  /** Distance in meters from the player (from the focus when there is no player) */
  dist: number | null;
  /** Shown this frame (false when the target is missing, off screen with offscreen 'hide', or before the first frame) */
  visible: boolean;
  /** The UI part drawing it (null when hud.marker is turned off); the default part has .el */
  part: import('./core').UIPart | null;
  /** On screen (otherwise an edge arrow is shown or it is hidden) */
  onScreen: boolean;
  /** Change parameters */
  set(opts: HudMarkerOptions): void;
  /** Change the target (the marker itself is not rebuilt) */
  setTarget(target: HudTarget): void;
  /** Delete */
  remove(): void;
}
/** engine.hud: objective markers, counters, progress bars */
export interface Hud {
  /** All markers */
  markers: HudMarker[];
  /** Add an objective marker: target is an object, position or place name */
  marker(target: HudTarget, opts?: HudMarkerOptions): HudMarker;
  /** Counter (calling again with the same id = update; calling every frame is fine), e.g. counter('fish', { label: '鱼', value: 2, max: 5 }) */
  counter(id: string, opts: { label?: string; icon?: string; value?: number; max?: number }): void;
  /** Progress bar (calling again with the same id = update; calling every frame is fine, the DOM is untouched when the value is unchanged), value/max 0–max */
  bar(id: string, opts: { value: number; max?: number; label?: string }): void;
  /** Delete a counter or progress bar */
  remove(id: string): void;
}
/**
 * Result of worldToScreen(): x/y are pixels from the canvas's top-left corner (the UI root covers the canvas), onScreen is inside the view, behind is
 * behind the camera
 */
export interface ScreenPoint { x: number; y: number; onScreen: boolean; behind: boolean }
