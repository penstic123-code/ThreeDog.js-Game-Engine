# 60 Make the picture look good: what each knob does and how to judge it

A map for visual polish: when you want to tune the picture, make a scene look prettier or closer to what the game wants, this page lists the
knobs, what each one changes on screen and how to tell it is right. **It is not a list of steps and nothing here is required**: pick the knobs
your style needs and leave the rest alone. There are no values to copy on purpose; the right value depends on the style, the camera and the
time of day, so every row says what to look for instead.

Where the rest lives (one home each, this page only points there):
- the calls, their parameters and who writes what: [recipe 52](52-look.md) (the look API, every part);
- the plain three.js way and how the engine yields to it: [THREE.md](../THREE.md) (a direct write takes the value over; the engine stops writing it);
- questions about the whole picture (light roles, readability, consistency) and the numbers each shot prints: [recipe 35](35-style-from-reference.md) "Look questions" and "Look check after every shot";
- a whole look as one package: a style pack ([recipe 09](09-style.md)).

## How to judge, in one loop
Change one knob, take a shot (`threedog shot`, or `threedog snap` on a running page), compare with the one before, keep or undo. Shoot the
times and weathers the game really shows (`threedog shot --time`), not only noon. A knob is right when the difference you wanted is visible
and nothing else got worse; when you cannot say what difference a knob should make, leave it at the style's value.

## The knobs

