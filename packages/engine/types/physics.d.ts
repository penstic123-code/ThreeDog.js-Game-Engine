// Collision, real physics, camera.
import type { Object3D, Vector3, DirXZ, Vec3Like, Ease, Handle, PositionLike } from './common';
import type { Engine, ModuleDef } from './core';
import type { Input } from './generated/core/Input';
import type { Character } from './gameplay';

// ======================================================================
// Lightweight collision collision() → engine.collision
// ======================================================================

export interface CollisionOptions {
  /** Max walkable slope (height difference / horizontal distance), default 1.1 */
  maxClimb?: number;
  /** A camera above this height (meters) is not considered blocked by trees, default 5 */
  canopyHeight?: number;
  /** Margin between the camera and obstacles (meters), default 0.5 */
  cameraPad?: number;
  /** Nearest camera distance (meters), default 1.5 */
  cameraMin?: number;
  /** Height above the water surface (meters) at which it counts as walkable, default 0.2 */
  walkableWaterMargin?: number;
  /** What camera occlusion checks: 'colliders' (default) | 'meshes' registered static meshes (engine.raycaster) | 'both' */
  cameraOcclusion?: 'colliders' | 'meshes' | 'both';
}
/** Circle collider: center x/z, radius r, height h (meters) */
export interface CircleCollider { x: number; z: number; r: number; h: number }
/** Box collider: center x/z, half width hw, half depth hd, rotation around Y rot (radians), height h, bottom height y (meters) */
export interface BoxCollider { x: number; z: number; hw: number; hd: number; rot: number; h: number; y?: number; [k: string]: any }

/** Parameters of addCircle() (meters) */
export interface CircleColliderOptions {
  /** Radius, default 0.5 */
  radius?: number;
  /** Height, default 6 */
  height?: number;
}
/** Parameters of addBox() (meters, radians) */
export interface BoxColliderOptions {
  /** Half width (X direction), default 1 */
  halfWidth?: number;
  /** Half depth (Z direction), default 1 */
  halfDepth?: number;
  /** Rotation around the Y axis (radians), default 0 */
  rotation?: number;
  /** Height, default 6 */
  height?: number;
  /** Bottom height of the box; if omitted it sits on the ground (give it for walls placed on platforms in a level) */
  y?: number;
}

/** engine.collision (lightweight collision: no walking through things, the camera is not blocked). Real physics is a separate module, engine.rigid */
export interface Collision {
  maxClimb: number;
  canopyHeight: number;
  cameraPad: number;
  cameraMin: number;
  walkableWaterMargin: number;
  /** What camera occlusion checks (see CollisionOptions.cameraOcclusion) */
  cameraOcclusion: 'colliders' | 'meshes' | 'both';
  /** Circle colliders added by hand */
  circles: CircleCollider[];
  /** Box colliders added by hand */
  boxes: BoxCollider[];
  /** +1 each time a static collider is added or removed */
  version: number;
  /** Add a circle collider (pillar, campfire): position is the center, e.g. addCircle(mesh, { radius: 1 }). Returns a handle { remove() } */
  addCircle(position: PositionLike, opts?: CircleColliderOptions): Handle;
  /** Add a box collider (house, fence): position is the center, e.g. addBox(house, { halfWidth: 3, halfDepth: 2, rotation: 0.3 }). Returns a handle { remove() } */
  addBox(position: PositionLike, opts?: BoxColliderOptions): Handle;
  /** Add a collider from an object's bounding box, pad expands outward (meters). Returns a handle { remove() } */
  addObject(obj: Object3D, opts?: { pad?: number }): Handle;
  /** Iterate all static colliders added by hand */
  forEachStatic(fn: (type: 'box' | 'circle', data: any) => void): void;
  /** Low level (called every step by character movement): push a character of radius radius (meters) out of obstacles (modifies pos.x/pos.z directly), returns whether it hit anything */
  resolve(pos: { x: number; z: number }, radius?: number): boolean;
  /** Whether someone can stand at this position (for pathfinding): not in water, not too steep, not inside an obstacle. radius is the character radius (meters, default engine.movement.radius) */
  walkable(position: PositionLike, opts?: { radius?: number }): boolean;
  /** walkable with plain numbers, allocating nothing (A* inner loops); radius defaults to engine.movement.radius */
  walkableAt(x: number, z: number, radius?: number): boolean;
  /** Low level (called every frame by the camera): camera occlusion, returns the max allowed distance (meters) */
  cameraDistance(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, want: number, pad?: number): number;
}

