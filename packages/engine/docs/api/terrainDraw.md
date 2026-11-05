# engine.terrainDraw — terrainDraw()

(experimental) Draws the terrain chunks (terrain()'s drawing module, slot 'terrain-draw'; undefined when a game replaced it)


## Methods and properties
- `terrainDraw.recolor(o?: TerrainRecolor)` — Same as engine.terrain.recolor
- Properties:
  - `material: Material` The ground material every chunk draws with; setting swaps it on every loaded chunk as given (same as engine.terrain.material). Nothing is regenerated, collision is untouched
  - `patches: ShaderPatch[]` Same as engine.terrain.patches
  - `uniforms: Record<string, { value: any }>` Same as engine.terrain.uniforms
  - `meshes: Map<TerrainChunk, { group: Object3D; mesh: Mesh; colorTex: …` chunk record -> { group, mesh, colorTex, colorMat }
