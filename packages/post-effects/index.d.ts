// Types of @threedog/post-effects for code that imports it from the published package
// (TypeScript does not read JS inside node_modules, so without this the import would be untyped).
import type { PostEffect, ColorLike } from 'threedog';
import type { Data3DTexture } from 'three';

/** Color grading (ldr, fused): contrast / saturation 1 = unchanged, temperature -1 cool .. 1 warm, optional 3D LUT (e.g. LUTCubeLoader's texture3D). On when added (enabled: false adds it off) */
export function lut(o?: { lut?: Data3DTexture | null; amount?: number; contrast?: number; saturation?: number; temperature?: number; enabled?: boolean; order?: number }): PostEffect;
/** A 3D LUT that snaps every color to the nearest of `colors` (display sRGB, nearest filter), for lut({ lut }). colors: at least 2; size: cells per side (default 32). */
export function paletteLut(colors: ColorLike[], size?: number): Data3DTexture;
/** Film grain (ldr, fused); size in device pixels, animated = new noise 24 times a second. On when added (enabled: false adds it off) */
export function grain(o?: { amount?: number; size?: number; animated?: boolean; enabled?: boolean; order?: number }): PostEffect;
/** Darker corners (ldr, fused); start: 0 center .. 1 corner. On when added (enabled: false adds it off) */
export function vignette(o?: { strength?: number; start?: number; enabled?: boolean; order?: number }): PostEffect;
/** Red / blue shift apart toward the screen edge (ldr, fused; starts a fused group because it samples the input). On when added (enabled: false adds it off) */
export function chromatic(o?: { amount?: number; enabled?: boolean; order?: number }): PostEffect;
/** Depth of field (hdr, heavy on weak devices, reads scene depth; passes it on, so it can be on with outline when its order is lower, lines then stay sharp); meters / device pixels. On when added (enabled: false adds it off) */
export function dof(o?: { focus?: number; range?: number; falloff?: number; maxBlur?: number; enabled?: boolean; order?: number }): PostEffect;

/** Bloom (glow around bright pixels; hdr, heavy on weak devices). On when added (enabled: false adds it off) */
export function bloom(o?: { strength?: number; radius?: number; threshold?: number; enabled?: boolean; order?: number }): PostEffect;
/** Ambient occlusion (soft contact shadows in corners; hdr, heavy on weak devices). On when added (enabled: false adds it off) */
export function ao(o?: { radius?: number; intensity?: number; enabled?: boolean; order?: number }): PostEffect;
/** Outline (hdr, reads scene depth). On when added (enabled: false adds it off). mode 'depth' (default) = silhouettes, 'normal' = creases (an extra scene render), 'both'; wobble = line jitter in pixels; offLayer = objects with that three.js layer enabled get no lines (use OUTLINE_OFF_LAYER) */
export function outline(o?: { color?: ColorLike; thickness?: number; strength?: number; mode?: 'depth' | 'normal' | 'both'; fadeWithDistance?: boolean; wobble?: number; offLayer?: number | null; enabled?: boolean; order?: number }): PostEffect;
/** Layer number (29) for outline({ offLayer }): mesh.layers.enable(OUTLINE_OFF_LAYER) exempts that object from the lines */
export const OUTLINE_OFF_LAYER: number;
