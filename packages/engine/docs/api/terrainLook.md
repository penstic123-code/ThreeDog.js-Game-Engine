# engine.terrainLook — terrainLook()

Draws the terrain chunks (terrain()'s look module, slot 'terrain-look'; undefined when a game replaced it)


## Methods and properties
- `terrainLook.setMaterial(m: Material)` — Swap the ground material on every loaded chunk at once (look.ground.replace uses it): nothing is regenerated, collision is untouched
- Properties:
  - `material: Material` The ground material every chunk draws with
  - `meshes: Map<TerrainChunk, { group: Object3D; mesh: Mesh; colorTex: …` chunk record -> { group, mesh, colorTex, colorMat }
