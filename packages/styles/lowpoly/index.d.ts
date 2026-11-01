// Types of @threedog/style-lowpoly for code that imports it from the published package
// (TypeScript does not read JS inside node_modules, so without this the import would be untyped).
import type { Style, AssetManifest, BufferGeometry, Object3D } from 'threedog';

/** The lowpoly style pack: looks only (materials, sky, lighting, post, terrain colors, UI look). Mix with other parts: createEngine({ style: [lowpoly, { sky }] }) */
declare const lowpoly: Style;
export default lowpoly;
/** The procedural models (pine, pineLow, roundTree, roundTreeLow, rock, flower, grass): name → generator */
export const models: Record<string, (...args: any[]) => BufferGeometry | Object3D>;
/** Asset pack of those models: engine.assets.manifest(assets) makes the names usable in content ({ model: 'pine' }) */
export const assets: AssetManifest & { name: 'lowpoly' };

/** Re-exports of @threedog/post-effects (kept for style packs that still import them from here; import from @threedog/post-effects in new code) */
export { bloom, ao, outline, OUTLINE_OFF_LAYER } from '@threedog/post-effects';