// ======================================================================
// Real physics rigid() → engine.rigid
// ======================================================================

export interface RigidOptions {
  /** Gravity (m/s², negative points down), default -9.81 */
  gravity?: number;
  /** How many rings of chunks around the player get terrain colliders, default 1 */
  terrainRing?: number;
  /** Whether there is buoyancy, default true */
  buoyancy?: boolean;
  /** Buoyancy strength (1 = just floats), default 1.6 */
  buoyancyForce?: number;
  /** Drag in water, default 2.5 */
  waterDrag?: number;
  /** Buoyancy "waterline": an object starts floating when its center is this many meters below the water surface, default 0.3 */
  floatLine?: number;
  /** Buoyancy reaches its maximum this many meters further down, default 0.8 */
  floatDepth?: number;
  /** Height (meters) of vegetation collision pillars (tree trunks), default 6 */
  treeColliderHeight?: number;
  /** Player capsule size (meters), default computed from engine.movement radius / height */
  playerCapsule?: { halfHeight: number; radius: number };
}
/** Parameters for adding a physics body */
export interface RigidBodyOptions {
  /** Mass (kilograms), default 1 */
  mass?: number;
  /** Friction, default 0.7 */
  friction?: number;
  /** Restitution 0–1, default 0.1 */
  restitution?: number;
  /** Linear damping, default 0.05 */
  damping?: number;
  /** Angular damping, default 0.1 */
  angularDamping?: number;
  /** Fixed in place (only blocks other things) */
  fixed?: boolean;
}
/** Parameters of addBox() */
export interface RigidBoxOptions extends RigidBodyOptions {
  /** Size [width, height, depth] (meters); if omitted, taken from the model's bounding box */
  size?: number[];
}
/** Parameters of addBall() */
export interface RigidBallOptions extends RigidBodyOptions {
  /** Radius (meters); if omitted, taken from the model's bounding box */
  radius?: number;
}
/** A physics body (the handle returned by addBox / addBall / addHull) */
export interface RigidEntry extends Handle {
  /** Rapier rigid body (translation(), mass(), setLinvel()…) */
  body: any;
  /** Rapier collider */
  collider: any;
  /** The matching three.js model (position is written by physics every step) */
  mesh: Object3D;
  /** Same as mesh (the name consistent with player.object, ent.object) */
  object: Object3D;
  /** Whether it is being simulated (frozen when too far from the player) */
  enabled: boolean;
  /** Volume (cubic meters, used for buoyancy) */
  volume: number;
  damping: number;
  angularDamping: number;
  wet?: boolean;
  /** Remove this rigid body (the model was passed in by you and is not deleted; call engine.remove(entry.object) when done). Casting / receiving shadows follows the model's own castShadow / receiveShadow */
  remove(): void;
}

/** engine.rigid (real physics; bodies can only be added after start(), or in the world:ready event) */
export interface RigidBodies {
  /** Is the physics engine ready (downloaded and initialized at start()) */
  readonly ready: boolean;
  /** All physics bodies */
  bodies: RigidEntry[];
  gravity: number;
  terrainRing: number;
  buoyancy: boolean;
  buoyancyForce: number;
  waterDrag: number;
  floatLine: number; floatDepth: number; treeColliderHeight: number;
  /** Rapier library */
  R: any;
  /** Rapier world */
  world: any;
  /** Add a box (crate). Returns null if not ready */
  addBox(mesh: Object3D, opts?: RigidBoxOptions): RigidEntry | null;
  /** Add a ball */
  addBall(mesh: Object3D, opts?: RigidBallOptions): RigidEntry | null;
  /** Add a convex hull (irregular objects such as rocks and barrels) */
  addHull(mesh: Object3D, opts?: RigidBodyOptions): RigidEntry | null;
  /** Give it a push: impulse vector impulse (Vector3 / [x, y, z] / { x, y, z }), e.g. impulse(ball, [0, 3, 5]) */
  impulse(entry: RigidEntry, impulse: Vec3Like): void;
  /** Teleport to position (velocity is zeroed) */
  setPosition(entry: RigidEntry, position: PositionLike): void;
  /** The player's Rapier kinematic body and capsule collider (follow the player position every step; used for collision when mover: 'rapier'; the capsule is off while driving) */
  playerBody: any;
  playerCollider: any;
  /** Player capsule size (meters) */
  playerCapsule: { halfHeight: number; radius: number };
  /** Is the physics ground under position built (always true without chunked terrain; with mover: 'rapier' and not yet built, 'simple' is used temporarily) */
  groundReady(position: PositionLike): boolean;
  /** All vehicles */
  vehicles: Vehicle[];
  /** Turn a model into a drivable car (Rapier vehicle controller); remove it with vehicle.remove() (anyone inside gets out first). Returns null if not ready */
  addVehicle(mesh: Object3D, opts: VehicleOptions): Vehicle | null;
  /** Statistics */
  readonly stats: { bodies: number; active: number; colliders: number };
  init(): Promise<void>;
  step(dt: number): void;
}

