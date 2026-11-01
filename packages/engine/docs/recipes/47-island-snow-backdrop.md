# Floating island look: round rim, snow that settles, flat backdrop

A floating island scene (recipe 42 for the outline) usually wants three more things: a soft rim, trees and ground that turn white while
it snows, and a plain background with no horizon. All three are style or scenario settings; none needs a shader of your own.

## Round rim
`terrain({ shape: { edge: { round: 1.2 } } })` bends the top down by up to 1.2 m toward the rim. The side wall follows every bend of the
top (it is split where the rim crosses a cell diagonal), so there is no slit between top and wall at any `round`.

## Season tint on a textured top
With `shading: 'texture'` the color map is applied before the vertex colors, so every patch after `color_fragment` sees the mapped color.
`style.seasons: { mode: 'mix', winter: { ground: 0xeef0f2 } }` therefore whitens the textured top like the side walls (recipe 43).

## Snow that settles: `style.weather.snow.cover`
```js
weather: {
  snow: { size: 18, cover: { foliage: 0xf2f4f6, ground: 0xeef0f2, strength: 0.8 } },
},
```
- While the weather's `snow` amount rises (any type with `snow > 0`), the foliage / ground season tint moves `strength` of the way toward
  these colors, and melts back as it falls. It reuses the season patch uniforms (`uFoliageTint/Mix`, `uGroundTint/Mix`): vegetation, terrain
  and any material with `applyEffects(m, { season: 'ground' })` follow; no extra shader pass.
- Over a `mode: 'mix'` season the two blend into one mix; a `'multiply'` season gives way while snow lies (use `'mix'` for smooth fades).
- Leave a part out to keep its season color (`cover: { foliage: 0xffffff }` whitens trees only). Leave `cover` out and snow is particles only.
- Ash, frost or anything else: `engine.sky.modify('ash', { groundCover: 0x555555, coverAmount: 0.6 })` (one layer per owner, `null` removes).

## Weather changes and seasons in scenarios
- `engine.events.on('weather:change', ({ from, to }) => ...)`: once per change of name, when the blend starts (`weather.set` with the same name
  again does not fire).
- `engine.applyState({ season: 'winter' })` (or `?season=winter`): jumps `sky.day` to that season's first day, time of day kept. Needs
  `sky({ seasons })`; a wrong name throws with the calendar's list.

## Flat backdrop: `style.sky.backdrop`
```js
sky: { backdrop: 0xefebe4 },                                       // one color
sky: { backdrop: sky => (sky.isDay ? 0xefebe4 : 0x2c3346) },       // per frame (time of day, weather, your own state)
```
- Hides the dome (no gradient, horizon line, sun / moon disk, stars or clouds) and sets `scene.background` to the color. A plain background
  color is not tone mapped, so what you write is what shows. `style.background` stays the color when there is no sky module.
- The keyframes still light the world (sun, ambient, their colors).
- Fog: in its default `'horizon'` color the fog follows the backdrop, so far things fade into it; `style.sky.fog.color` of your own wins.
- Not together with `skybox` (both replace the dome).
- To fade the backdrop toward gray in snow, read the weather in the function: `sky => new THREE.Color(0xefebe4).lerp(gray, engine.weather.current.snow * 0.3)`
  (reuse the Color objects; it runs every frame).
