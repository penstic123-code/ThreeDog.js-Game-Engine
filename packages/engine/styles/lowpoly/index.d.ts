// Type of the lowpoly style pack for code that imports 'threedog/styles/lowpoly' from the published package
// (TypeScript does not read JS inside node_modules, so without this the import would be untyped).
import type { Style } from '../../types/style';

/** The lowpoly style pack: a Style whose models (procedural low-poly generators) are always present */
declare const lowpoly: Style & { models: NonNullable<Style['models']> };
export default lowpoly;

type PostEffect = import('../../types/generated/render/PostFX').PostEffect;
/** Bloom effect for style.post (hdr slot, off by default on low-tier devices) */
export function bloom(o?: { strength?: number; radius?: number; threshold?: number; enabled?: boolean; order?: number }): PostEffect;
/** Ambient occlusion effect for style.post (hdr slot, off unless enabled) */
export function ao(o?: { enabled?: boolean; order?: number }): PostEffect;
/** Depth-edge outline effect for style.post (hdr slot, before bloom, off unless enabled) */
export function outline(o?: { color?: import('../../types/common').ColorLike; thickness?: number; strength?: number; enabled?: boolean; order?: number }): PostEffect;
