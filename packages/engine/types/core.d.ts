// Engine core: the Engine class, events, input, i18n, saves, assets, audio, the ground interface, module definitions.
import type { Object3D, Vector3, Vector2, Color, Texture, BufferGeometry, Handle, PositionLike, Vec3Like, ColorLike, Material } from './common';
import type { Style, StyleInput } from './style';
import type {
  Terrain, Vegetation, Sky, Weather, Water, WaterBody, WaterBodyOptions, VegetationRemoveEvent, Hlod, LightPool, Budget, BudgetLimits, BudgetReport,
} from './world';
import type { World } from './generated/modules/world/World';
import type { Net } from './generated/modules/net/Net';
import type { PostEffect } from './generated/render/PostFX';
import type { Grids } from './generated/modules/grid/index';
import type { Collision, RigidBodies, CameraRig, CameraKind, CameraShotEvent, Animator, AnimatorOptions, Vehicle } from './physics';
import type { Nav } from './nav';
import type { Stream } from './generated/core/Stream';
import type { Batching } from './generated/core/Batching';
import type { Rays } from './generated/core/Rays';
import type { I18n } from './generated/core/I18n';
import type { Audio } from './generated/core/Audio';
import type { Input } from './generated/core/Input';
import type { Saves } from './generated/core/Saves';
import type { Session } from './generated/core/session';
import type { Page } from './generated/core/page';
import type { Events } from './generated/core/Events';
import type { Commits } from './generated/core/Commits';
import type { Threads } from './generated/core/Threads';
import type { Ops } from './generated/core/Ops';
import type { Views } from './generated/core/Views';
import type { DebugOverrides } from './generated/core/DebugOverrides';
import type { Jobs } from './generated/core/Jobs';
import type { Random } from './generated/core/Random';
import type { PostFX } from './generated/render/PostFX';
import type {
  Timeline, Level, LevelLoadedEvent, Triggers, TriggerEvent, Entities, Entity, EntityStateEvent, EntityStageEvent,
  Particles, Settings, Music, MusicChangeEvent, CharactersApi, NPCManager, Character,
  Interactions, Dialogue, Inventory, ItemEvent, ItemUseEvent, ContainerEvent, PickupEvent, Quests, Photo, PhotoShot, Ambience, DebugPanel,
  Clock, Vars, Content, Flow, Hud,
} from './gameplay';

// ======================================================================
// Events
// ======================================================================

declare global {
  /**
   * Your game's own events, declared in the game's folder without touching the engine: games/<game>/events.d.ts
   * @example
   * // games/my-game/events.d.ts
   * interface GameEvents { 'fighter:hit': [{ attacker: string; victim: string; damage: number }] }
   */
  interface GameEvents {}
}
/**
 * Events the engine and modules emit, and the arguments callbacks receive (written as an array: what each argument is).
 * A game adds its own to the global GameEvents interface (games/<game>/events.d.ts); undeclared names still work, their arguments just aren't checked.
 */
export interface EventMap extends GameEvents {
  /** Loading finished; the world is playable */
  'engine:ready': [];
  /** Audio can play (after the player's first click / key press) */
  'audio:ready': [];
  /** UI language changed; the argument is the new language */
  'i18n:change': [locale: string];
  /** Key bindings changed; action null means everything was reset to defaults */
  'input:rebind': [{ action: string | null; keys: string[] | null }];
  'input:context': [{ stack: string[] }];
  /** Save written to disk; the argument is the slot name (not emitted when the write fails, a toast is shown instead) */
  'save:written': [slot: string];
  /**
   * Restore from a save file (saves.importFile) finished; the argument is the slot name. Attachments in the file (such as photos) are written to storage
   * too
   */
  'save:imported': [slot: string];
  /** A save was loaded onto the running playthrough (saves.load / session.load); the argument is the slot name */
  'save:loaded': [slot: string];
  /** A window was opened (the argument is the window id, e.g. 'inventory') */
  'ui:open': [id: string];
  /** A window was closed */
  'ui:close': [id: string];
  /** Shadows were toggled */
  'settings:shadows': [on: boolean];
  /** A value in the settings menu changed (the argument is all setting values) */
  'settings:change': [values: Record<string, any>];
  /** A water body was added */
  'water:add': [body: WaterBody];
  /** A water body was removed */
  'water:remove': [body: WaterBody];
  /** A new day (the argument is the day number, starting at 1; needs the sky module) */
  'day:start': [day: number];
  /** Season changed (the argument is the season name, e.g. 'autumn') */
  'season:change': [season: string];
  /** engine.skip jumped game time forward (seconds = game seconds skipped); timers and world catch-up already ran */
  'time:skip': [{ seconds: number }];
  /** Lightning strike (weather module) */
  'weather:lightning': [];
  /** engine.weather.set switched to another weather name (once, when the blend starts; setting the same name again does not fire) */
  'weather:change': [change: { from: string; to: string }];
  /** The fixed-shot camera switched shots */
  'camera:shot': [CameraShotEvent];
  /** engine.setCamera switched the camera kind; settings that belong to the camera (sensitivity, invert Y, field of view) are re-applied on it */
  'camera:change': [{ kind: string; previous: string }];
  /** A character jumped */
  'character:jump': [{ character: Character }];
  /** A character's model named by asset finished loading and replaced the placeholder body (same root; anim is now set) */
  'character:model': [{ character: Character; model: Object3D }];
  /** A character landed; impact is the landing speed (m/s), the larger the harder the fall */
  'character:land': [{ character: Character; impact: number }];
  /** Dialogue started; the argument is the dialogue script name */
  'dialogue:start': [speaker: string];
  /**
   * A dialogue line started (after its do ran): data is the node's own fields (portrait, voice...), {} when none. Use it for voice, portraits, camera
   * shots without replacing the UI part
   */
  'dialogue:line': [{ script: string; node: string; speaker: string; text: string; data: Record<string, any> }];
  /** Dialogue ended; the argument is the dialogue script name */
  'dialogue:end': [speaker: string];
  /** An item was added to the inventory */
  'item:add': [ItemEvent];
  /** An item was removed from the inventory */
  'item:remove': [ItemEvent];
  /** An item was added to a non-player container (chest, corpse...); container is the container id */
  'container:add': [ContainerEvent];
  /** An item was removed from a non-player container */
  'container:remove': [ContainerEvent];
  /** An item on the ground was picked up */
  'item:pickup': [PickupEvent];
  /** An item was used through the inventory.use op (after use ran) */
  'item:use': [ItemUseEvent];
  /** A quest started */
  'quest:start': [{ id: string }];
  /** A quest moved to the next step; step is the new step index (starting at 0) */
  'quest:step': [{ id: string; step: number }];
  /** A quest completed */
  'quest:done': [{ id: string }];
  /** A part of a parallel quest step was met; step and part are indexes (starting at 0) */
  'quest:part': [{ id: string; step: number; part: number }];
  /** A quest failed (its fail condition held); quests.start(id) may begin it again */
  'quest:fail': [{ id: string }];
  /** A photo was taken */
  'photo:taken': [PhotoShot];
  /** The photo key was pressed but the op photo.take was refused (reason from photo.canTake(), 'denied' when it returned false) */
  'photo:denied': [{ reason: string }];
  /** Entered a trigger zone */
  'trigger:enter': [TriggerEvent];
  /** Left a trigger zone */
  'trigger:exit': [TriggerEvent];
  /** Level finished loading */
  'level:loaded': [LevelLoadedEvent];
  /** A cutscene started */
  'timeline:start': [{ id: number }];
  /** A cutscene ended; skipped tells whether it was skipped */
  'timeline:end': [{ id: number; skipped: boolean }];
  /** An entity was spawned */
  'entity:spawn': [Entity];
  /** An entity was removed */
  'entity:remove': [Entity];
  /** A state value of an entity changed */
  'entity:state': [EntityStateEvent];
  /** An entity entered a new growth stage */
  'entity:stage': [EntityStageEvent];
  /** The ground's shape or type changed in this world-space box (engine.terrain.edit): cached ground samples (path rasters) inside it are stale */
  'ground:change': [{ x0: number; z0: number; x1: number; z1: number }];
  /** terrain({ shape }): the player or a moving rigid body dropped below engine.terrain.voidY (once per fall). The engine does not respawn: the game decides */
  'terrain:void': [{ who: any; position: { x: number; y: number; z: number } }];
  /** A vegetation instance was chopped / removed */
  'vegetation:remove': [VegetationRemoveEvent];
  /** A vegetation instance was restored */
  'vegetation:restore': [VegetationRemoveEvent];
  /** Background music changed track (null means silence) */
  'music:change': [MusicChangeEvent];
  /** A stinger was played */
  'music:stinger': [{ name: string }];
  /** Scenario parameters were applied (URL parameters or engine.applyState) */
  'state:applied': [StateParams];
  /** A one-shot action of the animation state machine finished */
  'anim:end': [{ root: Object3D; state: string }];
  /** A record was added to world */
  'world:add': [{ id: string; kind: string }];
  /** world.set changed fields (keys lists which) */
  'world:change': [{ id: string; kind: string; keys: string[] }];
  /** A record was removed from world */
  'world:remove': [{ id: string; kind: string }];
  /** world finished loading a save (the data is now the save's; caches holding a rec object should refresh on this, count is the record count after loading) */
  'world:load': [{ count: number }];
  /** Host (net): a peer connected; actor is its world record / container id */
  'net:join': [{ peer: number; actor: string }];
  /** Host (net): a peer disconnected (its bag stays; a reconnect with its key gets the same actor) */
  'net:leave': [{ peer: number; actor: string }];
  /** Client (net): connected to the host (the first snapshot follows) */
  'net:open': [{}];
  /** Client (net): connection lost */
  'net:close': [{}];
  /** Client (net): host state applied (full: a whole snapshot, else a diff); redraw UI from state here */
  'net:sync': [{ tick: number; full: boolean }];
  /** Client (net): the host's answer to an op request (seq from ops.run's return value; tick is the host's), sent after the state it caused */
  'net:result': [{ seq: number; name: string; ok: boolean; code: string | null; value?: any; tick: number }];
  /** A gameplay error in development / testing; gameplay is frozen (error severity levels, see engine.error) */
  'engine:error': [EngineError];
  /** A presentation module errored and was disabled (the game continues) */
  'module:disabled': [{ name: string; message: string }];
  /** A character boarded a vehicle */
  'vehicle:enter': [{ character: Character; vehicle: Vehicle }];
  /** A character exited a vehicle */
  'vehicle:exit': [{ character: Character; vehicle: Vehicle }];
  /** Game flow state changed */
  'flow:change': [{ from: string; to: string }];
  /** Scene transition: phase 'start' begins fading to black, 'end' finishes fading back in */
  'flow:transition': [{ phase: 'start' | 'end' }];
  /** A playthrough ends (engine.session.newGame / load / quit), before the reset */
  'session:end': [];
  /** A playthrough started from a clean slate: kind 'new' (newGame) or 'load' (session.load, with the slot) */
  'session:start': [{ kind: 'new' | 'load'; slot?: string }];
  /** The page went away: the window lost focus or the tab was hidden (engine.page) */
  'page:blur': [{ focused: boolean; visible: boolean }];
  /** The page came back: focused and visible again */
  'page:focus': [{ focused: boolean; visible: boolean }];
  /** The mouse lock on the canvas started or ended (Esc, alt-tab); cameras with pointerLock lock again on the next click */
  'page:pointerlock': [{ locked: boolean }];
  /** The WebGL context was lost: gameplay waits and the player sees a message */
  'page:contextlost': [];
  /** The WebGL context is back: gameplay resumes */
  'page:contextrestored': [];
}
/** Arguments a callback of the given event receives: known events follow EventMap, other names are not checked */
export type EventArgs<K extends string> = K extends keyof EventMap ? EventMap[K] : any[];
/** Event name: known events get autocompletion, any string is also allowed */
export type EventName = keyof EventMap | (string & {});


// ======================================================================
// Input
// ======================================================================

/** Mouse / touch pointer. ndcX/ndcY are screen coordinates in -1..1 */
/** Per-engine shader uniforms (engine.uniforms): { value } objects shared by every material of that engine */
export interface EngineUniforms {
  /** Fixed seconds (= engine.elapsed) */
  uTime: { value: number };
  /** Wind strength multiplier (weather) */
  uWind: { value: number };
  /** Sway frequency multiplier (style.wind.frequency) */
  uWindFreq: { value: number };
  /** Cloud cover 0-1 (weather) */
  uCloud: { value: number };
  /** Darkest cloud shadow 0-1 (style.clouds.shadow; 0 = none) */
  uCloudShadow: { value: number };
  /** Cloud size: smaller = bigger clouds (style.clouds.scale) */
  uCloudScale: { value: number };
  /** Cloud drift per second (style.clouds.speed) */
  uCloudSpeed: { value: Vector2 };
  /** Season tint of foliage (sky calendar) */
  uFoliageTint: { value: Color };
  /** Season tint of the ground (sky calendar) */
  uGroundTint: { value: Color };
  uFoliageMix: { value: number };
  uGroundMix: { value: number };
}

