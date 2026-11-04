# island R1 / R2 on real WebGPU (2026-11-05)

System Chrome (headless, `launchRealGPU`), GPU "nvidia blackwell", 1280x720, vite dev server per game copy. Game code not changed.
Page opened with `?play`, waited for `engine.ready`, then 6 s idle. Player moved with `engine.player.placeAt` in a fixed step, `face()` set; screenshot 3.5 s later.

| | R1 | R2 |
|---|---|---|
| backend (`describe().renderer`) | webgpu (requested webgpu, tsl true, no fallback) | webgpu (same) |
| console / page errors | 1: "Failed to load resource: 404" (url not captured, no response >= 400 seen by the page listener; likely favicon) | same single 404 |
| frame ms, median (5 s at start, 300 frames) | 16.7 | 16.7 |
| frame ms, p95 | 16.8 | 16.7 |
| draw calls (`inspect.perf` = `renderer.info.render`) | 589 | 265 |
| triangles | 2,238,305 | 902,829 |

Frame time is pinned at 60 Hz vsync, so it only says "no dropped frames at the start spot"; it is not a GPU-cost measure.

## Spots (player position x, y, z at shot time)

| spot | R1 | R2 |
|---|---|---|
| cabin (start) | -6, 2.3, 23 | -4, 1.6, 14.5 |
| flowers | 20, 1.8, 17 | 22, 1.3, 13 |
| dock | 6, 0.4, 42 | 8, 0.5, 50 |
| hill (facing sea) | 14, 11.7, -24 | -26, 7.5, -28 |
| lighthouse from below | -33, 2.3, -20 | 32, 2.3, -20 |
| reef | 62, 4.4, -34 | 62, 1.8, 42 |
| lighthouse top | NOT REACHED | 35.2, 7.4, -32 (outer ramp ring near the top, top is 8.2; not the lamp room) |

## Not reached
- R1 lighthouse top / ending: the climb is a scripted ride in `main.js` that only starts with all 5 shards (`game.shards >= 5`); `placeAt` snaps to ground, so teleporting up gives ground level. Needs collecting 5 shards (reef one needs the boat); not done. No r1-top.png saved.
- R2 ending: not played; the shot is the ramp near the top only.
- "Dock with boat": the boat is at the dock/pier at start in both; in the dock shots check it is in view (camera behind player facing south toward it).
- Camera is the game's follow camera (set behind the player after placement, no pose); the hill / lighthouse shots show the player's back, camera angle was not tuned per spot.

Files: r1-<spot>.png, r2-<spot>.png (cabin, flowers, dock, hill, lighthouse, reef; r2-top).
