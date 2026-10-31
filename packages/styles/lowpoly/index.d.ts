// Types of @threedog/style-lowpoly for code that imports it from the published package
// (TypeScript does not read JS inside node_modules, so without this the import would be untyped).
import type { Style, PostEffect, ColorLike, AssetManifest, BufferGeometry, Object3D } from 'threedog';

/** The lowpoly style pack: looks only (materials, sky, lighting, post, terrain colors, UI look). Mix with other parts: createEngine({ style: [lowpoly, { sky }] }) */
declare const lowpoly: Style;
export default lowpoly;
/** The procedural models (pine, pineLow, roundTree, roundTreeLow, rock, flower, grass): name → generator */
export const models: Record<string, (...args: any[]) => BufferGeometry | Object3D>;
/** Asset pack of those models: engine.assets.manifest(assets) makes the names usable in content ({ model: 'pine' }) */
export const assets: AssetManifest & { name: 'lowpoly' };

/** Bloom effect for style.post (hdr slot, off by default on low-tier devices) */
export function bloom(o?: { strength?: number; radius?: number; threshold?: number; enabled?: boolean; order?: number }): PostEffect;
/** Ambient occlusion effect for style.post (hdr slot, off unless enabled) */
export function ao(o?: { enabled?: boolean; order?: number }): PostEffect;
/** Depth-edge outline effect for style.post (hdr slot, before bloom, off unless enabled) */
export function outline(o?: { color?: ColorLike; thickness?: number; strength?: number; enabled?: boolean; order?: number }): PostEffect;
