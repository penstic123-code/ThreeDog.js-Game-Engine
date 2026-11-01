# Making a new look from a reference picture

For an AI that is given one picture ("make it look like this") and has to turn it into a style pack. Three commands do the mechanical parts:
`threedog style palette` measures the picture, `npm run new-style` makes the pack, `threedog style check` finds mistakes before you look at pixels.
The taste is yours: the tools never say which colors are right, they only keep the work measurable and repeatable. What a style is and the
composing rules are in `09-style-pack.md`; this page is the order of work.

## What a style can change, and what it cannot
Can change (all in the style pack): colors (`palette`, `terrain.colors`, `background`, `water.color`, season tints), material types per role
(`materials`: matte `lambert`, `toon` bands, `standard`...), lights and sky (`sky.keyframes`, sun, clouds, shadows, `exposure`, `toneMapping`), post
effects (`post`: outline, bloom, grain, vignette, color grading from `@threedog/post-effects`), UI colors and fonts, particle looks, and the colors
of the procedural models (`palette` read by `models.js`).

Cannot change by a style: the **silhouette of models**. A tree stays the shape its model has; a new shape means a new asset pack (code-built models
in `models.js`, or `.glb` files, recipes `05-props-bake.md` and `10-blender-level.md`). And the **world rules**: water level, terrain shape, what
exists where, timing and gameplay are not in a style (a dev run throws, `style check` and R34 report it). If the reference shows a different
world (a canyon instead of hills), say so instead of faking it with colors.

## Steps
1. **Keep the picture.** Put it in the game's `art/reference/` (one file per look, with a few lines of notes beside it on what to copy:
   palette, mood, line work, light direction).
2. **Measure it.** `threedog style palette art/reference/ref.png --n 8` prints JSON (colors with share, hue, saturation, brightness, and role hints:
   largest block = ground / environment candidate, brightest = highlight / sky candidate, most saturated = accent candidate, darkest = shadow or
   outline candidate) and one summary line such as `warm colors, mostly sand, low saturation, medium brightness, weak light/dark contrast`. It
   reads pixels in a headless browser (png, jpg, webp, gif, svg). It is a measurement: a picture's biggest block may be a wall you do not want as the
   ground, so look at the picture too. A phone screenshot of a game usually has a dark UI frame that becomes "the biggest block": add
   `--ignore-ui` (cuts a flat frame around the picture) or `--region x,y,w,h` (only that rectangle), `--crop cut.png` to save exactly what was
   measured and open it, and `--average` for the overall mean color (HSL). The output says what area was measured.
3. **Make the pack.** `npm run new-style sand-dune` creates `packages/styles/sand-dune` from a clean template (gray neutral materials, a sky, one
   palette, no post effects, one palette-colored example model) and links it as `@threedog/style-sand-dune`. Import it in the game:
   `import style, { assets } from '@threedog/style-sand-dune'`, `createEngine({ canvas, style })`, `engine.assets.manifest(assets)`.
   To start from another pack's strengths instead, compose: `style: [lowpoly, sandDune]` (later parts win key by key).
4. **Fill it in, in this order** (each step changes the picture most for the least work): `sky` and `background` (light and mood), `exposure` and
   `toneMapping`, `palette` and `terrain.colors` / `biomeColors` (the measured colors, snapped to a few named ones), `materials` (flat `lambert` for
   a paper look, `toon` for bands, `phong` for shine), `post` (outline for ink lines, bloom for glow, color grading for the final tint), then `ui`.
   Use few colors on purpose: a reference usually has 5 to 8 that matter.