export interface Pointer {
  /** Pixels from the canvas's top-left corner (not the window's): the same space as worldToScreen and the UI root */
  x: number; y: number;
  /** -1..1 across the canvas box (engine.pick / screenToGround take these) */
  ndcX: number; ndcY: number;
  /** Held down */
  down: boolean;
  /**
   * Clicked once this frame (not a drag). Only for in-frame uses such as UI and clicking the ground; bind fire / attack to the action 'Mouse0' and read
   * pressed in onFixed
   */
  clicked: boolean;
  /** Mouse button pressed: 0 left, 1 middle, 2 right */
  button: number;
}
/** Autopilot: movement direction replacing player input (x right-positive, y forward-positive) and speed (m/s) */
export interface Autopilot { x: number; y: number; speed?: number }


// ======================================================================
// i18n
// ======================================================================

/** String table: { 'zh-CN': { key: text }, en: {...} }. {name} in the text is replaced by arguments, {key:action} shows the key name */
export type StringTables = Record<string, Record<string, string>>;


// ======================================================================
// Saves
// ======================================================================

/** Save provider: save() returns JSON-able data, load(data) reads it back (may return a Promise, e.g. for changing level;
 *  later parts wait for it to finish before loading).
 *  first: true providers load first (parts such as the level, where the rest only makes sense after it is loaded) */
export interface SaveProvider {
  save: () => any;
  load: (data: any) => void | Promise<void>;
  /** Load before the other parts (such as the level) */
  first?: boolean;
  /** Join atomic ops: copied before an atomic op runs, put back if it fails (plain data; afterLoad does not run on rollback) */
  atomic?: boolean;
  /** This part's format version, default 1: raise it by 1 when what save() returns changes shape. A save with a newer version is refused */
  version?: number;
  /** Upgrade steps: old version -> data => data in the next version's shape, e.g. { 1: d => ({ ...d, beds: [] }) }.
   *  The second argument is the whole save as read ({ parts, versions }, read only), for a step that depends on another part */
  migrate?: Record<number, (data: any, save: { parts: Record<string, any>, versions: Record<string, number> }) => any>;
}


// ======================================================================
// Assets
// ======================================================================

/** Function that generates a model in code: returns a three object or geometry (may be async) */
export type ModelBuilder = (params?: any) => Object3D | BufferGeometry | Promise<Object3D | BufferGeometry>;
/**
 * One asset manifest entry: a path; or { url, preload?, ... }; models can also be a generator function, or { build, params?, preload? } (generated on
 * demand, cached automatically, reads the baked file if there is one)
 */
export type AssetEntry = string | ModelBuilder | {
  /** File path (a file under public/ is written as '/models/x.glb') */
  url?: string;
  /** Model: generator function (instead of url) */
  build?: ModelBuilder;
  /** Model: parameters passed to build */
  params?: any;
  /** Bake manifest (bake.js) only: 'file' = the baked file is the source of truth (edited in Blender), npm run bake no longer overwrites it */
  source?: 'file';
  /** Preload at startup */
  preload?: boolean;
  /** start() stops with the reason if this fails (default false: a failed file falls back and the game continues) */
  critical?: boolean;
  /** Name of another entry of the same type to use if this one fails (default: a gray placeholder model / gray texture / silence) */
  fallback?: string;
  /** Texture: whether it is a color texture (write false for normal and roughness maps) */
  color?: boolean;
  /** Texture: pixel-art style (no smoothing) */
  pixelated?: boolean;
  /** Texture: repeat count [horizontal, vertical] */
  repeat?: number[];
  /**
   * Model: game action names -> this file's clip names, as data (assets.animate and characters start from it), e.g.
   * { states: { idle: { clip: 'Idle_Sword' }, attack: { clip: 'Sword_Slash', loop: false, timing: 0.6 } } }
   */
  animation?: AnimatorOptions;
};
/**
 * An asset manifest, also the shape of an asset pack (a folder or npm package exporting one): names -> files or generators; content and code use the
 * names only
 */
export interface AssetManifest {
  /** Label shown as the source manifest in engine.loading (default 'manifest#1', '#2'...) */
  name?: string;
  /**
   * Folder that this manifest's relative paths resolve against: '/packs/forest/', a CDN URL, or new URL('./files/', import.meta.url) in an npm pack.
   * '/x' and full URLs stay as written
   */
  base?: string | URL;
  /** Models (.glb / .gltf, Draco/Meshopt compression also works): name -> path or generator function */
  models?: Record<string, AssetEntry>;
  /** Textures: name -> path */
  textures?: Record<string, AssetEntry>;
  /** Sounds: name -> path */
  sounds?: Record<string, AssetEntry>;
  /** Fonts: name -> file, or { url, family, weight, style, ... } (family defaults to the name). style.ui.fonts lists the names the UI uses */
  fonts?: Record<string, string | FontAssetEntry>;
}
/** One font of an asset pack: the file plus the FontFace descriptors (family defaults to the asset name) */
export interface FontAssetEntry {
  url: string;
  /** CSS font-family it registers (default: the asset name); several entries may share one family with different weight / style */
  family?: string;
  weight?: number | string; style?: string; stretch?: string; unicodeRange?: string; display?: string; featureSettings?: string; variationSettings?: string;
  /** start() stops if it fails (otherwise text falls back to the next family of style.ui.font) */
  critical?: boolean;
  /** Load at start() even if style.ui.fonts does not name it */
  preload?: boolean;
}

export interface Assets {
  /**
   * Register an asset manifest or asset pack (can be called several times; a later entry with the same name replaces the earlier one). Its name labels
   * it in engine.loading, base resolves its relative paths
   */
  manifest(m: AssetManifest): this;
  /** The generator function registered under a model name, null for a file model or an unknown name (content builds [name, ...params] models with it) */
  builder(name: string): ((...args: any[]) => any) | null;
  /**
   * Preload (onProgress(0–1, current name)). Code-generated models and fonts are only loaded up front if marked preload. failed includes entries now
   * showing their fallback
   */
  preload(onProgress?: (p: number, name: string) => void, opts?: { onlyMarked?: boolean }): Promise<{ loaded: number; failed: string[]; ok: boolean }>;
  /**
   * A font from an asset pack by name: downloaded once, added to document.fonts; null when the file failed and it is not critical. style.ui.fonts calls
   * it at start()
   */
  font(name: string): Promise<FontFace | null>;
  /**
   * Get a model copy (name or path; geometry and materials are shared with other copies). static: true registers it in engine.rays (builds ray
   * acceleration)
   */
  model(nameOrUrl: string, opts?: { castShadow?: boolean; receiveShadow?: boolean; static?: boolean }): Promise<Object3D>;
  /**
   * A model copy right now if it has already loaded, else null (never starts a load, never waits): lets code that rebuilds often skip the frame an await costs
   * @example const m = engine.assets.modelNow('villager') ?? await engine.assets.model('villager');
   */
  modelNow(nameOrUrl: string, opts?: { castShadow?: boolean; receiveShadow?: boolean; static?: boolean }): Object3D | null;
  /** Get the geometry of the first mesh in a model */
  geometry(nameOrUrl: string): Promise<BufferGeometry>;
  /** An image as grid data for sampleGrid: PNG at 8 or 16 bits (jpg / webp 8). channel 'r' (default) 'g' 'b' 'a' or 0-3; range maps pixels to [min, max] (default [0, 1]) */
  gridFromImage(nameOrUrl: string, opts?: { channel?: 'r' | 'g' | 'b' | 'a' | number; range?: [number, number]; bits?: 8 | 16 }): Promise<{ data: Float32Array; width: number; height: number; bits: number }>;
  /** Get a texture (.ktx2 compressed textures also work) */
  texture(nameOrUrl: string, opts?: { color?: boolean; pixelated?: boolean; repeat?: number[] }): Promise<Texture>;
  /**
   * Release a resource and return GPU memory. Not released while copies of the model are still in the scene; it is released when the last copy is
   * removed with engine.remove
   */
  release(name: string): void;
  /**
   * Release every model that has no copy in use (called automatically after level changes). Models whose shared geometry was taken by geometry() /
   * cached() are not released automatically. Returns the released names
   */
  trim(): string[];
  /** How many copies of this model are in use now (taken with model() and not yet removed with engine.remove) */
  users(name: string): number;
  /**
   * Called when an object is fully removed (engine.remove already calls it, normally you don't need to): decrements the use count of the model copies
   * under it
   */
  forget(obj: Object3D): void;
  /**
   * Code-generated model: generated only once per name + params, returns a copy (for geometry, the same one).
   * Order: files baked by npm run bake (public/models/baked/) -> automatic dev cache (.threedog/cache, invalidated automatically when the generator or
   * a file it imports changes) -> compute now.
   * When the generator is newer than the baked file during development, it computes now and prints a one-time hint "run npm run bake once it is final"
   */
  cached<T = any>(name: string, build: (params?: any) => T | Promise<T>, params?: any): Promise<T>;
  /** Generations faster than this many milliseconds are not written to the automatic cache (reading the file would be slower), default 20 */
  cacheMinMs: number;
  /** Geometry and materials shared by model copies (engine.remove does not release them, use release) */
  shared: WeakSet<object>;
  /** Current GPU memory usage (number of geometries and textures) */
  readonly memory: { geometries: number; textures: number };
  /**
   * Create an animation state machine for a skinned model (without config it is simple play-by-name).
   * A copy of a manifest model whose entry has `animation` starts from that mapping; config wins per state
   */
  animate(root: Object3D, config?: AnimatorOptions): Animator;
  /** The manifest entry's animation mapping for a model copy, or null (not a manifest copy, or no mapping) */
  mapping(root: Object3D): AnimatorOptions | null;
  /** three.js GLTFLoader (Meshopt installed; Draco and KTX2 are installed the first time they are needed) */
  gltf: any;
  /**
   * three.js DRACOLoader (created only the first time Draco compression is met, null before; the decoder defaults to the one bundled with three, vite
   * packs it automatically)
   */
  draco: any;
  /** three.js KTX2Loader (created only the first time a KTX2 texture is met, null before) */
  ktx2: any;
  /** Import report of a loaded model (by name, or a copy from model()): materials, textures with colorSpace, clips, colliders, templates, and issues for what the file has but the scene lost */
  report(nameOrRoot: string | Object3D): AssetReport;
  /** assets.report as text for the console / describe */
  reportText(nameOrRoot: string | Object3D): string;
}
/** engine.assets.report(): see recipes/46-blender-art-route.md */
export interface AssetReport {
  name: string | null; url: string | null; fromFile: boolean;
  counts: Record<string, number>;
  materials: { name: string; type: string; maps: Record<string, any>; flatShading: boolean; vertexColors: boolean; madeByStyle: boolean }[];
  textures: any[]; clips: { name: string; seconds: number }[]; colliders: any[]; templates: any[];
  issues: { severity: 'warn' | 'info'; code: string; msg: string }[];
}

/** Phase of a loading task */
export type LoadingPhase = 'queued' | 'download' | 'decode' | 'upload' | 'build' | 'done' | 'failed';
/** One loading task (engine.loading.get / list) */
export interface LoadingTask {
  name: string;
  kind: 'model' | 'texture' | 'sound' | 'module' | 'stream' | 'step';
  phase: LoadingPhase;
  /** 0-1 within the phase (download reports bytes) */
  progress: number;
  /** A failure stops start() */
  critical: boolean;
  /** url: the file that failed (may be a .bin / texture the model references); status: HTTP status when known */
  error?: { message: string; url: string | null; status?: number };
  /** Files the model references but could not load (it loaded without them) */
  missing?: string[];
  /** What is used instead: 'gray placeholder', 'silence' or the fallback entry's name */
  fallback?: string;
  /** Where it came from: manifest name, path, file version (ETag / Last-Modified), size, animation clip names */
  source: { manifest: string | null; url: string | null; version: string | null; bytes: number | null; animations: string[] | null };
}
/**
 * describe().loading: done = nothing pending; ok = nothing failed (all finished is not all succeeded); blocked = a critical item failed before start()
 * finished
 */
export interface LoadingView {
  done: boolean; ok: boolean; blocked: boolean;
  /** One English line naming the current item, e.g. 'decoding model "hero" (/models/hero.glb, manifest "main")'; null when done */
  waiting: string | null;
  pending: { name: string; kind: string; phase: LoadingPhase; progress: number; critical: boolean }[];
  failed: LoadingTask[];
  warnings: { name: string; missing: string[]; source: LoadingTask['source'] }[];
  counts: { total: number; done: number; failed: number; pending: number };
}
export interface Loading {
  /** Summary (what describe().loading shows) */
  view(): LoadingView;
  /** Player-facing text for the loading screen, null when nothing is pending */
  text(): string | null;
  /** One task with its source, or null */
  get(name: string, kind?: string): LoadingTask | null;
  /** Every task so far */
  list(filter?: { kind?: string; phase?: LoadingPhase }): LoadingTask[];
  /** Run the game's own loading step as a task (critical by default: a failure before start() finishes stops start()) */
  track<T>(name: string, fn: () => Promise<T>, opts?: { critical?: boolean }): Promise<T>;
  /**
   * Resolves when every module installed after start() has finished its init() (also when one failed: see engine.moduleStates).
   * @example engine.use(shop()); await engine.loading.settled(); engine.moduleStates.shop   // 'running'
   */
  settled(): Promise<void>;
  /** How long start() waits for modules whose isReady(e) stays false before it rejects naming them, in ms (default 120000) */
  timeoutMs: number;
}

