# Questions and answers

English · [中文](faq.zh-CN.md) · [How ThreeDog thinks](philosophy.md)

These answers describe version 0.9. Versions up to 0.5 had the look layer. Items marked *planned* are not built yet.

## The idea

### What is the split between three.js and the engine?

Three.js draws. The engine runs what a game needs around the drawing: the loop, time, saves, input, physics, pathfinding, terrain streaming, and the checks that show whether the result works. Engine objects are ordinary three.js objects, so `scene.add`, materials and shaders work the way they always do.

### Do I have to learn a new language to change the picture?

No. Fog is `scene.fog`, a light is `new THREE.DirectionalLight`, and a shader is a shader. The only engine words in picture code are the signals it reads, such as `engine.uniforms.uDaylight`.

### What was the look layer, and why was it removed?

It was a table inside the engine, with 18 look parts and six verbs each, through which a game changed its picture. It repeated values three.js already has, so agents had to learn them twice, and anything missing from the table had to wait for a new engine entry. In 0.6 the game writes its picture directly and the engine only reports signals. The [design notes](philosophy.md) tell the full story.

### Where did the engine's conveniences go?

The hard parts stayed. Cascaded shadows, the post-effect chain, the sky, terrain, plants, water and weather are all still engine work, and each hands over its three.js material or a small entry such as `engine.shadows.cascades(sun)`. What left is the wrapper around values three.js can already set.

### Who writes shaders and textures?

The AI, or you. The engine ships no art and no finished effects. Reusable work goes in a personal library outside the engine, and a pull copies it into the game, which then owns it and can change it.

### Will every game made with it look the same?

That is the risk the design works hardest against. The engine has no default style, and a new game starts neutral gray. Library items are copies that each game changes. Runs of the same brief have still not been compared for sameness at scale.

### The number of public names went up from 1682 to 1731. Did the engine get bigger?

Version 0.9 stands at 1773 after adding optional features. The rise in 0.6 was mostly how the counting works. The old `look.fog.set({ ... })` wrote dozens of values but counted its verb once, and those values now have names of their own. So the count says little in either direction. Whether the engine is simpler has to show in how often agents go wrong.

## Coordination

### Can code from different sources work together?

Mostly, and the mechanisms are fixed frame order, modules that declare what they need and provide, shared values with one formula, and an engine that yields when a game writes a value. The [design notes](philosophy.md#how-separate-code-shares-one-frame) walk through each one.

### What happens when two pieces of picture code write the same value?

Today the later assignment wins and nothing complains, because it is plain JavaScript. Wrapping three.js to stop this would bring back the layer that was removed. The answer has three parts. On the dev server, a tool reports two writers in one frame, with both file and line numbers, and `engine.explain({ picture: 'fog.far' })` says which line wrote a value. Values several parties change go through `engine.mod`. Values that can exist only once take a slot, so a second claim fails at install. Three parts written in different styles run together in a test, and each planned collision fails with a message naming both sides. No real game has tried this yet.

### Can it tell when two assets look wrong together?

No. Tools can measure size, orientation, color space and which values an item writes. A warm lamp beside a cold sea is a matter of taste, and that needs screenshots and a person.

### How do assets fit together, and how are gameplay systems reused?

The library holds models, textures, materials, shaders, effects, modules and whole gameplay systems with their data and tests. Every entry has a card saying what it needs, provides and writes, every pull leaves a record of where the item came from (`lib status`), and `lib check` tells whether what a game pulled fits together. *Planned:* combination entries that show how several pieces connect.

## Rendering

### WebGL or WebGPU?

Pick before you start, because shaders are written differently for each and changing later means rewriting the picture code. A new game starts on WebGPU with TSL; `--webgl` starts it on GLSL, the form agents have seen most. Real-time global illumination and other effects that exist only as TSL nodes need WebGPU. Without WebGPU in the browser the game runs on three's WebGL2 backend. What the four TSL-only effects do in each case (`voxelGI`, `temporalAA`, `sunShafts`, `lightVolumes`; held means switched off with the reason in `describe().render.post`):

| Case | voxelGI | the other three |
|---|---|---|
| Real WebGPU | runs (held on low tier) | run |
| WebGL2 backend (no WebGPU, or `forceWebGL`) | held | run |
| Fell back to `WebGLRenderer` | held | held |
| Game chose WebGL | throws | throw |

### Does it have real-time GI, baked lighting, lightmaps, occlusion culling and volumetrics?

Three.js 0.187 has the parts, a trial measured them, and most are now in the engine (entry points in the last column; screen-space GI is the one left out). The numbers below come from a light test scene at 1280×720 on an AMD Radeon 780M integrated GPU.

| Feature | WebGL | WebGPU | Extra time per frame | Result | In the engine |
|---|---|---|---|---|---|
| Baked probe grid | Yes | Yes | 0.24 ms | Good | `engine.bakeProbes` |
| Lightmap | Use only, baked on WebGPU | Yes | 0 ms | Best | `engine.loadLightmap` |
| Real-time GI with voxels | No | Yes | 3 to 6 ms | Best real-time option, fine for a moving sun, not for objects moving every frame | `voxelGI` in `@threedog/post-effects/tsl` |
| Screen-space GI | No | Yes | 5.5 to 9.3 ms | Weak indoors | No |
| Volumetric lights | Hand-written post effect | Yes | 0.6 ms | Good with spotlights, no effect with the sun | `sunShafts`, `lightVolumes` in `@threedog/post-effects/tsl` |
| Occlusion culling | About 20 lines by hand | Yes | Saves time only behind heavy objects | Worth it for large engine parts, a loss for an ordinary 200-object scene | `engine.occlusion` |

## Compared with other engines

### Does it have nodes, components and prefabs like Godot and Unity?

Some, in a lighter form. Prefabs are templates placed as data, and changing a template changes its instances. A variant is plain JavaScript: `{ ...chest, model: 'iron-chest' }`. Parent and child objects are the three.js scene tree. Components are template fields plus module calls, since an agent does not drag anything onto an object. Composed templates that place several parts at once are *planned*. Template inheritance and a general component system are left out on purpose.

### Why not use PlayCanvas, Godot or Unity?

They are complete engines with their own renderers and editors, and for many projects they are the better choice, especially if you want a mature visual editor today. ThreeDog is for a different bet: agents already write three.js well, so the engine stays on three.js and adds only what three.js lacks. It is young, and that bet is still being tested.

## Using it

### Does it save work?

Less than you might hope on a small game. In ten timed runs of two small games, about two thirds of the code was picture code, so the engine could save perhaps a fifth of the work. The saving should grow with saves, streaming and coordination, but larger games have not been measured yet.

### Can a person use it without an AI?

Yes. It is a JavaScript library with documentation. The docs and tools are shaped for agents, so the short index and the error messages read more like instructions than like a tutorial.

### Is it ready for a real game?

Not yet. It is an early release, its APIs still change, and there is no compatibility layer between versions. Multiplayer exists as a basic `engine.net` but is not being developed for now. Texture compression is `threedog assets optimize`. Staged loading waits until a game needs it.
