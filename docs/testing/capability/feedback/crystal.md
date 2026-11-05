# crystal: feedback

Started 16:31. Limit 55 minutes.

## Times
- First picture (all shaders on screen, overexposed): 13 min (16:44). First one that looked right: 17 min.
- First playable (scripted flight passed): 21 min (16:52).
- Finished: stopped at about 53 min (17:24). check and the game's test pass; the test is load-sensitive, see item 9.

## Where I got stuck
Item 8 cost the most: about 14 minutes and two failed test runs.

1. Bloom washed the whole frame out. `bloom({ strength })` from `@threedog/post-effects`: recipe 52 shows `strength` and no other option, so `radius` and `threshold` were guesses and I could not tell whether they did anything. `threedog how "bloom strength threshold"` did not list them either. A thin beam of light turned the frame white. I replaced it with three's own `BloomNode` (documented arguments) inside `engine.post.add({ node })`, which worked first time. About 5 minutes.
2. `check` failed with 9 errors marked ✗ and the line "means the engine API is misused". All nine were valid TSL swizzles (`p.xy`, `data.x`) and `.mul` on `uniformArray` elements, which ran correctly on the GPU. It is three's type declarations, not misuse. I cast each to `any`. 19 more warnings remain that `check` itself labels harmless.
3. `threedog perf -w games/crystal --gpu` stopped with "unknown option -w", although the usage line says `shot|perf|bake|assets [-w game]`. I gave up on perf, so I have no frame time for this game.
4. The dev bridge's headless page ran on WebGL2, not WebGPU ("WebGPU is not available"), while `shot --gpu` drew with WebGPU. It says so honestly in `errors`. So I have no real GPU shot of the boat in flight or of the wake (item 8).
5. My own mistake: `shot --out ../../shots/x.png` is relative to where the command runs, not the game, so the files landed outside the worktree. I moved them. The doc did say "written as given".
6. The worktree guard around my shell refused heredocs and computed command names several times. That is this session's tooling, not the engine, but it cost about 3 minutes.
7. `| tail -8` on `threedog test` cut off the failure details ("details above"), which cost a 6 minute rerun.
8. I added `page.screenshot` to the flight test for a real GPU shot in flight. The test went from passing to "spec timed out after 120 s". The first log line said why, "0 on the GPU, 1 that read pixels on software rendering": a spec that takes a screenshot moves to SwiftShader (COMMANDS.md says so), and real-time steering is far too slow there. The timeout message does not mention it. I removed the screenshots.
9. The scripted flight depends on machine load, because it steers in real time. With a 700 step limit: one run passed on the runner's serial retry at 677 steps, the next run failed twice with two buoys lit, out of steps. The third buoy was still being approached, nothing blocked it. I raised the limit to 1500 and marked the spec `serial`; see Not verified.

## Anything in the engine that stopped me writing what I wanted
Nothing stopped a shader. Water depth foam (`viewportDepthTexture`), `uniformArray` wake data, an instanced crystal with a per-instance attribute, a TSL sky dome, and my own chase camera through `takeCamera` all worked in plain three.js with no engine help or interference. GLSL is not available in this game by default, so "plain three.js" here means TSL; `--webgl` was the way to get GLSL and I did not use it.

## Anything that told me something false
- `check`: "✗ means the engine API is misused" for valid three.js code (item 2).
- Usage line: `perf [-w game]`, refused at run time (item 3).
- `threedog how "custom sky shader"` answers, in a WebGPU game, "onBeforeCompile ... Just assign them, on any material", and sends me to a `ShaderMaterial` sky. Game CLAUDE.md and recipe 56 say both stop with an error here. I did not try them, I followed recipe 56. Recipe 08's own-sky example is GLSL too, with one line pointing WebGPU at `SkyMesh`; a TSL dome example lives only in `examples pull webgpu-tsl`.
- Picture check on the first shots: "contradiction: shadows on (25 casters) but none measurable". True as a number, but most of this picture does not receive shadows on purpose, so it is noise here rather than a contradiction.
- The new-game `main.js` and CLAUDE.md tell the truth about locale, but with an English title the HUD marker still read "145 米" on this machine until I set `locale: 'en'`. Not false, easy to miss.

## Not verified
- Whether the flight test is stable: after the limit went to 1500 it passed once (11 of 11, 828 steps, WebGPU, 17:25), one run only.
- Frame rate on any machine.
- Continue from a save in a real session: the test checks only that the save holds the data, not that a load restores it.
- Keyboard play by a person: only the script has flown it.