// ---------- Vehicles ----------
/** A wheel: position relative to the body (meters), radius (meters), steer can steer, drive is powered, object is the wheel model that spins */
export interface VehicleWheel { position: Vec3Like; radius: number; steer?: boolean; drive?: boolean; object?: Object3D }
/** Parameters of rigid.addVehicle() */
export interface VehicleOptions {
  /** Stable id (default 'vehicle1', 'vehicle2'... in creation order): saves name the player's vehicle by it; give one when the creation order varies */
  id?: string;
  /** Wheels (at least 3) */
  wheels: VehicleWheel[];
  /** Mass (kilograms) */
  mass?: number;
  /** Throttle force, default 800 */
  engineForce?: number;
  /** Brake force, default 20 */
  brakeForce?: number;
  /** Max steering angle (radians), default 0.5 */
  maxSteer?: number;
  /** Suspension: rest natural length (meters), stiffness, damping */
  suspension?: { rest?: number; stiffness?: number; damping?: number };
  /** Seat (relative to the body, meters): the player gets out beside it */
  seat?: Vec3Like;
  /** Camera distance and height while driving (meters) */
  camera?: { distance?: number; height?: number };
  /** Body collision box size [width, height, depth] (meters); if omitted, taken from the model's bounding box (wheels excluded) */
  size?: number[];
  /** Tire grip, default 1.5 */
  friction?: number;
  /** Distance from the side of the body when getting out (meters), default 0.8 */
  exitOffset?: number;
}
/** A vehicle (returned by rigid.addVehicle, faces the model's +Z). player.enter(vehicle) gets in; with interactions installed, press the interact key nearby to get in / out */
export interface Vehicle extends RigidEntry {
  /** Stable id (rigid.addVehicle({ id })); saves name the player's vehicle by it */
  readonly id: string;
  /** Body model (the mesh you passed in) */
  object: Object3D;
  /** Rapier rigid body */
  body: any;
  /** Rapier vehicle controller (DynamicRayCastVehicleController) */
  controller: any;
  wheels: VehicleWheel[];
  /** Current speed (m/s) */
  readonly speed: number;
  /** Who is driving (null if nobody) */
  driver: Character | null;
  /** Camera parameters while driving */
  camera?: { distance?: number; height?: number };
  /** Controls: throttle -1..1, steer -1..1 (right is positive), brake 0–1 */
  drive(throttle: number, steer: number, brake?: number): void;
  /** World position of the seat */
  seatPosition(): Vector3;
  /** Where to get out (outside the door on the driver's side, world coordinates) */
  exitPosition(): Vector3;
}

// ======================================================================
// Skeletal animation state machine Animator (returned by engine.assets.animate)
// ======================================================================