| Knob | What it changes on screen | It is right when | Engine line (details) | Plain three.js |
|---|---|---|---|---|
| Sky gradient, horizon | the color from the top of the sky down to where it meets the ground | the horizon band and the fog agree where they meet; the top-to-horizon change matches the hour and mood; no visible seam | `look.sky.set({ top, horizon })` ([08 §3](08-weather-sky.md#3-changing-sky-colors-sun-stars-style)); own shader: share `engine.uniforms.uSkyHorizon` / `uSkyTop` ([08](08-weather-sky.md#sky-color-for-my-shader-horizon-color-zenith-color)) | `engine.look.sky.replace(mySky)` with three/addons `Sky` or a `ShaderMaterial` dome |
| Fog near / far | how fast distant things fade | the play space stays clear, the far edge of the world dissolves instead of ending in a line, landmarks you want seen still read | `look.fog.set({ near, far })` ([52 Atmosphere](52-look.md#atmosphere-parts-sky-module-fog-sky-shadow)) | `engine.scene.fog = new THREE.Fog(color, near, far)` |
| Fog color vs sky | whether the distance melts into the sky or into its own haze | distant hills fade toward the sky behind them; a fog color of its own is a choice you can name (smoke, mist, a dream) | `look.fog.set({ color })` (`'horizon'` follows the sky; [38 Fog](38-environment-look-hooks.md#fog-kind-color-density-your-own-math-or-your-own-fog)) | `engine.scene.fog.color.set(c)` |
| Exposure | overall brightness after lighting | the brightest things you care about keep detail and the darkest still read; a night is dark because the lights are, not because exposure hides it | `look.tone.set({ exposure })` ([38 Exposure](38-environment-look-hooks.md#exposure-over-time-and-the-tone-curve)) | `engine.renderer.toneMappingExposure = v` |
| Tone mapping curve | how highlights roll off and how saturated bright colors stay | bright colors keep their hue where the style wants color, highlights soften where it wants film; flat-color styles may want almost no curve | (plain three.js is the route; [52 Who writes it](52-look.md#who-writes-it-the-ownership-table)) | `engine.renderer.toneMapping = THREE.AgXToneMapping` (or ACESFilmic, Neutral, No) |
| Sun direction | where shadows fall and which faces are lit | shapes read from the camera (lit side and shaded side both visible), shadows point somewhere useful, the hour looks like the hour | time of day (`engine.calendar`, [06](06-clock-events.md)); sun path: `look.sky.set({ orbitTilt })`; fixed: `look.lights.manual('sun.direction')` ([52 table](52-look.md#who-writes-it-the-ownership-table)) | `engine.lights.sun.position.set(x, y, z)` after the manual call, or your own `DirectionalLight` |
| Sun color, intensity | the key light: color and strength of lit faces | lit and shaded sides separate; whites under the sun are the white the style wants (warm, neutral, cool) | `look.lights.set({ sun: { color, intensity } })` ([52 table](52-look.md#who-writes-it-the-ownership-table)) | `engine.lights.sun.color.set(c)` |
| Ambient / hemisphere, environment | the fill: how bright and what color the shaded side is | shadows are as deep as the style wants and still show shape; up-facing and down-facing faces differ; metals have something to reflect | `look.lights.set({ hemi: { color, ground, intensity } })`, `look.env.set({ intensity })` ([34](34-environment-lighting.md), [08 brightness](08-weather-sky.md#3-changing-sky-colors-sun-stars-style)) | `engine.lights.hemi.groundColor.set(c)`, `engine.scene.environmentIntensity = v` |
| Shadow softness | hard or blurred shadow edges | edges match the light (crisp under a clear sun, soft under cloud or for a gentle style); no stair-steps or speckle | `look.shadow.set({ type, radius })` ([52 Atmosphere](52-look.md#atmosphere-parts-sky-module-fog-sky-shadow), [45](45-cascaded-shadows.md)) | `engine.lights.sun.shadow.radius = r` |
| Shadow distance, detail | how far shadows reach and how sharp small ones are | the area the player looks at has shadows; small props keep theirs; objects touch the ground (no gap under a foot) | `look.shadow.set({ extent, cascades, maxFar, bias })` ([52 Atmosphere](52-look.md#atmosphere-parts-sky-module-fog-sky-shadow)) | `engine.lights.sun.shadow.camera` sides, `engine.lights.sun.shadow.mapSize` |
| Bloom | light bleeding around bright pixels | the bright things you meant (sun, lamps, magic) glow and nothing else does; the picture does not turn milky | `look.post.add(bloom())` from `@threedog/post-effects`, then `look.post.set({ bloom: { strength } })` ([52 Post chain](52-look.md#post-effect-chain)) | `engine.look.post.add(new UnrealBloomPass(size, strength, radius, threshold))` |
| Light glow / halo | lamps, windows, signs that read as lit | a glowing object keeps its hue at the center (it is not a white block), has a halo where bloom is on, and lights its surroundings if it should | `look.materials.glow(match, { night })` ([52 Night glow](52-look.md#night-glow-emissive-that-follows-daylight)); many lamps: `lightPool` ([09 §1b](09-style.md#1b-lights-and-stalls)) | `material.emissive` / `material.emissiveIntensity`, an additive `THREE.Sprite` for a halo |
| Water, sea | color with depth, waves, foam, what it reflects | shallow and deep read differently, the far sea meets the sky without a seam, foam sits where waves break | `look.water.set({ depthColor, foam, waveHeight })` ([44](44-water-weather-look-hooks.md)) | three/addons `Water`, or a `ShaderMaterial` that reads `engine.uniforms.uSkyHorizon` ([44 own material](44-water-weather-look-hooks.md#water-your-own-material-reflections-refraction)) |
| Wet ground | streets and stone after rain | wet is darker and glossier together, gloss shows reflections of something bright, puddles have soft edges | no engine look: read `engine.weather.current.rain`, then `look.materials.set({ role: { color, roughness } })` ([08 §7](08-weather-sky.md#7-wet-roads-and-puddles-after-rain)) | `material.roughness`, `material.color` on your ground material |
| Color grading | contrast, saturation and warm / cool shift of the whole frame | the frame has the mood you named; skin, foliage and the player's colors still read | `look.post.add(lut())` from `@threedog/post-effects` ([52 Post chain](52-look.md#post-effect-chain)) | `engine.look.post.add(new LUTPass({ lut }))` |
| Cloud shadow | moving dark patches on the ground | the patches drift slowly enough to read as clouds, are as dark as the sky is cloudy, and do not hide gameplay | `look.cloudShadow.set({ shadow, scale, speed })`; clouds in the sky: `look.sky.set({ clouds })` ([36](36-sky-ground-plant-looks.md)) | your own patch: `look.cloudShadow.replace(spec)` ([52 Surface](52-look.md#surface-parts-materials-surface-ground-wind)) |
| Grain, vignette | film noise; darker frame corners | you notice the mood, not the effect; text and the HUD stay clean | `look.post.add(grain())`, `look.post.add(vignette())` ([52 Post chain](52-look.md#post-effect-chain)) | a pixel snippet: `engine.look.post.add({ name, fuse: { glsl }, slot: 'ldr' })` |
| Ambient occlusion | darker creases and contact corners | objects sit on the ground and corners have weight; no dark halo around thin things | `look.post.add(ao())` ([52 Post chain](52-look.md#post-effect-chain)) | three/addons `GTAOPass` through `engine.look.post.add(pass)` |
| Outline | lines around shapes | lines help read shapes at play distance and match the style's line weight | `look.post.add(outline())` ([52 Post chain](52-look.md#post-effect-chain)) | three/addons `OutlinePass` through `engine.look.post.add(pass)` |
| Surface shading | how light falls across a surface (smooth, banded, flat) | materials that should differ (wood, stone, metal, cloth) differ in response, not only in color | `look.surface.set({ lighting })`, `look.materials.set({ role: { ... } })` ([43](43-shader-patches-surface-looks.md), [48](48-make-material.md)) | `new THREE.MeshToonMaterial({ gradientMap })` or any material of yours |
| God rays, volumetric fog | light shafts, fog thick in the air | shafts come from where the light is and fade when it leaves the screen | your own depth effect ([59](59-depth-post-effects.md)) | a Pass of yours through `engine.look.post.add(pass)` |

## Same knob, different styles
A knob is a direction, not a setting. Three styles, the same three knobs, moved different ways:

| Knob | Realistic dusk | Flat cartoon | Gloomy rainy night |
|---|---|---|---|
| Key against fill (sun, hemisphere) | a low, warm key against a cool fill: long shadows, faces lit on one side | a soft key and a strong fill, so shadows are a shape of color, not darkness; little warm / cool split | almost no key; the fill is dim and cool, and the light comes from lamps and windows instead |
| Fog | follows the horizon color; starts far, so the distance turns golden-grey | often light or off, so the bright flat colors stay clean; if on, a pale tint of the sky | close and dark, a color of its own (blue-grey), so lamps are islands in it |
| Bloom and glow | a gentle bloom on the sun and the first lit windows | little or none; glowing things are a brighter flat color | lamps and signs carry it: saturated glow, a halo through the rain, reflections on the wet ground below |

Read the other knobs the same way: ask what the style wants the viewer to notice first, then move the knob toward that and stop when the shot
shows it.
