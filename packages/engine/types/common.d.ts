// Shared small types. three.js objects are the real @types/three classes (a dependency of this package),
// re-exported here so engine declarations and game JSDoc can name them without importing 'three'.
export type { Object3D, Vector3, Vector2, Color, Quaternion, Material, BufferGeometry, Texture, Light } from 'three';
import type { Object3D, Vector3, Color } from 'three';

/** Color forms: 0xff8800, '#f80', 'orange' or THREE.Color */
export type ColorLike = number | string | Color;
/** 3D position forms: [x, y, z], { x, y, z } or THREE.Vector3 / Object3D */
export type Vec3Like = number[] | { x?: number; y?: number; z?: number } | Vector3;
/** Anything that can be passed where a position is expected: [x, y, z], { x, y, z }, THREE.Vector3, or a three.js object (its position is used) */
export type PositionLike = Vec3Like | Object3D;
/** A point on the horizontal plane (meters) */
export interface XZ { x: number; z: number }
/** A direction on the horizontal plane (unit length) */
export interface DirXZ { x: number; z: number }
/** Two numbers: [min, max] or [start, end]; a single number means both ends are the same */
export type Range = number[] | number;
/** An easing name, or your own function t => t*t (input 0–1, output 0–1) */
export type EaseName =
  | 'linear' | 'smooth'
  | 'inQuad' | 'outQuad' | 'inOutQuad'
  | 'inCubic' | 'outCubic' | 'inOutCubic'
  | 'inSine' | 'outSine' | 'inOutSine'
  | 'inExpo' | 'outExpo' | 'inOutExpo'
  | 'inBack' | 'outBack' | 'inOutBack'
  | 'outElastic' | 'outBounce';
export type Ease = EaseName | ((t: number) => number);
/** A few known names (with autocomplete), other strings are accepted too (a style is a plain object, its strings are not treated as fixed values) */
export type Loose<T extends string> = T | (string & {});
/**
 * Handle: returned by every "add / register / listen / attach" API (events.on, onFrame, clock.after, collision.addBox, interactions.add, rays.addStatic…),
 * call remove() to undo that registration (removes the listener, collider, timer…; safe to call repeatedly). Some handles carry extra fields (such as setTarget on hud.marker)
 */
export interface Handle { remove(): void }
