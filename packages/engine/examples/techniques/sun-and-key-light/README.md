Sun and key light: sun direction for composition, key-to-fill ratio (hard noon / soft overcast / golden hour side by side), warm key with cool shadows, and shadow softness, bias and box size.

# Sun and key light (technique example)

A neutral gray yard: where the sun stands, how strong it is against the fill light, what color each has, and how its shadow is filtered.
Run `npm run dev` and open `/sun-and-key-light.html`. The engine never imports this folder.

| URL | What changes |
|---|---|
| `?route=noon \| overcast \| golden` | one of three lighting routes (default `golden`) |
| `&sun=front \| side \| back \| low \| top` | the sun direction relative to the camera, keeping the route's colors and strengths |
| `&tint=0..1.5` | how far key and fill are pushed apart in color (0 = white light, gray shadows; 1 = the route) |
| `&shadow=basic \| pcf \| vsm` `&radius=N` `&extent=M` `&bias=cm` `&cascades=1..4` | the shadow filter, softness, box half size, depth bias in centimeters, cascades |

All values sit in the parameter block at the top of `main.js` (`ROUTES`, `DIRECTIONS`, `SHADOW_FIT`, `CAMERA`).
Related techniques (separate examples, not repeated here): `contact-shadows` (small objects resting on things), `day-night-grade`
(the whole day's color curve), `night-lights`, `stylized-shading`, `outlines-and-rim` (a drawn rim instead of a lit one), `interior-light`.

## The principle
**Key and fill.** The sun is the key: one direction, one color, the only light that casts a shadow here. The fill is everything else (sky and
ground light, the environment). A lit surface gets key + fill, a shadowed one only fill, so their ratio is how dark shadows read. Lower fill
-> harder, more graphic, more dramatic; higher fill -> softer, calmer, more readable in the shadows. There is no right ratio: it follows what
the game wants the player to feel and to see. Fill that is as bright as the key leaves nothing for the shadow to darken.

**Airy vs gray-flat.** Both have a low ratio. A scene reads *airy* when the fill is bright and has color (sky blue from above, a warm bounce
from below) and the values stay high; it reads *gray-flat* when the fill is dim and colorless, so everything sits in one mid-gray band. If
an overcast scene looks dead, raise the fill's brightness or color before adding contrast back with the sun.

**Direction is composition.**
- A high sun (`?sun=top`) lights every top face the same and hides every side: short shadows under things, shapes read as cutouts. That is
  why noon light looks flat in games, and why many games keep their "day" sun around mid-height instead.
- A side sun (`?sun=side`) splits each form into a lit half and a shaded half: the best light for showing shape.
- A low sun (`?sun=low`, the golden route) throws long shadows that draw lines across the ground and lead the eye; the ground gets darker
  (it receives the key at a grazing angle) while walls facing the sun get brighter: low light is about vertical faces.
- A back sun (`?sun=back`) makes silhouettes and lights the edges toward the camera (a rim). Good for drama and for separating a character
  from the background; the faces toward the camera fall into fill, so the fill decides whether they still read.
- A front sun (`?sun=front`, behind the camera) shows the least shape: shadows fall behind the objects.

**Colored shadows.** Outdoors the key is warm (sun) and the fill is cool (blue sky), so shadows are blue-ish and lit faces warm. The
temperature difference does a lot of the work contrast would otherwise do. It is too far when skin or materials stop reading as themselves
in the shadows; check a shot with a known-colored object in shadow.

**Hard vs soft shadow edges.** Edge softness says how big the light looks: a clear sun gives crisp edges (a little blur hides the shadow map's
pixels), an overcast sky gives very soft shadows that are mostly contact darkening. Match the edge to the fill: hard edges with a bright, soft
fill look like a render error.

**Shadow detail is texels per meter.** A texel is `2 x extent / mapSize`. A big box in a small scene blurs or loses the shadows of small
objects; a small box in a big world cuts shadows off. Match the box to what the camera sees. A depth bias that is too large detaches or
removes contact shadows.

How to judge it in a shot at the game's camera: can you still read the shapes inside the shadows (if the game needs that), and do the lit
sides separate from the shadow sides at a glance? Read the real lit : shadow ratio in a shot rather than estimating it from light numbers.
`threedog shot` and `threedog snap` print it as the `light:` fact: the share of the lit brightness from the key and from the fill (each turned
off once) and how much darker the shadowed areas are, with the light parameters and their values.

## Plain three.js
- Key: [DirectionalLight](https://threejs.org/docs/#api/en/lights/DirectionalLight) — `position` relative to `target` sets the direction,
  `color` and `intensity` the key. Fill: [HemisphereLight](https://threejs.org/docs/#api/en/lights/HemisphereLight) (sky / ground colors) and
  `scene.environment` with `material.envMapIntensity`.
- Shadow: `renderer.shadowMap.type` (`BasicShadowMap`, `PCFShadowMap`, `VSMShadowMap`), `light.shadow.radius`, `shadow.blurSamples` (VSM),
  `shadow.mapSize`, `shadow.camera` bounds, `shadow.bias`, `shadow.normalBias`
  ([LightShadow](https://threejs.org/docs/#api/en/lights/shadows/LightShadow), [webgl_shadowmap_vsm](https://threejs.org/examples/#webgl_shadowmap_vsm)).
- Large views: `CSM` from `three/addons/csm` ([webgl_shadowmap_csm](https://threejs.org/examples/#webgl_shadowmap_csm)).
- Debugging the box: `CameraHelper(light.shadow.camera)` ([CameraHelper](https://threejs.org/docs/#api/en/helpers/CameraHelper)).

## Style routes
- **Realistic / naturalistic**: warm key, cool fill, `tint` around 1, pcf radius 1-2, a ratio chosen per time of day.
- **Painterly / storybook**: push `tint` higher, soften shadows (vsm or larger radius), raise colored fill: shadows become a color, not a dark.
  VSM costs a blur pass.
- **Toon / cel**: hard edges (`basic` or pcf radius 0-1), a clear key direction, the light-to-shadow step handled by the material ramp
  (`stylized-shading`). Cheapest filter.
- **Low-poly / flat**: side or three-quarter light so faces separate by value; a moderate ratio keeps the flat colors readable.
- **Noir / horror**: low or back key, very low fill, little color in the fill; the silhouette carries the scene.
- **Pixel art**: `basic` shadows, hard and aliased on purpose, with a map sized so a texel matches the art's pixel.

## The engine helper (optional convenience)
`threedog examples pull sun-and-key-light` copies `keyLight.js` and this README into the game: `applyKeyFill(engine, route, { tint })` sets
key and fill colors and strengths (owner `key-light`), `aimSun(engine, { elevation, azimuth, camera })` places the sun relative to the camera,
`fitSunShadow(engine, { extent, biasCm, normalBias })` fits the box and converts the bias from centimeters.

The three routes, side by side:

| | noon | overcast | golden |
|---|---|---|---|
| sun elevation / azimuth | 72° / 35° | 58° / 40° | 13° / 50° (three-quarter) |
| key (sun) | 2.7, warm white | 0.9, near white | 5, orange |
| fill (hemi + env) | 0.35 + 0.1, blue | 1.5 + 0.3, pale gray-blue | 0.55 + 0.1, blue |
| shadow | pcf, radius 1 | vsm, radius 14 | pcf, radius 2 |
| measured ground lit : shadow (linear light) | about 4.3 : 1 | about 1.25 : 1 | about 1.9 : 1 |
| look numbers (`threedog shot`) | luminance 0.60, contrast 0.07 | 0.63, 0.06 | 0.51, 0.12 |

The measured ratios are what this scene gives, not targets. The golden route has a lower ratio *on the ground* than noon (the key arrives at
13°) and a much higher one on walls facing the sun. The light-number estimate in `main.js` (`ratio`) overstates every ratio because the room
environment adds more fill than its intensity number suggests. `tint=0` is a neutral studio, `tint=1` a natural afternoon, `tint=1.5` a
painterly or stylized look.

Shadow softness and cost (GPU path):
- `basic`: one hard tap, cheapest; aliased edges. Fine for pixel art or a hard toon look.
- `pcf` + `radius`: the default. A few taps; `radius` widens the blur in shadow-map pixels, so the same radius is softer with a bigger box
  or a smaller map. Cost grows little with radius.
- `vsm` + `radius` + `blurSamples`: the softest, wide penumbras for overcast or stylized looks; a blur pass and float targets (the engine's
  rough estimate: 1.6x the pcf shadow pass). Can show light bleeding where two casters overlap.
- This yard fits +-12 m, 1.2 cm per texel (the texel formula and the engine default are in recipe 52, "Atmosphere parts").
- Cost scales with the casters drawn into the map (each shadow-casting light draws them once more) and the map's pixel count.
  `engine.budget.byTag()` and `threedog stress` show it for your scene; this example does not measure milliseconds.

Cascades vs one fitted shadow: one fitted box (this example, `follow: false`, `extent` around the play area) is the sharpest and cheapest when
the camera sees a bounded area: a room, an arena, a top-down board. A large open world with a free camera wants cascades (`?cascades=3`,
`look.shadow.set({ cascades: 3, maxFar })`, recipe 45): sharp near the camera, coarse far away, at the cost of drawing the casters once per
cascade and a recompile when switched. Before adding cascades, try a smaller `extent` or `maxFar`.

Lessons from real demos:
- **Bias too large removed contact shadows.** The old sky bias was about 25 cm in world depth, so anything resting on the ground lost the
  shadow at its base. The engine default is now about 2 cm (`bias: -0.00005` over a 420 m shadow depth), with `normalBias` (meters) doing
  most of the work against acne. Try `?bias=25` and look at the small cube and ball: their shadows detach or vanish.
- **Strong hemisphere + environment washes shadows out.** The shot check reports "shadows on but none measurable". Lower the fill
  (`look.lights.set({ hemi })`, `env`) or the sky's ambient before blaming the shadow settings.
- **A +-70 m shadow box blurs small objects in a compact scene.** Try `?extent=70`: the 10 cm cube's shadow turns into a smudge. Fit the box.

Rules (correctness):
- The engine's sky owns the sun, hemisphere, fog and shadow box. Change them through it: `engine.look.lights.set({ sun, hemi, env })`
  (an override layer over the keyframes), `engine.look.shadow.set({...})`, `engine.look.sky.set({ backdrop })`. To aim the sun yourself,
  take only its direction: `engine.look.lights.manual('sun.direction')`, then place `sun.position` relative to `sun.target`. A plain write
  without `manual` also works but the engine warns that it stopped writing the value (recipe 52, the ownership table).
- With the sky, a game that wants a fixed sun direction also wants `look.shadow.set({ follow: false })`, or the shadow box keeps moving
  with `engine.focus` (here the box is centered on the yard).
- `PCFSoftShadowMap` is gone in three 0.187 (three warns and uses PCF). Soft PCF edges come from `radius`; the engine's types are
  `basic`, `pcf`, `vsm` (`look.shadow.set({ type })`). Switching the type recompiles every lit material: do it on a settings screen.
- `bias` is in the shadow camera's 0-1 depth, so its size in meters is `bias x (far - near)`. The page converts from centimeters:
  `bias = -cm / 100 / (shadow.camera.far - shadow.camera.near)`. `normalBias` is already in meters.
- Do not name your page's URL parameters `time`, `view`, `weather`, `pos`, `season`, `state`, `save`, `wait` or `cutscene`: those are the
  engine's scenario keys (`?time=12:00` sets the drawn time).

Sources: written for this repository, no code copied. Background reading: three.js `DirectionalLight` / `LightShadow` docs and source (0.187),
the three.js shadow-map examples, and general cinematography and game-lighting writing on key / fill / rim lighting and color temperature.
