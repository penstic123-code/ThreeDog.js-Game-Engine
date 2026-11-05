# engine.water — water(opts?: WaterOptions)

Water surface (water() module)

- Options `WaterOptions`:
  - `sea?: boolean` false: do not draw the global water surface (sea)
  - `level?: number` Global water level (meters); if omitted, the terrain's water level is used
  - `flat?: boolean` Flat shading (low poly), default true
  - `size?: number` Edge length of the global water plane (meters), default 900
  - `segments?: number` Mesh subdivision of the global water, default 150

## Methods and properties
- `water.shader(opts?: WaterShaderOptions)` — Which GLSL the water has. Keys left out keep what an earlier call gave; null takes one back to the built-in. Refreshes engine.water.patches and engine.water.uniforms and patches the engine's own material again (one recompile). A game's material is the game's to patch again. uWave, uWaveScale, uWaveSpeed and uFresnel stay the same objects. Example: `engine.water.shader({ depthColor: { shallow: 0x55ddcc, deep: 0x082040 }, foam: true }); engine.water.shader({ uniforms: { uBands: 4 }, surface: `vec4 threedogWaterSurface(vec4 base, float wave, float facing, vec3 worldPos, float time) { return vec4(base.rgb * floor(facing * uBands) / uBands, base.a); }` });`
- `water.normalMap(name: string | null, opts?: { scale?, repeat?, speed? }) → THREE.Texture | null` — Normal map by asset name (null = none): a flat-normal placeholder until the asset loads, then it takes the asset's image source (shared, not copied; goes through asset management, so it can be preloaded and released). Goes on the engine's own material; a game's material takes the returned texture (also engine.water.normalTexture). The tiling and the scroll apply whatever material draws. Keys left out keep their value (defaults scale 0.4, repeat 0.05, speed [0.01, 0.006]). Example: `engine.water.normalMap('water-n', { scale: 0.6, repeat: 0.1, speed: [0.02, 0.01] });`
- Properties:
  - `normalTexture: THREE.Texture | null` The loaded normal map (null = none): a game material takes it as its own normalMap. Its offset scrolls and the water UVs tile for it whatever material draws
  - `patches: import("../../render/patches.js").ShaderPatch[]` The engine's water shader patches (waves, waterSurface when asked for, fresnel), so a game material keeps the behavior: applyEffects(mat, { patches: engine.water.patches })
  - `uniforms: Record<string, { value: any }>` Shader values, written directly and live: uWave, uWaveScale, uWaveSpeed, uFresnel, uTime; with depthColor / foam uWaterShallow, uWaterDeep, uWaterCurve, uFoamColor, uFoamStart, uFoamEnd, uFoamOpacity; and what shader({ uniforms }) declared
  - `bodies: Map<WaterBody, THREE.Mesh>` Water body → mesh
  - `sea: THREE.Mesh | null` (experimental) Global water mesh (null when absent)
  - `material: THREE.Material` Water material, shared by all water. Reading gives the plain three.js material in use (a neutral MeshLambertMaterial until you set one); setting swaps it on every water mesh and draws it as given: no engine patch is added, so a material that should keep the waves goes through applyEffects(m, { patches: engine.water.patches })

## Data structures
- **WaterBodyOptions** Parameters of engine.addWaterBody(): position center, level water surface height (meters); give radius for a circle, halfWidth / halfDepth for a rectangle
  - `position: PositionLike`
  - `level: number`
  - `radius?: number`
  - `halfWidth?: number`
  - `halfDepth?: number`
- **WaterBody** A standalone body of water (stored in engine.waterBodies and given by the water:add event, already converted): circle { x, z, radius, level } or rectangle { x, z, hw, hd, level } (meters)
  - `x: number` Center position (meters)
  - `z: number`
  - `level: number` Water surface height (meters)
  - `radius?: number` Radius of a circular body (meters)
  - `hw?: number` Half width and half depth of a rectangular body (meters)
  - `hd?: number`