// ======================================================================
// Audio
// ======================================================================

/** Built-in bus names; a game adds its own with createEngine({ audio: { levels: { voice: 1 } } }) or audio.addBus */
export type AudioBus = 'master' | 'music' | 'sfx' | 'ambience' | 'ui' | (string & {});
/** A playing sound (returned by audio.sfx / audio.play): stop(fade), fade(to, seconds), setPosition(at) */
import type { SoundHandle } from './generated/core/audioVoice';
export type { SoundHandle };
/** One sounds entry in full form. src: a file or variants (random, no immediate repeat); synth: a registered synth name (default: the entry's own name) */
export interface SoundDef {
  src?: string | string[];
  synth?: string;
  /** Passed to the synth (merged over its registered defaults) */
  params?: Record<string, any>;
  /** Bus it plays on (default 'sfx', or the synth's registered bus) */
  bus?: AudioBus;
  volume?: number;
  /** Playback rate multiplier (1 = as recorded); synths get it as params.pitch */
  pitch?: number;
  /** Random spread per play, as a fraction: { pitch: 0.08 } = +-8% */
  jitter?: { volume?: number; pitch?: number };
  /** Seconds before the same sound can start again (calls inside it return null) */
  cooldown?: number;
  /** Most voices of this sound at once; the oldest stops for a new one (default unlimited) */
  voices?: number;
  loop?: boolean;
  /** 3D falloff for sfx(name, { at }): ref meters at full volume (2), max meters (60), rolloff (1) */
  distance?: { ref?: number; max?: number; rolloff?: number };
}
/** A sounds entry: a file, variants, 'synth' (the synth registered under the same name) or the full form */
export type SoundSource = string | string[] | SoundDef;
/** A measure comparison in a rule's `when`: every given key must hold ({ daylight: { gt: 0.15 } }, { rain: { lt: 0.2 } }) */
export interface AudioCompare { gt?: number; gte?: number; lt?: number; lte?: number }
/**
 * A rule's condition: an object whose keys all hold, or a function. Keys are condition keys (state, time, weather, zone, engine.audio.condition)
 * or measures compared with AudioCompare (daylight, rain, snow, wind, nearWater, altitude, engine.audio.measure). Content packs: object only
 */
export type AudioCondition = Record<string, any | AudioCompare> | ((e: Engine, ...extra: any[]) => boolean);
/** Volume as data: base plus measure * factor for each add entry, clamped to [min, max] ({ base: 0.05, add: { wind: 0.08 }, max: 0.5 }) */
export interface AudioVolumeData { base?: number; add?: Record<string, number>; min?: number; max?: number }
/** A rule volume: a number 0-1, data (AudioVolumeData, the only form in content packs), or a function of the moment */
export type AudioVolume = number | AudioVolumeData | ((e: Engine, ...extra: any[]) => number);
/** One ambience rule: while `when` holds, `sound` plays at `volume`. With `every` it is a one-shot repeated at random gaps, else a loop */
export interface AmbienceRule {
  sound: string;
  when?: AudioCondition;
  /** 0-1, data { base, add: { measure: factor }, min, max }, or a function of the moment (e, ambience) => 0-1 (code only) */
  volume?: number | AudioVolumeData | ((e: Engine, ambience: import('./gameplay').Ambience) => number);
  /** Fade seconds when the rule turns on / off (1) */
  fade?: number;
  /** One-shot: [shortest, longest] seconds between plays */
  every?: number[];
  /** Bus (default 'ambience') */
  bus?: AudioBus;
}
/** Synthesized sound: connect to `out` and return the length in seconds, or { stop(time) } for a loop (params.loop is true then) */
export type SynthFn = (audio: Audio, params: Record<string, any>, out: any) => number | void | { stop(time: number): void };

/**
 * The audio table of a content pack (content.load({ audio })): data only. sounds name asset pack sounds ('synth' for a built-in);
 * ambience and music.rules use condition keys and measures, never functions. Merged with createEngine({ audio }); a name in both is an error
 */
export interface ContentAudio {
  sounds?: Record<string, SoundSource>;
  ambience?: AmbienceRule[];
  music?: { tracks?: Record<string, import('./gameplay').MusicTrack>; rules?: import('./gameplay').MusicRule[] };
  footsteps?: Record<string, string>;
}
/** The game's sound config: createEngine({ audio }), read back as engine.audio.config (merged with content packs' ContentAudio). Not part of a style pack */
export interface AudioConfig {
  /** Sound name -> file / variants / 'synth' / SoundDef */
  sounds?: Record<string, SoundSource>;
  /** ambience() rule table */
  ambience?: AmbienceRule[];
  /** music() defaults: tracks, rules, fade seconds, duckDialogue (how low the music bus ducks during dialogue; default false = no duck) */
  music?: {
    tracks?: Record<string, import('./gameplay').MusicTrack>; rules?: import('./gameplay').MusicRule[];
    fade?: number; duckDialogue?: number | false; duckFade?: number; hold?: number; interval?: number;
  };
  /** Ground type (terrain groundType or level material name) -> sound name; 'water' while swimming; default for unmapped types (else 'footstep') */
  footsteps?: Record<string, string>;
  /** Volume per bus 0-1, default { master: 0.8, music: 0.5, sfx: 0.8, ambience: 0.7, ui: 0.8 }; an extra key adds a bus */
  levels?: Record<string, number>;
}


// ======================================================================
// Post-processing (type generated from render/PostFX.js, see types/generated/), UI parts
// ======================================================================

/**
 * One UI part: the engine calls these, the part only draws. Every method is optional (missing ones do nothing).
 * What each part receives:
 *   loading      show({ title }) · update({ progress 0-1, text, failed? }) · hide()   (failed: the critical tasks that stopped start())
 *   toast        show({ text, kind: 'info'|'quest'|'item'|'save'|'error'|string, ms })
 *   title        show({ title, items: [{ id, label, run() }] }) · hide()          (full screen: engine.ui.open / close)
 *   hud.marker   show() · update({ x, y, onScreen, arrow, angle, label, icon, distance }) · hide() · dispose()   (one per marker)
 *   hud.counter  update({ id, label, icon, value, max }) · dispose()               (one per counter)
 *   hud.bar      update({ id, label, value, max }) · dispose()                    (one per bar)
 *   touch        show(view) · update(view)  TouchView: on-screen stick and action buttons (touch devices / joystick: true)
 *   dialogue     show() · update(view) · hide()  DialogueView (dialogue module)
 *   prompt       update(view) every frame · hide()  PromptView (interactions module)
 *   questLog     show(view) · update(view) · hide()  QuestLogView (quests module; full screen: opened by the quest key)
 */
export interface UIPart {
  show?(data?: any): void;
  update?(data?: any): void;
  /** May return a promise that resolves when a fade-out has finished (engine.ui.settled() waits for it) */
  hide?(): void | Promise<void>;
  dispose?(): void;
  [key: string]: any;
}
/** Your own part: called once per single part (loading, toast, title) or once per item (hud.*); options are what the game passed as an object */
export type UIPartFactory = (engine: Engine, options: Record<string, any>) => UIPart;
/** false off · true the default · an options object for the default · your own factory */
export type UIPartValue = boolean | Record<string, any> | UIPartFactory;
/** Declaring a part (engine and modules): on = shown unless turned off; multi = one part per item; modal = full screen, opened with ui.open */
export interface UIPartDef {
  on?: boolean;
  multi?: boolean;
  modal?: { freeze?: boolean | ((engine: Engine) => boolean); cancel?: (engine: Engine) => void; data?: (engine: Engine, options: Record<string, any>) => object } | null;
}
/**
 * What the 'touch' UI part receives in show(view) and update(view) (buttons added later, language changed). Call move / press / release from your controls:
 * they feed the same input path as keys, so engine.input.axis and pressed('jump') work unchanged.
 * @example
 * engine.ui.set('touch', (engine) => ({
 *   show: (v) => { myPad.onDrag = (x, y) => v.move(x, y); for (const b of v.buttons) myButton(b.label, () => v.press(b.action), () => v.release(b.action)); },
 * }));
 */
export interface TouchView {
  /** Draw a stick (createEngine({ joystick }): 'auto' on touch devices, true always) */
  stick: boolean;
  /** One button per action the modules asked for (touch devices only) */
  buttons: { action: string; label: string }[];
  /** Stick position: x right, y forward, length <= 1; move(0, 0) on release */
  move(x: number, y: number): void;
  /** Button pressed / released */
  press(action: string): void;
  release(action: string): void;
}
/** A title screen button: built-ins 'start' | 'continue' | 'settings', or your own */
export interface UITitleItem {
  id?: string;
  label: string | ((engine: Engine) => string);
  run(engine: Engine): any;
}
/** engine.ui: every piece of screen UI is a named part a game can replace or turn off (see recipes/26-ui-parts.md) */
export interface UIParts {
  /** Declare a part and its default (engine and modules; games use set) */
  define(name: string, factory: UIPartFactory, def?: UIPartDef): void;
  /**
   * Replace a part, give the default options, or turn it off (before engine.start(); the loading part only via createEngine({ ui }))
   * @example engine.ui.set('hud.marker', false)
   * @example engine.ui.set('toast', (engine) => ({ show: ({ text, kind }) => { if (kind !== 'quest') myToast(text); } }))
   */
  set(name: string, value: UIPartValue): void;
  /** The live single part (null when off) */
  get(name: string): UIPart | null;
  /** A new part for one item of a multi part (null when off) */
  create(name: string): UIPart | null;
  /** Open a full-screen part (title): shows it, takes Esc, locks input, freezes gameplay, emits ui:open; false when off */
  open(name: string, data?: object): boolean;
  /** Close a full-screen part, emits ui:close */
  close(name: string): void;
  isOpen(name: string): boolean;
  /** name -> 'default' | 'custom' | 'off' */
  describe(): Record<string, string>;
  /**
   * Resolves once every hiding part has finished fading out (hide() returned a promise); screenshots wait for it
   * @example await engine.ui.settled();
   */
  settled(): Promise<void>;
}

// ======================================================================
// Ground interface
// ======================================================================

/** Ground: whoever provides the ground height is the "terrain" (terrain module, level module, or the default flat y=0) */
export interface Ground {
  /**
   * Ground height (meters) at (x, z). For multi-layer ground (bridges, caves) pass refY: takes the highest layer not above refY + one step (0.45 m);
   * without it the highest layer is used. Single-layer ground ignores refY
   */
  height(x: number, z: number, refY?: number): number;
  /** Slope at (x, z) (height difference / horizontal distance) */
  slope(x: number, z: number): number;
  /** Ground type at (x, z) (landform name, e.g. 'meadow') */
  type(x: number, z: number): string;
  /** Global water level (meters); -Infinity when there is no water */
  waterLevel: number;
  /**
   * Is there ground at (x, z). Always true except off the outline of terrain({ shape }), where height is -Infinity and slope 0.
   * @example if (engine.ground.has(x, z)) engine.snapToGround(chest);
   */
  has(x: number, z: number): boolean;
  /** Height below which something has fallen out of the world (terrain:void): engine.terrain.voidY with terrain({ shape }), else -Infinity */
  voidY(): number;
  /** Optional: iterate the circular colliders (tree trunks etc.) within range meters of (x, z) */
  forEachCollider?(x: number, z: number, range: number, fn: (cx: number, cz: number, r: number) => void): void;
  /** Optional: chunk edge length (meters) */
  chunkSize?: number;
  /** Optional: how far (meters) the ground is shown around a stream source now; stream entries build within it by default (else fogFar) */
  viewRange?(): number;
  /** Optional: collision data of a chunk (used by the physics module) */
  chunkCollision?(cx: number, cz: number): any;
  /** Optional: static triangle mesh (the level module provides it for physics) */
  staticTrimeshes?(): { positions: Float32Array; indices: Uint32Array }[];
  /** Optional: version number of the static mesh; rebuild when it changes */
  staticVersion?(): number;
  /** Optional: triangle mesh for building the navmesh (walkable surfaces + obstacle volumes), used by the nav module */
  navGeometry?(): { positions: Float32Array; indices: Uint32Array };
}

// ======================================================================
// Module definition
// ======================================================================

/**
 * A module (the argument of engine.use). The name is the property name on the engine once installed.
 * Per-frame hook order follows stage, then before / after within a stage, then install order.
 */
