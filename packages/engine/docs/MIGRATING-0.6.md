# Moving a game from 0.5 to 0.6

`engine.look.*` is removed: the capabilities stay, as plain three.js or as one entry on the module that owns them. Each row is old -> new.

## Sky: `engine.look.sky` is gone

| Old | New |
|---|---|
| `engine.look.sky.replace(x)` | `engine.sky.replace(x)` (null gives the dome back) |
| `engine.look.sky.set({ sunSize, moonColor, starDensity, ... })` | `sky({ ... })` at install; after it `engine.uniforms.uSunSize.value` and friends (recipe 08) |
| `engine.look.sky.set({ clouds: { coverage, scale, speed } })` | `engine.uniforms.uCloudCover`, `uSkyCloudScale`, `uSkyCloudSpeed` |
| `engine.look.sky.set({ keyframes })` | `engine.sky.keyframes(rows)` |
| `engine.look.sky.set({ top, horizon, backdrop, orbitTilt, dim })` | plain fields `engine.sky.top`, `.horizon`, `.backdrop`, `.orbit.tilt`, `.dim`; a color function: write the field in your frame code |
| `engine.look.sky.patch('clouds', x)`, `patch('layer:<name>', x)` | `engine.sky.clouds(x)`, `engine.sky.layer(name, x)` |
| `engine.look.env.replace('sky')`, `sky({ environment })`, `style.sky.environment` | `engine.sky.environment({ into: engine.scene })` |
| `engine.look.env.replace(asset \| Texture \| target)`, `look.env.set({ intensity, rotation })` | `scene.environment`, `scene.environmentIntensity`, `scene.environmentRotation`, `THREE.PMREMGenerator` (recipe 34) |
| `engine.mod('look.sky.tint' \| 'look.sky.flash' \| 'look.ground.cover', ...)` | `engine.mod('sky.tint' \| 'sky.flash' \| 'ground.cover', ...)` |
| keyframe rows `[time, zenith, horizon, lightColor, lightIntensity, ambient]` | `[time, zenith, horizon, sunColor, ambient]`: the intensity column drove nothing and six columns now throw; the color is the signal `engine.uniforms.uSunColor` |
| `engine.sky.setShadowMapSize(n)`, `engine.sky.shadowMapSize` | `engine.shadows.mapSize(light, n)`, `light.shadow.mapSize` |

## Post effects: `engine.look.post` is gone

| 0.5 | 0.6 |
|---|---|
| `engine.look.post.add(x, { name, slot, order })` | `engine.post.add(x, { name, slot, order })`, returns `{ name, enabled, set(params), remove() }` |
| `look.post.set({ bloom: false })` | `engine.post.get('bloom').enabled = false` |
| `look.post.set({ 'bloom.strength': 0.6 })` | `engine.post.get('bloom').set({ strength: 0.6 })` |
| `look.post.replace([...])` | remove the handles and add the new effects |
| `look.post.manual('chain')` | `engine.post.own()`, back with `engine.post.own(false)` |
| settings `{ limits: 'look.post.<name>.enabled' }` | `{ limits: 'post.<name>.enabled' }` |
| a heavy effect a style brought started off on low-tier devices (`costly`) | the engine no longer decides: read `engine.tier` before adding it |

## Tone: `engine.look.tone` is gone

| 0.5 | 0.6 |
|---|---|
| `engine.look.tone.set({ exposure })` | `engine.renderer.toneMappingExposure = x` |
| `engine.look.tone.manual('toneMapping')` | nothing to take: `engine.renderer.toneMapping = THREE.AgXToneMapping` |

## Lights: `engine.look.lights` is gone