/** An animation state: clip is the clip name; or blend is a blend tree (blends several clips by the param parameter); loop: false is a one-shot clip */
export interface AnimatorState {
  /** Clip name (the clip name in the glTF) */
  clip?: string;
  /** Blend tree: at the parameter value at it is fully this clip, in between they blend proportionally, e.g. [{ clip: 'Walk', at: 1.5 }, { clip: 'Run', at: 6 }] */
  blend?: { clip: string; at: number }[];
  /** Which parameter the blend tree reads (set by anim.set), default 'speed' */
  param?: string;
  /** Align the strides of blended clips, default true */
  sync?: boolean;
  /** Loop, default true; with false the anim:end event fires when it finishes */
  loop?: boolean;
  /** Which state a one-shot clip goes to when it finishes */
  then?: string;
  /** go() cannot interrupt it while playing */
  lock?: boolean;
  /**
   * For sync(): gameplay seconds -> clip seconds. A number = the gameplay length the whole clip is stretched over;
   * [[gameT, clipT], ...] = piecewise linear (land the swing on the hit phase). Without it clip seconds = t
   */
  timing?: number | [number, number][];
}
/** What an Animator is showing (anim.describe(), describe().player.anim) */
export interface AnimatorInfo {
  state: string | null;
  /** Clip name as written in the state */
  clip: string | null;
  /** Clip seconds */
  time: number;
  /** 0-1 through the clip */
  progress: number;
  /** true while sync() drives it */
  driven: boolean;
  /** Last gameplay t passed to sync (only while driven) */
  t?: number;
  /** Share of each fading state (sums to 1) */
  weights: Record<string, number>;
}
/** Animation state machine parameters */
export interface AnimatorOptions {
  /** Default transition seconds, default 0.25 (style pack style.character.animation.fade) */
  fade?: number;
  /** States: name → state */
  states?: Record<string, AnimatorState>;
  /** Transition seconds for specific pairs: { 'jump>fall': 0.1, '*>idle': 0.3 } */
  transitions?: Record<string, number>;
  /** Initial parameter values */
  params?: Record<string, number>;
}
/** Skeletal animation state machine (returned by engine.assets.animate(model, config)) */
export declare class Animator {
  constructor(engine: Engine, root: Object3D, opts?: AnimatorOptions);
  /** three.js AnimationMixer */
  mixer: any;
  /** clip name → three.js AnimationAction */
  actions: Map<string, any>;
  /** Current state name */
  state: string | null;
  /** State configuration (states can be added directly) */
  states: Record<string, AnimatorState>;
  /** Parameters (used by blend trees) */
  params: Record<string, number>;
  /** Set a parameter, e.g. set('speed', 3) */
  set(param: string, value: number): this;
  /** Switch to a state (fade is the transition seconds); null (dev warning) if there is no such state / clip; ignored while sync() drives a state */
  go(state: string, fade?: number): any;
  /** One-shot clip: state name or clip name, returns to then or the previous state when done; go() cannot interrupt it while playing */
  action(name: string, fade?: number): any;
  /**
   * Gameplay drives the clock: show state at gameplay time t (fixed-step seconds) through its timing.
   * The clip never advances or ends by itself and go() leaves it alone; sync(null) hands control back
   */
  sync(state: string | null, t?: number): any;
  /** What is showing: state, clip, clip time, progress, driven, weights */
  describe(): AnimatorInfo;
  /** Advance every frame (called automatically by the engine) */
  update(dt: number): void;
  /** Stop the per-frame update when no longer needed */
  dispose(): void;
}

// ======================================================================
// Camera → engine.cameraRig (install one kind, switch at runtime with engine.setCamera)
// ======================================================================

/** Camera kinds: 'follow' third person | 'firstPerson' first person | 'fixed' fixed shot | 'rts' strategy top-down */
export type CameraKind = 'follow' | 'firstPerson' | 'fixed' | 'rts';

/** Interface shared by all cameras */
export interface CameraRigBase {
  engine: Engine;
  /** Current kind (the first argument of engine.setCamera) */
  kind: CameraKind;
  /** The object being followed */
  target: Object3D | null;
  /** Follow someone (called automatically when the player is created), null to cancel. opts temporarily changes distance / height (used while driving), restored when the target changes */
  follow(obj: Object3D | null, opts?: { distance?: number; height?: number }): void;
  /** The "forward" direction on the horizontal plane (player movement is relative to it) */
  forward(): DirXZ;
  /** The "right" direction on the horizontal plane */
  right(): DirXZ;
  /** Where the world loads around */
  focusPoint(): Vector3;
  /** Update the camera every frame */
  update(dt: number, input: Input): void;
  /** Called when a cutscene takeover starts / ends */
  onOverride?(on: boolean): void;
  /** Called when this camera is switched in (switched: switched at runtime) */
  onEnter?(switched?: boolean): void;
  /** Called when this camera is switched out */
  onExit?(): void;
}

