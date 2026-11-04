# How ThreeDog got here

English · [中文](evolution.zh-CN.md) · [How ThreeDog thinks](philosophy.md) · [Questions and answers](faq.md)

ThreeDog is a web 3D engine on three.js, made for AI coding agents, and today it declines to draw the picture. A game writes its own lights, fog and materials as plain three.js, and the engine hands it signals such as the time of day. [The philosophy page](philosophy.md) explains that design. It does not explain how an engine that began in a folder called `lowpoly-engine` arrived there, by way of a picture API that took three versions to build and one day to take apart.

The whole history fits into seven days, from 30 October to 5 November 2026, and about 2,000 commits on the main branch. Dates here are commit dates, which can sit a day away from the changelog's. At this speed few decisions could be tried on a real game before the next one was made, so this account says where the evidence runs out.

## 0.1 keeps world data apart from the picture

The first commit, on the night of 30 October, already holds 268 files and about 27,000 lines, and its message calls it the third batch of engine work, so the project's beginning is not in git and its first motive is not written down. The package was `@lpe/engine`, it traveled as a zip called `lowpoly-engine`, it carried a style folder of its own, and within the hour it shared one repository with three game folders, one copied from an open-world example and two empty shells.

The first real design turn came from an outside review, which argued for separating world data from presentation. The next day a `world` module appeared and NPCs, props and pickups moved into it as records, so an NPC's data stayed true while its character existed only as a nearby presentation. That split is still there. The packages were renamed to `threedog` the same afternoon, and no commit says why. Around midnight the version number was reset from an internal 0.4.0 to 0.1.0. The stated plan was an open-source preview holding the engine, the tools and one small example, with the games moving to a private repository. The changelog's 0.1.0 heading says "unreleased" and has nothing under it.

## 0.2 goes public and starts doubting its art

A public repository existed by the first hours of 1 November, so going public came before 0.2. The low-poly look left the engine the same night as an optional package, and the README gained a line saying the engine itself was not low-poly. That evening the first layered look system landed, a table of picture values that would matter later. Version 0.2.0 was committed at about ten that evening.

Much of what 0.2 stands for came just after that commit. `threedog init`, which sets up a game in any folder, arrived twenty minutes later, and a clean template with no gameplay and an empty style folder took another half hour. Two experimental style packs disappeared and lowpoly was retired from recommendation before midnight. The commits record what changed and rarely why. The changelog has no 0.2 entry, so this chapter rests on commit titles.

## 0.3 treats engine features as shortcuts over three.js

On 2 November an audit listed where the engine stood in the way of plain three.js. The repository's own checks raised an error when a game created a three.js material, and the agents' guide listed editing materials directly as a common mistake. An engine built for agents who already know three.js was telling them not to use it. Gameplay had the same trouble, since a test game that wanted a double jump had to poke private fields, and the one global time scale slowed only the calendar.

Two design papers answered overnight, one for the picture and one for gameplay, in shared terms. Three.js could always be written, and engine features were shortcuts. Whatever the engine wrote each frame, a game could take over, and a direct write earned one warning with the line to copy, never a quiet revert. Gameplay gained `engine.mod`, so several owners could change one value, along with a concrete test: base time, speed-up, bullet time, time stop and a pause menu, switched in any order, must not fight. Unknown options began to throw in development, and the calendar and pickups became modules of their own.

The six experimental games were deleted that afternoon, folder and all. The earlier plan had been a private repository, and the commit gives no motive beyond showing that the repository works with zero games. Published style packs went the same morning, which left a game's look in its own `style/` folder. The bill came with 0.3.0 on 3 November, in a [long migration page](../packages/engine/docs/MIGRATING-0.3.md) and a lighting change that altered the default look of every game with a sky. Old saves still loaded.

## 0.4 gives every shared value an owner

A wider look followed the audit, when seven reviewers read one commit separately while all 576 test items passed. They found code that had been swallowed into the comment at the end of a line, which left a network speed check passing about 85 m/s where 5 was meant. Their main finding was larger. Lifecycle, time and "who decides" had no single home, so the same bug appeared module after module. The design that followed called this one fault, a thing written by several parties under separate rules, and rebuilt those systems on shared values with owners and layers. Time got one source, input got contexts, each character got one control slot, and every module had to declare a type.

The picture moved into the same model and reached its tidiest form, 18 look parts with the same six verbs each. Games felt the change at once, because a sun set to intensity 3 now dimmed in rain: a game's value had become the base that effects multiply. The [0.4 migration page](../packages/engine/docs/MIGRATING-0.4.md) is the longest of the four.

