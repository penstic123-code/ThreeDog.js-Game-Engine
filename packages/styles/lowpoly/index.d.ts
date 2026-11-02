// Types of @threedog/style-lowpoly (private, never published; re-exports packages/engine/examples/world/style) for code that imports it by
// package name (TypeScript does not read JS inside node_modules, so without this the import would be untyped).
import type { Style, AssetManifest, BufferGeometry, Object3D } from 'threedog';

/** The lowpoly style pack: looks only (materials, sky, lighting, post, terrain colors, UI look). Mix with other parts: createEngine({ style: [lowpoly, { sky }] }) */
declare const lowpoly: Style;
export default lowpoly;
/** The procedural models (pine, pineLow, roundTree, roundTreeLow, rock, flower, grass, the character body humanoid, and the ground pickup shape pickup): name → generator */
export const models: Record<string, (...args: any[]) => BufferGeometry | Object3D>;
/** Asset pack of those models: engine.assets.manifest(assets) makes the names usable in content ({ model: 'pine' }) and for characters ({ model: 'humanoid' }) */
export const assets: AssetManifest & { name: 'lowpoly' };
