# Build notes (keeper, 30-minute run, 2026-11-03 20:06 - about 20:25)

## How I found things
- CLAUDE.md (asked me to offer options / ask about look first; the brief said do not ask, so I took picks and marked them below), then `node_modules/threedog/docs/AI.md` index.
- `npx threedog how "third person player"` -> pointed to recipe 21 / 13 / 32; useful. Then read by hand: recipes/01-new-game.md (openWorld options), 07-flow-scenes-pause.md (flow, pause, Esc), 08-weather-sky.md (style.sky keyframes, weather types), api/settings.md, api/saves.md, api/calendar.md, api/cameraRig.md, api/characters.md.
- Guessed: `engine.random.next()` (I wrote `engine.random()`), `engine.cameraRig` property names (docs say yaw/pitch/distance/height are writable at runtime).

## Picks made without asking (DESIGN.md was left as the empty template)
- Style: warm dusk to cold blue night, dark ambient so lamps matter; ACES tone mapping; Georgia/serif UI with amber accent.
- Camera: follow, behind the player looking down the pier (distance 7, pitch 0.2). Run 4 minutes dusk to dawn.
- Keeper body is a lathe-built coat + hat registered as a model in assets.js (not a skinned model, no walk animation).

## Errors hit, verbatim, and the fix
- `main.js:60 this is not a function, it cannot be called with parentheses` (from `npm run check` types) -> `engine.random` is an object; use `engine.random.next()`.
- `property does not exist: engine.weather.target (Weather has no target)` -> removed that condition.
- `world.js:6 A spread argument must either have a tuple type...` -> `t.repeat.set(repeat[0], repeat[1])`.
- Title overlay stayed on screen in `?moment=` shots: `.k-screen{display:flex}` beats the `hidden` attribute -> added `[hidden]{display:none}`.
- Title came back after my moment code had gone to `playing`: flow enters `title` after engine:ready -> flow:change handler skips the title when `moment` is set.
- Sea shader used `scene.fog.color` for horizon and stayed brown at night (that fog color did not match the sky I expected). I stopped reading it and interpolate `style.sky.keyframes` myself in main.js. I did not find out why scene.fog differed.
- A bash heredoc with a nested `python3 - <<EOF` hung the shell for 120 s (my mistake, not the engine).

## Stuck / confused (own words)
- "ops guard: 1 places change gameplay state outside fixed steps and ops (list: .threedog/ops-guard.log)" printed on every test run, but the log file does not exist. I moved `calendar.timeOfDay` into onFixed; the message stayed. Not resolved. My guess: `engine.weather.set` in onFrame, or the moment block at startup.
- Weather transition: `weather.set('storm', {seconds: 0.1})` still shows "changing (33%)" in the headless shot, so the storm shot has rain but little fog. Fog look is not verified.
- Whether `settings` rows (shadows on/off, low/medium/high) are really what the task wants: they are the engine's own Graphics tab ("画质"), I only confirmed the tab opens with Esc and has a shadow row text by test.

## Where I wanted plain three.js and what happened
- Nothing was blocked. Scene, lights, ShaderMaterial, meshes all went straight to `engine.scene`. Sea and halo are plain ShaderMaterials; I copied tone-mapping/colorspace chunks so they match the scene.
- Shot's shadow check says "shadows on (27 casters) but none measurable": the sun is low/dim at night, so shadows only show at dusk; I did not tune the sun.

## Time split (rough)
- Reading docs / finding APIs: ~5 min. Writing world, fx, rules: ~8 min. Tuning look from shots (title overlay bug, halo edge, sea color): ~5 min. Tests and fixing check errors: ~4 min.

## Not done / weak
- Sea reflection of lamps is faint; no moon glitter visible. Rain yes, fog not verified. Character has no animation. No sound. Mouse look and run key are engine defaults, not shown in the hint. Lamps only go out one at a time with a 1.6 s flicker warning. Barrels appear anywhere on the deck (can appear on top of a lamp). No pause screen of my own: Esc opens the engine settings menu (tabs: game, graphics, sound).