export interface FollowCameraOptions {
  /** Which side of the focus the camera sits on (radians), default 0.8: camera = focus + (sin yaw, cos yaw) × distance, it looks along forward() = -(sin yaw, cos yaw). Behind a character facing f: yaw = f + PI */
  yaw?: number;
  /** Pitch angle (radians), default 0.42 */
  pitch?: number;
  /** Distance (meters), default 13 */
  distance?: number;
  /** Zoom range (meters) */
  minDistance?: number;
  maxDistance?: number;
  /** How high above the character to look at (meters), default 1.4 */
  height?: number;
  /** Follow smoothing, default 10 */
  smoothing?: number;
  /** Drag sensitivity, default 1 */
  sensitivity?: number;
  /** Pitch range (radians) */
  minPitch?: number;
  maxPitch?: number;
  /** Zoom ratio per wheel notch, default 0.1 */
  zoomStep?: number;
  /** Minimum camera height above the ground (meters), default 1.2 */
  groundClearance?: number;
  /** Invert vertical */
  invertY?: boolean;
  /** Lock the pitch angle (top-down games) */
  lockPitch?: boolean;
  /** Over-the-shoulder offset: meters to the right of the target the camera aims (negative = left shoulder), default 0 */
  shoulder?: number;
  /** Click locks the mouse; mouse motion turns the view without dragging (Esc releases), default false */
  pointerLock?: boolean;
}
/** Third-person follow camera */
export interface FollowCamera extends CameraRigBase, Required<Omit<FollowCameraOptions, 'lockPitch'>> {
  /** Smoothed follow point */
  focus: Vector3;
  lockPitch?: boolean;
  /** false: no occlusion handling */
  avoidOcclusion?: boolean;
  /** Lock-on framing set by frame() */
  framing: { target: Object3D | Vec3Like; strength: number } | null;
  /** Lock-on framing: turn yaw each frame toward "behind the followed object, looking at target"; mouse yaw is ignored meanwhile; null hands yaw back. strength default 6 (1/s) */
  frame(target: Object3D | Vec3Like | null, opts?: { strength?: number }): void;
}

export interface FirstPersonCameraOptions {
  /** Eye height above the feet (meters), default 1.6 */
  height?: number;
  /** Mouse sensitivity, default 1 */
  sensitivity?: number;
  /** Field of view (degrees); unchanged if omitted */
  fov?: number | null;
  /** Walking bob amplitude (meters), 0 off, default 0.04 */
  headBob?: number;
  /** Bobs per meter */
  bobFrequency?: number;
  /** Hide the character itself (its shadow remains), default true */
  hideTarget?: boolean;
  /** Layer number used for hiding 0–31 */
  hideLayer?: number;
  /** Click to lock the mouse, default true */
  pointerLock?: boolean;
  /** Initial heading (radians) */
  yaw?: number;
  pitch?: number;
  /** Look down / up limit (radians) */
  minPitch?: number;
  maxPitch?: number;
  /** Turn range left / right [min, max] (radians), unlimited by default */
  yawLimits?: number[] | null;
  /** Smoothing of the camera following the body */
  smoothing?: number;
  /** Invert vertical */
  invertY?: boolean;
}
/** First-person camera */
export interface FirstPersonCamera extends CameraRigBase, Required<Omit<FirstPersonCameraOptions, 'fov'>> {
  /** Eye position */
  eye: Vector3;
  /** Turn toward a world position (Vector3 / object / [x, y, z] / { x, y, z }) */
  lookAt(position: PositionLike): void;
}

