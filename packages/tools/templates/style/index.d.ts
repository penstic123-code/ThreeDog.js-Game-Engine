// Types of @threedog/style-__NAME__ for code that imports it from the published package
// (TypeScript does not read JS inside node_modules, so without this the import would be untyped).
import type { Style, AssetManifest, BufferGeometry, Object3D } from 'threedog';

/** The __NAME__ style pack: looks only. Mix with other parts: createEngine({ style: [__NAME__, { sky }] }) */
declare const style: Style;
export default style;
/** The procedural models (block): name → generator */
export const models: Record<string, (...args: any[]) => BufferGeometry | Object3D>;
/** Asset pack of those models: engine.assets.manifest(assets) makes the names usable in content ({ model: 'block' }) */
export const assets: AssetManifest & { name: '__NAME__' };
