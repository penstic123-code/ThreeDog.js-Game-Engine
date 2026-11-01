// __NAME__ (@threedog/style-__NAME__): a style pack, LOOKS ONLY (packages/engine/docs/recipes/09-style-pack.md, recipes/35-style-from-reference.md).
// Start from the neutral values below and change them toward your reference picture; `threedog style check __NAME__` reports mistakes
// (unknown fields, missing palette keys, bad colors, post-effect conflicts) and `threedog shot` shows the result.
// Not here: the shape of the world (water level, terrain), gameplay data, sounds. Omitted entries fall back to the engine's gray placeholders.
import { models, PALETTE } from './models.js';

export { models };
/** Asset pack of the procedural models: engine.assets.manifest(assets) registers `block` as a model name */
export const assets = { name: '__NAME__', models };

export default {
  name: '__NAME__',
  exposure: 1,
  toneMapping: 'neutral',        // 'aces' | 'agx' | 'neutral' | 'none'
  background: 0xc8d0d8,

  // Post effects in render order; empty = none. Borrow some: import { bloom, outline } from '@threedog/style-lowpoly'
  post: [],

  // Material per role (default, terrain, vegetation, character, water, pickup, prop). type: 'lambert' | 'phong' | 'standard' | 'toon' | 'basic'
  materials: {
    default: { type: 'lambert', color: 0x9a9a9a },
    water: { type: 'phong', shininess: 60 },
  },

  // Colors the procedural models read (models.js); one change retints every model
  palette: PALETTE,

  // Sky: [time 0-1, zenith color, horizon color (= fog color), sun color, sun intensity, ambient intensity]
  sky: {
    keyframes: [
      [0.00, 0x10141c, 0x242a36, 0x8090b0, 0.4, 0.35],
      [0.30, 0x7898b8, 0xd8c8b0, 0xffd8b0, 1.8, 0.8],
      [0.50, 0x6890c0, 0xd0dce8, 0xffffff, 2.8, 1.1],
      [0.70, 0x7090b8, 0xd8c8b0, 0xffd8b0, 1.8, 0.8],
      [1.00, 0x10141c, 0x242a36, 0x8090b0, 0.4, 0.35],
    ],
    groundTint: 0x707070,
  },

  // Ground type colors go in terrain: { colors, biomeColors } (the names come from the terrain generator the game uses)
  // UI colors: ui: { bg, fg, muted, accent, line, font, radius }
};