export interface ModuleDef<Api = any> {
  /** Module name; after install, access the object returned by install through engine[name] */
  name: string;
  /** Display name (used by the loading screen) */
  label?: string;
  /** Names of other modules this depends on; they must be installed first (an error is thrown if not) */
  requires?: string[];
  /**
   * Optional dependencies (modules the code uses as e.xxx?. or guards with if (e.xxx); rule R16 requires listing them all).
   * An array only registers them; written as { moduleName: 'what is lost when missing' }, start() prints a one-time development hint when one is
   * missing; use this form when it changes gameplay results
   */
  optional?: string[] | Record<string, string>;
  /**
   * Hook stages (first -> last): 'control' timeline, camera -> 'world' terrain, level -> 'environment' weather, sky, water -> 'gameplay' interactions,
   * dialogue, triggers, entities
   * -> 'presentation' particles, settings, objective markers -> 'late' (default) -> 'audio' music. Within a stage use before / after, then install order
   */
  stage?: 'control' | 'world' | 'environment' | 'gameplay' | 'presentation' | 'late' | 'audio';
  /** Hooks run before these modules, inside one stage (ignored if not installed;
   *  use() throws on a cycle, or when the other module's stage already runs earlier) */
  before?: string[];
  /** Hooks run after these modules, inside one stage (ignored if not installed;
   *  use() throws on a cycle, or when the other module's stage already runs later) */
  after?: string[];
  /**
   * Presentation modules (particles, sound effects, HLOD; gameplay is unaffected without them): when a hook errors only this module is disabled and the
   * game continues.
   * Without it the module counts as gameplay: during development / testing an error freezes gameplay and is recorded in engine.error (error severity levels)
   */
  presentation?: boolean;
  /**
   * The game cannot run without this module (default false): when its init() fails, engine.start() rejects with the module name and reason instead of
   * starting a broken game. Without it a failed init is reported by severity (presentation: disabled and the game carries on; gameplay: error tiers) and
   * start() goes on. Only start() reads it; a critical module installed after start() is reported like any other
   * @example engine.use({ name: 'saveSlots', critical: true, async init(e) { await loadSlots(); } })
   */
  critical?: boolean;
  /** Install: create and return the object the game uses (engine.name) */
  install?(e: Engine): Api;
  /** Called at startup (download things, wait for assets); may be async */
  init?(e: Engine): void | Promise<void>;
  /** The loading screen waits until this returns true before disappearing (the hook is called isReady; in the engine ready is always a boolean property) */
  isReady?(e: Engine): boolean;
  /** After a save loaded: rebuild what the loaded state needs nearby; gameplay waits frozen until the returned Promise resolves */
  afterLoad?(e: Engine): void | Promise<void>;
  /** Fixed step (60 times per second); dt is in seconds */
  fixed?(dt: number, e: Engine): void;
  /** Once per frame; dt is in seconds */
  frame?(dt: number, e: Engine): void;
  /** After rendering */
  afterRender?(dt: number, e: Engine): void;
  /**
   * engine.skip moved time without stepping: advance your own time by dt fixed seconds (game seconds = dt x clock.timeScale), no per-step work.
   * Called once per skip segment (segments end at timers and sky clock marks); done is true on the last one: do expensive catch-up only then.
   * Only for modules that keep time themselves (sky, world); modules that compare against clock.now need nothing
   */
  skip?(dt: number, e: Engine, done: boolean): void;
  /**
   * Optional: add state to engine.describe(). The (JSON-able) return value goes into the result keyed by the module name; nothing is added if it
   * returns nothing.
   * It may also fill in the standard fields of ctx.out, or use ctx.near() to report "nearby things"
   */
  describe?(e: Engine, ctx: DescribeContext): any;
  /** Optional: leak-hunting counts for engine.counts(), put there under the module name (a number or an object of numbers that should not keep growing) */
  counts?(e: Engine): number | Record<string, number>;
  /** Optional: answer engine.explain({ key: value }) for your own keys, e.g. explain: { quest: (e, id) => ({ ok: false, text: 'waits on step 2: ...' }) } */
  explain?: Record<string, (e: Engine, value: any, query: Record<string, any>) => { ok: boolean; text: string; [k: string]: any }>;
  /** Optional: handle the keys of engine.applyState that this module owns (e.g. sky handles time) */
  applyState?(e: Engine, params: StateParams): void | Promise<void>;
  /**
   * Optional: called on engine.dispose() (in reverse install order). Only clean up what the core cannot: Workers, the physics world, real-time timers,
   * Audio nodes you connected yourself.
   * Events, onFixed / onFrame, clock timers, jobs, stream, ray registrations and GPU memory in the scene are reclaimed by the core; DOM listeners
   * attached to engine.signal and UI attached to engine.uiRoot are cleaned up automatically too
   */
  dispose?(e: Engine): void;
}
/** What engine.use() accepts: a module, an array of modules (what openWorld() returns); false/null are ignored */
export type ModuleInput = ModuleDef | ModuleInput[] | false | null | undefined;

// ======================================================================
// Engine
// ======================================================================

export interface EngineOptions {
  /** Canvas element (required unless renderer is given), e.g. document.getElementById('view') */
  canvas?: HTMLCanvasElement | HTMLElement;
  /** A ready three.js renderer (WebGLRenderer or compatible) to use instead of creating one; canvas then defaults to renderer.domElement. The engine configures
   * (pixel ratio, size, tone mapping, shadows) only a renderer it created itself. WebGL is the fully supported path; WebGPU-style renderers may not run shader patches or post effects (recipe 48) */
  renderer?: any;
  /** Style pack (looks only: materials, sky, lighting, post, UI look), a pack you made or installed (import basePack from 'your-pack'), or a list of parts
   * deep-merged left to right: [basePack, { sky: { sunSize: 600 } }]. Without one: neutral gray placeholders */
  style?: StyleInput;
  /** Real-time shadows, default true */
  shadows?: boolean;
  /** Shadow filter: 'basic' (hard edge) | 'pcf' | 'vsm' (softest, costliest), default 'pcf'. Change later with engine.look.shadow.set({ type }) */
  shadowType?: 'basic' | 'pcf' | 'vsm';
  /** MSAA anti-aliasing (kept with post effects on), default style.antialias, else on for desktop and off for low-tier devices */
  antialias?: boolean;
  /** Turn style post effects on or off by name at startup, e.g. { bloom: false }; default: each effect's own setting (costly ones off on low-tier devices) */
  post?: Record<string, boolean>;
  /** Render resolution, default min(device pixel ratio, 1.5); the low tier uses at least 0.75 x device pixel ratio (never below 1). describe().render.scale reports it */
  pixelRatio?: number;
  /** Automatically lower resolution when the frame rate is too low, default true. Never silent: a dev warning once, and describe().render.scale.autoLowered */
  adaptiveResolution?: boolean;
  /** Target frame rate for automatic resolution lowering, default 55 */
  targetFps?: number;
  /**
   * UI parts: replace or turn off any piece of screen UI (loading, toast, title, hud.marker, hud.counter, hud.bar). Default title screen is off.
   * @example createEngine({ canvas, ui: { loading: { title: 'My Game' }, title: { title: 'My Game' }, toast: false } })
   */
  ui?: Record<string, UIPartValue>;
  /** Volume of each channel, 0–1 */
  audio?: AudioConfig;
  /** Camera field of view (degrees), default 55 */
  fov?: number;
  /** Camera near clipping plane (meters), default 0.3 */
  near?: number;
  /** Default fog distance (meters), default 600 */
  fogFar?: number;
  /** UI language: 'auto' (default) follows the browser (a language starting with zh gives 'zh-CN', anything else 'en'); or force 'zh-CN' | 'en' | your own */
  locale?: string;
  /** Override / add UI strings: { 'zh-CN': { key: text } } */
  strings?: StringTables;
  /**
   * Keys per action: changes the neutral defaults (move / confirm / cancel) and binds gameplay actions, e.g. { interact: ['KeyE'], run: ['ShiftLeft'] };
   * a module's define() keeps these keys
   */
  bindings?: Record<string, string[]>;
  /** Default gamepad buttons: { jump: 'PadA' } */
  padBindings?: Record<string, string>;
  /** Save name prefix; must differ when several games share one site, default 'game' */
  saveKey?: string;
  /** On-screen joystick: 'auto' (only on touch devices) | true | false */
  joystick?: 'auto' | boolean;
  /**
   * Headless mode: no real-time loop and no per-frame rendering, advances only on step() (for tests and screenshots). Adding ?threedog-headless to the
   * URL also turns it on
   */
  headless?: boolean;
  /**
   * Check parameter names at runtime and warn on misspelled names (the console prints "did you mean xxx"), default true; a release build can write false
   * to turn it off
   */
  validate?: boolean;
  /**
   * Directory of Draco/KTX2 decoders (a URL containing draco/ and basis/), for when they live on a CDN. Normally not needed: the decoders bundled with
   * three are packed by vite automatically
   */
  decoders?: string;
  /** Performance budget limits, e.g. { drawCalls: 250, fps: 55 }; only the given categories are checked; off by default */
  budget?: BudgetLimits;
  /** Set up a scenario from URL parameters (?time=18:30&weather=rain&pos=40,-20), default on only in development */
  urlState?: boolean;
  /** Seed for engine.random; default 1 in headless mode (reproducible), the current time for live runs (different every game) */
  seed?: number;
  /**
   * Shared "can walk there" parameters (meters / degrees): collision, the Rapier capsule, navigation and level steps all read them by default. Default {
   * radius: 0.4, height: 1.8, maxSlope: 48, stepHeight: 0.45 }
   */
  movement?: Partial<MovementProfile>;
  /**
   * Worker pool size for engine.threads: 'auto' (default: cores - 1, at most 4), a worker count, or false (all on the main thread, same results, no
   * workers created) @experimental
   */
  threads?: 'auto' | number | false;
  /** Gameplay waits while the window is in the background or the tab is hidden; default true (engine.page) */
  pauseOnBlur?: boolean;
  /** false: no default lights in the scene at all (engine.lights.sun / hemi still exist, detached, so sky and describe never see undefined); the game adds its own. Default true */
  lights?: boolean;
  /** Automatic instancing of repeated static models (engine.batching): false turns it off; default { minCount: 8, cell: engine.stream.cellSize } */
  batching?: false | BatchingOptions;
}

/**
 * engine.movement (read-only): character radius / height / max slope (degrees) / step height; slopeRatio is maxSlope converted to height difference /
 * horizontal distance
 */
export interface MovementProfile { radius: number; height: number; maxSlope: number; stepHeight: number; readonly slopeRatio: number }

// ======================================================================
// Rays engine.raycast / pick / rays
// ======================================================================

/** Parameters of engine.raycast() */
export interface RaycastOptions {
  /** Maximum distance (meters), default unlimited */
  far?: number;
  /**
   * What to hit: 'static' registered static objects (default) | 'all' plus what modules merge in (with rigid installed this includes rigid bodies, hits
   * carry entry and kind: 'rigid') | an array of objects
   */
  targets?: 'static' | 'all' | Object3D[];
  /** Hits for which this returns false are skipped */
  filter?: (hit: RayHit) => boolean;
  /** Hit only meshes that block the camera (level buildings, hidden col_ collision meshes); used by collision's cameraOcclusion */
  occluders?: boolean;
}
/**
 * Ray hit: point is the hit point, distance in meters, normal the surface direction, object the mesh hit; entry/kind come from the module that merged
 * the hit in (e.g. a rigid body)
 */
export interface RayHit {
  point: Vector3;
  distance: number;
  normal: Vector3 | null;
  object: Object3D | null;
  face: any;
  entry?: any;
  kind?: string;
  /**
   * Point -> thing, computed when read: the world record the hit belongs to (a batched instance resolves to its original), where it was authored and
   * what to edit.
   * @example const t = engine.pick(0, 0)?.thing;   // { id: 'chest-home', kind: 'chest', template: 'chest', definedAt: 'content/props.js:14', ... }
   */
  readonly thing?: HitThing;
}
/** One reason an object is not (or may not be) drawn: level 'hidden' stops it being seen, 'maybe' may explain an odd look (engine.inspect.scene) */
export interface SceneReason { code: string; level: 'hidden' | 'maybe'; text: string; fix?: string }
/** engine.inspect.scene() result */
export interface SceneInspect {
  camera: { position: { x: number; y: number; z: number }; near: number; far: number } | null;
  counts: { total: number; drawn: number; notDrawn: number; byType: Record<string, number> };
  items: { name: string | null; type: 'Mesh' | 'Points' | 'Line' | 'Sprite'; path: string; id: number; position: { x: number; y: number; z: number }; radius: number | null;
    material: { type: string; purpose: string | null } | null; visible: boolean; drawn: boolean; reasons?: SceneReason[] }[];
  /** objects left out by limit */
  truncated: number;
  text: string;
}
/** engine.thing(id): a HitThing with the registry fields always present */
export interface Thing extends HitThing {
  id: string; owner: string; at: string | null; phase: 'setup' | 'play'; saved: 'record' | 'code' | 'session' | 'engine'; keeps: string[]; loses: string[];
  /** the live object (the record's current model, null when not built) */
  readonly object: Object3D | null;
  /** everything about this id in one JSON-able object: definition file:line, template, model, materials, state, collision rules, related ops, save status, how to change it. Not engine.explain(): that answers "why can this op / quest not run" (recipes/41 section 6) */
  explain(): ThingExplanation;
}
/** What thing.explain() returns (`threedog thing <id>` prints the same JSON); modules add keys to rules / state through their explainers */
export interface ThingExplanation {
  id: string; kind: string; owner: string;
  /** at: 'content/props.js:14' (null in release builds and for code without a file) */
  definition: { at: string | null; template: string | null; templateAt: string | null; level?: string; node?: string; spawned?: boolean; [k: string]: any };
  model: string | null;
  materials: ({ role: string | null; name: string | null; from: string | null; keys: string[]; type: string; color: string | null; mesh: string | null } | { more: number })[];
  state: { position?: number[]; visible?: boolean; scale?: number[]; [k: string]: any };
  rules: { height?: number; blocksMovement?: any; pickable?: boolean; interact?: any; [k: string]: any };
  ops: { op: string; desc: string | null; args: any }[];
  saved: { tier: 'record' | 'code' | 'session' | 'engine'; keeps: string[]; loses: string[]; overridden?: boolean; removed?: boolean };
  change: { runtime: string; permanent: string; diagnostic: string };
  overrides?: any[];
}
/**
 * What a ray hit is (RayHit.thing, engine.inspect(id).thing; engine.thing gives the same plus owner / saved): the world record it belongs to, else the
 * engine.add object. id is null for an object neither knows (engine.scene.add: only mesh and material are known then)
 */
