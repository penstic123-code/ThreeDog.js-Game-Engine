# engine.vegetationDraw — vegetationDraw()

(experimental) Draws the plants (vegetation()'s drawing module, slot 'vegetation-draw'; undefined when a game replaced it)


## Methods and properties
- `vegetationDraw.mesh(c: TerrainChunk, name: string) → InstancedMesh | null` — The InstancedMesh drawing one species in one chunk, null when none
- `vegetationDraw.kind(name: string) → { geometry, lodGeometry, material, fadeUniforms, shared } | null | …` — How one species is drawn: its geometry, low-poly geometry, patched material(s), near-fade uniforms; shared = it draws engine.vegetation.material; null for an unknown name
- Properties:
  - `meshes: Map<TerrainChunk, { group: Object3D; ims: Record<string, In…` chunk record -> { group, ims: { species name: InstancedMesh } }
