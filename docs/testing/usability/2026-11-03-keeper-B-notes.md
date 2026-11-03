# NOTES (守灯人)
- 19:02 start. Empty project: main.js only has "// start here". three 0.187 + vite 7.
- Approach: single main.js, custom ShaderMaterial for sky/sea/halo, canvas-generated wood textures (no asset files).
- No docs were consulted; wrote from memory of three.js API. Sky/sea/halo are hand-written ShaderMaterials (sea = analytic wave normals + sky reflection + lamp streaks + foam; halo = billboard additive flicker shader).
- Warnings seen (console): "THREE.Clock: This module has been deprecated. Please use THREE.Timer instead." (left as is, harmless) and
  "THREE.WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead." (left; I had assumed PCFSoft existed in 0.187 - it does not, no visible change).
- No shader compile errors, no runtime errors on first run.
- Confusion: none blocking. Minor: ShaderMaterial needs `#include <tonemapping_fragment>` / `<colorspace_fragment>` manually to match the tone-mapped output; I remembered this, otherwise sea would look washed.
- Tweaks after first screenshot: night sky too light, storm sea too bright/foamy -> darkened horizon keys, sea deep colour scaled by wind, foam weight halved.
- Time: ~25% writing the HTML/UI+gameplay, ~55% picture (shaders, textures, lighting keys), ~10% screenshots/tests, ~10% tweaks. No debugging of crashes.
- Verified with playwright: new game, pause overlay, reload -> "continue" restores carry/time/lamps. Not verified by hand: win/lose screens, E relight in real play (code path simple), quality switching visually.
- Known gaps: no sound, no touch input, pier only (no boat), no bloom pass (halo shader does the glow), player is simple lathe/capsule figure, shadows of lamps' point lights not cast (only moon/sun cast).
- Moments: ?moment=dusk|night|storm freezes the clock and lamp gusts so screenshots are stable.