export interface HitThing {
  id: string | null;
  kind: string | null;
  /** template name when the record is a content template instance */
  template: string | null;
  /** 'content/props.js:14' in dev and test builds (null in release, or when not from a content file) */
  definedAt: string | null;
  /** where the template itself is defined ('content/templates.js:3') */
  templateAt?: string | null;
  /** a level-model node record: level file name and node name */
  level?: string;
  node?: string;
  /** a record made during play: the op that made it and the tick */
  spawned?: { op: string | null; tick: number };
  model: any;
  mesh?: string | null;
  material?: string | null;
  position?: { x: number; y: number; z: number };
  /** the record's own fields (state you can change with world.set or an op) */
  fields: Record<string, any>;
  /** one sentence: where to change it for good */
  edit: string | null;
  /** who manages it: 'game' (engine.add), 'world' (a record), 'level' / 'stream' / 'engine:<module>' (engine internals) */
  owner?: string;
  /** dev: 'main.js:50' where engine.add was called (a record: where it was authored); null in release */
  at?: string | null;
  /** 'setup' (before engine.ready or in session:start) or 'play' (with op / tick) */
  phase?: 'setup' | 'play';
  op?: string | null;
  tick?: number;
  /** how much a save keeps (recipe 41): record = world save; code = thing.set / thing.remove overrides; session = nothing; engine = its module's business */
  saved?: 'record' | 'code' | 'session' | 'engine';
  /** what a save keeps / loses, in words */
  keeps?: string[];
  loses?: string[];
  /** removed with thing.remove (held for undo) */
  removed?: boolean;
}
/** A module merging in hits: (origin, direction, max distance) => hit or null */
export type RayProvider = (origin: Vector3, dir: Vector3, far: number) => RayHit | null;

/** createEngine({ batching }) options */
export interface BatchingOptions {
  /** Same geometry + material at least this many times in one cell becomes one InstancedMesh (default 8) */
  minCount?: number;
  /** Cell edge in meters that batches are split by (frustum culling, unloading); default engine.stream.cellSize */
  cell?: number;
}
/** engine.batching.stats */
export interface BatchingStats {
  /** InstancedMesh batches drawn */
  batches: number;
  /** Meshes drawn through them */
  instances: number;
  /** Draw calls saved per pass (instances - batches) */
  saved: number;
}
/** One entry of engine.batching.batches */
export interface BatchInfo {
  /** The batch (a real THREE.InstancedMesh) */
  mesh: any;
  /** Cell key 'cx,cz' */
  cell: string;
  /** Instances in use */
  count: number;
  /** items[i] is the placed object drawn by instance i */
  items: Object3D[];
}

// ======================================================================
// Frame-spread jobs engine.jobs, stream-in engine.stream, startup timing
// ======================================================================

/** Parameters of engine.stream.add(): position is the location, radius the size (meters), build generates (may be async), dispose unloads */
export interface StreamEntryOptions {
  /** Position (Vector3 / object / [x, y, z] / { x, z }; only the horizontal coordinates count) */
  position: PositionLike;
  /** Object size (meters); larger ones are built earlier */
  radius?: number;
  /** Generate the object (called when entering range, run spread over frames through engine.jobs) */
  build: () => Object3D | Promise<Object3D>;
  /** Unload (called when leaving range), default engine.remove (full removal); write your own when the object is reused (e.g. engine.detach) */
  dispose?: (obj: Object3D) => void;
  /** Do not unload even when out of range */
  keep?: boolean;
  /** Build order: larger first (nearer first within the same priority), default 0 */
  priority?: number;
}
/** Options of engine.stream.source() */
export interface StreamSourceOptions {
  /** Reach in meters: caps every loader's range around this source (default: each loader's own range) */
  radius?: number;
  /** 'full' (default): models, stream entries, terrain, colliders; 'simple': terrain and hlod proxies only (a far view) */
  detail?: 'full' | 'simple';
  /** Build colliders around it (default true for 'full'); false for a camera that only needs a picture */
  physics?: boolean;
  /** Removed automatically when this Promise settles, or when this function returns true (checked every frame) */
  until?: Promise<unknown> | (() => boolean);
  /** Label for describe and errors */
  name?: string;
}
/** A stream source returned by engine.stream.source() (also engine.stream.player / engine.stream.camera) */
export interface StreamSource {
  name: string;
  radius: number | null;
  detail: 'full' | 'simple';
  physics: boolean;
  /** Current horizontal position */
  readonly x: number;
  readonly z: number;
  /** Everything this source asks for is loaded (checked at the end of each frame) */
  readonly ready: boolean;
  /** Resolves when ready becomes true */
  readonly whenReady: Promise<void>;
  /** Move the source (a live Object3D / Vector3, a function returning a position, or a fixed position) */
  at(position: PositionLike | (() => PositionLike)): this;
  /** A loader's range for this source: the loader's own range, capped by the source radius */
  reach(range: number): number;
  /** Stop loading for this source */
  remove(): void;
}
/** Handle returned by stream.add(): object is the generated object (null while not generated) */
export interface StreamHandle { def: StreamEntryOptions; object: Object3D | null; built: boolean; remove(): void }
/**
 * Startup timing (milliseconds): totalMs page open to playable, startMs start() to playable, preloadMs preloading, streamMs the nearby builds required
 * by stream registrations finished, compileMs shader compilation before the first frame,
 * modules is the init / ready time of each module. With a budget on and startupMs (open to playable) / moduleMs (a single module) given, the slowest
 * module is reported in the console when exceeded
 */
export interface StartupReport {
  totalMs: number; startMs: number; preloadMs: number; streamMs: number | null; compileMs: number; modules: Record<string, { init?: number; ready?: number }>;
}

// ======================================================================
// Setting up a scenario engine.applyState
// ======================================================================

/** Scenario parameters (can also go in the URL: ?time=18:30&weather=rain&pos=40,-20&cutscene=skip&state=name) */
export interface StateParams {
  /** A group of parameters named with defineState */
  state?: string;
  /** Time of day: 'HH:MM' or 0–1 */
  time?: string | number;
  /** Season name from sky({ seasons }): jumps sky.day to that season's first day (time of day kept) */
  season?: string;
  /** Weather name */
  weather?: string;
  /** Player position: 'x,z' or a position (sets the focus when there is no player) */
  pos?: string | PositionLike;
  /** Which save slot to load */
  save?: string;
  /** How many seconds to advance (fixed-step seconds, not multiplied by clock.timeScale) */
  wait?: number;
  /** Opening cutscene: 'skip' skips it | 'keep' plays it as usual */
  cutscene?: 'skip' | 'keep';
}

/** A claim on something only its owner releases (pause, freeze, takeCamera, views) */
export interface OwnerHandle { owner: string; remove(): void }
/** What pause / freeze return: the claim handle, plus the old chaining calls forwarded to the engine */
export interface ChainedHandle extends OwnerHandle {
  pause(owner?: string | { owner?: string; kind?: 'test' }, opts?: { kind?: 'test' }): ChainedHandle;
  resume(owner?: string | { owner?: string }): Engine;
  freeze(owner?: string | { owner?: string; kind?: 'title' }, opts?: { kind?: 'title' }): ChainedHandle;
  unfreeze(owner?: string | { owner?: string }): Engine;
  step(seconds: number, opts?: { render?: boolean; frameEvery?: number; describe?: boolean }): GameState | null;
}
/** engine.runState: state in one word, by = every pause / freeze owner, blockedBy = opaque input contexts plus 'error' / 'loading' */
export interface RunState { state: 'loading' | 'title-frozen' | 'test-paused' | 'paused' | 'running'; by: string[]; blockedBy: string[] }
/** Camera takeover: when non-null no camera module moves the camera (for cutscenes); see engine.takeCamera */
export interface CameraOverride {
  /** Who took over (any name) */
  owner: string;
  /** Optional: where the world loads around */
  focus?: Vector3;
  [key: string]: any;
}
/** State of automatic resolution */
export interface AdaptiveState { paused: boolean; on: boolean; target: number; min: number; max: number; /** true once the render scale was lowered below max (a dev warning was logged) */ lowered?: boolean; [key: string]: any }

// ======================================================================
// Look parts engine.look.<part> (recipes/52-look.md)
// ======================================================================

/** Returned by set / patch / replace: remove() takes that owner's layer back off */
export interface LookHandle { remove(): void }
/** engine.look.post: a LookPart with add() for one custom pass */
export interface LookPost extends LookPart {
  /** Add ONE custom post pass (name, create | fuse, slot, order, params) without replacing the chain; remove() takes it out again. Slot, order and depth-order errors throw and add nothing. Change its params with set({ '<name>.<param>': v }) */
  add(effect: PostEffect, opts?: LookOptions): LookHandle;
}
/** owner: who writes the layer (non-empty name, default 'game'); roles: only materials.patch, the material roles that get the patch */
export interface LookOptions { owner?: string; roles?: string[] }
/** patch(name, spec): a spec instead of plain GLSL. post: fuse snippet (glsl, slot, order, uniforms, values); sky 'layer:<name>': glsl, blend, order, uniforms */
export interface LookPatchSpec {
  glsl?: string | Record<string, any>;
  /** post: 'hdr' | 'ldr' */
  slot?: string;
  /** post and sky layers: draw order, smaller first */
  order?: number;
  uniforms?: Record<string, any>;
  /** post: live values of the generated effect */
  values?: Record<string, any>;
  /** sky layer: 'mix' | 'add' */
  blend?: string;
}

/**
 * One look part. Layers, upper wins: engine default < style < game (per owner, last write wins) < engine.debug.override.
 * A part offers only the verbs that make sense for it; the others throw naming the verb to use.
 */
export interface LookPart<P = Record<string, any>> {
  /** 'look.<part>': the id engine.catalog() and debug.override use */
  readonly id: string;
  /** Shallow-merge into the owner's layer, only the keys given; null drops a key so the layer below shows again. Keys that recompile shaders warn once in dev */
  set(params: { [K in keyof P]?: P[K] | null } & Record<string, any>, opts?: LookOptions): LookHandle;
  /** Swap one named GLSL hook the part registered (names: engine.catalog('look.<part>').hooks); the same name again overrides; patch(name, null) restores the default */
  patch(name: string, glsl: string | LookPatchSpec | null, opts?: LookOptions): LookHandle;
  /** Take the whole part over (Material, texture, object, effect list ...: see the catalog); replace(null) gives it back. materials.replace takes the role first */
  replace(impl: any, opts?: LookOptions): LookHandle;
  replace(role: string, impl: any, opts?: LookOptions): LookHandle;
  /** Drop every game and debug layer of that owner (the style value shows again); returns how many layers were removed, like engine.debug.clear */
  clear(owner: string): number;
  /** The resolved value of a key (what is in use now) */
  value(key: string): any;
  /** The value from the highest game / debug layer for the key (undefined when only style or default gives it) */
  top(key: string): any;
  /** The three.js object(s) behind the part (renderer, lights, scene.fog ...); changing it directly works but describe tags it 'three'.
   *  look.materials: a function, object('wool') = the last Material made for that role, object() = all of them */
  readonly object: any;
  /** Each verb's call shape, e.g. { set: 'set(params, { owner })', replace: 'replace(role, ...)' } (also in engine.catalog('look.<part>')) */
  readonly signatures: Record<string, string>;
  // ---- for authors of a part made with defineLookPart (recipes/52-look.md) ----
  /** Write raw keys (params, 'hook:<name>', '@replace') for an owner, no normalize; null drops a key */
  write(owner: string, values: Record<string, any>, opts?: { layer?: 'game' | 'debug' }): LookHandle;
  /** What one owner holds for a key, or undefined */
  ownerValue(owner: string, key: string, opts?: { layer?: 'game' | 'debug' }): any;
  /** Add declared keys to a started part (same fields as defineLookPart params) */
  extend(params: Record<string, any>): void;
  /** Remove every key starting with prefix, with every layer's value for them */
  retract(prefix: string): void;
  /** Is key a declared param */
  has(key: string): boolean;
  /** [key, value] pairs in effect whose key starts with prefix */
  resolved(prefix?: string): Array<[string, any]>;
  /** Replace the style layer */
  restyle(values: Record<string, any>): void;
  /** Declare keys a style-driven system writes every frame (by = the driver's module name); drive(keys, null) hands them back */
  drive(keys: string[], by: string | null): void;
  /** Unregister the part (its module went away) */
  dispose(): void;
}

