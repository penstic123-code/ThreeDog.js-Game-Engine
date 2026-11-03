# Making a new look from a reference picture

**In this recipe**: The loop · What a style can change, and what it cannot · Steps · Look check after every shot · Look questions · Guard rails ·
The style test page

No reference picture? Skip the measuring (step 2, `style palette`, `style compare` against a reference); judge each shot against DESIGN.md and
its "Loved / Not for this game" list, and use the rest: the loop, `style check`, the look check after every shot and the look questions.

For an AI that is given one picture ("make it look like this") and has to turn it into a style. The tools keep the work measurable: `threedog style palette`
and `style compare` measure pictures, your game's `style/index.js` holds the result, `threedog style check` finds mistakes before you look at pixels. They never say which
colors are right; the taste is yours. What a style is and the composing rules are in `09-style.md`; this page is the order of work.

## The loop (every round, in this order)
Looping "edit, screenshot, read the image" costs the most tokens and fixes the least. Numbers come first, pictures last.
1. **Measure the reference once** (step 2 below): `style palette <ref> --average`, then `style compare <ref> <your shot>`. Break the picture into
   techniques (shading, one texture language, palette, edges) before choosing values.
2. **Change one family of values** (colors, then materials, then post). Art code hot-swaps on save. After writing or changing a model, look at it alone
   first: `threedog gallery --shots` (every model under three lights, `.threedog/gallery/index.html`) shows wrong scale, wrong facing, holes and missing
   faces before the level hides them.
3. **Shoot small and compare to the previous shot**: `threedog shot styletest --view overview --size 480x270 --keep --compare <previous.png>`. It prints the
   pixel diff and the look differences. Through MCP the `snap` tool is 480 px wide by default; `style_compare` gives the numbers.
4. **Read the numbers first, then at most one image per round.** Name the biggest remaining difference and fix only that. `style compare <ref> <shot>
   --out side.png` puts both in one image. With no reference, read the shot's hints (below). Then look at the image as a player would and judge it
   against the picture DESIGN.md wants and its "Loved / Not for this game" list (never against a technique example): what would a player read as a
   mistake? Typical ones are objects floating or cutting into each other, odd flat discs or blobs (a hard-edged opaque "puddle" reads as a gray ball),
   glare, areas too dark or busy to read, placeholder-looking shapes; these are prompts, not a list to tick. Fix what you find, or note it in
   STATUS.md with why it stays. Before calling a look done, go through the "Look questions" below that matter for this game.
5. **Wrong in a way the numbers do not explain?** Diagnose before guessing: `engine.debug.view('albedo' | 'lighting' | 'shadow' | 'normals')` shows which
   layer is off, `engine.describe().look` shows who set each value and where (recipe 52). Nothing drawn: `threedog scene --hidden` (reasons per mesh).
   Washed-out or too-dark textures, odd normals: `threedog inspect materials` (wrong color spaces first, sizes, who made each material).
6. **If the biggest difference stops shrinking over a few rounds, change approach** (in this order) and tell the user which and why:
   `look.surface.patch('detail' | 'lighting', glsl)` -> painted textures (`map`, `normalMap`) -> `look.materials.replace` -> plain three.js
   (recipe 40 section 8). Never call it "close" to stop tuning.
7. **Every few rounds show the user the shot and the numbers.**

The loop is the same for every art direction; only what you measure and which value you move differ: flat (palette share, hard edges, no shading), painterly
(soft edges, texture, low contrast), low-poly (few flat colors, faceted light), realistic (exposure, tone mapping, lighting, material roughness). None is the default.

## What a style can change, and what it cannot
Can change (all in the style): colors (`palette`, `terrain.colors`, `background`, `water.color`, season tints), material types per role
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
2. **Measure it.** `threedog style palette art/reference/ref.png --n 8 --average` (MCP: `style_palette`) prints the colors (`--json`: JSON only) with share, hue, saturation,
   brightness, and role hints: largest block = ground / environment candidate, brightest = highlight / sky candidate, most saturated = accent candidate,
   darkest = shadow or outline candidate, and one summary line such as `warm colors, mostly sand, low saturation, medium brightness, weak light/dark contrast`.
   It reads pixels in a headless browser (png, jpg, webp, gif, svg). The overall mean (`--average`) sets exposure and tint; the clusters pick the named
   palette entries. A phone screenshot with a dark UI frame needs `--ignore-ui` or `--region x,y,w,h`; `--crop cut.png` saves exactly what was measured.
3. **Open the style.** Edit your game's `style/index.js` (a new game has one with every key commented out, so the engine shows gray placeholders).
   It is already passed in: `import style from './style/index.js'`, `createEngine({ canvas, style })`. Procedural models the look needs go in the same
   folder (`style/models.js`, registered with `engine.assets.manifest({ name: 'mygame', models })`).
   To start from another pack's strengths instead, compose: `style: [basePack, style]` (later parts win key by key).
4. **Fill it in, in this order** (each step changes the picture most for the least work): `sky` and `background` (light and mood), `exposure` and
   `toneMapping`, `palette` and `terrain.colors` / `biomeColors` (the measured colors, snapped to a few named ones; a reference usually has 5 to 8 that
   matter), `materials` (`lambert` matte, `toon` banded, `phong` shiny, `standard` PBR, `basic` unlit), `post`, then `ui`. The first frame should already be close:
   if it is far from the reference, fix sky, exposure, palette and material type before adding anything.