WebGPU arrived in this cycle as a choice a game makes at start. The project's own experiment on 31 October had said not to switch, after measuring 8.4 ms a frame against WebGL's 5.3 on an integrated GPU. WebGL stayed the default, so nothing switched, yet the engine took on writing its effects twice. The reason given later is that some real-time effects exist only there. The testing is thin: the final render review ran on a machine where `webgpu` really used the WebGL2 back end.

## 0.5 counts the surface and survives awaits

Version 0.5.0 followed 0.4.0 by less than three hours, and much of it answered an outside review. A module unloaded during its async setup could still act on a same-named module installed after it, so each install got its own identity. Plugins got the same care: two files in one style pack had shared an owner, so switching one off dropped the other's material, and each file became its own owner.

The other job was counting, with a new tool that listed everything an agent could see in the public types. It found 1,719 names at 0.4.0, 243 of them apparently unused, a rough figure because it matches by name. Cleaning brought the total to 1,680. The biggest step moved look values out of module options and into `look.*`, so the table became the only door and gained new parameters for water and sky. The plan that would remove it was committed about two hours after 0.5.0.

## 0.6 stops writing the picture and gives signals

Test reports had been pointing that way. In a small night-street game the sky repainted the hemisphere light every frame, blue after dark, and warm walls went black under a light the game had never written. In a comparison on 3 November the engine saved about four tenths of the code, while the plain three.js version looked more polished. The plan compared five routes and chose [the one the philosophy page describes](philosophy.md#why-the-engine-stopped-drawing-the-picture): the game owns the picture, the engine supplies signals, and terrain, plants, water and the sky dome stay engine work that hands over its materials.

The first blind round did not help the case. In three runs per side, the engine versions used only `createEngine`, wrote their own saves and pause menus, and came out longer than plain three.js, and the screenshots the reviewer singled out as good-looking were all plain three.js. The note written that day held the next step back. After the template was repaired, a second round of two runs per side showed the reviewer could not tell the sides apart, on numbers too small to prove much. The plan also required a medium-sized game finished the new way before the old layer was deleted. No such game existed, and the maintainer dropped that condition. The strongest argument left was a count: 12 games made by AI used `look.*` at most three times each, and only four entries ever appeared. The layer was gone on 4 November, so the reversal rests on a few small tests and that count, and its promise of easier upkeep on larger games is unproven. It also has a price: new games start gray, and two of a game's own files can still [fight over one value](philosophy.md#the-gap-this-design-accepts).

The last review before release built a game using only the template and its guides, then pressed real keys in a browser. Pressing E did nothing, because the guides never bound the key. `check` found nothing, the smoke test passed, `describe` listed the item as interactable, and `ops` reported a successful use, since it runs the action without going through the keyboard. Only `threedog press interact`, which said the action had no key, and a console warning that the smoke test did not count told the truth. An earlier test note had recorded that a real press of E was never tried. The review called this its most important finding, and the engine's users are agents who [trust whatever a tool tells them](philosophy.md). The key was fixed before release, and a missing key is now a loud failure.

## 0.7 moves new games to WebGPU

A new game now starts on WebGPU with TSL, and `--webgl` keeps the GLSL way. The open risk was whether an AI agent could write TSL without getting stuck, so the same island game was built twice. Both runs played from opening to ending on real WebGPU. That is one run per side, enough to show the path works and too few to say how often it does.

The same test disappointed in one place. The new shading helpers, `celLighting` and `paletteLut`, made no visible difference, and the run allowed to use them did not. A later small task named the banded light and outlines it wanted, and the agent found the helpers by itself. So a brief that asks for the effect leads to them, and nothing yet shows an agent reaching for them unprompted.

Global illumination, occlusion culling and volumetric lights arrived as optional parts that run on real WebGPU. An audit of unused public names removed only six of 1,765, because most of the others had a reason to stay.

## What lasted

The picture ran in one direction for four versions, from shortcuts to verbs to a table, until 0.6 removed the table, while the art shrank the whole time, from a built-in look to an optional package to a game's own folder. Gameplay coordination went the other way. `engine.mod`, owners, module requirements and saves that roll back all grew from version to version and are all still in 0.6.

Surviving in the code is a weaker claim than being used. In the blind runs the agents mostly wrote their own versions of these systems, and the case for them is games large enough to need them. No game of that size has been measured yet.