export interface LookTone { mapping: string; exposure: number | Array<[number, number]> | ((t: number) => number) }
export interface LookLightSide { color?: ColorLike; intensity?: number }
export interface LookLights { sun: LookLightSide | 'manual' | false; hemi: LookLightSide | 'manual' | false }
/** The map itself is the replace slot: look.env.replace('sky' | Texture | null) */
export interface LookEnv { intensity: number; rotation: number; interval: number }
export interface LookFog { kind: string; color: ColorLike | 'horizon'; density: number; near: number; far: number; height: number; falloff: number; enabled: boolean }
export interface LookSky { clouds: Record<string, any>; backdrop: ColorLike | null }
export interface LookShadow {
  type: 'basic' | 'pcf' | 'vsm'; radius: number; blurSamples: number; bias: number; normalBias: number; mapSize: number; updateEvery: number;
  snap: number | 'texel'; ahead: number; cascades: number; maxFar: number; fade: boolean; lightMargin: number; enabled: boolean;
  split: 'practical' | 'uniform' | 'logarithmic' | ((count: number, near: number, far: number, out: number[]) => void);
}
export interface LookCloudShadow { shadow: number; scale: number; speed: [number, number] }
export interface LookWind { frequency: number; amplitude: number }
export interface LookGround {
  colors: Record<string, ColorLike>; biomeColors: Record<string, string | string[]>; steep: Array<{ maxNormalY: number; colors: any }>;
  variation: any; detail: any; shading: string;
}
export interface LookSurface { lighting: Record<string, any>; detail: Record<string, any>; ramp: number[]; soften: number }
export interface LookWater {
  color: ColorLike; opacity: number; depthColor: { shallow?: ColorLike; deep?: ColorLike }; foam: Record<string, any>;
  waveHeight: number; waveScale: number; waveSpeed: number; fresnel: number;
}

/** engine.look: the parts by name. A part exists only when the module that provides it is installed (fog / sky / shadow / env: sky(); ground: terrain(); wind: vegetation(); water; weather) */
export interface Look {
  tone: LookPart<LookTone>;
  lights: LookPart<LookLights>;
  cloudShadow: LookPart<LookCloudShadow>;
  /** Old name of cloudShadow (recipes/52-look.md, Old names) */
  clouds: LookPart<LookCloudShadow>;
  env: LookPart<LookEnv>;
  fog: LookPart<LookFog>;
  sky: LookPart<LookSky>;
  shadow: LookPart<LookShadow>;
  /** Roles are the keys: set({ wool: { roughness: 0.4 } }), patch(name, spec, { roles }), replace('wool', Material | fn) */
  materials: LookPart<Record<string, Record<string, any>>>;
  surface: LookPart<LookSurface>;
  ground: LookPart<LookGround>;
  wind: LookPart<LookWind>;
  water: LookPart<LookWater>;
  /** Keys 'rain.speed', 'snow.size', 'lightning.brightness', overcastColor ...; patch('rain.fragment', wholeShaderText) */
  weather: LookPart;
  /** Per effect: set({ bloom: { strength: 0.6 }, vignette: false }); patch(name, { glsl, slot, order, uniforms, values }); add(effect, { owner }); replace([effects]) */
  post: LookPost;
  /** Parts made with defineLookPart */
  [custom: string]: LookPart;
}

/**
 * The engine. Created by createEngine({ canvas, style }); engine.use(module...) installs modules, engine.start() starts it.
 * Installed modules hang on the engine (engine.terrain, engine.sky...); modules not installed are undefined, check with engine.xxx?.method().
 */
export declare class Engine {
  constructor(opts: EngineOptions);

  // ---------- Core objects ----------
  /** three.js (a game can also import { THREE } from 'threedog' directly) */
  THREE: typeof import('three');
  /** Style pack */
  style: Style;
  /** three.js renderer */
  renderer: import('three').WebGLRenderer;
  /** Device tier: 'low' (phones, integrated graphics) | 'high' */
  tier: 'low' | 'high';
  /** three.js scene */
  scene: import('three').Scene;
  /**
   * Default lights (neutral without sky; the sky module drives these same two). Hide or retune them for your own lighting: `engine.lights.sun.visible =
   * false`
   */
  lights: { sun: import('three').DirectionalLight; hemi: import('three').HemisphereLight };
  /** three.js perspective camera */
  camera: import('three').PerspectiveCamera;
  /**
   * Camera focus, updated every frame by the camera module: terrain, models etc. load around it. The center of gameplay simulation is world.anchor (the
   * player by default), which does not follow the camera
   */
  focus: Vector3;
  /** Whether shadows are on */
  shadows: boolean;
  /** Shadow filter in use; change it with look.shadow.set({ type }) */
  shadowType: 'basic' | 'pcf' | 'vsm';
  /** Current ground */
  ground: Ground;
  /**
   * Shared parameters for whether a character can walk somewhere (set by createEngine({ movement }), read-only); same-named options of individual
   * modules are only overrides
   */
  readonly movement: Readonly<MovementProfile>;
  /**
   * The player (exists only after characters.createPlayer()). Its position belongs to the character's mover: other systems request movement (placeAt /
   * move / vehicle enter), don't modify position directly
   */
  player: Character | null;
  /**
   * World record id of the one the local user controls (default 'player'): interactions, trigger zones, marker distances, the world simulation center
   * and ops (ctx.actor) use it. Set it to hand control to a vehicle or squad member
   */
  actor: string;
  /**
   * Where an actor is now (default engine.actor): the player's position for 'player' (engine.focus without a player), else its model or world record
   * position; null when unknown. @example engine.actor = 'boat_1'; engine.actorPosition()
   */
  actorPosition(id?: string): { x: number; y: number; z: number } | null;
  /** True once start() completes and the loading screen is gone (every "is it ready" in the engine is such a boolean property) */
  ready: boolean;
  /** True after dispose() */
  readonly disposed: boolean;
  /** Execution order of module hooks (module names, first -> last), for debugging "who runs before whom" */
  readonly moduleOrder: string[];
  /**
   * Where each module is: 'registered' (init not started), 'initializing', 'running', 'failed' (init threw: its hooks never run) or 'disposed'.
   * A module installed after start() runs no fixed / frame hook until it is 'running'; `await engine.loading.settled()` waits for that
   */
  readonly moduleStates: Record<string, 'registered' | 'initializing' | 'running' | 'failed' | 'disposed'>;
  /**
   * What this game can do, read from the existing registrations (modules, ops, save parts, describe, params schemas).
   * No argument: short list; a module id / op name: that entry expanded (null if unknown); { find }: the short list filtered. recipes/51-capability-catalog.md
   * @example engine.catalog('shop').ops[0].failures   // ['soldOut', 'noMoney']
   */
  catalog(id?: string | { find?: string }): any;
  /**
   * Gameplay error in development / testing (module hooks, onFixed / onFrame / clock callbacks, event listeners): { where (location of the error),
   * message }, gameplay is frozen; null when there is no error. A release build does not freeze, it reports once in the console
   */
  readonly error: EngineError | null;
  /** Names of presentation modules disabled after an error (modules with presentation: true) */
  readonly disabledModules: Set<string>;
  /**
   * The engine's cancel signal (AbortSignal): for DOM listeners write addEventListener(type, fn, { signal: engine.signal }), removed automatically on
   * dispose()
   */
  readonly signal: AbortSignal;
  /** UI root node: UI elements of the engine and modules hang under it (don't attach to document.body directly), the whole tree is removed on dispose() */
  readonly uiRoot: HTMLDivElement;
  /** Base fog distance (meters) */
  fogFar: number;
  /** Installed modules: name -> module definition */
  modules: Map<string, ModuleDef>;
  /** Standalone water bodies (lakes, ponds) */
  waterBodies: WaterBody[];
  /** Event bus */
  events: Events;
  /** i18n */
  i18n: I18n;
  /** Saves */
  saves: Saves;
  /** New game / continue / back to title, each from a clean slate (engine.session.newGame(), load(slot), quit()) */
  session: Session;
  /** Window focus, tab visibility, mouse lock, WebGL context: the one place that listens to them */
  page: Page;
  /** Input */
  input: Input;
  /** Audio */
  audio: Audio;
  /** Assets */
  assets: Assets;
  /** Observable loading: every asset load, module init / isReady and track() step as a task (phase, error, source manifest) */
  readonly loading: Loading;
  /** Post-processing: named effects in slots (add / get / enable / list) */
  post: PostFX;
  /** Every look in one place: engine.look.<part>.set / patch / replace (recipes/52-look.md) */
  look: Look;
  /** UI parts: every piece of screen UI is replaceable or off (see recipes/26-ui-parts.md) */
  ui: UIParts;
  /** Automatic resolution state */
  adaptive: AdaptiveState;
  /**
   * Main-thread CPU milliseconds of the last real-time frame: input, fixed steps, frame hooks, render submission and afterRender hooks
   * (not GPU time, not the wait for the next frame). Only the real-time loop updates it; step() does not.
   */
  cpuMs: number;
  /** cpuMs split by phase (last frame): fixed = input + fixed steps, frame = frame hooks incl. stream / jobs, render = draw submission, afterRender = its hooks */
  cpuPhases: { fixed: number; frame: number; render: number; afterRender: number };
  /** The camera holder in charge (latest engine.takeCamera claim), null when nobody holds it. Assigning { owner } / null is the old alias of takeCamera */
  cameraOverride: CameraOverride | null;
  /** Take the camera over (camera modules leave it alone) until remove(); the latest holder is in charge, releasing hands it back to the previous one */
  takeCamera(owner: string | ({ owner: string } & Partial<CameraOverride>), opts?: Partial<CameraOverride>): OwnerHandle;
  /** Why the page is (not) advancing; the dev bridge and MCP tools copy it as-is */
  readonly runState: RunState;
  /** Draco/KTX2 decoder directory */
  decoders: string;
  /** Game clock: game seconds now, after / every (clock-time / season timers are on engine.sky) */
  clock: Clock;
  /** Story flags and counters (autosaved) */
  vars: Vars;
  /** Performance budget (off by default) */
  budget: Budget;
  /** Ray registry (what engine.raycast hits) */
  rays: Rays;
  /** Frame-spread job scheduler */
  jobs: Jobs;
  /** Background results that affect gameplay take effect on a fixed tick (chunk collision, spread jobs with apply...), see Commits */
  commits: Commits;
  /**
   * Worker pool (createEngine({ threads })): lane() for your own worker script, pure() for self-contained functions, array() for shared typed arrays.
   * Results that affect gameplay go through commits @experimental
   */
  threads: Threads;
  /** One entry point for actions players and NPCs decide to do: define / run / can / list / recent, see Ops and recipes/23-ops.md */
  ops: Ops;
  /** Named fixed camera views for repeatable screenshots: define / show / release (recipes/46-blender-art-route.md) */
  views: Views;
  /** Fixed-step count (the gameplay timeline: does not advance while frozen; commits due times, event history and the operation log use it) */
  readonly tick: number;
  /** Seeded random numbers (use for gameplay randomness: reproducible and saved with the game) */
  random: Random;
  /**
   * Spatial stream-in and the stream sources (where the world is loaded: terrain, colliders, models, stream entries; built-in player and camera sources,
   * add one for a teleport destination)
   */
  stream: Stream;
  /** Automatic batching: the same static model placed many times in a cell is drawn as one InstancedMesh (createEngine({ batching })) */
  batching: Batching;
  /** Startup timing report (null until start() completes) */
  startup: StartupReport | null;
  /**
   * Run seconds: unaffected by the sky time scale, does not advance while frozen or paused; for presentation animation (swaying, floating).
   * The other two "times": game seconds engine.clock.now (= fixed-step seconds x clock.timeScale, saved); sky time of day engine.sky.timeOfDay (0–1,
   * one day = dayLength game seconds)
   */
  readonly elapsed: number;
  /**
   * This engine's shader uniforms, read by the built-in effects (wind, clouds, season, water, sky, rain). Share these objects in your
   * own ShaderMaterial or patch instead of making your own uTime. Weather and sky write them; uTime follows engine.elapsed.
   * @example
   * new THREE.ShaderMaterial({ uniforms: { uTime: engine.uniforms.uTime }, vertexShader, fragmentShader });
   */
  readonly uniforms: EngineUniforms;
  /** Global water level (meters); -Infinity when there is no water */
  readonly waterLevel: number;

