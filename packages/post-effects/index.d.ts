// Types of @threedog/post-effects for code that imports it from the published package
// (TypeScript does not read JS inside node_modules, so without this the import would be untyped).
import type { PostEffect } from 'threedog';
import type { Data3DTexture } from 'three';

/** Color grading (ldr, fused): contrast / saturation 1 = unchanged, temperature -1 cool .. 1 warm, optional 3D LUT (e.g. LUTCubeLoader's texture3D) */
export function lut(o?: { lut?: Data3DTexture | null; amount?: number; contrast?: number; saturation?: number; temperature?: number; enabled?: boolean; order?: number }): PostEffect;
/** Film grain (ldr, fused); size in device pixels, animated = new noise 24 times a second */
export function grain(o?: { amount?: number; size?: number; animated?: boolean; enabled?: boolean; order?: number }): PostEffect;
/** Darker corners (ldr, fused); start: 0 center .. 1 corner */
export function vignette(o?: { strength?: number; start?: number; enabled?: boolean; order?: number }): PostEffect;
/** Red / blue shift apart toward the screen edge (ldr, fused; starts a fused group because it samples the input) */
export function chromatic(o?: { amount?: number; enabled?: boolean; order?: number }): PostEffect;
/** Depth of field (hdr, costly, reads scene depth so it cannot be on together with another depth reader such as the outline); meters / device pixels */
export function dof(o?: { focus?: number; range?: number; falloff?: number; maxBlur?: number; enabled?: boolean; order?: number }): PostEffect;
