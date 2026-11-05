# 60 Make the picture look good: what each knob does and how to judge it

A map for visual polish: when you want to tune the picture, make a scene look prettier or closer to what the game wants, this page lists the
knobs, what each one changes on screen and how to tell it is right. **It is not a list of steps and nothing here is required**: pick the knobs
your style needs and leave the rest alone. There are no values to copy on purpose; the right value depends on the style, the camera and the
time of day, so every row says what to look for instead.

Where the rest lives (one home each, this page only points there):
- the calls, their parameters and who writes what: [recipe 52](52-around-the-picture.md) (reading the picture, the post chain, the ownership table);
- the plain three.js way and how the engine yields to it: [THREE.md](../THREE.md) (a direct write takes the value over; the engine stops writing it);
- questions about the whole picture (light roles, readability, consistency) and the numbers each shot prints: [recipe 35](35-picture-from-reference.md) "Picture questions" and "Picture check after every shot";
- a whole picture: the game's `picture/` code ([recipe 62](62-picture-code.md), materials and lights in [recipe 09](09-materials-lights-models.md)).

## How to judge, in one loop
Change one knob, take a shot (`threedog shot`, or `threedog snap` on a running page), compare with the one before, keep or undo. Shoot the
times and weathers the game really shows (`threedog shot --time`), not only noon. A knob is right when the difference you wanted is visible
and nothing else got worse; when you cannot say what difference a knob should make, leave it at the style's value.

## The knobs

