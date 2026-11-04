Day-night grade: light and color grade across the day, with a dark but readable night.

# Day-night grade (technique example)

A neutral gray scene under one clock: sky, sun / moon, ambient, exposure, a color grade and lamps all keyed by the time of day. Demo:
`npm run dev` in the engine package, open `/day-night-grade.html` (the day runs in 4 minutes; `?time=17:00` starts at a time). Shots:
`threedog shot /day-night-grade.html --time 12:00` (and `17:00`, `22:00`). The engine never imports this folder.

## The principle
A time of day is read from three things at once: the light's color and direction, how dark the shadows are, and how much color is left in
the picture. Changing only brightness gives an underexposed photo, not evening or night. Every number below is this example's current value
on a gray scene, given to explain an effect.

**Noon is the reference.** At noon `sun 3 x sin(elevation) + ambient 1.1` is close to pi, the level where mid-tone albedos show at their own
value on three's AgX curve (recipe 52). Grade neutral, exposure 1. Tune the palette here first; every other time is a deviation from it.

**Dusk: warm without oversaturation.**
- Put the warmth in the **light** (sun color `0xffa264`, horizon `0xdc9c6c`), not only in the grade: the lit sides turn warm and the shadow
  sides stay cool, and that contrast is what reads as evening (warm key / cool fill).
- Drop the ambient (0.7) as the sun drops, so shadows deepen and take the sky's blue.
- In the grade, raise temperature and **lower saturation** (0.9): warm light on warm-ish albedos already adds chroma; a saturation boost on
  top clips oranges into neon. The demo's 17:00 shot measures saturation 0.14 on a gray scene.
- Lamps fade in before dark (about 16:40 here), the way people switch them on.

**Night: dark but readable.**
- **Moonlight** is a weak, blue-white key (`0x8fa4d4`, 0.35). It still casts a direction, so forms read.
- **Ambient floor** (the example uses 0.26): keep some. With none, faces away from the moon are pure black and the player sees nothing.
- **Exposure** lifts a little (1.15) but nowhere near day: the demo's night mean luminance is about half of noon (0.35 vs 0.69).
- **The grade cools and desaturates** (temperature -0.45, saturation 0.72): eyes lose color in the dark (the Purkinje shift), so less color
  reads as night even at a readable brightness. A touch of contrast (1.06) keeps silhouettes.
- **Lamps carry the scene**: warm pools of light where the player goes, emissive windows and lamp heads that read as light sources. Warm
  lamps against a cool night is the strongest night cue.

How to judge it: shoot each time of day at the game's real camera (`threedog shot --time`) and read luminance, saturation, the "dark" area
and your own eyes. Common failures: night = noon with lower exposure (daytime colors, an underexposed photo); night with no ambient (crushed
black; the shot reports the "dark" area); dusk = saturation up (neon oranges).

## Plain three.js
- Tone and exposure: `renderer.toneMapping = THREE.AgXToneMapping` and `renderer.toneMappingExposure`
  ([WebGLRenderer](https://threejs.org/docs/#api/en/renderers/WebGLRenderer), [webgl_tonemapping](https://threejs.org/examples/#webgl_tonemapping)).
- Light over time: interpolate a few keyframes per frame and write `DirectionalLight.color` / `.intensity`, `HemisphereLight` colors and
  intensity, `scene.fog.color` and `scene.background` ([Color.lerpColors](https://threejs.org/docs/#api/en/math/Color)).
- Grade: a final pass in `EffectComposer` — a `ShaderPass` that shifts temperature / saturation / contrast, or `LUTPass` with a 3D LUT
  ([webgl_postprocessing_3dlut](https://threejs.org/examples/#webgl_postprocessing_3dlut)).
- Lamps: `PointLight` / `SpotLight` intensity and `material.emissiveIntensity`, faded by a daylight value, never toggled.

## Style routes
- **Naturalistic**: warm sun at dusk, a blue moon, a cooled and desaturated night grade, lamps as the night's light. One full-screen grade pass.
- **Pastel / cozy**: night kept lighter (more ambient, more exposure) and dusk pinker. Same cost.
- **Horror**: a lower ambient floor, lamps carry everything; darkness is part of play. Same cost, often more lamps.
- **Stylized flat**: skip the grade and key only the sky and lamps; the palette swap does the work. No post pass.
- **Pixel / palette-limited**: swap whole palettes or a small set of LUTs at fixed times instead of continuous curves. One lookup.

## The engine helper (optional convenience)
`dayNightGrade.js` holds one clock and four tables, all keyed by `engine.calendar.timeOfDay` (0 midnight, 0.5 noon). `threedog examples pull
day-night-grade` copies it; replace its colors with the ones your DESIGN.md picture names.

The whole picture is the `picture/` folder, plain three.js from the signals: `palette.js` holds the tables, the other files read them.

| Table (`picture/palette.js`) | Read by | What it sets |
|---|---|---|
| `SKY` | `picture/sky.js`, `picture/lights.js` | gradient sky and fog (= horizon), sun color + intensity (the moon at night), ambient color + intensity |
| `EXPOSURE` | `picture/lights.js` | `renderer.toneMappingExposure` |
| `GRADE` | `picture/post.js` | a `ShaderPass` in the `ldr` slot: temperature, saturation, contrast |
| `LAMPS` | `picture/lights.js`, `picture/materials.js` | the lamps: point-light intensity and emissive strength, by `uDaylight` (`LAMPS.offAbove: 0.35`) |

`createPicture(engine)` wires them in one `engine.onRender`, reading `engine.uniforms` (`uTimeOfDay`, `uDaylight`, `uSunDir`). `sample(rows, t)` is the interpolation;
colors blend through `skyColor` as colors, never as hex numbers. Keyframes interpolate linearly and wrap at midnight, so the first and last rows are
the same night. The demo spec checks that ground under a lamp is over 1.3x open ground at 22:00.

Cost (1280x720, laptop GPU, this demo; median of 120 frames):
- Keyframes, exposure, lamp writes: no measurable cost (uniform writes).
- The grade pass: about **+1.5 ms** a frame (22:00: 5.8 ms with it, 4.3 ms without), the post chain's full-screen pass.
- Point lights: each one adds to every lit material's shader. Keep `distance` short; for many lamps use `engine.lightPool` (recipe 09).

Rules (correctness):
- Never toggle `light.visible` (or add / remove lights) as the day turns: a light-count change recompiles every lit material. Write intensity.
- Under a cycle, adjust brightness in the keyframes. For a place (a cave), add a signal of your own that `picture/lights.js` multiplies in; a fixed value written from gameplay freezes the cycle.
- Lamps and gameplay read `calendar.daylight` / `isDay` / `between`, never the clock text (`if (clock === '18:00')` breaks other day
  lengths; recipe 08).

Sources: written for this engine from its sky contract (recipe 08), the three.js `toneMappingExposure` / AgX docs and common film-grading
practice (warm key / cool fill, Purkinje shift at night); no code copied.