| 0.5 | 0.6 |
|---|---|
| `engine.look.lights.set({ sun: { intensity, color } })`, `hemi` likewise | `engine.lights.sun.intensity = x`, `engine.lights.hemi.color.set(c)`, or `createEngine({ lights: false })` and your own lights |
| `engine.mod('look.lights.sun.intensity', { mul })`, `settings { limits: 'look.lights.*' }` | keep your own factor in your `picture/` code and multiply when you write the light; weather's is `engine.uniforms.uWeatherLight` |
| `engine.look.lights.set({ env: { intensity } })` (the neutral room map) | `scene.environment = new THREE.PMREMGenerator(engine.renderer).fromScene(new RoomEnvironment()).texture`, `scene.environmentIntensity = x` (`RoomEnvironment` from `three/addons/environments/RoomEnvironment.js`) |
| `engine.look.lights.manual('probes')` | `probes.own()`, back with `probes.own(false)` |

## Fog: `engine.look.fog` is gone

| 0.5 | 0.6 |
|---|---|
| `engine.look.fog.set({ far, near, color })` | `engine.scene.fog = new THREE.Fog(color, near, far)`, or write `.color`, `.near`, `.far` on it; read `engine.uniforms.uViewDistance`, `uSkyHorizon`, `uWeatherFog` |
| `engine.look.fog.set({ kind: 'exp2', density })` | `engine.scene.fog = new THREE.FogExp2(color, density)` |
| `engine.look.fog.set({ enabled: false })` | `engine.scene.fog = null` |
| `engine.look.fog.set({ kind: 'height' })`, `look.fog.patch('fog', x)` | three.js: `onBeforeCompile` on your materials, `scene.fogNode` on `renderer: 'webgpu'` |
| `engine.mod('look.fog.far', { mul })` | your own factor in your `picture/` code, multiplied in when you write the fog |

## Cloud shadow: `engine.look.cloudShadow` is gone

| 0.5 | 0.6 |
|---|---|
| `look.cloudShadow.set({ shadow, scale, speed })` | `engine.uniforms.uCloudShadow.value`, `uCloudScale.value`, `uCloudSpeed.value.set(x, z)` |
| `look.cloudShadow.replace(spec \| false)` | `engine.terms.cloudShadow(spec \| false)`, returns `{ remove() }` |
| a plain lit material took the cloud shadow on its own; `userData.cloudShadow = false` kept one out | nothing is added unasked: call `applyEffects(mat)` on the materials that should darken |

## Season tint: `engine.look.season` is gone

| 0.5 | 0.6 |
|---|---|
| `look.season.replace(spec \| kind => spec \| false)` | `engine.terms.season(spec \| kind => spec \| false)`, returns `{ remove() }` |

## Wind: `engine.look.wind` is gone

| 0.5 | 0.6 |
|---|---|
| `look.wind.set({ frequency, amplitude })` | `engine.uniforms.uWindFreq.value`, `uWindAmp.value` |
| `look.wind.patch('sway', { glsl, tsl, uniforms })` | the species' `wind: { amplitude, glsl, tsl, uniforms }` in `vegetation.define`, or `applyEffects(mat, { wind: { ... } })` |

## Shadows: one map now follows the camera

`engine.shadows.cascades(light)` with one map (`count: 1`, or a low-tier device) used to leave your light where it was, on three's default 10 m shadow box. It now places the light like cascades do: the map follows the camera and covers `maxFar` each way, `remove()` puts everything back, and `engine.shadows.box` on that light is refused while it is on. Nothing to change unless you sized that light's shadow camera yourself for the low tier: leave it to `maxFar`, or call `engine.shadows.box(light, { ... })` instead of `cascades` there.

## The rest of the look and style layer is gone

Older parts and every `style.*` key, row by row: [MIGRATING-0.4.md](MIGRATING-0.4.md).