5. **Check.** `threedog style check sand-dune` (or the folder / file of a game's own style). It checks the final merged style, not each part:
   unknown fields (with "did you mean"), world-state fields, palette keys a model reads but the style does not define, color formats (`'ff8800'`
   without `#`, a float, a string `'0xff8800'`), post-effect conflicts (same name twice, two `scene` effects, a depth reader after a buffer-swapping
   effect, `dof` ordered after `outline`), misspelled material roles and types, and asset names the pack does not register. `--json` gives the same list for
   tools, `--assets file.js` adds another pack's names. Exit code 1 on errors. It is static: it cannot prove a pack holds no gameplay logic, only
   the patterns R34 can see (`npm run check` runs R34).
6. **Look.** Take pictures with the same arguments every round so only the style differs:
   `threedog shot styletest --view overview --time day` (add `--weather rain` or another `--time` for the second shot). Use the style test page's
   named camera positions (see "The style test page" below), not free `--pos` shots.
   Read the two images side by side: reference first, then yours; name the three biggest differences (usually: overall brightness, ground color,
   shadow darkness) and fix those only. Then put numbers on them: `threedog style compare art/reference/ref.png .threedog/shots/styletest.png
   [--region x,y,w,h]` prints brightness, saturation, contrast, fine detail, average and main color of both and one sentence such as "the
   screenshot is 18% darker and 2.3x more broken up". It is an aid to judging, not a replacement for looking: no single number is a quality
   score (there is deliberately no "similarity %"); it turns "looks dirty / fragmented / too dark" into something you can change and re-measure.
7. **Iterate.** Change one family of values per round (colors, then materials, then post), re-run `style check`, shoot again. Stop when the
   biggest remaining difference is a silhouette or a world rule: that is the asset pack or the game, not the style.

## Method lessons (from matching a reference picture)
- **Measure first, then build.** Run `style palette --average` and `style compare` before touching values; guessing by eye and getting "close" rejected
  several times costs more than ten minutes of measuring.
- **Take the overall average, not clustered colors.** The tone of a picture is its mean (`--average`), not the 8 colors a median cut finds; a few
  bright accents can dominate the clusters and say little about the look. Use clusters for picking named palette entries, the mean for exposure and tint.
- **Use the highest-resolution reference you have**, and crop away phone UI (`--ignore-ui` / `--region`). A small, compressed or UI-framed picture
  gives wrong fine-detail and brightness numbers.
- **Restraint: an effect the reference does not show is not added.** Smudge filters, AO and tone changes stacked together made a picture worse with every
  layer. Start with no post effects, add one only for a visible difference you named, and measure again after each one. `style check` warns when more than 2 are on.
- **The first frame should already be close.** Get sky, exposure, palette and material type right in the first round; if the first screenshot is far
  from the reference, fix that (one family of values at a time) before adding anything.
- **Quantify "dirty / fragmented / dark".** Dirty = lower saturation or an off hue (average color), fragmented = fine detail ratio well above 1,
  dark or flat = brightness and contrast. Change one thing, run `style compare` again, keep it if the number moved toward the reference and the picture looks better.
- **Nothing drawn?** Do not bisect with screenshots: `threedog scene --hidden` lists every mesh that exists but is not drawn and why (hidden parent, layers, scale 0,
  empty geometry, behind the camera...). A mesh that is drawn but far too small is not an error there, but its position and bounding radius are listed:
  compare them with what you meant (`scene` without `--hidden`).

## Guard rails
- Never put gameplay or world values in the pack to match a picture; `style check` reports them as errors.
- Fonts and textures are asset-pack entries; the style names them (`ui.fonts: ['pixel']`, `terrain.detail.texture`), it does not carry files.
- Keep `npm run check` at 0 errors; a new pack adds no warnings.

## The style test page
`/styletest.html` (`examples/styletest`) is the one fixed scene a style is judged by: a character, trees, rock, grass, flowers, water, terrain, glass,
a shadow receiver, wood / stone / metal surfaces, a lit room (outside and inside) and the UI parts. Same arguments, same picture, so only the style differs.
- `threedog shot styletest --view <name> [--time day|dusk|night] [--weather clear|rain|snow]`; the same words work as URL parameters
  (`?view=room&time=dusk&weather=rain`; also `style=none` for the engine's gray placeholders, `env=1` for environment lighting from the sky).
- Views: `overview` (everything, read overall brightness, ground color, shadow darkness), `character` (close-up: character colors, outline, shadow on
  the ground), `water` (water color, shore, fog at distance), `room` (the lamp and window light against the dark corners: ambient level, `ao`, bloom),
  `path` (the camera moves along a fixed line at 2.5 m/s: with `--wait 4` the shot is the same frame every time; in a browser look for grass blades
  and shadow edges that flicker or crawl), `ui` (HUD, dialogue line, bag window: the `ui` colors).
- Per round: shoot `overview`, `room` at `--time dusk`, and `character`; compare with the reference, name the three biggest differences, fix those.
- `?panel=1` opens the workbench (needs the dev package `tweakpane`, installed with the repository's `npm install`; without it the page says so).
  Live sliders change exposure, sky time, environment lighting, water color, post effects and UI colors at once; palette, terrain and wave values
  are marked "needs rebuild" and only apply after "apply and rebuild". "export overrides" prints an object literal to paste into
  `style: [lowpoly, { ... }]`; the original pack is never written, so the paste is the one place the change becomes real.
