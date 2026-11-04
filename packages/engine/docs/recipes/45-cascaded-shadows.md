# Shadows: cascades, box, budget, the switch

**In this recipe**: `engine.shadows` works on a light you hand it and leaves every other light alone: cascades, a box that follows, an update budget, the master
switch. Filter, bias, softness and map size are plain three.js (last section).

```js
const sun = new THREE.DirectionalLight('#fff4e0', 3);
sun.position.set(40, 80, 30);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(engine.tier === 'low' ? 1024 : 2048);
engine.scene.add(sun);

const shadows = engine.shadows.cascades(sun, { count: 3, maxFar: 150 });
engine.onRender(() => sun.position.copy(engine.uniforms.uSunDir.value).multiplyScalar(100));   // aim it as usual
shadows.set({ count: 2 });        // on a settings screen: it recompiles
shadows.remove();                 // one plain shadow map again
```

Cascades split one light's shadow along the view into 2-4 maps (three's CSM addon): sharp near the camera, coarse far away. Use them when near
shadows look blocky and the world is bigger than one map covers well. Off by default: a light casts one shadow map (the engine sun around the
focus, `extent` 30 m).

The engine sun takes the same entry: `engine.shadows.cascades(engine.lights.sun, { count: 3 })`.

| field | default | meaning |
|---|---|---|
| `count` | 3 | 1 = one map that follows the camera (`maxFar` each way); 2-4 = cascades |
| `maxFar` | 120 | meters from the camera they cover; no sun shadow beyond |
| `split` | `'practical'` | where borders fall: `'practical'` / `'uniform'` / `'logarithmic'` / `(count, near, far, out) => void` |
| `lightMargin` | 100 | meters behind each cascade box toward the light still caught as casters |
| `fade` | true | cross-fade at borders so no seam shows (two shadow lookups there); false is a little cheaper |

`light.shadow.mapSize`, `bias`, `normalBias`, `radius`, `blurSamples`, the filter and a budget reach every cascade. A box does not go with cascades: they
follow the camera frustum and snap to whole shadow pixels themselves, so edges do not shimmer while the camera moves.

## How it works (what you can rely on)
- The light you hand in stays the light you write (color, intensity, direction) and is cascade 0; the other
  cascades are extra DirectionalLights that copy its color and intensity every frame. `engine.shadows.csm` is three's CSM object (lights,
  breaks, updateFrustums()), null when off.
- Built-in lit materials (Lambert, Phong, Standard, Physical, Toon), **your own `new` ones too**, get a named patch `csm`, added after the
  material's other patches; wind, cloud shadows, season, detail and lighting patches stay, and wind shadows still sway. This is the one place
  the engine changes a material it did not make: unpatched, a lit material is lit once by every cascade light (N times as bright, doubled
  shadows). `engine.describe().owned['shadow.csm'].materials` lists your materials that got it. Materials added later are picked up the next
  frame (the scene is walked once per frame while cascades are on).
- Your own `ShaderMaterial` with `lights: true` is never patched unasked: one warning names it, and `engine.shadows.include(mat)` opts it
  in (it needs `#include <lights_fragment_begin>`, i.e. a shader built from `THREE.ShaderLib`).
  Never call `CSM.setupMaterial` yourself: it overwrites `onBeforeCompile` and drops every patch. A game patch must not replace
  `lights_fragment_begin` (it would clash with `csm`, reported when added).
- three's `ShaderChunk` is never changed (the addon's constructor does that globally; the engine swaps the chunk per material instead).
- Under `engine.shadows.budget` cascades move only on frames whose maps re-render (or when the camera jumps), so lights and maps agree.
- `engine.shadows.mapSize(sun, n)` resizes every cascade's map, on both renderers.

On WebGPURenderer (recipe 56) the same call is three's
`CSMShadowNode` on `light.shadow.shadowNode`: one light, so no material is patched, nothing is listed in `describe().owned`,
and `engine.shadows.include(mat)` does nothing (it says so once). `engine.shadows.csm` is that node (its `lights` are placeholder objects, not
lights). The cascade shadow cameras reach `lightMargin + 2 * maxFar` meters, as on WebGL.

## Costs and stalls
- Each cascade draws the shadow casters once more (each culls to its own box; near ones see little). `engine.budget.byTag()` counts a
  caster once per shadow map (each cascade, on both renderers), an upper bound. In the styletest acceptance test (software renderer, relative only) 3 cascades
  went from 1 to 3 shadow passes and roughly doubled frame time; do not expect frame rate to improve.
- Switching cascades on, off or changing any cascade field recompiles every lit material once (a stall), and each material keeps the
  old program until it is disposed (three would otherwise reuse a stale program whose uniforms no longer update). Do it on a settings
  screen, not during play.
- Ladder for weaker devices: `count: 3` -> `2` -> `1` (one map); before dropping a cascade try a smaller `maxFar` or `mapSize`.
  Low-tier devices get 1 unless you ask: `{ count: 3, low: { count: 2 } }`.

## Rules of the entry
`engine.shadows.cascades(light, options)` takes `count`, `maxFar`, `split`, `fade`, `lightMargin` (the table above) and `low: { count }`, with and without a
sky, on both renderers (WebGPU needs `import 'threedog/tsl'`, or the call says so).
- The light must be a DirectionalLight, a direct child of `engine.scene`, with `castShadow = true`; anything else throws at the call.
- Color, intensity, `visible`, `castShadow` and `light.shadow` values stay yours and are read every frame: `mapSize`, `bias`, `normalBias`,
  `radius` and `blurSamples` written on the light reach every cascade. The cascades only place the light. On WebGL, while they are on,
  `light.position` and `light.target` hold that placement: writes to `light.position` or a new `light.target` still set the direction, and
  `remove()` puts both back as you left them, with the shadow camera box. A `light.target` you assigned (your player, say) is never moved.
