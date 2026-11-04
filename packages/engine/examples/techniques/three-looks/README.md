Three looks: the same models as a bright cartoon, a black-and-white comic and a soft cinematic low-poly scene, plain three.js and TSL on the WebGPU route.

# Three looks (technique example)

One set of shapes, three separate scenes. Page `/technique-looks.html?look=cartoon`, `comic` or `cinematic` (`npm run dev`). `main.js` holds shapes only; each file in
`picture/` is a whole look: its materials, lights, fog and post effects. The engine never imports this folder, and none of these looks is a preset to copy: they show
where each kind of decision lives. The principles and how to judge a look are in recipe 56, "A consistent style".

| Decision | cartoon | comic | cinematic |
|---|---|---|---|
| Where light turns, and the shade color | `celLighting`, one colored ramp shared by every material | `celLighting`, a two-entry ramp | `MeshStandardNodeMaterial`, `flatShading` |
| Tone curve | none | none | ACES |
| Line | none | `outline` (hdr), silhouettes and creases | none |
| Finished picture (ldr) | nothing, no post at all | `lut` with `paletteLut`: three inks | `lut` warm grade, `vignette`, `grain` |
| Air | none | none | `scene.fog`, `bloom` (hdr) |

All three share the tree crowns' `wind`, one `positionNode`; their shadows sway with it.

Known limit: the comic's depth lines run together into a gray strip on the far ground, where the surface is seen at a grazing angle. A closer horizon or `mode: 'normal'` avoids it.

The measured differences are in `tests/specs/technique-looks.mjs`: `window.techTest.measure()` gives saturation, luminance spread, warmth and color counts of the frame.