  // ---------- Modules (undefined when not installed) ----------
  /** Procedural terrain (terrain() module) */
  terrain?: Terrain;
  /** Vegetation (vegetation() module; grows on terrain or on any ground provider) */
  vegetation?: Vegetation;
  /** Sky, day/night, calendar (sky() module) */
  sky?: Sky;
  /** Weather (weather() module, needs sky) */
  weather?: Weather;
  /** Water surface (water() module) */
  water?: Water;
  /** World data (world() module): things that must be saved, survive level changes and keep changing while far away; the model is built only when nearby */
  world?: World;
  /** Co-op multiplayer (net() module): host authority, clients mirror the state and request ops; see recipes/27-net.md @experimental */
  net?: Net;
  /** Placement grids: world <-> cell, occupancy derived from world records, per-cell layers, placement preview (grids() module) @experimental */
  grids?: Grids;
  /** Lightweight collision (collision() module): no clipping while walking, the camera is not blocked */
  collision?: Collision;
  /** Real physics, Rapier (rigid() module, needs collision) */
  rigid?: RigidBodies;
  /** Current camera (one of followCamera / firstPersonCamera / fixedCamera / rtsCamera) */
  cameraRig?: CameraRig;
  /**
   * Switch the camera at runtime (only exists with a camera module installed): the target and horizontal heading carry over; the first-person camera
   * hides the character body automatically (the shadow stays) and locks / releases the mouse; the camera switched out is kept, with its parameters, for
   * switching back.
   * Passing opts rebuilds this kind of camera with the new parameters. A wrong kind throws and lists the available options.
   * @example engine.onFrame(() => { if (engine.input.pressedRaw('toggleView')) engine.setCamera(engine.cameraRig.kind === 'follow' ? 'firstPerson' :
   * 'follow'); });
   */
  setCamera?(kind: CameraKind, opts?: object): CameraRig;
  /** Cutscenes, tweens (timeline() module) */
  timeline?: Timeline;
  /** Hand-built level (level() module) */
  level?: Level;
  /** Trigger zones (triggers() module) */
  triggers?: Triggers;
  /**
   * Entities: single stateful, saved objects such as saplings, campfires and chests; the data is a record of engine.world, the model is built only when
   * nearby (entities() module)
   */
  entities?: Entities;
  /** Particles (particles() module) */
  particles?: Particles;
  /** Settings menu (settings() module) */
  settings?: Settings;
  /** Background music (music() module) */
  music?: Music;
  /** Characters: createPlayer() (characters() module) */
  characters?: CharactersApi;
  /** NPC management (characters() module, npcs on by default) */
  npcs?: NPCManager;
  /** Interaction prompts (interactions() module) */
  interactions?: Interactions;
  /** Dialogue (dialogue() module) */
  dialogue?: Dialogue;
  /** Inventory (inventory() module) */
  inventory?: Inventory;
  /** Quests (quests() module) */
  quests?: Quests;
  /** Photo mode (photo() module) */
  photo?: Photo;
  /** Ambience (ambience() module) */
  ambience?: Ambience;
  /** Diagnostic overrides and view modes with an owner (override / clear / view: core, always there); panel is the F3 panel, null without the debug() module */
  debug: DebugOverrides & { panel: DebugPanel | null };
  /** Navmesh (nav() module) */
  nav?: Nav;
  /** HLOD, merged distant geometry (hlod() module) @experimental */
  hlod?: Hlod;
  /** Light pool: many light sources, a fixed number of real lights (lightPool() module) */
  lightPool?: LightPool;
  /** Content loading (content() module) */
  content?: Content;
  /** Game flow and scene transitions (flow() module) */
  flow?: Flow;
  /** Objective markers, counters, progress bars (hud() module) */
  hud?: Hud;

  // ---------- Module system ----------
  /** Install one or more modules (in order; dependencies must be installed first) */
  use(...mods: ModuleInput[]): this;
  /** Whether a module is installed */
  has(name: string): boolean;

  /** Material by role from this engine's style pack: engine.makeMaterial('prop', { color: 0x8a5a36 }) */
  makeMaterial(purpose?: string, params?: { color?: ColorLike, [prop: string]: any }): Material;

  // ---------- Ground ----------
  /** Set the ground (called by the terrain and level modules); missing parts fall back to flat ground */
  setGround(g: Partial<Ground>): void;
  /**
   * Ground height (meters) at (x, z); a position or object also works: engine.surface(mesh.position).
   * For multi-layer ground (bridges, caves, interiors) pass a reference height refY: returns the highest layer not above refY + one step (0.45 m), so
   * standing under a bridge gives the ground and standing on it gives the deck;
   * without it the highest layer is used (as before). Procedural terrain and flat ground have one layer and ignore refY.
   * Off the outline of terrain({ shape }) it is -Infinity (no ground there; engine.ground.has(x, z) says so as a boolean)
   */
  surface(x: number, z: number, refY?: number): number;
  surface(at: PositionLike, refY?: number): number;
  /** Slope at (x, z); a position or object also works */
  slope(x: number, z: number): number;
  slope(at: PositionLike): number;
  /** Ground type at (x, z) (for footsteps, particles); a position or object also works. 'void' off the outline of terrain({ shape }) */
  groundType(x: number, z: number): string;
  groundType(at: PositionLike): string;
  /**
   * Water surface height at (x, z): standalone water bodies first, otherwise the global water level; -Infinity when there is no water. A position or
   * object also works
   */
  waterAt(x: number, z: number): number;
  waterAt(at: PositionLike): number;
  /**
   * Put an object on the ground under it (y = ground height + offset) and return the object. With multi-layer ground the object's current y is the
   * reference height
   */
  snapToGround<T = Object3D>(obj: T, offset?: number): T;
  /** Add a water body (give radius for a circle, halfWidth / halfDepth for a rectangle) and return a handle { body, remove() }. The water module draws it */
  addWaterBody(opts: WaterBodyOptions): Handle & { body: WaterBody };

  // ---------- Common ----------
  /** Get UI text (i18n) */
  t(key: string, params?: Record<string, any>): string;
  /**
   * Add objects to the scene and register them (engine.thing), returns the first one. The last argument may be { id?, save? }: id makes thing.set /
   * thing.remove changes saved (unique, no '#', one object per call); without it a unique obj.name is used, else a session id obj#n. save: true asks dev
   * to warn when it cannot be saved. engine.scene.add adds without registering.
   * @example engine.add(windmill, { id: 'windmill' });
   */
  add<T = Object3D>(obj: T, ...more: (Object3D | { id?: string; save?: boolean })[]): T;
  /**
   * What a thing is and what a save keeps: a world record id, an engine.add id or name, or any Object3D (its registered ancestor). object is the live
   * Object3D (not enumerable). Throws with the closest id when nothing matches. Change it with ops.run('thing.set' | 'thing.remove', { id, ... }).
   * @example engine.thing('windmill').saved   // 'code'
   */
  thing(idOrObj: string | Object3D): Thing;
  /**
   * Fully delete an object (use it when you no longer want the object): removes it from its parent, unregisters rays, and releases the geometry and
   * materials of it and its children (textures and geometry / materials shared by assets are not released)
   */
  remove(...objs: Object3D[]): void;
  /** Only take it off its parent without releasing GPU memory (use when you will add it back later). Use remove for objects you no longer need */
  detach(...objs: Object3D[]): void;
  /**
   * Fixed-step logic (60 times per second, dt in fixed seconds): movement, physics, cooldowns, and gameplay keys (read pressed() here: a per-step
   * snapshot, independent of frame rate). Returns a handle { remove() }
   */
  onFixed(fn: (dt: number) => void): Handle;
  /**
   * Once per frame (dt in frame seconds): animation, camera, UI and UI keys (menus read this frame's latest input). Gameplay keys belong in onFixed.
   * Returns a handle { remove() }
   */
  onFrame(fn: (dt: number) => void): Handle;

  // ---------- Settings ----------
  /** Render resolution */
  setPixelRatio(p: number): void;
  /** Shadow toggle */
  setShadows(on: boolean): void;
  /** Fog distance (meters), also adjusts the camera far plane */
  setFogFar(d: number): void;
  /** Exposure per frame from style.exposure / look.tone keyframes or function, null for a plain number; the sky module calls it with engine.sky @readonly */
  exposureDriver: ((sky: any) => number) | null;

  // ---------- Rays, scenarios ----------
  /** Ray: shoot from origin along dir, returns the nearest hit or null (by default only registered static objects are hit) */
  raycast(origin: Vec3Like, dir: Vec3Like, opts?: RaycastOptions): RayHit | null;
  /** Shoot a ray through the camera from screen coordinates (-1..1, e.g. input.pointer.ndcX/ndcY) */
  pick(ndcX: number, ndcY: number, opts?: RaycastOptions): RayHit | null;
  /**
   * New runtime instance of a content template (inside an op or fixed step), saved whole; returns the world record (kind = template name). Needs content().
   * e.g. engine.spawn('chest', { x: 10, z: 4 }, { opened: true })
   */
  spawn(name: string, at: any, fields?: { id?: string; rot?: number; scale?: number; y?: number; items?: Record<string, number>; [stateField: string]: any }): import('./generated/modules/world/World').WorldRecord;
  /** Set up a scenario: time of day, weather, player position, load a save, advance time, skip cutscenes; emits state:applied when done */
  applyState(params: StateParams): Promise<void>;
  /** Name a group of scenario parameters, then use applyState({ state: name }) or URL ?state=name */
  defineState(name: string, params: StateParams): this;
  /**
   * Scenario is ready: start() completed, and the URL parameters / the latest applyState have all been applied. Tests and screenshots wait for it:
   * page.waitForFunction(() => window.engine?.stateApplied)
   */
  readonly stateApplied: boolean;

