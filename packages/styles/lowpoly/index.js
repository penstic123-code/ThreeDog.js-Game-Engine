// @threedog/style-lowpoly: a private workspace package of this repository, never published. It holds no code of its own: the look lives in the
// world example's style folder (examples/world/style), and this package only re-exports it, so the tests and older games that import
// '@threedog/style-lowpoly' share that one copy instead of keeping a second one that would drift.
export { default, models, assets } from '../../engine/examples/world/style/index.js';
