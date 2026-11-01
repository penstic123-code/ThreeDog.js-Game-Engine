# Cascaded shadows

Off by default: the sun casts one shadow map around the focus (`extent`, default 70 m). Cascades split the sun's shadow
along the view into 2-4 maps (three's CSM addon): sharp near the camera, coarse far away. Use them when near shadows look blocky and the
world is bigger than one map covers well.

```js
engine.use(sky({ shadow: { cascades: 3 } }));             // or the style pack: style.sky.shadow.cascades
engine.look.shadow.set({ cascades: 3, maxFar: 150 });       // at run time; { cascades: 1 } switches back
```

| field | default | meaning |
|---|---|---|
| `cascades` | 1 | 1 = one map (the plain path); 2-4 = cascades |
| `maxFar` | 120 | meters from the camera they cover; no sun shadow beyond |
| `split` | `'practical'` | where borders fall: `'practical'` / `'uniform'` / `'logarithmic'` / `(count, near, far, out) => void` |
| `lightMargin` | 100 | meters behind each cascade box toward the light still caught as casters |
| `fade` | true | cross-fade at borders so no seam shows (two shadow lookups there); false is a little cheaper |

`mapSize`, `bias`, `normalBias`, `type`, `radius` and `updateEvery` apply to every cascade. `extent`, `snap` and `ahead` do not: cascades
follow the camera frustum and snap to whole shadow pixels themselves, so edges do not shimmer while the camera moves.

## How it works (what you can rely on)
- `engine.sky.sun` stays the light the sky drives (color, intensity, direction, `sky({ sun: 'manual' })`) and is cascade 0; the other
  cascades are extra DirectionalLights that copy its color and intensity every frame. `engine.sky.csm` is three's CSM object (lights,
  breaks, updateFrustums()), null when off.
- Lit materials (Lambert, Phong, Standard, Physical, Toon, ShaderMaterial with `lights: true` and `#include <lights_fragment_begin>`) get a
  named patch `csm`, added after the material's other patches; wind, cloud shadows, season, detail and lighting patches stay, and wind
  shadows still sway. Materials added later are picked up the next frame (the scene is walked once per frame while cascades are on).
  Never call `CSM.setupMaterial` yourself: it overwrites `onBeforeCompile` and drops every patch. A game patch must not replace
  `lights_fragment_begin` (it would clash with `csm`, reported when added).
- three's `ShaderChunk` is never changed (the addon's constructor does that globally; the engine swaps the chunk per material instead).
- With `shadow.updateEvery > 1` cascades move only on frames whose maps re-render (or when the camera jumps), so lights and maps agree.
- Photo mode raises `setShadowMapSize`, which is the sun's map: the nearest cascade, where it shows most.

## Costs and stalls
- Each cascade draws the shadow casters once more (each culls to its own box; near ones see little). `engine.budget.byTag()` counts a
  caster once per shadow-casting light, an upper bound. In the styletest acceptance test (software renderer, relative only) 3 cascades
  went from 1 to 3 shadow passes and roughly doubled frame time; do not expect frame rate to improve.
- Switching cascades on, off or changing any cascade field recompiles every lit material once (a stall), and each material keeps the
  old program until it is disposed (three would otherwise reuse a stale program whose uniforms no longer update). Do it on a settings
  screen, not during play.
- Ladder for weaker devices: `cascades: 3` -> `2` -> `1` (one map); before dropping a cascade try a smaller `maxFar` or `mapSize`.
  Low-tier devices default to 1 unless the style asks: `shadow: { cascades: 3, low: { cascades: 2 } }`. `sky({ shadow })` options keep
  this: on low they use their own `low.cascades` (default 1).

## With your own lights
Cascades only split the engine sun. `sky({ sun: false })` plus cascades throws; with your own DirectionalLight use three's CSM addon on it
directly (and then mind the two points above: `setupMaterial` order and the global chunk swap). Another shadow-casting DirectionalLight
next to cascades breaks the cascade order (three sorts shadow casters first); keep extra lights shadowless.

