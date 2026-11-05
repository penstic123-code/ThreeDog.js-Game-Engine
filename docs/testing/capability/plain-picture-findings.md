# Plain-picture findings (phase 1 of docs/plans/2026-11-04-visuals-signals-in.md)

What was built: a night street in a flat-illustration look. `main.js` (47 lines) places shapes; `picture/` (~110 lines in one file at the time, a folder since) is the whole
picture in plain three.js: its own HemisphereLight, DirectionalLight, six PointLights, `THREE.Fog`, a gradient sky sphere
(`ShaderMaterial`), MeshLambert materials with an emissive copy of their own color that rises at night, painted lamp pools (additive
discs). Engine setup: `createEngine({ lights: false })`, `sky({ sun: false, hemisphere: false, fog: false })`, `calendar`, `weather`
(clear / rain), `fixedCamera`. Signals read: `uDaylight`, `uSunDir`, `uSkyHorizon` (15 % only), `engine.weather.current.rain`.

Shots (from packages/engine): `npx threedog shot plain-picture --time 22:00 | 12:00 [--weather rain]`. Three rounds of tuning;
`npm run check` passes with no opt-out comment.

Each finding is marked with what became of it (phase 2 is in the plan).

## Where the engine got in the way

1. **onFrame reads last frame's signals, and noon on the first frame.** `onFrame` callbacks run before module frame hooks
   (`core/loop.js`), so the sky writes `uDaylight` etc. after picture code read them; on frame 1 the picture reads the defaults
   (`render/effects.js`, `uDaylight: 1` = noon). Worked around with `engine.onRender`. Phase 2: one documented hook that runs after
   all signals are final for this frame, and uniform defaults that do not claim noon.
2. **The picture check's light probes are undone by picture code that runs in onRender.** The probe zeroes `light.intensity`, then calls
   `e._render(0)`, which runs `onRender` hooks, and the picture code writes the intensities back before the draw. So every shot reported
   "light ... changes no pixel" for exactly the pattern the plan recommends. Phase 2: probe renders do not run game hooks.
3. **The picture check still describes the engine's lights, not the game's.** With `lights: false` the `time-flat` hint named
   `sun.intensity 2, hemi.intensity 0.6`, the engine's lights that are not in the scene (`describe().look.lights`).
4. **Things the engine still writes with everything switched off:** `scene.environment` (the room map, `environmentIntensity` driven by
   the sky); `scene.background` gray `0x8c8c8c` (`core/Engine.js`); `renderer.shadowMap.enabled = true` though no light casts; plain
   Lambert / Phong / Standard / Toon materials get the cloud-shadow `onBeforeCompile` patch on entering the scene (strength 0; opt-out
   `material.userData.cloudShadow = false`, which nobody would know); page-wide patches in `describe().threePatches`. Hiding the
   engine's sky dome needs `engine.sky.dome.visible = false` (documented route is `look.sky.replace`).
5. **`describe()` disagrees with itself about tone mapping.** After `renderer.toneMapping = NoToneMapping`, `describe().render.toneMapping`
   says `writer: game`, `describe().owned.toneMapping` still says `writer: engine` (`core/describeRender.js`).
6. **The sky colors are the engine's look, not signals.** `uSkyTop / uSkyHorizon` come from the neutral keyframes (`#161616 / #2a2a2a`
   at 22:00). A styled game cannot use them as-is. Phase 2: signals are physical (sun, moon, cloud, rain, wetness); sky colors belong to
   the picture file.
7. **Weather signals are not in `engine.uniforms`.** Rain amount is only `engine.weather.current.rain` (JS); no wetness signal; a
   weather type's `fog: 0.6` / `sun` fields only mean something to the sky's drivers. Rain streaks are drawn by the engine's weather
   look (restyle only through `look.weather.replace`).
8. **Light count / quality caps are not a signal.** The engine knows a light budget (`core/gameLights.js`, `engine.tier`), but there is
   no "how many lights this tier can afford" value to read.
9. **Docs: the switch-off options are scattered** (`createEngine({ lights: false })` in a comment in `render/lights.js`; `sky({ sun,
   hemisphere, fog })` in `modules/sky/look.js`); nothing says which hook picture code should use.
10. **Example folders are treated as games by check:** a new `examples/` folder needs `npm run map` (GAMEMAP.md) before check passes.

## What was pleasant

- `lights: false` + `sky({ sun: false, hemisphere: false, fog: false })` worked on the first try; plain `scene.add` of lights, fog and
  materials was respected (`describe().render.lights` lists them as `writer: game`).
- `renderer.toneMapping = NoToneMapping` was respected for rendering.
- `engine.uniforms.uDaylight / uSunDir` are exactly the right shape for picture code: one number, one vector.
- `threedog shot` is fast (~5 s); the picture-level facts are useful apart from findings 2 and 3.
- No lint rule blocked plain three.js materials in an example.
- The flat look itself was easy in plain three.js: Lambert + emissive copy of the base color, a warm hemisphere light at night, painted
  lamp pools. Total picture code ~110 lines, all in one file.
