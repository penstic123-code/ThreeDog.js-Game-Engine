# How ThreeDog thinks

English · [中文](philosophy.zh-CN.md) · [Questions and answers](faq.md) · [How it got here](evolution.md)

An AI coding agent asked for a three.js game starts from an empty scene. Before it reaches the gameplay it writes saving, a clock, collision and a camera, and in the next game it writes them again, slightly differently. Those systems also have to agree with each other: a save has to restore the weather, a cutscene has to stop the player, a loaded chunk has to appear in the physics world. ThreeDog exists for that agreement. Three.js is the brush, and the engine lets many brushes work on one canvas without painting over each other, then shows which brush made a mark when something goes wrong.

The main user of the engine is an agent, not a person at a keyboard. That one fact explains most of the decisions below: an agent already knows three.js well, it reads little documentation, and it trusts whatever a tool tells it. So the engine stays close to three.js, keeps its index short, and has to report problems honestly.

> **Where this stands.** The published version is 0.5, which still has the look layer described in the next section. Version 0.6 removes it and is being finished on a work branch. Everything here describes 0.6 unless it says otherwise. The last section lists what is planned and not yet built.

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
| Core | The loop, time, world records and saves, input, events | Touch any rendering value |
| Signals | Time of day, sun direction, weather amounts, wetness, wind, quality tier | Write lights, fog or exposure |
| Capabilities | Terrain chunks, plant instancing, cascaded shadows, light budgets, the post-effect chain | Work on anything the game did not hand over |
| Checks | Screenshots, diagnostic views, performance budgets, pointers to the next step | Change the picture |
| The game | Lights, materials, fog, sky colors, grading, models, rules | Reach into another system's state directly |

Three questions decide whether something belongs in the engine. Three.js must lack it, most games must need it, and it must be easy to get wrong alone or have to work with other systems. A shadow system that follows the player passes all three. A wood material fails the first two, so it stays with the game.

## How separate code shares one frame

Agreement between systems comes from a few small mechanisms, and each one covers a different way code can collide.

**Order is fixed.** Every frame runs gameplay steps, then frame hooks, then render hooks, then shadows, then the draw. Signals are written before the hooks run, so every reader sees the same frame's values.

**Modules declare what they need.** A module says what it `requires` and what it `provides`. A second module providing the same slot is an error at install time unless it says `replaces`, and a missing requirement is an error that names the fix.

**Shared values have one formula.** When several owners really do change one number, such as bullet time and a stopwatch both slowing the world, each one adds an entry with `engine.mod`. Entries combine by layer, from the game through effects and system holds up to the player's settings, and the settings layer can only restrict. Nothing remembers an old value, so effects can end in any order. Two owners who both try to set the value on one layer get an error naming both code lines.

**The engine yields.** The few values the engine still writes, such as the sky's background or the shadow box's center, are registered. When a game writes one directly, the engine stops writing it, keeps the game's value and warns once.

**Everything can be read back.** `engine.describe()` reports what three.js holds now, who wrote each shared value, and which modules hold which slots, so an agent can check its work without guessing.

## The gap this design accepts

Two pieces of the game's own picture code can still collide. If `sky.js` and `rain.js` both assign `sun.intensity`, the later line wins and nothing complains, because this is an ordinary JavaScript assignment. Catching it directly would mean wrapping three.js, which brings the look layer back. The engine accepts this gap on purpose and closes it from the outside, in three steps that are being built for 0.6:

| Kind of value | Example | Rule | On a collision |
|---|---|---|---|
| Only one can exist | Sky, fog, tone and exposure, main light | The code takes a slot with `provides` | Error at install, or an explicit `replaces` |
| Several parties change it | A sunset and a cutscene both dim the sun | A shared value through `engine.mod`, read in one place and written to three.js once | Combined by the formula |
| Just more things | Another lamp, another object | Add it | No conflict, only a budget |

Anything undeclared falls to a development tool that records which line wrote a picture value and reports two writers in one frame. Declaring is voluntary, so this tool is the safety net, and it only sees code that actually runs. Nothing here can tell that a warm lamp clashes with a cold sea. That judgment stays with screenshots and human eyes. This design also has not yet been tested with picture code from different sources in one game.

## Principles

1. Three.js can always be written directly, and what is written takes effect.
2. Engine objects are real three.js objects. Every change the engine makes to three.js is listed in `describe().threePatches`.
3. Nothing limits what an agent can draw. Every picture path ends in "replace it with your own".
4. What three.js already does, the engine does not redo.
5. The engine ships no art: no default style, character or terrain look, only neutral gray placeholders.
6. Defaults fit no single genre.
7. Errors are never silent. An error states the rule that was broken and the line to copy.
8. Each job has one way in, and the vocabulary stays small.
9. When something replaces something else, the old thing is deleted in the same change. There is no compatibility layer before 1.0.
10. A module that is not installed costs nothing.

## WebGL or WebGPU

A game picks its renderer when it starts, because picture code is written differently for each one. WebGL uses GLSL shaders, which agents know best, and it stays the default. WebGPU uses three.js's node language, TSL, and is the only way to some real-time effects. Changing later means rewriting the picture code. The engine's own effects exist in both forms, and a rule in the repository refuses a patch that has only one.

## What the evidence says so far

The evidence is small. In ten timed runs of two small games, half with the engine and half with plain three.js, about two thirds of the code was picture code. So on a game of that size the engine can save perhaps a fifth of the work. Those runs found no case of the engine fighting a game's values, which was the reason to move on from the look layer. In a blind look at eight screenshots, one reviewer named the right side three times, so the engine does not visibly change how a small game looks. Larger games, where saves, streaming and coordination matter more, have not been measured yet.

## What comes next

- Lighting. A trial on three.js 0.187 found that baked probe grids and lightmaps give the best picture for almost no cost per frame and also run on WebGL. Real-time global illumination runs only on WebGPU. These are trial results and are not in the engine yet.
- An asset library that records where each pulled item came from, describes what it needs and writes, and checks that items fit together.
- Composed templates, so one placed object can be made of several parts.
- A browser editor, and a harder art test that combines assets from different sources.
