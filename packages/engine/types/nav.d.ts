// Navmesh nav() → engine.nav (Recast, levels only for now).
import type { XZ, PositionLike } from './common';

/** Options of nav() */
export interface NavOptions {
  /** Voxel cell size (meters), default 0.3; smaller is more accurate but slower to build */
  cellSize?: number;
  /** Character radius (meters), default reads engine.movement.radius (this is an override). The mesh built at load; a path with another radius gets a mesh of its own, on first ask */
  agentRadius?: number;
  /** Character height (meters), default reads engine.movement.height */
  agentHeight?: number;
  /** Step height that can be climbed (meters), default reads engine.movement.stepHeight */
  maxClimb?: number;
  /** Max walkable slope (degrees), default reads engine.movement.maxSlope */
  maxSlope?: number;
  /** Tile size (in cells), default 32 @experimental */
  tileSize?: number;
  /** NPCs use Recast crowd avoidance, default false */
  crowd?: boolean;
  /** Show the navmesh (debug), default false */
  debug?: boolean;
  /** Most TileCache obstacles (collision boxes are cut into several), default 1024 @experimental */
  maxObstacles?: number;
  /** Most crowd agents (with crowd: true), default 128 @experimental */
  maxAgents?: number;
  /** Meters past the character's radius a path may end short of its goal and still count as arrived, default 0.6 */
  arrive?: number;
  /** Places joined by a jump or a climb instead of walking (Recast off-mesh connections); walkers cross them straight unless the game says otherwise @experimental */
  links?: NavLink[];
}

/** One link of nav({ links }) @experimental */
export interface NavLink {
  /** Name in path points and link events; default its index */
  id?: string | number;
  /** One end, on or near walkable ground (no y: the ground there). A link joins neighbouring tiles at most: keep it under tileSize x cellSize meters */
  from: PositionLike;
  /** The other end */
  to: PositionLike;
  /** Only from -> to, default false */
  oneWay?: boolean;
  /** How far (meters) an end may be from the mesh and still attach, default the agent radius + 2 cells */
  radius?: number;
}

/** A path point that starts a link: the leg to the next point is the crossing @experimental */
export interface NavPathPoint extends XZ {
  link?: { id: string | number; from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } };
}

/** A crossing under way: plain data, saved with an NPC. seconds may be set at link:enter @experimental */
export interface LinkCrossing {
  link: string | number;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  seconds: number;
  time: number;
}

/**
 * engine.nav: navmesh. Usually not called directly; engine.characters.findPath uses it automatically once ready.
 * The mesh comes from the ground API's staticTrimeshes() (the level's walkable mesh);
 * collision boxes / circles (level col_ walls, those added by collision.addBox) all become dynamic obstacles and update automatically when added or removed.
 */
export interface Nav {
  /** The navmesh has been generated */
  readonly ready: boolean;
  /** The links in effect, ends in 3D, in the order given to nav({ links }); empty until the mesh is built @experimental */
  readonly links: readonly { id: string | number; from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; oneWay: boolean; radius: number }[];
  /** Native Recast NavMesh (null until ready) @experimental */
  navMesh: any;
  /** Native Recast NavMeshQuery @experimental */
  query: any;
  /** Native Recast TileCache (for dynamic obstacles) @experimental */
  tileCache: any;
  /** Native Recast Crowd (only when crowd: true) @experimental */
  crowd: any;
  /** three.js object for the debug display (only when debug: true) @experimental */
  helper: any;
  /** +1 on rebuild / unload: code that cached native objects (crowd agents etc.) must recreate them when it changes @experimental */
  readonly version: number;
  /** Path from from to to [{ x, y, z }…] (meters); null if not ready or unreachable; radius: the body it must fit, default agentRadius. Usually use engine.characters.findPath */
  findPath(from: PositionLike, to: PositionLike, opts?: { radius?: number; detailed?: false }): NavPathPoint[] | null;
  /** Pass detailed: true: returns { status: 'ok' | 'noPath' | 'notReady', path }, telling "unreachable" from "mesh not generated yet" */
  findPath(from: PositionLike, to: PositionLike, opts: { radius?: number; detailed: true }): { status: 'ok' | 'noPath' | 'notReady'; path: NavPathPoint[] | null };
  /** Character size actually in effect (from engine.movement, or the override in nav()) @experimental */
  readonly agent: { radius: number; height: number; maxClimb: number; maxSlope: number } | null;
  /** Unload the navmesh (frees native objects); characters.findPath then falls back to A* */
  dispose(): void;
}
