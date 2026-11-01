# 48. `engine.makeMaterial(role, spec)`: which keys work, who wins

`engine.makeMaterial('furniture', { color: 0x8a5a36 })` returns a normal three.js material. The **role** picks the look from the style pack
(`style.materials[role]`, unlisted roles use `materials.default`); the **spec** is this call's own settings.

## Which spec keys are accepted

- **Any real property of the material**: `color`, `emissive`, `emissiveIntensity`, `roughness`, `metalness` (standard/physical only), `shininess` (phong),
  `transparent`, `opacity`, `side` (`THREE.DoubleSide`), `vertexColors`, `flatShading`, `wireframe`, `alphaTest`, `depthWrite`, `fog`... Colors take
  a hex, a CSS string or a `THREE.Color`; a Vector2 prop takes `[x, y]`.
- `type`: `'lambert' | 'phong' | 'standard' | 'physical' | 'toon' | 'basic'` (default `lambert`, or whatever the pack says).
- Texture slots by asset name (or a `THREE.Texture`): `map`, `emissiveMap` (sRGB), `normalMap`, `roughnessMap`, `metalnessMap`, `aoMap`, `bumpMap`,
  `alphaMap`... The slot must exist on the type (`roughnessMap` needs `standard`). Plus `repeat` (number or `[x, y]`) and `wrap` (`repeat | clamp | mirror`).
- `detail`: grain / paper / strokes / a texture laid over the surface in world space (no UVs).
- `lighting`: extra light shaping (shadow tint, rim, wrap, own GLSL), merged over `style.lighting`; `false` opts out.
- toon only: `steps` (number of bands), or `ramp` (+ `soften`). `ramp` on a non-toon type throws.
- A key the chosen material does not have (`roughness` on lambert) is skipped on purpose, so one spec works for any type.
  A key that looks like a typo of a real one (`roughnes`) warns once in dev with `did you mean 'roughness'?`. Nothing is ever blocked.

## Who wins: pack or call

The pack entry is the default, the call wins. For a pack **spec** the two are merged (`default` spec, then the role's spec, then your call);
the same key in the call overrides the pack's:

```js
// pack: materials: { building: { type: 'standard', roughness: 0.8 } }
engine.makeMaterial('building', { roughness: 0.2 });          // roughness 0.2, still standard
engine.makeMaterial('building', { type: 'toon', steps: 4 });  // your type wins too
```

A pack entry that is a **Material instance** is cloned, then your keys are set on the clone (keys it lacks are skipped).
A pack **function** `(params, role, engine) => Material` receives your spec first and decides itself; keys it did not use are set afterwards.
The pack's `style.lighting` is added unless your spec says `lighting: false`.

## Tweak the returned material directly

The result is an ordinary `THREE.Material`; edit it freely. The engine does not wrap or track it, so this is not "bypassing" anything:

```js
const glass = engine.makeMaterial('window', { color: 0x9fd4ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
glass.depthWrite = false;          // plain property edit, fine
glass.onBeforeCompile = ...;       // allowed, but it replaces the engine's shader patches (wind, clouds, detail, lighting) on this material
```

Keep `makeMaterial` as the way to *create* materials (a style swap then restyles the game, `npm run check` flags a bare `new THREE.Mesh*Material`);
afterwards use three.js normally. Changing `needsUpdate`-type settings (`vertexColors`, `flatShading`, `transparent`) after first render needs `mat.needsUpdate = true`.

## Copyable examples

```js
// Solid prop with vertex colors (merged model)
engine.makeMaterial('prop', { vertexColors: true });

// Textured PBR stone
engine.makeMaterial('rock', { type: 'standard', map: 'rock.png', normalMap: 'rock_n.png', roughness: 0.9, repeat: 4 });

// See-through, double-sided
engine.makeMaterial('banner', { color: 0xd04a3a, transparent: true, opacity: 0.8, side: THREE.DoubleSide });

// Glowing lamp
engine.makeMaterial('lamp', { color: 0x6b5a40, emissive: 0xffc070, emissiveIntensity: 1.2 });

// Grain over the surface, no extra shading
engine.makeMaterial('wall', { color: 0xc9b99a, detail: { noise: 'paper' }, lighting: false });

// Toon with an explicit light ramp
engine.makeMaterial('character', { type: 'toon', color: 0xe8a0a0, ramp: [0.25, 0.6, 1] });
```

See also: `09-style-pack.md` (writing the pack side), `43-shader-patches-surface-looks.md` (detail / lighting / patches).
