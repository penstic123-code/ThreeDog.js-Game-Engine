Stylized shading: toon bands (ramp texture or smoothstep), painterly soft light, stylized PBR, side by side on the same neutral models.

# Stylized shading (technique example)

Reshaping how the sun lands on a surface. Five columns of the same gray house, capsule, ball and ground tile: toon by ramp texture, toon by
smoothstep, painterly, stylized PBR, and the "plastic" mistake for comparison. Page `/technique-shading.html` (`npm run dev`). The engine
never imports this folder.

## The principle
A shaded surface is read through three things: where light turns into shade (the terminator), how hard that turn is, and what color the
shade has. Stylizing is choosing those three on purpose instead of leaving them to a physical default. The columns are routes, not a ranking;
choose from what the game's picture should feel like.
- **Bands** (toon): the light share is cut into a few levels. Few bands read from far away; more bands drift back towards smooth shading.
- **Soft wrap** (painterly): light wraps past the terminator, so forms read soft and light; a warm band at the terminator and colored shadows
  are what a painter adds and a renderer does not.
- **Restraint in the inputs** (stylized PBR): the style comes from chosen roughness and albedo per surface, not from a special shader.
- **Shade carries the mood** more than the light side does: a cool shade under a warm sun reads as daylight, a gray shade reads as overcast or
  as "not designed yet".
- **Why things look plastic** (the last column): one low roughness on everything, a specular highlight on every surface, and flat albedo
  with no variation. Any one of them alone is fine; together they read as injection-molded toys. Check: is the highlight on the ball the
  brightest, sharpest thing in the shot? Then roughness is doing the styling instead of the art.

How to judge it: shoot at the game's real camera (`threedog shot /your-page --gpu`). The bands, terminator or shade color should still be
visible at that distance; if a technique only shows in a close-up, it is not part of the game's picture. A very low contrast with no clipped
areas in the shot's picture numbers usually means the fill light (hemisphere, environment) is as strong as the sun.

## Plain three.js
- Toon: [MeshToonMaterial](https://threejs.org/docs/#api/en/materials/MeshToonMaterial) with a `gradientMap` (a small `DataTexture`,
  `NearestFilter`) ([webgl_materials_toon](https://threejs.org/examples/#webgl_materials_toon)). It bands every light (point lights too), but
  reads only the red channel of its gradientMap, looks it up at `n.l * 0.5 + 0.5` (the left half of the ramp is the side turned away), and has
  no place for a shade color.
- Custom bands, wrap, shadow tint: `material.onBeforeCompile` on `MeshStandardMaterial` / `MeshLambertMaterial`, changing the direct-light
  term after three sums the lights; keeps shadows, fog and every light type.
- Stylized PBR: [MeshStandardMaterial](https://threejs.org/docs/#api/en/materials/MeshStandardMaterial) `roughness`, `metalness`, `color`
  chosen per surface, and usually an ambient floor (`HemisphereLight`) so shade keeps some color; if your game wants black shadows, leave it out.
- Fully custom: [ShaderMaterial](https://threejs.org/docs/#api/en/materials/ShaderMaterial) with `UniformsLib.lights`, at the cost of
  re-implementing shadows and fog.

## Style routes
- **Flat graphic** (cel-shaded, comic, anime-like, poster): toon. A ramp texture suits an art-directed ramp with colored bands; smoothstep
  suits a band count or border softness that changes at run time (a hit flash, a mood). A few ALU and one texture read.
- **Soft illustrated** (storybook, gouache, watercolor-like): painterly wrap, warm terminator, cool shadows. A few ALU.
- **Grounded but designed** (stylized adventure, "hand-painted 3D", most mid-poly games): stylized PBR. No shader change.
- **Unlit / baked**: `MeshBasicMaterial` with light painted into textures or vertex colors. Cheapest; lighting no longer changes with the sun.
- **Pixel art**: two or three hard bands from a palette, nearest-filtered ramp. Same cost as toon.

## The engine helper (optional convenience)
Copy `shading.js` into a game; `main.js` (shapes) and `picture/` (this page's whole picture, plain three.js; knobs in `picture/palette.js`) are only the demo. Every route is a patch in three's own lit material
(`applyEffects(material, { patches })`, slots `lightsPars` and `lighting`, recipe 43). The patch runs after three has summed the lights,
re-reads the sun's direction and its shadow-map value, and changes only the sun's share (or the ambient's color). Because the light loop is
untouched, the materials keep your sun and shadows, hemisphere and point lights, fog, cloud shadows and seasons. Nothing edits
`THREE.ShaderChunk`, and every number is a uniform, so materials that differ only in values share one shader program.
Functions: `rampTexture(stops)`, `toonMaterial({ color, ramp, bands, soft, shade })`, `toonPatch(...)` for your own material,
`painterlyMaterial({ color, wrap, terminator, shadow })`, `stylizedPbrMaterial({ color, roughness, lift })`.

| route | what the patch does | knobs (`picture/palette.js`) |
|---|---|---|
| toon, ramp texture | sun share (n.l times shadow, 0-1) looks up a 1-D texture; the texture can carry color per band | `TOON_RAMP` stops |
| toon, smoothstep | the same share cut into `bands` levels by smoothstep, `soft` = border width | `TOON_BANDS` |
| both toons | the dark band's ambient leans to `shade` at the same brightness | `TOON_SHADE` |
| painterly | wrapped diffuse (`threedogWrapDiffuse`), a warm band at the terminator, shade and cast shadow lean to a cool hue (`threedogShadowTint`) | `PAINTERLY` |
| stylized PBR | MeshStandardMaterial with roughness and albedo chosen per surface, and here a floor under the ambient so shade keeps some color | `PBR_ROUGHNESS`, `PBR_LIFT` |

Cost: a few ALU operations per pixel and one texture read for the ramp route; no extra draw, render target or pass. The shadow value is read
once more per pixel (three has already read it once), which is the most expensive part on large shadow kernels.

Rules (correctness):
- Patch, do not replace: keep three's light loop (`lighting` slot, not `lightingModel`) so shadows, fog and lights keep working.
- Index 0 of `directionalLights` is the sun only when it is the shadow-casting light (three sorts casters first). A game with several
  shadow-casting directional lights must pick its own.
- The demo's lights are its own (`picture/lights.js`, `createEngine({ lights: false })`): the sun has to be a shadow-casting light for the patches to read its shadow map. Its `RoomEnvironment` is plain three.js too; the plastic column's hot spots are that room.

Sources: written for this engine from common practice: half-Lambert / wrapped diffuse (Valve, "Shading in Valve's Source Engine", 2006),
toon ramps (three.js `MeshToonMaterial` and its examples), colored shadows and terminator color as taught in traditional painting. No code copied.
