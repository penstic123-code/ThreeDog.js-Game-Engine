# __NAME__: design

<!-- The short entry to this game's design (keep it under about 8 KB). Detail lives in docs/design/<system>.md, one file per system.
     npm run map copies this file into GAMEMAP.md. Update it in the same commit as the gameplay change. -->

**Pitch**: one sentence on what the player does and why it is fun.

**Core loop**: (not written yet)

**Pillars**
- One line per thing the game must never lose.

## Look and controls
<!-- Chosen with the user in the first session (see CLAUDE.md "First session"); nothing here is a default to keep silently. -->
| Item | Choice | Options (engine name) |
|---|---|---|
| Reference images | (not chosen) | 1-3 images or games whose look to aim for (art/reference/) |
| Style pack | (not chosen) | own pack in style/ (empty now) · a published pack · own pack built on one |
| Ground shading | (not chosen) | smooth · texture (color map, clean color borders) · flat (one color per triangle, faceted) — `look.ground` |
| Character body | (not chosen) | gray capsule placeholder · procedural asset · own GLB from Blender — `{ model }` |
| Asset sources | (not chosen) | per kind (ground and terrain textures, vegetation, characters, props and buildings, effects, sounds): you make or specify · you provide (anything you choose, from anywhere) · generated (procedural code or tools, you confirm) · mix. The AI recommends with reasons; it does not pick an asset library or someone else's style pack on its own |
| Materials and palette | (not chosen) | colors per material role, lambert (matte) · toon (banded) · standard (PBR) · unlit · own material — `look.materials`, `look.surface` |
| Sky and time of day | (not chosen) | fixed time or day/night cycle, sky colors, fog — `look.sky`, `look.fog`, sky presets |
| Lighting and shadows | (not chosen) | sun strength and color, shadow type and softness — `look.lights`, `look.shadow`, `look.env` |
| Post effects | (not chosen) | none · bloom · outline · ao · color grading — `look.post` |
| Camera and controls | follow camera, click to capture the mouse | follow (pointer lock or drag) · first person · top-down / rts · fixed |

## Systems
| System | One line | Detail |
|---|---|---|
