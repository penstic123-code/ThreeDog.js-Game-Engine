# Design decisions

- **This example proves the engine is general-purpose**: it deliberately uses no terrain, vegetation or style, only the level module and a top-down camera. Do not add a style to make it prettier.
- **The map comes from the level scene**: spawn points, NPC spots and trigger zones are all marker points in the scene (content/level.js), so content files keep the same format when later switched to a Blender-exported glTF.
- **No inventory or quests module**: so content/ has no items or quests; to add them, first install inventory() and quests() in main.js's engine.use.
