# The ground up close: options and diagnosis

Not a standard recipe. Several pictures are right for different games, and none is the default. **Decide from the reference images first**: is the
ground flat color shapes, a painted surface, a photographic texture, or a few lit polygons? Then pick a row. If the ground already looks wrong,
jump to the symptoms.

## Approaches (pick by the picture you want)
| Picture | How |
|---|---|
| Flat color blocks, no detail (minimal, flat illustration; on purpose) | `shading: 'flat'` or `'smooth'`, `colors` / `biomeColors`, no `detail`; a few `variation.patches` with `levels` |
| Color map + detail layer + near grass (soft variation, crisp borders) | `terrain({ shading: 'texture', colorResolution, detail })`, grass with `vegetation.define(name, { nearOnly: true })` |
| Tiling or triplanar textures (your own painted, photographed or generated images) | your own material with `map` and `texture.repeat` through `terrain({ material })`, or `detail: { texture: 'name' }` (`projection: 'triplanar'` on slopes and rocks) |
| Vertex color + toon lighting | vertex colors from `colors` and `variation.jitter`, `terrain({ material })` with a `MeshToonMaterial`, `gradientMap: rampTexture(...)`; detail optional |
| Your own shader or plain three.js | `terrain({ material })`, or recipe 40 section 8 (what you give up) |

Detail noises (recipe 43): `grain` fine speckle, `paper` fibres, `stroke` directional streaks (stretched on purpose), `dabs` soft oval dabs with
no direction. `fade` (on by default) removes the detail where its pattern is smaller than a pixel. At run time: `engine.terrain.recolor({ detail })`. On any
other material: `applyEffects(mat, { detail })`, with your own function as `detail: { glsl }` (recipe 43).

Where each key is defined: `variation` (blend, jitter, patches) recipe 36; `shading`, `colorResolution`, `normals`, `normalFn`, heights from a
grid recipe 37; `detail` keys recipe 43; run-time changes `engine.terrain.recolor` recipe 36; terrain basics recipe 28.

## Symptom, causes, options
**Brushed metal at grazing angles.** Cause: `stroke` stretches one axis (`stretch` 6) and `world` projection looks straight down, so a flat
ground seen at a low angle shows the stretch as long streaks. Options: `noise: 'dabs'` or `'grain'` (no stretch); `stretch: 1`; a smaller
`strength`; `projection: 'triplanar'` only on slopes; no detail at all if the reference is flat.

**Slopes show terraces or creases.** Causes: heights from sparse data with linear (bilinear) interpolation show the data grid as kinks along
its cell lines (`terrain({ heightmap })` always reads its image bilinearly; `sampleGrid` defaults to `interp: 'linear'`); a coarse mesh
`resolution` (16 per 64 m chunk = one height every 4 m); `shading: 'flat'`, which lights each triangle on its own so every facet shows.
Options, any of them: more height samples (a larger image or table), or the data smoothed before the terrain reads it; `sampleGrid(...,
{ interp: 'cubic' })` for smooth heights everywhere outside the terrain module (placement, gameplay; recipe 37 section 7; a terrain `height`
function runs in a worker and cannot capture a sampler); a finer `resolution` (more triangles, collision and edit cells); `shading: 'smooth'`,
or `normals: 'smooth'` with `shading: 'texture'`; `diagonal: 'adaptive'` against zigzag ridges; or noise in the `height` function (`n.fbm`; ridges from
folding it) instead of a sparse table. Terraces can also be the picture you want: `interp: 'nearest'`, or a stepped `height`.

**Blurry up close.** Cause: the color map is `colorResolution + 2` pixels per 64 m chunk side; 128 is 0.5 m per pixel, which is soft when the
camera is within a few meters. It does not depend on the mesh `resolution`. On a `low` tier the default is 64 (twice as coarse) unless you set
it. Options: `colorResolution: 256` (0.25 m; four times the image memory and worker time); a detail layer on top (it is computed per screen
pixel, so it stays sharp); near grass over the ground; or accept soft color and let a texture carry the fine part.

**One flat green.** Cause: not resolution. Color comes from `colors` / `biomeColors` per ground type (`groundType`), `variation.blend`
(wavelength and `strength` of the two-color noise) and `steep`. One color with no `biomeColors` and a flat blend is one green. Options: two
colors in `biomeColors` for the type; `blend.strength` 1.5; `variation.patches` with a `tint`; more ground types.

**Dark blotches.** Cause: usually cloud shadows (`engine.uniforms.uCloudShadow.value` above 0), not texture; they drift with `uCloudShadowSpeed`, and bigger clouds mean
bigger blotches. Test by setting `uCloudShadow` to 0; if they vanish, lower it or change `uCloudShadowScale`. Blotches that
never move are `variation.patches` or a strong `detail`.

**Shimmer far away.** Cause: a pattern smaller than a pixel aliases. `detail.fade` (default) fades it out; `fade: false` keeps it. In your own
`glsl`, read `threedogDetailFootprint` (one pixel in pattern units; 1 = one cell per pixel) and fade yourself. A `variation.jitter.size` below a
pixel shimmers the same way; use a few meters, or `shading: 'texture'` (mipmapped).

**Near-only vegetation fades out by distance.** Any `nearOnly` species (grass, flowers, pebbles, twigs, snow tufts, debris ...) is placed per chunk ring
(`maxRing`), whose edge would be a visible line. By default instances shrink toward their base over a band that ends at `maxRing x chunk size` from the
player (start at 65% of it), so nothing pops per chunk. Tune with `fade: { start: 20, end: 45 }` (metres), or `fade: false` for a hard edge
(e.g. a species hidden in fog anyway). It is part of the species' own material (no extra draw call or program), keeps wind sway and shadows in step, and is skipped
when `effects: false`. A larger `maxRing`, fog, or a ground color near the species' base color still help for stylized looks with strong silhouettes.
