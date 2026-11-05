# FEEDBACK: The Last Exposure (ghosts)

## Times (from the start, 50 minute limit)
- First picture: 17 min (first `shot --play --gpu`, real WebGPU, whole house built; it worked on the first run).
- First playable: 21 min (walk, raise camera, photo counts, `check` passed; the test had one wrong check of mine left).
- Finished: about 47 min. `check` passes, game test 29 of 29 on real WebGPU (nvidia blackwell), winning run included.

## Where I got stuck
1. **The dev bridge does not draw on the GPU.** `snap` said "drawn by WebGL2 (fallback...)", `describe().renderer` said SwiftShader. Honest and clear, but `shot --gpu` has no way to pose a moment (aim, raise the viewfinder). I added `game/showcase.js`, a `?view=` URL for `shot "/?view=plate" --play --gpu`. A `shot --js` or a bridge page on the GPU would remove that file.
2. **Plain data under `content/` fails `check`.** `content/mansion.js`: "unknown content "mansion"... register it in content/rules.js". The message was exact, but the file is not imported by content/index.js at all, so I had not expected every file there to count. I moved both to `data/`.
3. **`engine.audio.buses.master` is undefined.** Recipe 31 section 2: "Buses are real Web Audio GainNodes: `master`, `music`, `sfx`...". My reverb connected to it and froze gameplay with "Failed to execute 'connect' on 'AudioNode'". `api/audio.md` has it right (`audio.master`, and "empty until audio unlocks"). Found by listing the keys over the bridge.
4. **`engine.describe('hunt')` returns `{ hunt: {...} }`.** Recipe 19's `describe.add` and the bridge's `describe player.state` led me to expect the part itself. Failed three test checks; read the output and fixed the spec.
5. **"How" had nothing for two of my questions.** `how "dark scene readable"` and `how "room sound reverb"`: no good match ("The docs never use: reverb"). It said so plainly. Reverb I built by hand on `audio.ctx`, which is fine. Light leaking through walls is the bigger gap, see below.
6. **A dark room stayed black when I doubled the fill.** The check named `HemisphereLight intensity 2.03` as the setter, and luminance did not move. The cause was mine: a dark blue light on a dark red wall multiplies to nothing. Changing the light's color to near neutral fixed it (near-black share 57% to 45% with everything out). The fact line pointed at intensity, not at color.
7. **`engine.onRender(fn)` gives `ctx`, not `dt`,** unlike `onFixed` and `onFrame`. Caught by reading api/engine.md before running. I time it myself.
8. **My own shell slips cost about 4 minutes**: a Node one-liner with backticks in bash corrupted the spec, and a patch left a stray line. The type check named the stray line at once.
9. **`applyState({ pos })` puts the player anywhere, walls included.** The test stood at x 22.9, outside the house. That led me to a real bug: ghosts could wander outside the walls where no plate reaches them. Ghosts are now bound to their room.

## Lights: how many and how
- **74 flames** in 10 rooms (sconces, table candles, 3 chandeliers, hearths), all `engine.lightPool` sources, on **12 real PointLights**. Plus 3 lights outside the pool: hemisphere fill, flashlight (SpotLight with the only shadow map), camera flash (PointLight, intensity 0 until used). 15 in all, fixed from the start.
- Each flame also has a flame mesh and spark that always draw, and a halo sprite as the pool's `glow` stand-in, which is what you see through a door into a room with no real light. This worked very well for almost no code.
- **Pool lights cast no shadow, so they shine through walls.** The pool picks by distance and brightness and knows nothing of rooms. My fix: sources outside the player's room (and the far side of a door within 5 m) get `set({ intensity: 0 })`. Near a door, both rooms are lit, so some leak is still there for those few steps. `lightPool({ shadows })` was not tried: a shadowed point light per lamp looked too costly and I had no time to measure it. A "rooms" or "group" idea in the pool, or one line in recipe 09 section 1b about indoor use, would help.
- Lit lamps also warm the fill light a little (a stand-in for bounced light), so a snuffed candle is felt across the room.
- Busiest place (Great Hall, 12 of 74 holding real lights, flashlight on): 19.9 ms a frame, measured once in the headless GPU test at 960x540-class size. Not measured in a real window.

## Things that told me something false, or close to it
- Recipe 31: `master` listed among the buses (item 3). False for `audio.buses`.
- Picture check: "shadow stripes on 82.0% of the picture (self-shadowing or thin casters)" and 97.1% on another shot. I looked at the images and saw no stripes. The moving grain or the printed wallpaper may be what it measures. I changed nothing.
- Picture check: "lights 10 over 8 (tier high)" reads as a limit. 15 lights ran at about 20 ms; I could not tell where 8 comes from or what it costs.
- "no detail is left there" for 45% near black on the all-out room: the image does show carpet and wallpaper at that level, so the sentence is stronger than the picture. The number itself is fine.
- `new-game` printed that `threedog` is `^0.7.1` while docs include MIGRATING-0.8.md; I did not need either, noted only.

## Not verified
- Sound was never heard. Tests prove the right loops start per room (`bed.foyer`, `bed.hall`) and the echo level changes; whether it sounds good is unknown.
- Right mouse and left click (`Mouse2`, `Mouse0`) under real pointer lock were not tried; keys Q, C, F were, through real key events.
- No person played it; difficulty, nerve drain and film count are guesses.

## The plate itself
`shots/the-widow-plate.jpg` is the photo the game stored during the test (2048x1152, real WebGPU). The ghost is on it, but the camera flash burns out the desk in front of it and much of the ghost's lower half. Readable, not tuned.
