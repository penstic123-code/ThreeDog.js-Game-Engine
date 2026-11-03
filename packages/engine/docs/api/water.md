# engine.water — water(opts?: WaterOptions)

Water surface (water() module)

- Options `WaterOptions`:
  - `sea?: boolean` false: do not draw the global water surface (sea)
  - `level?: number` Global water level (meters); if omitted, the terrain's water level is used
  - `flat?: boolean` Flat shading (low poly), default true
  - `size?: number` Edge length of the global water plane (meters), default 900
  - `segments?: number` Mesh subdivision of the global water, default 150
  - `uniforms?: import('./style').StyleWater['uniforms']` Uniforms for your look.water hooks' GLSL (same as style.water.uniforms)

## Methods and properties
- Properties:
  - `material: THREE.Material` Water material (shared by all water)
  - `bodies: Map<WaterBody, THREE.Mesh>` Water body → mesh
  - `sea: THREE.Mesh | null` Global water mesh (null when absent)

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