| Knob | What it changes on screen | It is right when | Engine line (details) | Plain three.js |
|---|---|---|---|---|
| Sky gradient, horizon | the color from the top of the sky down to where it meets the ground | the horizon band and the fog agree where they meet; the top-to-horizon change matches the hour and mood; no visible seam | `engine.sky.top`, `engine.sky.horizon` ([08 §3](08-weather-sky.md#3-changing-sky-colors-sun-stars)); own shader: share `engine.uniforms.uSkyHorizon` / `uSkyTop` ([08](08-weather-sky.md#sky-color-for-my-shader-horizon-color-zenith-color)) | `engine.sky.replace(mySky)` with three/addons `Sky` or a `ShaderMaterial` dome |
| Fog near / far | how fast distant things fade | the play space stays clear, the far edge of the world dissolves instead of ending in a line, landmarks you want seen still read | your `picture/` code ([38 Fog](38-environment-hooks.md#fog-plain-threejs-signals-your-own-math)) | `engine.scene.fog = new THREE.Fog(color, near, far)` |
| Fog color vs sky | whether the distance melts into the sky or into its own haze | distant hills fade toward the sky behind them; a fog color of its own is a choice you can name (smoke, mist, a dream) | your `picture/` code reads `uSkyHorizon` ([38 Fog](38-environment-hooks.md#fog-plain-threejs-signals-your-own-math)) | `engine.scene.fog.color.set(c)` |
| Exposure | overall brightness after lighting | the brightest things you care about keep detail and the darkest still read; a night is dark because the lights are, not because exposure hides it | `engine.renderer.toneMappingExposure = 1.2` ([38 Exposure](38-environment-hooks.md#exposure-and-the-tone-curve)) | `engine.renderer.toneMappingExposure = v` |
| Tone mapping curve | how highlights roll off and how saturated bright colors stay | bright colors keep their hue where the style wants color, highlights soften where it wants film; flat-color styles may want almost no curve | (plain three.js is the route; [52 Who writes it](52-around-the-picture.md#who-writes-it-the-ownership-table)) | `engine.renderer.toneMapping = THREE.AgXToneMapping` (or ACESFilmic, Neutral, No) |
| Sun direction | where shadows fall and which faces are lit | shapes read from the camera (lit side and shaded side both visible), shadows point somewhere useful, the hour looks like the hour | time of day (`engine.calendar`, [06](06-clock-events.md)); sun path: `engine.sky.orbit.tilt`; the lights do not move on their own: aim yours from `engine.uniforms.uSunDir` ([62](62-picture-code.md)) | `engine.lights.sun.position.set(x, y, z)`, or your own `DirectionalLight` |
| Sun color, intensity | the key light: color and strength of lit faces | lit and shaded sides separate; whites under the sun are the white the style wants (warm, neutral, cool) | your `picture/` code writes the light ([62](62-picture-code.md)) | `engine.lights.sun.color.set(c)` |
| Ambient / hemisphere, environment | the fill: how bright and what color the shaded side is | shadows are as deep as the style wants and still show shape; up-facing and down-facing faces differ; metals have something to reflect | your `picture/` code writes the hemisphere light and `scene.environment` ([34](34-environment-lighting.md), [08 brightness](08-weather-sky.md#3-changing-sky-colors-sun-stars)) | `engine.lights.hemi.groundColor.set(c)`, `engine.scene.environmentIntensity = v` |
| Shadow softness | hard or blurred shadow edges | edges match the light (crisp under a clear sun, soft under cloud or for a gentle style); no stair-steps or speckle | `renderer.shadowMap.type`, `light.shadow.radius` ([52 Atmosphere](52-around-the-picture.md#atmosphere-fog-sky), [45](45-cascaded-shadows.md)) | `engine.lights.sun.shadow.radius = r` |
| Shadow distance, detail | how far shadows reach and how sharp small ones are | the area the player looks at has shadows; small props keep theirs; objects touch the ground (no gap under a foot) | `engine.shadows.box(sun, { extent })`, `engine.shadows.cascades(sun, { count, maxFar })`, `sun.shadow.bias` ([45](45-cascaded-shadows.md)) | `engine.lights.sun.shadow.camera` sides, `engine.lights.sun.shadow.mapSize` |
| Bloom | light bleeding around bright pixels | the bright things you meant (sun, lamps, magic) glow and nothing else does; the picture does not turn milky | `engine.post.add(bloom())` from `@threedog/post-effects`, then `engine.post.get('bloom').set({ strength })` ([52 Post chain](52-around-the-picture.md#post-effect-chain)) | `engine.post.add(new UnrealBloomPass(size, strength, radius, threshold))` |
| Light glow / halo | lamps, windows, signs that read as lit | a glowing object keeps its hue at the center (it is not a white block), has a halo where bloom is on, and lights its surroundings if it should | `engine.uniforms.uNight` ([09 §1b](09-materials-lights-models.md#night-glow-emissive-that-follows-daylight)); many lamps: `lightPool` ([09 §1b](09-materials-lights-models.md#1b-lights-and-stalls)) | `material.emissive` / `material.emissiveIntensity`, an additive `THREE.Sprite` for a halo |
| Water, sea | color with depth, waves, foam, what it reflects | shallow and deep read differently, the far sea meets the sky without a seam, foam sits where waves break | `engine.water.shader({ depthColor, foam })`, `engine.water.uniforms.uWave` ([44](44-water-weather-hooks.md)) | three/addons `Water`, or a `ShaderMaterial` that reads `engine.uniforms.uSkyHorizon` ([44 own material](44-water-weather-hooks.md#water-your-own-material-reflections-refraction)) |
| Wet ground | streets and stone after rain | wet is darker and glossier together, gloss shows reflections of something bright, puddles have soft edges | no engine picture: read `engine.uniforms.uRain`, then write `material.color`, `material.roughness` ([08 §7](08-weather-sky.md#7-wet-roads-and-puddles-after-rain)) | `material.roughness`, `material.color` on your ground material |
| Color grading | contrast, saturation and warm / cool shift of the whole frame | the frame has the mood you named; skin, foliage and the player's colors still read | `engine.post.add(lut())` from `@threedog/post-effects` ([52 Post chain](52-around-the-picture.md#post-effect-chain)) | `engine.post.add(new LUTPass({ lut }))` |
| Cloud shadow | moving dark patches on the ground | the patches drift slowly enough to read as clouds, are as dark as the sky is cloudy, and do not hide gameplay | `engine.uniforms.uCloudShadow`, `uCloudShadowScale`, `uCloudShadowSpeed`; clouds in the sky: `engine.uniforms.uCloudCover`, `uSkyCloudScale`, `uSkyCloudSpeed` ([08](08-weather-sky.md)) | your own patch: `engine.shaderTerms.cloudShadow(spec)` ([52](52-around-the-picture.md)) |
| Grain, vignette | film noise; darker frame corners | you notice the mood, not the effect; text and the HUD stay clean | `engine.post.add(grain())`, `engine.post.add(vignette())` ([52 Post chain](52-around-the-picture.md#post-effect-chain)) | a pixel snippet: `engine.post.add({ name, fuse: { glsl }, slot: 'ldr' })` |
| Ambient occlusion | darker creases and contact corners | objects sit on the ground and corners have weight; no dark halo around thin things | `engine.post.add(ao())` ([52 Post chain](52-around-the-picture.md#post-effect-chain)) | three/addons `GTAOPass` through `engine.post.add(pass)` |
| Outline | lines around shapes | lines help read shapes at play distance and match the style's line weight | `engine.post.add(outline())` ([52 Post chain](52-around-the-picture.md#post-effect-chain)) | three/addons `OutlinePass` through `engine.post.add(pass)` |
| Surface shading | how light falls across a surface (smooth, banded, flat) | materials that should differ (wood, stone, metal, cloth) differ in response, not only in color | `applyEffects(mat, { lighting })`, `rampTexture` ([43](43-shader-patches-surfaces.md), [09](09-materials-lights-models.md)) | `new THREE.MeshToonMaterial({ gradientMap })` or any material of yours |
| God rays, volumetric fog | light shafts, fog thick in the air | shafts come from where the light is and fade when it leaves the screen | your own depth effect ([59](59-depth-post-effects.md)) | a Pass of yours through `engine.post.add(pass)` |

## When the picture check names a feature
The check printed after every shot states a fact and, where the engine has a feature for it, one line of usage. Each is a way out, not a request: a
hard-edged or pitch-dark look may want exactly what was measured. All of them read the lights in the scene, the game's own included.

| The check says | What it measured | Where it points |
|---|---|---|
| one shadow texel covers X m | the size on the ground of one shadow map pixel, when shadows do not show | cascades: `engine.shadows.cascades(engine.lights.sun, { count })` for the engine sun, `engine.shadows.cascades(light, { count: 3 })` on your own light ([recipe 45](45-cascaded-shadows.md)) |
| over budget | lit point and spot lights, shadow maps, the largest map size, against `engine.budget` | many lights: `engine.lightPool` ([recipe 09](09-materials-lights-models.md)); shadows: `castShadow`, `light.shadow.mapSize` picked from `engine.tier` |
| shadows nearly black | how much the fill adds on the shadowed pixels themselves | `engine.bakeProbes` ([recipe 34](34-environment-lighting.md)) or a fill light |
| shadow stripes, stepped edges | the shadow alone, at canvas pixels: thin bands, or stairs along an edge | the bias, map size and shadow range it lists; stairs also the cascades above |
| fog covers X% | how much of the picture is fog color; printed before a line about the night, since the fog comes first | `scene.fog` |

Limits a game sets per device go through the same check: `engine.budget.enable(engine.tier === 'low' ? { lights: 4 } : { lights: 12 })`. A limit you wrote is
reported as your own intent; the engine's default line for lights is only a fact.

## Same knob, different styles
A knob is a direction, not a setting. Three styles, the same three knobs, moved different ways:

| Knob | Realistic dusk | Flat cartoon | Gloomy rainy night |
|---|---|---|---|
| Key against fill (sun, hemisphere) | a low, warm key against a cool fill: long shadows, faces lit on one side | a soft key and a strong fill, so shadows are a shape of color, not darkness; little warm / cool split | almost no key; the fill is dim and cool, and the light comes from lamps and windows instead |
| Fog | follows the horizon color; starts far, so the distance turns golden-grey | often light or off, so the bright flat colors stay clean; if on, a pale tint of the sky | close and dark, a color of its own (blue-grey), so lamps are islands in it |
| Bloom and glow | a gentle bloom on the sun and the first lit windows | little or none; glowing things are a brighter flat color | lamps and signs carry it: saturated glow, a halo through the rain, reflections on the wet ground below |

Read the other knobs the same way: ask what the style wants the viewer to notice first, then move the knob toward that and stop when the shot
shows it.
