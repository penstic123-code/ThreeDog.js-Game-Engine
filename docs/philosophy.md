# How ThreeDog thinks

English · [中文](philosophy.zh-CN.md) · [Questions and answers](faq.md) · [How it got here](evolution.md)

An AI coding agent asked for a three.js game starts from an empty scene. Before it reaches the gameplay it writes saving, a clock, collision and a camera, and in the next game it writes them again, slightly differently. Those systems also have to agree with each other: a save has to restore the weather, a cutscene has to stop the player, a loaded chunk has to appear in the physics world. ThreeDog exists for that agreement. Three.js is the brush, and the engine lets many brushes work on one canvas without painting over each other, then shows which brush made a mark when something goes wrong.

The main user of the engine is an agent, not a person at a keyboard. That one fact explains most of the decisions below: an agent already knows three.js well, it reads little documentation, and it trusts whatever a tool tells it. So the engine stays close to three.js, keeps its index short, and has to report problems honestly.

> **Where this stands.** This page describes version 0.9. Version 0.6 was the first in which the engine no longer drew the picture. Versions up to 0.5 had the look layer described in the next section. The last section lists what is planned and not yet built.

## Why the engine stopped drawing the picture

Up to 0.5 the engine held the picture. It owned a table of 18 look parts, each with the same six verbs, and a game changed its fog with `engine.look.fog.set({ far: 60 })`. This looked tidy, and it had two costs that only showed up in use. An agent had to learn a second language for values it could already write in three.js. And the table set a ceiling, because anything the table did not offer needed a new engine entry first.

Version 0.6 turns the arrangement around. The game writes its picture as plain three.js in a folder of its own, and the engine hands over signals: the time of day, the sun's direction, how hard it is raining, how far the player can see.

```js
// The game's picture code. Nothing here is engine language except the signals it reads.
engine.onRender(() => {
  sun.intensity = palette.sunBright * engine.uniforms.uDaylight.value;
  scene.fog.far = palette.fogFar * (1 - 0.6 * engine.uniforms.uRain.value);
});
```

The rule behind this is that every three.js value has one writer, and that writer is the game. The engine no longer changes lights, fog, exposure or the game's materials behind its back, so "I changed the value and it changed back" stops being a possible bug. The large engine parts (terrain, plants, water, the sky dome, rain and snow) are still engine work, but each one hands over its three.js material so a game can change it or replace it.

The price is real. A new game starts gray, and writing the picture is now the game's job. Starter files and a personal asset library soften that, but they do not remove it.

## Who does what

| Part | Does | Does not |
|---|---|---|
| Core | The loop, time, saves, input, events, and the wiring to three.js (scene, renderer, loading, shadows, the changes it lists in `describe().threePatches`) | Decide how the picture looks: lights, materials, fog and colors stay the game's |
| World | The world records (`modules/world`), a module on top of core | Know how a record is drawn |
| Signals | Time of day, sun direction, weather amounts, wetness, wind, quality tier | Write lights, fog or exposure |
| Capabilities | Terrain chunks, plant instancing, cascaded shadows, light budgets, the post-effect chain | Work on anything the game did not hand over |
| Checks | Screenshots, diagnostic views, performance budgets, pointers to the next step | Change the picture |
| The game | Lights, materials, fog, sky colors, grading, models, rules | Reach into another system's state directly |

Three questions decide whether something belongs in the engine. Three.js must lack it, most games must need it, and it must be easy to get wrong alone or have to work with other systems. A shadow system that follows the player passes all three. A wood material fails the first two, so it stays with the game.

## How separate code shares one frame

The frame order, module requirements, shared values with one formula, the engine yielding to direct writes, the known gap and the principles are in [design.md](design.md), sections 2 to 5. They are written there once.

## WebGL or WebGPU

A game picks its renderer when it starts, because picture code is written differently for each one. A new game starts on WebGPU, which uses three.js's node language, TSL, and is the only way to some real-time effects. `--webgl` starts it on GLSL shaders instead, the form agents have seen most. Without WebGPU in the browser the game keeps running on three's WebGL2 backend. Changing later means rewriting the picture code. The engine's own effects exist in both forms, and a rule in the repository refuses a patch that has only one.

## What the evidence says so far

The evidence is small. In ten timed runs of two small games, half with the engine and half with plain three.js, about two thirds of the code was picture code. So on a game of that size the engine can save perhaps a fifth of the work. Those runs found no case of the engine fighting a game's values, which was the reason to move on from the look layer. In a blind look at eight screenshots, one reviewer named the right side three times, so the engine does not visibly change how a small game looks. Larger games, where saves, streaming and coordination matter more, have not been measured yet.

## What comes next

- An asset library that records where each pulled item came from, describes what it needs and writes, and checks that items fit together.
- A harder art test that combines assets from different sources.