| 0.5 | 0.6 |
|---|---|
| `createEngine({ style })` | throws `[engine-misuse]`: the picture is plain three.js in the game's `picture/` folder, `createPicture(engine)` (recipes 62, 63); UI colors go in `createEngine({ ui })` |
| `engine.mod(point, { layer: 'style' })` | throws `[shared-layer]`: use the default `game` layer (recipe 55) |
| `look.<part>.manual(key)` | `engine.view.manual('far' \| 'fov' \| 'pixelRatio')`; the other values have the entries in the tables above |
| `engine.look.water` | `engine.water.material`, `.uniforms`, `.patches`, `.shader()`, `.normalMap()` (recipe 44) |
| `makeMaterial(role)`, `engine.makeMaterial`, `engine.look.materials` | any `new THREE.*Material` in `picture/materials.js`; a module's material is `engine.<module>.material` (recipe 09) |
| `engine.look.surface` | per material: `applyEffects(mat, { lighting, detail })`, `rampTexture(ramp, soften)` on a toon material (recipe 43) |
| `look.shadow.set({ enabled })` | `engine.shadows.enabled = false` |
| `look.shadow.set({ type })` | `engine.renderer.shadowMap.type` |
| `look.shadow.set({ cascades })`, `look.shadow.include(mat)` | `engine.shadows.cascades(light, { count })`, `engine.shadows.include(mat)` (recipe 45) |
| `defineLookPart(...)` in a module | module options and a plain `engine.<module>.material` |
| `threedog style check` | `npm run check` type-checks `picture/` |
| `threedog style palette \| compare` | `threedog picture palette \| compare` |
| `engine.styleWorkbench` | `engine.devPanel`, after `openPanel(engine)` from `@threedog/tools/panel` (recipe 35) |

## Names: "look" becomes "picture"

The look layer is gone, so the word no longer names picture things. Mouse and camera look (`input.look`, `lookAt`, `mouseLook`) keep their names. No aliases: the old names just stop existing.

| Old | New |
| --- | --- |
| game folder `look/` | `picture/` (also the `include` line of a game's `tsconfig.json`) |
| `createLook(engine)`, `const look = ...`, `look.lamp(id)`, `look.materials` | `createPicture(engine)`, `const picture = ...`, `picture.lamp(id)`, `picture.materials` |
| module type `type: 'look'` | `type: 'picture'` |
| `engine.terrainLook`, `engine.vegetationLook`, `engine.weatherLook` | `engine.terrainDraw`, `engine.vegetationDraw`, `engine.weatherDraw` |
| `replaces: 'terrainLook'`, `'vegetationLook'`, `'weatherLook'` | `replaces: 'terrainDraw'`, `'vegetationDraw'`, `'weatherDraw'` |
| slots `terrain-look`, `vegetation-look`, provides `weatherLook` | `terrain-draw`, `vegetation-draw`, `weatherDraw` |
| `SkyLookOptions` (types) | `SkyPictureOptions` |
| `threedog shot --no-look`, `threedog snap --no-look` | `--no-picture` |
| `look` and `lookMs` in `threedog shot --json`; the printed `Look:` line | `picture` and `pictureMs`; `Picture:` |
| DESIGN.md line `Look intent:` | `Picture intent:` |
| `threedog lib add --kind look` | `--kind picture` (an entry of the old kind in a library is re-added under the new one) |
| `@threedog/tools/look` (`lookHints`, `lookNumbers`, `probeLook`, `pageLook`, `imageLook`, `formatLook`) | `@threedog/tools/picture-check` (`pictureHints`, `pictureNumbers`, `probePicture`, `pagePicture`, `imagePicture`, `formatPicture`) |
| recipes 35-look-from-reference, 36-sky-ground-plant-looks, 37-terrain-look-hooks, 38-environment-look-hooks, 43-shader-patches-surface-looks, 44-water-weather-look-hooks, 52-look | 35-picture-from-reference, 36-sky-ground-plants, 37-terrain-hooks, 38-environment-hooks, 43-shader-patches-surfaces, 44-water-weather-hooks, 52-around-the-picture |
| recipe 41-thing-registry | merged into 40-scene (one recipe on what is in the scene and what a save keeps) |
| example `plain-look` | `plain-picture` |
| `grids.preview({ look })` | `grids.preview({ draw })` (`false`, or `(engine) => part`) |
| `layer(name, { tiles: { look } })` | `tiles: { color }`, the same `(data, cell) => color \| null`; an unknown `tiles` key now throws |