- `engine.tier === 'low'` gets one map unless you pass `low: { count: 2 }`. That map follows the camera and covers `maxFar` each way, so it is blurrier than cascades but never stops at the
  origin; `handle.csm` is three's CSM object, null while there is one map. Like cascades it places the light, so `engine.shadows.box` on that light is refused.
- An engine draws one set of cascades: a second handle throws. A box on the same light throws too, except the engine's own box on `engine.lights.sun`, which waits
  until `remove()`.
- Materials work as described above (the `csm` patch, `engine.shadows.include(mat)`, `describe().owned`). Never call `CSM.setupMaterial` yourself.
- Another shadow-casting DirectionalLight next to cascades breaks the cascade order on WebGL (three sorts shadow casters first): one warning
  names it; keep extra lights shadowless.

## A box that follows
One shadow map stays sharp when it covers little. `box` keeps that little around the action:

```js
const sun = new THREE.DirectionalLight('#fff', 3);
sun.position.set(40, 80, 30); sun.castShadow = true;
engine.scene.add(sun);

const box = engine.shadows.box(sun, { follow: player, extent: 40, snap: 'texel' });
box.set({ extent: 60 });   // a wider view
box.remove();              // position, target and the shadow camera come back
```

| field | default | meaning |
|---|---|---|
| `follow` | `'focus'` | `'focus'` (`engine.focus`), `'camera'`, an Object3D, `() => Vector3`, or `false` (it stays on the light's target) |
| `extent` | left out | half size in meters, written on `light.shadow.camera`; left out, the camera stays as you set it |
| `snap` | 0.5 | center snap grid in meters, or `'texel'`: one shadow pixel, no shimmer on a moving camera |
| `ahead` | 0 | meters the center is shifted in front of the view |

- A game light gets no box unless you call this. The light keeps its direction, which is its position minus its target, so aim it as usual; a `light.target` you assigned
  (your player, say) is never moved. It works like cascades here: `position` and `target` hold the placement while the box is on, and writes to `light.position` or a new `light.target` set the direction.
- The engine's placeholder sun under `sky()` has a box already, following `engine.focus`, 30 m each way. `engine.shadows.box(engine.lights.sun, { follow: false, extent: 9 })` changes that one
  box and `remove()` restores it. Writing `engine.lights.sun.target.position` yourself takes the box's center over, with one warning; `{ follow: 'focus' }` gives it back.

## An update budget
A shadow map of a still scene need not redraw every frame:

```js
const budget = engine.shadows.budget(sun, { every: 3 });   // a third of the shadow fill cost
budget.redraw();                                           // something big moved: draw on the next frame
budget.set({ every: 1 });                                  // every frame again
budget.remove();                                           // light.shadow.autoUpdate as it was
```

It works on any light with a shadow, through that light's own `shadow.autoUpdate` and `shadow.needsUpdate`, so other lights are not touched. Skipped frames make swaying shadows stutter.
A box or cascades on the same light redraw early when they jump (teleport, fast travel).

## Resolution after the first draw
Before the first frame `light.shadow.mapSize.set(2048, 2048)` is all it takes. Once a map exists, three.js keeps it, so a settings menu or a one-shot change goes through the engine:

```js
engine.shadows.mapSize(sun, 1024);   // the map is rebuilt and redrawn; with cascades, every cascade's map
```

Photo mode does this itself for every casting DirectionalLight in the scene (`photo({ shadowMapSize })`) and puts the sizes back after the shot.

## The master switch
```js
engine.shadows.enabled = false;                                                  // a game's own setting
const hold = engine.mod('shadows.enabled', { owner: 'cutscene', layer: 'system', set: false });
hold.remove();                                                                   // back to what was before
```

It writes `renderer.shadowMap.enabled` only, so no light's `castShadow` changes, and recompiles materials once: use it on a menu, not per frame. The settings menu holds the same
point (`'shadows.enabled'`, layer `settings`, restrict only), so a player who turned shadows off keeps them off through a cutscene; a game's `true` does not undo that.

## Filter, bias, softness, map size: three.js
```js
engine.renderer.shadowMap.type = THREE.VSMShadowMap;   // BasicShadowMap | PCFShadowMap (default) | VSMShadowMap
sun.shadow.radius = 3; sun.shadow.blurSamples = 8;     // softness (pcf, vsm); blur quality (vsm)
sun.shadow.bias = -0.0001; sun.shadow.normalBias = 0.03;
sun.shadow.mapSize.setScalar(2048);                    // before the first frame; later also sun.shadow.map?.dispose(); sun.shadow.map = null;
```

Changing the type later, measured against three 0.187's source:
- WebGLRenderer does the work itself: `WebGLShadowMap.render` sees the new type, sets `needsUpdate` on every material in the scene and rebuilds the maps of the lights it draws that frame. You write
  only `shadowMap.type`. Two limits: it happens on the next frame that draws a shadow, and only for lights that draw on that frame. A light under `engine.shadows.budget` is redrawn
  by the budget at once. A light of your own with `shadow.autoUpdate = false` needs `light.shadow.needsUpdate = true` in the same frame, or it keeps its old map.
- WebGPURenderer reads the type when it builds a light's shadow node. Set it before the first frame; there is no switch at run time.

Each switch costs one recompile of every lit material: a settings screen, not during play.
