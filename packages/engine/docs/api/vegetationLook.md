# engine.vegetationLook — vegetationLook()

Draws the plants (vegetation()'s look module, slot 'vegetation-look'; undefined when a game replaced it)


## Methods and properties
- `vegetationLook.mesh(c: TerrainChunk, name: string) → InstancedMesh | null` — The InstancedMesh drawing one species in one chunk, null when none
- `vegetationLook.kind(name: string) → { geometry, lodGeometry, material, fadeUniforms } | null | …` — How one species is drawn: its geometry, low-poly geometry, patched material(s), near-fade uniforms; null for an unknown name
- Properties:
  - `meshes: Map<TerrainChunk, { group: Object3D; ims: Record<string, In…` chunk record -> { group, ims: { species name: InstancedMesh } }
