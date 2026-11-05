// Navmesh nav() → engine.nav (Recast, levels only for now).
import type { XZ, PositionLike } from './common';

/** Options of nav() */
export interface NavOptions {
  /** Voxel cell size (meters), default 0.3; smaller is more accurate but slower to build */
  cellSize?: number;
  /** Character radius (meters), default reads engine.movement.radius (this is an override) */
  agentRadius?: number;
  /** Character height (meters), default reads engine.movement.height */
  agentHeight?: number;
  /** Step height that can be climbed (meters), default reads engine.movement.stepHeight */
  maxClimb?: number;
  /** Max walkable slope (degrees), default reads engine.movement.maxSlope */
  maxSlope?: number;
  /** Tile size (in cells), default 32 */
  tileSize?: number;
  /** NPCs use Recast crowd avoidance, default false */
  crowd?: boolean;
  /** Show the navmesh (debug), default false */
  debug?: boolean;
  /** Most TileCache obstacles (collision boxes are cut into several), default 1024 */
  maxObstacles?: number;
  /** Most crowd agents (with crowd: true), default 128 */
  maxAgents?: number;
  /** Meters past the character's radius a path may end short of its goal and still count as arrived, default 0.6 */
  arrive?: number;
}

/**
 * engine.nav: navmesh. Usually not called directly; engine.characters.findPath uses it automatically once ready.
 * The mesh comes from the ground API's staticTrimeshes() (the level's walkable mesh);
 * collision boxes / circles (level col_ walls, those added by collision.addBox) all become dynamic obstacles and update automatically when added or removed.
 */
export interface Nav {
  /** The navmesh has been generated */
  readonly ready: boolean;
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
  /** +1 on rebuild / unload: code that cached native objects (crowd agents etc.) must recreate them when it changes */
  readonly version: number;
  /** Path from from to to [{ x, z }…] (meters); null if not ready or unreachable. Usually use engine.characters.findPath */
  findPath(from: PositionLike, to: PositionLike, opts?: { radius?: number; detailed?: false }): XZ[] | null;
  /** Pass detailed: true: returns { status: 'ok' | 'noPath' | 'notReady', path }, telling "unreachable" from "mesh not generated yet" */
  findPath(from: PositionLike, to: PositionLike, opts: { radius?: number; detailed: true }): { status: 'ok' | 'noPath' | 'notReady'; path: XZ[] | null };
  /** Character size actually in effect (from engine.movement, or the override in nav()) */
  readonly agent: { radius: number; height: number; maxClimb: number; maxSlope: number } | null;
  /** Unload the navmesh (frees native objects); characters.findPath then falls back to A* */
  dispose(): void;
}