  // ---------- Start, pause, state ----------
  /** Start: initialize modules, preload assets, wait for the world to be ready */
  start(): Promise<this>;
  /** Whether in headless mode (createEngine({ headless: true })) */
  headless: boolean;
  /** Whether paused (headless mode is paused by default, only step() advances) */
  paused: boolean;
  /** Smoothed frame rate */
  fps: number;
  /** Ids of the open windows */
  openWindows: Set<string>;
  /**
   * Pause the real-time loop: the picture stops and even rendering stops, only step() advances (for tests and screenshots). Use freeze() for a game menu
   * pause
   */
  pause(owner?: string | { owner?: string; kind?: 'test' }, opts?: { kind?: 'test' }): ChainedHandle;
  /** Resume the real-time loop (only this owner's pause) */
  resume(owner?: string | { owner?: string }): this;
  /** Run fn at the start of the next fixed step (via commits); a Promise of fn's value */
  nextFixed<T>(fn: () => T): Promise<T>;
  /**
   * Gameplay pause (menu, flow's paused): fixed steps are skipped entirely (onFixed, module fixed, the game clock and engine.elapsed all stop), frame
   * hooks and rendering continue and the UI works.
   * So gameplay logic (movement, timing, quest checks, cutscene waits) belongs in fixed, or check engine.frozen first in frame. owner is the freezer's
   * name, default 'game'
   */
  freeze(owner?: string | { owner?: string; kind?: 'title' }, opts?: { kind?: 'title' }): ChainedHandle;
  /** Release the freeze of owner (gameplay resumes only when all freezers are released) */
  unfreeze(owner?: string | { owner?: string }): this;
  /** Is anyone freezing gameplay? */
  readonly frozen: boolean;
  /**
   * Advance seconds of fixed-step time synchronously; seconds must be a finite number >= 0: 0 advances nothing (no step, no render),
   * negative or non-finite throws (code step-seconds), any positive value runs at least one fixed step (60Hz; when timeScale is not 1,
   * game seconds clock.now and sky time of day run faster or slower than it;
   * frame hooks run once every frameEvery fixed steps, default 2; describe: false returns null instead of building describe()).
   * jobs ignore real time and finish every frame; results of stream's synchronous build are attached to the scene before returning. When render is true
   * (default) one frame is rendered at the end. Returns the describe() result after advancing
   */
  step(seconds: number, opts?: { render?: boolean; frameEvery?: number; describe?: boolean }): GameState | null;
  /**
   * Skip game time forward (sleep until morning, wait an hour) without stepping every fixed step.
   * clock.after / every, sky.at / daily / between, day:start and season:change fire in time order as if stepped (each crossing once);
   * world records with far catch up the span in one far(rec, dt). onFixed, module fixed hooks, physics and near simulation do not run;
   * engine.elapsed does not move. Input is locked and gameplay frozen during the skip; emits time:skip.
   * fade 0 (default): the time has moved when skip returns. fade > 0: fade out, jump, save, fade in; the Promise resolves after the fade in (it needs frames).
   * session.newGame / load / quit cancel a running skip: it resolves null.
   * @example await engine.skip({ to: '06:00' })
   * @example await engine.skip({ to: '06:00', fade: 0.6, save: 'auto' })
   * @example engine.skip({ seconds: 600 })
   */
  skip(opts: SkipOptions): Promise<{ seconds: number; clock: string | null; day: number | null } | null>;
  /**
   * Consistency check: engine.skip({ seconds }) vs stepping the same span in fixed steps; compares the saved state. Leaves the world at the stepped state (use a scratch playthrough or a test).
   * @param ignore state paths (or prefixes) not to compare
   * @returns a = after skip, b = after stepping
   * @example const r = await engine.checkSkip(600); if (!r.ok) console.log(r.diffs);
   */
  checkSkip(seconds: number, opts?: { ignore?: string[] }): Promise<{ ok: boolean; diffs: { path: string; a: any; b: any }[] }>;
  /**
   * Consistency check: save -> load gives the same saved state back (nothing is written to the browser).
   * @example const r = await engine.checkSave(); if (!r.ok) console.log(r.diffs);
   */
  checkSave(opts?: { ignore?: string[] }): Promise<{ ok: boolean; diffs: { path: string; a: any; b: any }[] }>;
  /**
   * Call engine.describe(opts?: { radius?: number }) to get the current game state (a plain object, JSON.stringify-able); radius is how far counts as
   * "nearby" (meters, default 30).
   * engine.describe.add(name, fn) registers the game's own state in one line: the return value of fn(engine, ctx) goes into describe().<name>, and the
   * returned handle's remove() cancels it.
   * Small games use add; big games write the system as a module and use the module's describe hook. Example: engine.describe.add('range', () => ({
   * score, targets: targets.length }))
   */
  describe: {
    (opts?: { radius?: number; center?: { x: number; z: number } }): GameState;
    add(name: string, fn: (e: Engine, ctx: DescribeContext) => any): { remove(): void };
  };
  /**
   * The same information as English text, summary first: at most 30 lines (standard lines, the 5 nearest things, one line per module with its key
   * counts), ending with how to expand.
   * { path: 'world.byKind' } returns one part of describe() as JSON; { full: true } returns everything (all nearby things, every module's full data).
   * @example engine.describeText()   engine.describeText({ path: 'quests' })   engine.describeText({ full: true })
   */
  describeText(opts?: { radius?: number; full?: boolean; path?: string }): string;
  /**
   * What is around an actor or a spot, and what that actor can do now (each op offer checked with can, possible first, at most 8; failed ones carry
   * reason and the op's reasons note).
   * at: a world record id (that actor), [x, z] / { x, z } (a spot, ops as the player), or nothing (the player). radius default 10 m.
   * @example engine.inspect();            // { actor: 'player', at: { x, z }, near: [...], ops: [{ op: 'shop.buy', args, ok: false, reason: 'noMoney',
   * why: 'Not enough gold' }] }
   * @example engine.inspect('enemy_3');   // why is this enemy not attacking: its ops and their reasons
   * @example engine.inspect('chest-home').thing.definedAt   // 'content/props.js:14': edit that line to change the level for good
   * thing (when at is a record id): the record as a thing to change, with where it was authored (see HitThing).
   */
  inspect: {
    (at?: string | { x: number; z: number } | number[], opts?: { radius?: number }): {
      actor: string; at: { x: number; z: number }; near: any[]; thing?: HitThing;
      ops: { op: string; args: any; ok: boolean; reason?: string; why?: string | null }[];
    };
    /**
     * The mesh exists but is not drawn: use this first. Lists every Mesh / Points / Line / Sprite in the scene (name, type, world position, bounding radius,
     * material type and purpose, visible, drawn) and, for each one that is not drawn, every reason found, most likely first: own or ancestor visible = false,
     * layers not matching the camera, material flags (visible, opacity 0, colorWrite / depthWrite off), scale 0 or NaN, NaN position or vertices, empty geometry
     * or draw range, behind the camera, beyond camera.far, outside the frustum, bounding radius 0 or NaN, swallowed by fog. Computed on call only.
     * hidden: only the objects not drawn. limit: how many to list (default 40; counts cover everything). text is the same thing as lines to read.
     * @example engine.inspect.scene({ hidden: true }).items[0].reasons   // [{ code: 'hidden-ancestor', level: 'hidden', text, fix }]
     * @example engine.inspect.scene().text
     */
    scene(opts?: { hidden?: boolean; limit?: number }): SceneInspect;
  };
  /**
   * Why something is the way it is. { op, args?, actor? }: text says whether it can run now, and if not the reason and the op's note on fixing it
   * (reason first);
   * detail has the last attempt and the events around it; recent / events are the raw last 5 attempts and event names within a step of the last one.
   * Other keys are answered by modules (definition field explain: { key(e, value, query) { return { ok, text } } }); the quests module answers { quest: id }.
   * @example engine.explain({ op: 'shop.buy', args: { shop: 'bakery', item: 'bread' } }).text   // 'shop.buy {...} cannot run now: noMoney (Not enough gold)'
   * @example engine.explain({ quest: 'first-light' }).text   // which step it waits on
   * An op whose args.id names a world record also says where that record was authored (text ends with "defined in content/props.js:14: edit it there…";
   * thing has the rest).
   */
  explain(q: { op: string; args?: any; actor?: string } | Record<string, any>): {
    ok: boolean; reason?: string | null; text: string; detail?: string; recent?: any[]; events?: string[]; thing?: HitThing;
  };
  /**
   * Module hook timing: pass true to turn on, false to turn off (returns the engine); with no argument returns { moduleName: average milliseconds per
   * rendered frame } and resets, or null when not on
   */
  profile(on: boolean): this;
  profile(): Record<string, number> | null;
  /**
   * Destroy the engine: stop the main loop, call each module's dispose(e) in reverse install order, then reclaim listeners, timers, audio, UI and GPU
   * memory (scene, assets cache, post-processing, renderer).
   * After that no callbacks fire and step() returns null. Safe to call repeatedly. Don't use it for level changes; use level.track(handle)
   */
  dispose(): void;
  /**
   * Counts for leak hunting: they should not keep growing after repeatedly entering / leaving levels or opening / closing windows. geometries / textures
   * come from three.js renderer.info.memory (counted only after rendering)
   */
  counts(): EngineCounts;
}

/** Result of engine.counts() */
/** engine.error and the engine:error event: where and why, plus a stable code, the fix and the pages to read (from the error or the hint table) */
export interface EngineError {
  /** Where it happened, e.g. "fixed hook of module quests" or "load() of save part 'inventory'" */
  where: string;
  /** The error message (English) */
  message: string;
  /** Stable code (e.g. 'save-load-threw', 'world-plain'); null for an unknown error */
  code: string | null;
  /** What to do about it; null when unknown */
  fix: string | null;
  /** Doc pages to read, relative to the package docs */
  docs: string[];
}

export interface EngineCounts {
  /** Number of event listeners */
  listeners: number;
  /** Number of onFixed callbacks */
  fixed: number;
  /** Number of onFrame callbacks */
  frame: number;
  /** Number of clock timers (after / every); sky clock-time timers are in sky.timers */
  timers: number;
  /** Number of static meshes registered for rays */
  statics: number;
  /** Number of stream registrations */
  streamEntries: number;
  /** Unfinished tasks in the jobs queue */
  jobs: number;
  /** Requests in commits that have not yet taken effect */
  commits: number;
  /** Geometries in GPU memory (three.js renderer.info.memory) */
  geometries: number;
  /** Textures in GPU memory (three.js renderer.info.memory) */
  textures: number;
  /** Only with world() installed: records is the record count, views the number of records with a built model */
  world?: { records: number; views: number };
  /** Only with rigid() installed: number of rigid bodies */
  rigid?: number;
  /** Only with particles() installed: alive is the number of live particles, emitters the number of attached emitters */
  particles?: { alive: number; emitters: number };
  /** Only with sky() installed: timers is the number of at / between / daily / onSeason timers */
  sky?: { timers: number };
  /** Any other module's counts(e) hook result, under the module name */
  [module: string]: any;
}

// ======================================================================
// Game state description engine.describe()
// ======================================================================

/** A nearby thing: dist is the distance (meters), dir the compass heading (north = -Z), rel relative to the camera heading */
export interface NearbyThing {
  name?: string;
  /** 'npc' | 'pickup' | 'interactable' | 'trigger' | 'entity' ... */
  kind?: string;
  dist: number;
  dir: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
  rel: 'front' | 'front-right' | 'right' | 'back-right' | 'back' | 'back-left' | 'left' | 'front-left';
  x: number; z: number;
  /** Prompt text when interactable */
  use?: string;
  [key: string]: any;
}
/** Result of engine.describe(). The standard fields are below; the return values of each module's describe hook are added separately, keyed by module name */
export interface GameState {
  ready: boolean;
  /** Gameplay error in development / testing (gameplay is frozen), null when there is none */
  error: EngineError | null;
  /** Presentation modules disabled after an error */
  disabledModules: string[];
  /** Modules that are initializing or failed ({ name: state }); absent when every module with an init is running (engine.moduleStates has all) */
  moduleStates?: Record<string, string>;
  /** What loading is waiting for, what failed, whether it blocks the start (engine.loading.view()) */
  loading: LoadingView;
  /** elapsed is the run seconds (= engine.elapsed); with the sky module there are also clock, day, season, isDay, timeOfDay */
  time: {
    elapsed: number; paused: boolean; frozen: boolean; headless: boolean; clock?: string; day?: number; season?: string; isDay?: boolean;
    [key: string]: any;
  };
  /** Player (null when there is no player), position in meters */
  /** ground is the ground type, groundName its display name (i18n key ground.<type>, null if none) */
  player: {
    x: number; y: number; z: number; ground: string; groundName: string | null; inWater: boolean; state: string | null;
    running: boolean; jumping: boolean; [key: string]: any;
  } | null;
  /** Camera: type 'follow' | 'first' | 'fixed' | 'rts', override is the takeover owner's name */
  camera: { type: string | null; x: number; y: number; z: number; focus: { x: number; z: number }; override: string | null; [key: string]: any };
  /** How far counts as nearby (meters) */
  nearbyRadius: number;
  /** Nearby things, sorted by distance (at most 15) */
  nearby: NearbyThing[];
  /** UI: open windows, whether input is locked, the dialogue in progress */
  /** windows: open windows and full-screen UI parts (e.g. 'title'); parts: each UI part 'default' | 'custom' | 'off' */
  ui: {
    windows: string[]; inputLocked: boolean; parts: Record<string, string>; [key: string]: any;
    dialogue: { speaker: string; text: string; choices: string[]; [key: string]: any } | null;
  };
  /** Cutscenes: count is how many are playing, skippable whether they can be skipped */
  cutscene: { count: number; skippable: boolean; [key: string]: any } | null;
  /** Installed module names */
  modules: string[];
  /**
   * engine.add / world things by save tier (counts only) and what will not survive a load: unsaved ('obj#3 (main.js:88, made during play by op x)'),
   * conflicts (two systems managing one object), orphans (saved ids no object has); atCapped when dev stopped taking stacks
   */
  scene: { game: number; code: number; session: number; world: number; engine: number; unsaved: string[]; conflicts: string[]; orphans: string[]; atCapped?: boolean };
  /** Performance (fps/cpuMs are null while paused) */
  perf: {
    fps: number | null; cpuMs: number | null; drawCalls: number; triangles: number; pixelRatio: number;
    chunks?: { loaded: number; visible: number; queued: number }; budget?: BudgetReport | null; startup?: StartupReport | null;
    /** cpuMs by phase (null while paused), see Engine.cpuPhases */
    cpu?: { fixed: number; frame: number; render: number; afterRender: number } | null;
    /** Cost of applying background results by stage: transit, build, collider, upload, stream (see engine.budget.cost; upload and transit are approximations) */
    apply?: Record<string, { n: number; totalMs: number; maxMs: number; frameMs: number; bytes: number }>;
    /** Stream registry: registered, built, queued */
    stream?: { entries: number; built: number; queued: number };
    /** Automatic batching: batches, instances, draw calls saved per pass */
    batching?: BatchingStats;
    /** Number of unfinished frame-spread jobs */
    jobs?: number; [key: string]: any };
  /**
   * Weather module additions: name (label is the display name), rain, snow, fog intensity 0–1, progress is the transition progress 0–1, rainVisible /
   * snowVisible whether raindrops / snowflakes are drawn right now (object names weather-rain / weather-snow)
   */
  weather?: any;
  /** Content added by other modules */
  [module: string]: any;
}
/** ctx received by a module's describe(e, ctx) hook */
export interface DescribeContext {
  /** The result being generated; you can fill in the standard fields (e.g. ctx.out.time.clock = '18:30') */
  out: GameState;
  /** How far counts as nearby (meters) */
  radius: number;
  /** Center of the search (the player or the focus) */
  center: Vector3;
  /** Report a nearby thing: at is an object or {x, z}; reporting the same at several times merges them, weak = true only fills empty fields */
  near(at: Object3D | { x: number; z: number }, info: { name?: string; kind?: string; [key: string]: any }, weak?: boolean): void;
}

/** engine.skip options: pass to or seconds */
export interface SkipOptions {
  /** Until the sky clock next reads this time ('HH:MM' or 0-1; needs sky). The current time itself means a full day */
  to?: string | number;
  /** Game seconds to skip (> 0) */
  seconds?: number;
  /** Fade out / in seconds (default 0: no fade, the jump happens before skip returns) */
  fade?: number;
  /** Save slot written after the jump, before the fade in (true = 'auto') */
  save?: string | boolean;
}
