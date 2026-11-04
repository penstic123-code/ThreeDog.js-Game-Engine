# Particles: dust, smoke, sparks, splashes

```js
import { particles } from 'threedog';
engine.use(particles({
  default: { color: 0xc8b89a },                                     // what every effect starts from
  effects: { dust: { max: 300, lifetime: [0.6, 1.2], size: [0.3, 0.8], opacity: [0.6, 0] } },   // the effects, by name
}));
engine.particles.emit('dust', player.position, { count: 20 });      // a name in effects needs no define()
engine.particles.define('smoke', { gravity: 0.4, size: [0.5, 2] });
const chimneySmoke = engine.particles.attach('smoke', chimney, { rate: 8, offset: [0, 2, 0] });
chimneySmoke.remove();
```
One effect is one `THREE.Points`, one draw call. Parameters and their fallbacks are at the top of `modules/particles/Particles.js` and in `api/particles.md`.
With no options an effect is a soft gray dot.

## Where a value comes from
Lowest to highest: the neutral fallback, `particles({ default })`, `particles({ effects: { name } })`, `define(name, params)`, then `overrides` of one
`emit` or `attach`. So the game's picture can sit in one table and a line of play code writes only what it decides: `define('leaves', { max: 200 })`.

## The material
```js
const sparks = engine.particles.define('sparks', { blending: 'additive' });
sparks.material = new THREE.PointsMaterial({ size: 0.2, color: 0xffaa33 });   // drawn as given
sparks.material = null;                                                       // the engine's back
sparks.uniforms.uMaxPx.value = 64;                                            // live
```
`.material` is the effect's plain three.js material, `.points` what draws it. Particle age reaches the picture through the geometry attributes `aSize`,
`aAlpha`, `aColor`, `aAngle`: a material that ignores them shows every particle alike, and one that wants the fade reads them, as
`modules/particles/shaders.js` does. `.uniforms` (`uMap`, `uHasMap`, `uScale`, `uMaxPx`) are written whichever material is drawn; a `ShaderMaterial` of yours can
share them, `uScale` being the pixels per meter at distance 1. Your material is yours: the engine never disposes it, and defining the effect again goes back to
the engine's. On WebGPURenderer the effect is a sprite with node materials (recipe 56), so a material of yours is a node material there.

## Weather
Rain and snow are separate, because they follow the camera and fade with the weather: `engine.weather.particles` (recipe 44).