/** Fixed shot */
export interface CameraShot {
  /** Camera position */
  position: Vec3Like;
  /** Fixed point to look at (if omitted, it turns its head with the player) */
  lookAt?: Vec3Like;
  /** Turn its head with the player */
  track?: boolean;
  /** Field of view (degrees) */
  fov?: number;
  /** Position used to judge the "nearest shot", defaults to position */
  at?: Vec3Like;
  /** How high above the character to look at (meters) */
  trackHeight?: number;
}
export interface FixedCameraOptions {
  /** Shots: name → shot */
  shots?: Record<string, CameraShot>;
  /** Initial shot name */
  start?: string | null;
  /** Automatic switching: false | 'nearest' (pick the one nearest to the player) */
  auto?: false | 'nearest';
  /** Check interval for automatic switching (seconds) */
  autoInterval?: number;
  /** How many meters closer a new shot must be to switch (prevents flipping back and forth) */
  hysteresis?: number;
  /** Transition seconds for trigger-zone switches (0 = hard cut) */
  triggerBlend?: number;
  /** How high above the character a track shot looks (meters) */
  trackHeight?: number;
  /** Head-follow smoothing */
  trackSmoothing?: number;
  /** Keep the direction when switching shots until the direction key is released */
  holdDirection?: boolean;
  /** Transition easing */
  ease?: Ease;
}
/** Fixed-shot camera */
export interface FixedCamera extends CameraRigBase {
  /** All shots */
  shots: Record<string, any>;
  /** Current shot name */
  current: string | null;
  auto: false | 'nearest';
  autoInterval: number;
  hysteresis: number;
  triggerBlend: number;
  trackHeight: number;
  trackSmoothing: number;
  holdDirection: boolean;
  ease: Ease;
  /** Add / replace a shot */
  add(name: string, shot: CameraShot): this;
  /** Cut to a shot immediately */
  cut(name: string): void;
  /** Transition smoothly to a shot (over seconds seconds); the Promise resolves when done */
  blend(name: string, seconds?: number, ease?: Ease): Promise<void>;
  /** Name of the shot nearest to a point */
  nearest(p: Vector3): string | null;
}

export interface RtsCameraOptions {
  /** Camera height above the focus (meters), default 30 */
  height?: number;
  /** Zoom range (meters) */
  minHeight?: number;
  maxHeight?: number;
  /** Pitch down angle (radians, π/2 = straight down), default 0.95 */
  angle?: number;
  /** Initial horizontal heading (radians) */
  yaw?: number;
  /** Pan speed multiplier */
  panSpeed?: number;
  /** Drag with the mouse to pan, default true */
  dragPan?: boolean;
  /** Pan at the screen edge, default false */
  edgePan?: boolean;
  /** Edge width (fraction of the screen) */
  edgeSize?: number;
  /** Focus range (meters) */
  bounds?: { minX?: number; maxX?: number; minZ?: number; maxZ?: number } | null;
  /** Rotate keys, false turns rotation off */
  rotateKeys?: { left?: string[]; right?: string[] } | false;
  /** Rotation speed (radians/second) */
  rotateSpeed?: number;
  /** Zoom ratio per wheel notch */
  zoomStep?: number;
  /** Smoothing */
  smoothing?: number;
  /** Field of view (degrees); unchanged if omitted */
  fov?: number | null;
  /** Manual panning is not allowed while following */
  followLock?: boolean;
  /** Initial focus (position) */
  start?: PositionLike | null;
}
/** Strategy top-down camera */
export interface RtsCamera extends CameraRigBase, Required<Omit<RtsCameraOptions, 'rotateKeys' | 'fov' | 'start'>> {
  /** Is it following target */
  following: boolean;
  /** Focus (on the ground) */
  focus: Vector3;
  /** Can it rotate */
  rotate: boolean;
  /** Move the view to position (instant: true skips smoothing) */
  moveTo(position: PositionLike, opts?: { instant?: boolean }): void;
  /** Screen coordinates (-1..1) → a point on the ground, null if nothing is hit */
  screenToGround(ndcX: number, ndcY: number): Vector3 | null;
}

/**
 * engine.cameraRig: one of four cameras. The shared methods (follow, forward, right) always work;
 * properties specific to one camera (distance, cut(), moveTo()…) only exist when that camera is installed.
 */
export type CameraRig = CameraRigBase
  & Partial<Omit<FollowCamera, keyof CameraRigBase>>
  & Partial<Omit<FirstPersonCamera, keyof CameraRigBase | 'height' | 'smoothing'>>
  & Partial<Omit<FixedCamera, keyof CameraRigBase | 'trackHeight' | 'add' | 'ease' | 'auto'>>
  & Partial<Omit<RtsCamera, keyof CameraRigBase | 'height' | 'smoothing' | 'focus'>>
  & {
    /** Fixed shot: add a shot */
    add?(name: string, shot: CameraShot): any;
    ease?: Ease;
    auto?: false | 'nearest';
  };

/** Fixed-shot switch event */
export interface CameraShotEvent { name: string }

export type CameraModule = ModuleDef<CameraRig>;
