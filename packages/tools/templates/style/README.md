# @threedog/style-__NAME__
Use: `import style, { assets } from '@threedog/style-__NAME__'; createEngine({ canvas, style })`, and `engine.assets.manifest(assets)` for its models.
Change: edit `index.js` (palette, materials, sky, post) and `models.js`; check with `threedog style check __NAME__`, look with `threedog shot`.
Guide: `recipes/35-style-from-reference.md` (making a look from a reference picture). A style holds looks only, never world rules.