5. **Check.** `threedog style check` (the game's `style/` folder; or give a folder, a file or a game name). It checks the final merged style, not each part:
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
   Add `--out side.png` (MCP `style_compare` always writes `<shot>.compare.png`) and open that one image: reference left, screenshot right; look at both.
7. **Stop** when the biggest remaining difference is a silhouette or a world rule: that is the asset pack or the game, not the style.

## Look check after every shot
Every `threedog shot` prints look numbers and hints (`--no-look` skips them). The numbers are luminance, contrast (std and p5-p95 range of
luminance), saturation, clipped and near-black shares, and the shadow area. Hints come in two kinds:
- **Contradictions**, whatever the style: the settings say one thing and the pixels another. Shadows on but none measurable (with the cause it found:
  `look.shadow` bias as meters of shadow depth, the view outside the shadow box, texel size, or fill light washing them out), a light that changes
  no pixel.
- **Facts**: measured, maybe wanted, with what sets them: glare, large clipped or near-black areas, a night that is not dark from lighting (and
  whether the brightness at 00:00 is lighting at all), the key / fill balance. Each becomes a contradiction only where DESIGN.md declares the
  opposite.
- **Intent**, only against what the game declared: DESIGN.md's optional `Look intent:` line (listed words such as `no-glare`, `dark-nights`,
  `strong-light`, `muted`; the template lists them all; the table's free text is not read), or the reference given with `--ref`. A muted,
  low-contrast game is told when its shot measures saturated and contrasty, never the other way round unless it said so. No declaration and
  no reference: numbers only, no judgement.

A hint is a fact plus the parameter and its current value, not a target. It never says what value is right for an art direction; decide that from
the reference, DESIGN.md or the user. A deliberate choice (a night meant to be pitch black) makes a hint something to note, not to fix.

## Look questions
Pick the ones that matter for this game, before calling a look done and when a round stalls. They name what to look at, not which answer is
right for a given art direction.
- **Light roles**: is there one clear key light (direction, color), a fill that keeps shadows readable, and does the sky / ambient color agree with it?
  `debug.view('lighting')`.
- **Shadows and contact**: do objects sit on the ground (contact shadow, AO, or a dark base), are shadow edges as hard or soft as the reference, no
  acne or peter-panning? `debug.view('shadow')`. A shadow that starts a hand's width away from a foot or a crate is peter-panning: check
  `look.shadow` `bias` (it is in 0-1 shadow depth, so a large value over a long light range is decimeters). Faint shadows: the shadowed ground gets
  only hemi + environment, so their sum against the sun sets the contrast; small casters blur when the shadow box is much bigger than the
  scene (texel size: recipe 52, "Atmosphere parts"); a compact scene fits it, for example `look.shadow.set({ extent: 30 })`.
- **Day / night**: shoot noon and night (`shot --time 12:00`, `--time 22:00`); is night as dark as the design wants on every material, PBR ones
  too? A PBR material that stays bright at night is usually lit by an environment map that does not follow the time (`describe().look.env.source`
  says which map lights it and whether it follows).
- **Material response**: do surfaces that should differ (wood, stone, metal, cloth, skin, water) differ in roughness, specular and color, not only hue?
  A plastic-looking surface is a shading problem, not a color problem.
  Metals have something to reflect (environment). A glossy flat decal (puddle, spill, polished floor) reflects only the environment map, never the
  street around it: a hard-edged dark or bright ellipse then reads as a hole or a blob. Give it soft alpha edges and a color close to the surface
  under it, or darken / smooth the ground's own material (roughness map) instead of laying a disc on it; check it at noon and at night.
- **Texture scale and detail**: is texel density similar across neighbors, no obvious tiling at the usual camera distance, detail matching how close the
  camera gets? Color spaces right (`inspect materials`).
- **Color and grading**: value range (darkest / brightest), saturation and the overall hue shift match the reference (`style compare`); exposure and
  tone mapping chosen, not left at whatever was there.
- **Atmosphere and depth**: fog, haze or color shift with distance as the reference shows; the background separates from the play space.
- **Readability of gameplay elements**: the player, interactables, hazards and pickups stand out by value or color from the ground at play distance and
  under every time of day / weather the game uses (shoot them at dusk and in rain too).
- **Consistency**: does any asset step out of the overall style (outline weight, shading model, texture language) where DESIGN.md did not
  intend it? A deliberate mix of styles is a choice, not a mistake.

## Guard rails
- Restraint: for each post effect, say which difference in the shot it fixes. Start with none, add one for a visible difference you named, and
  measure again after each one; `style check` lists which are on and how to see what each costs.
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
- The dev panel (workbench + tune), in any game: `if (location.search.includes('panel=1')) import('@threedog/tools/panel').then(m => m.openPanel(engine));`
  It needs the optional dev package `tweakpane` (`npm install -D tweakpane`; the repository's `npm install` has it); without it the page says so.
  A production build of the vite preset gets a stub instead (no panel, no tweakpane in the bundle); dev and test builds get the real one.
  `/styletest.html?panel=1` opens it on the style test, which also passes `{ overrides }` (its `?ov=` style part) for "apply and rebuild".
  Live sliders change exposure, sky time, environment lighting, water color, post effects and UI colors at once; palette, terrain and wave values
  are marked "needs rebuild" and only apply after "apply and rebuild". "export overrides" prints an object literal to paste into
  `style: [yourPack, { ... }]`; the original pack is never written, so the paste is the one place the change becomes real.
  The "tune" folder drags any look part value (`engine.look.<part>.set`), a material picked by name (color, roughness, metalness, emissive...) and
  numeric `engine.uniforms`. "write back" saves them (with the style changes) to `.threedog/tune.json` on the dev server; then
  `threedog tune write <file>` prints the code change as a diff (one `// threedog:tune begin ... end` block of plain calls) and `--apply` writes it.
  Review it, then keep the block or move each value where it belongs (the pack, the material's definition).
