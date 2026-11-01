# Making a new look from a reference picture

For an AI that is given one picture ("make it look like this") and has to turn it into a style pack. The tools keep the work measurable: `threedog style palette`
and `style compare` measure pictures, `npm run new-style` makes the pack, `threedog style check` finds mistakes before you look at pixels. They never say which
colors are right; the taste is yours. What a style is and the composing rules are in `09-style-pack.md`; this page is the order of work.

## The loop (every round, in this order)
Looping "edit, screenshot, read the image" costs the most tokens and fixes the least. Numbers come first, pictures last.
1. **Measure the reference once** (step 2 below): `style palette <ref> --average`, then `style compare <ref> <your shot>`.
2. **Change one family of values** (colors, then materials, then post).
3. **Shoot small and compare to the previous shot**: `threedog shot styletest --view overview --size 480x270 --keep --compare <previous.png>`. It prints the
   pixel diff and the look differences. Through MCP the `snap` tool is 480 px wide by default; `style_compare` gives the numbers.
4. **Read the numbers first, then at most one image per round.** Name the biggest remaining difference and fix only that.
5. **Wrong in a way the numbers do not explain?** Diagnose before guessing: `engine.debug.view('albedo' | 'lighting' | 'shadow' | 'normals')` shows which
   layer is off, `engine.describe().look` shows who set each value and where (recipe 52). Nothing drawn: `threedog scene --hidden` (reasons per mesh).
6. **After two rounds without reaching the reference, take the next exit** and tell the user which and why: `look.surface.patch('detail' | 'lighting', glsl)`
   -> painted textures (`map`, `normalMap`) -> `look.materials.replace` -> plain three.js (recipe 40 section 8). Never call it "close" to stop tuning.
7. **Every few rounds show the user the shot and the numbers.**

The loop is the same for every art direction; only what you measure and which value you move differ: flat (palette share, hard edges, no shading), painterly
(soft edges, texture, low contrast), low-poly (few flat colors, faceted light), realistic (exposure, tone mapping, lighting, material roughness). None is the default.

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
   palette, mood, line work, light direction). Use the highest-resolution picture you have: a small or compressed one gives wrong detail and brightness numbers.
2. **Measure it.** `threedog style palette art/reference/ref.png --n 8 --average` (MCP: `style_palette`) prints JSON (colors with share, hue, saturation,
   brightness, and role hints: largest block = ground / environment candidate, brightest = highlight / sky candidate, most saturated = accent candidate,
   darkest = shadow or outline candidate) and one summary line such as `warm colors, mostly sand, low saturation, medium brightness, weak light/dark contrast`.
   It reads pixels in a headless browser (png, jpg, webp, gif, svg). The overall mean (`--average`) sets exposure and tint; the clusters pick the named
   palette entries. A phone screenshot with a dark UI frame needs `--ignore-ui` or `--region x,y,w,h`; `--crop cut.png` saves exactly what was measured.
3. **Make the pack.** `npm run new-style sand-dune` creates `packages/styles/sand-dune` from a clean template (gray neutral materials, a sky, one
   palette, no post effects, one palette-colored example model) and links it as `@threedog/style-sand-dune`. Import it in the game:
   `import style, { assets } from '@threedog/style-sand-dune'`, `createEngine({ canvas, style })`, `engine.assets.manifest(assets)`.
   To start from another pack's strengths instead, compose: `style: [basePack, sandDune]` (later parts win key by key).
4. **Fill it in, in this order** (each step changes the picture most for the least work): `sky` and `background` (light and mood), `exposure` and
   `toneMapping`, `palette` and `terrain.colors` / `biomeColors` (the measured colors, snapped to a few named ones; a reference usually has 5 to 8 that
   matter), `materials` (`lambert` matte, `toon` banded, `phong` shiny, `standard` PBR, `basic` unlit), `post`, then `ui`. The first frame should already be close:
   if it is far from the reference, fix sky, exposure, palette and material type before adding anything.
5. **Check.** `threedog style check sand-dune` (or the folder / file of a game's own style). It checks the final merged style, not each part:
   unknown fields (with "did you mean"), world-state fields, palette keys a model reads but the style does not define, color formats (`'ff8800'`
   without `#`, a float, a string `'0xff8800'`), post-effect conflicts (same name twice, two `scene` effects, a depth reader after a buffer-swapping
   effect, `dof` ordered after `outline`), misspelled material roles and types, and asset names the pack does not register. `--json` gives the same list for
   tools, `--assets file.js` adds another pack's names. Exit code 1 on errors. It is static: it cannot prove a pack holds no gameplay logic, only
   the patterns R34 can see (`npm run check` runs R34).
6. **Look: the loop above.** Take pictures with the same arguments every round so only the style differs, and use the style test page's named camera
   views (below), not free `--pos` shots. `threedog style compare art/reference/ref.png .threedog/shots/styletest.png [--region x,y,w,h]` prints brightness,
   saturation, contrast, fine detail, average and main color of both and one sentence such as "the screenshot is 18% darker and 2.3x more broken up". There is
   deliberately no "similarity %": the numbers turn "looks dirty / fragmented / too dark" into something you can change and re-measure. Dirty = lower
   saturation or an off hue, fragmented = fine detail ratio well above 1, dark or flat = brightness and contrast. Keep a change if its number moved toward
   the reference and the picture looks better. A phone UI frame in the screenshot skews the numbers: compare a `--region`.
7. **Stop** when the biggest remaining difference is a silhouette or a world rule: that is the asset pack or the game, not the style.

## Guard rails
- Restraint: an effect the reference does not show is not added. Start with no post effects, add one only for a visible difference you named, and measure
  again after each one. `style check` warns when more than 2 are on.
- Never put gameplay or world values in the pack to match a picture; `style check` reports them as errors.
- Fonts and textures are asset-pack entries; the style names them (`ui.fonts: ['pixel']`, `terrain.detail.texture`), it does not carry files.
- Keep `npm run check` at 0 errors; a new pack adds no warnings.

## The style test page
`/styletest.html` (`examples/styletest`) is the one fixed scene a style is judged by: a character, trees, rock, grass, flowers, water, terrain, glass,
a shadow receiver, wood / stone / metal surfaces, a lit room (outside and inside) and the UI parts. Same arguments, same picture, so only the style differs.
- `threedog shot styletest --view <name> [--time day|dusk|night] [--weather clear|rain|snow]`; the same words work as URL parameters
  (`?view=room&time=dusk&weather=rain`; also `style=none` for the engine's gray placeholders, `env=1` for environment lighting from the sky).
- Views: `overview` (everything: overall brightness, ground color, shadow darkness), `character` (close-up: character colors, outline, shadow on
  the ground), `water` (water color, shore, fog at distance), `room` (the lamp and window light against the dark corners: ambient level, `ao`, bloom),
  `path` (the camera moves along a fixed line at 2.5 m/s: with `--wait 4` the shot is the same frame every time; in a browser look for grass blades
  and shadow edges that flicker or crawl), `ui` (HUD, dialogue line, bag window: the `ui` colors).
- Per round: shoot `overview`, `room` at `--time dusk`, and `character`.
- `?panel=1` opens the workbench (needs the dev package `tweakpane`, installed with the repository's `npm install`; without it the page says so).
  Live sliders change exposure, sky time, environment lighting, water color, post effects and UI colors at once; palette, terrain and wave values
  are marked "needs rebuild" and only apply after "apply and rebuild". "export overrides" prints an object literal to paste into
  `style: [yourPack, { ... }]`; the original pack is never written, so the paste is the one place the change becomes real.
